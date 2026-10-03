// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPerplTrading} from "./interfaces/IPerplTrading.sol";
import {IPerplExchange} from "./interfaces/IPerplExchange.sol";

interface IRecoveryArena { function canRecover(uint256 id) external view returns (bool); }

/// @notice One player's isolated BTC account. No general call, API forwarding, deposits or operator withdrawals.
contract MatchTradingAccount {
    using SafeERC20 for IERC20;
    IPerplTrading public immutable exchange;
    IERC20 public immutable token;
    uint256 public constant PERP_ID = 16;
    address public arena;
    address public beneficiary;
    uint256 public matchId;
    uint256 public accountId;
    uint256 private sequence;
    uint8 private leverageOpen; // set by open(); clones start zeroed, so closes fall back to 5x
    bool private initialized;
    error Unauthorized();
    error BadExecution();
    error NotFlat();

    constructor(IPerplTrading exchange_, IERC20 token_) {
        exchange = exchange_;
        token = token_;
        initialized = true; // only clones can initialize
    }
    modifier onlyArena() { if (msg.sender != arena) revert Unauthorized(); _; }

    function initialize(address beneficiary_, uint256 matchId_, uint256 budget) external {
        if (initialized || beneficiary_ == address(0)) revert Unauthorized();
        initialized = true;
        arena = msg.sender;
        beneficiary = beneficiary_;
        matchId = matchId_;
        token.forceApprove(address(exchange), budget);
        accountId = exchange.createAccount(budget);
        token.forceApprove(address(exchange), 0);
        if (accountId == 0) revert BadExecution();
    }

    function snapshot() public view returns (
        IPerplTrading.AccountInfo memory a, IPerplTrading.PositionInfoV2 memory p, int256 equity
    ) {
        a = exchange.getAccountByAddr(address(this));
        (p,,) = exchange.getPositionV2(PERP_ID, accountId);
        equity = int256(a.balanceCNS + p.depositCNS) + p.pnlCNS;
        if (equity < 0) equity = 0;
    }

    function open(bool isLong, uint16 sizeBps, uint8 leverage) external onlyArena {
        (IPerplTrading.AccountInfo memory a, IPerplTrading.PositionInfoV2 memory p,) = snapshot();
        if (p.lotLNS != 0 || a.lockedBalanceCNS != 0 || a.frozen != 0) revert BadExecution();
        uint256 mark = IPerplExchange(address(exchange)).getPerpetualInfo(PERP_ID).markPNS;
        if (mark == 0) revert BadExecution();
        // BTC price has 1 decimal and size 5: their product is directly AUSD's 6-decimal notional.
        uint256 lots = a.balanceCNS * leverage * sizeBps * 95 / 1_000_000 / mark;
        if (lots == 0) revert BadExecution();
        leverageOpen = leverage;
        exchange.execOrder(_order(isLong ? 0 : 1, lots, mark, leverage, true));
        (,p,) = snapshot();
        // Perpl can reject an order inside a successful tx. Prove a complete fill before emitting game events.
        if (p.lotLNS != lots) revert BadExecution();
    }

    function closePosition() public onlyArena returns (bool flat) { return _close(); }
    function _close() private returns (bool) {
        (,IPerplTrading.PositionInfoV2 memory p,) = snapshot();
        if (p.lotLNS == 0) return true;
        uint256 mark = IPerplExchange(address(exchange)).getPerpetualInfo(PERP_ID).markPNS;
        if (mark == 0) revert BadExecution();
        // Reduce-only + IOC: retries never flip the position or leave resting orders behind.
        exchange.execOrder(_order(p.positionType == 0 ? 2 : 3, p.lotLNS, mark, leverageOpen == 0 ? 5 : leverageOpen, false));
        (,IPerplTrading.PositionInfoV2 memory afterPos,) = snapshot();
        if (afterPos.lotLNS > p.lotLNS) revert BadExecution();
        return afterPos.lotLNS == 0;
    }

    function returnCollateral() external onlyArena returns (uint256) { return _withdraw(); }

    /// @notice Permissionless recovery always sends to the passkey owner, even when the keeper is unavailable.
    function recover() external returns (uint256) {
        if (!IRecoveryArena(arena).canRecover(matchId)) revert Unauthorized();
        if (!_close()) return 0;
        return _withdraw();
    }
    function _withdraw() private returns (uint256 amount) {
        (IPerplTrading.AccountInfo memory a, IPerplTrading.PositionInfoV2 memory p,) = snapshot();
        if (p.lotLNS != 0 || a.lockedBalanceCNS != 0 ||
            (a.positions.bank1 | a.positions.bank2 | a.positions.bank3 | a.positions.bank4) != 0) revert NotFlat();
        amount = a.balanceCNS;
        if (amount != 0) exchange.withdrawCollateral(amount);
        uint256 held = token.balanceOf(address(this));
        if (held != 0) token.safeTransfer(beneficiary, held);
    }
    function _order(uint8 kind, uint256 lots, uint256 mark, uint8 leverage, bool opening)
        private returns (IPerplTrading.OrderDesc memory o)
    {
        o.orderDescId = ++sequence;
        o.perpId = PERP_ID;
        o.orderType = kind;
        bool buying = kind == 0 || kind == 3;
        o.pricePNS = mark * (buying ? 101 : 99) / 100;
        o.lotLNS = lots;
        o.fillOrKill = opening;
        o.immediateOrCancel = true;
        o.maxMatches = 20;
        o.leverageHdths = uint256(leverage) * 100;
        o.lastExecutionBlock = block.number;
        o.maxNegPnlCollatBPS = opening ? 1000 : 10_000;
    }
}
