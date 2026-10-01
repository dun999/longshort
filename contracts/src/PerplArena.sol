// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IPerplTrading} from "./interfaces/IPerplTrading.sol";
import {IPerplExchange} from "./interfaces/IPerplExchange.sol";
import {MatchTradingAccount} from "./MatchTradingAccount.sol";

/// @notice AUSD duels ranked by actual, flat Perpl balances. Entry stakes never collateralize trades.
contract PerplArena is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Mode { DUEL, SQUAD, ROYALE }
    enum State { OPEN, LIVE, SETTLED, CANCELLED, CLOSING }
    struct Position { uint8 market; bool isLong; uint128 notional; uint128 entryPx; }
    struct Player {
        address addr; address session; uint8 team; uint8 leverage;
        bool out; uint8 outRank; bool hasPos; int128 realized; int128 frozenEquity; Position pos;
    }
    struct Match {
        Mode mode; State state; uint8 maxPlayers; uint8 teamSize; uint8 nPlayers; uint8 round; uint8 outCount;
        uint32 duration; uint64 createdAt; uint64 startAt; uint64 endAt; uint128 entry;
    }
    IERC20 public immutable stake;
    IPerplTrading public immutable exchange;
    address public immutable accountImplementation;
    uint256 public immutable tradingBudget;
    address public immutable treasury;
    int256 public constant MARGIN = 100e18;
    uint256 public constant COUNTDOWN = 15;
    uint256 public constant OPEN_TIMEOUT = 5 minutes;
    uint256 public constant RECOVERY_TIMEOUT = 5 minutes;
    uint256 public constant rakeBps = 250;
    uint256 public constant feeBps = 0; // Perpl charges actual protocol fees, not this coordinator.
    uint256 public matchCount;
    mapping(uint256 => Match) private matches;
    mapping(uint256 => Player[]) private players;
    mapping(uint256 => mapping(address => uint8)) private indices;
    mapping(uint256 => mapping(address => MatchTradingAccount)) public accountOf;
    mapping(uint256 => mapping(address => uint256)) public returnedCollateral;

    event MatchCreated(uint256 indexed id, Mode mode, uint256 entry, uint8 maxPlayers, uint32 duration, address creator);
    event PlayerJoined(uint256 indexed id, address indexed player, uint8 team, uint8 leverage, address session);
    event PlayerLeft(uint256 indexed id, address indexed player);
    event ClassChanged(uint256 indexed id, address indexed player, uint8 leverage);
    event MatchStarted(uint256 indexed id, uint64 startAt, uint64 endAt);
    event Opened(uint256 indexed id, address indexed player, uint8 market, bool isLong, uint256 notional, uint256 price, uint256 fee);
    event Closed(uint256 indexed id, address indexed player, uint8 market, uint256 price, int256 pnl, uint256 fee);
    event Liquidated(uint256 indexed id, address indexed player, address liquidator, uint256 price);
    event Eliminated(uint256 indexed id, address indexed player, int256 equity, uint8 round);
    event Settled(uint256 indexed id, address[] winners, uint256[] payouts, uint256 rake);
    event Cancelled(uint256 indexed id);
    event TradingAccountCreated(uint256 indexed id, address indexed player, address account, uint256 accountId, uint256 budget);
    event Closing(uint256 indexed id);
    event CloseDeferred(uint256 indexed id, address indexed player, bytes reason);
    event FinalBalance(uint256 indexed id, address indexed player, uint256 balance);
    event CollateralReturned(uint256 indexed id, address indexed player, uint256 amount);
    error BadParams(); error NotOpen(); error NotLive(); error NotPlayer(); error AlreadyJoined();
    error PlayerOut(); error NoPosition(); error TooEarly(); error NotLiquidatable(); error NotFlat();

    constructor(IERC20 token_, IPerplTrading exchange_, address treasury_, address owner_) Ownable(owner_) {
        (,,,uint256 decimals,address collateral,) = exchange_.getExchangeInfo();
        IPerplExchange.PerpetualInfo memory info = IPerplExchange(address(exchange_)).getPerpetualInfo(16);
        if (collateral != address(token_) || decimals != 6 || treasury_ == address(0) ||
            info.priceDecimals != 1 || info.lotDecimals != 5 || exchange_.getMinAccountOpenCNS() > 100e6) revert BadParams();
        stake = token_; exchange = exchange_; treasury = treasury_; tradingBudget = 100e6;
        accountImplementation = address(new MatchTradingAccount(exchange_, token_));
    }
    function createMatch(Mode mode, uint128 entry, uint32 duration, uint8 maxPlayers, uint8 team, uint8 leverage, address session)
        external payable nonReentrant returns (uint256 id)
    {
        if (mode != Mode.DUEL || maxPlayers != 2 || duration != 60 ||
            (entry != 5e6 && entry != 20e6 && entry != 50e6) || msg.value != 0) revert BadParams();
        id = ++matchCount;
        matches[id] = Match(mode, State.OPEN, 2, 1, 0, 0, 0, duration, uint64(block.timestamp), 0, 0, entry);
        emit MatchCreated(id, mode, entry, maxPlayers, duration, msg.sender);
        _join(id, team, leverage, session);
    }
    function joinMatch(uint256 id, uint8 team, uint8 leverage, address session) external payable nonReentrant {
        if (msg.value != 0) revert BadParams();
        _join(id, team, leverage, session);
    }
    function _join(uint256 id, uint8 team, uint8 leverage, address session) private {
        Match storage m = matches[id];
        if (m.createdAt == 0 || m.state != State.OPEN || block.timestamp >= m.createdAt + OPEN_TIMEOUT) revert NotOpen();
        if (team > 1 || leverage != 5 || m.nPlayers >= 2) revert BadParams();
        if (indices[id][msg.sender] != 0 || (session != address(0) && indices[id][session] != 0)) revert AlreadyJoined();
        if (m.nPlayers == 1 && players[id][0].team == team) revert BadParams();
        stake.safeTransferFrom(msg.sender, address(this), uint256(m.entry) + tradingBudget);
        MatchTradingAccount account = MatchTradingAccount(Clones.clone(accountImplementation));
        stake.safeTransfer(address(account), tradingBudget);
        account.initialize(msg.sender, id, tradingBudget);
        accountOf[id][msg.sender] = account;
        players[id].push(Player(msg.sender, session, team, leverage, false, 0, false, 0, 0, Position(0,false,0,0)));
        uint8 ix = ++m.nPlayers;
        indices[id][msg.sender] = ix;
        if (session != address(0)) indices[id][session] = ix;
        emit PlayerJoined(id, msg.sender, team, leverage, session);
        emit TradingAccountCreated(id, msg.sender, address(account), account.accountId(), tradingBudget);
        if (m.nPlayers == 2) {
            m.state = State.LIVE; m.startAt = uint64(block.timestamp + COUNTDOWN); m.endAt = m.startAt + m.duration;
            emit MatchStarted(id, m.startAt, m.endAt);
        }
    }
    function setClass(uint256 id, uint8 leverage) external {
        Match storage m = matches[id];
        if (leverage != 5) revert BadParams();
        if (m.state != State.OPEN && !(m.state == State.LIVE && block.timestamp < m.startAt)) revert NotOpen();
        Player storage p = _player(id); emit ClassChanged(id, p.addr, leverage);
    }
    function open(uint256 id, uint8 market, bool isLong, uint16 sizeBps) external nonReentrant {
        Match storage m = matches[id];
        if (m.state != State.LIVE || block.timestamp < m.startAt || block.timestamp >= m.endAt) revert NotLive();
        if (market != 0 || sizeBps == 0 || sizeBps > 10_000) revert BadParams();
        Player storage p = _player(id);
        _observeLiquidation(id, p);
        if (p.out) return;
        MatchTradingAccount a = accountOf[id][p.addr];
        if (p.hasPos && !_close(id, p)) revert NotFlat(); // a flip is atomic, never opens over an incomplete close
        (IPerplTrading.AccountInfo memory beforeAccount,,) = a.snapshot();
        a.open(isLong, sizeBps, p.leverage);
        (IPerplTrading.AccountInfo memory afterAccount, IPerplTrading.PositionInfoV2 memory pos,) = a.snapshot();
        uint256 base = afterAccount.balanceCNS + pos.depositCNS;
        uint256 fee = beforeAccount.balanceCNS > base ? beforeAccount.balanceCNS - base : 0;
        _refresh(id, p);
        emit Opened(id, p.addr, 0, isLong, pos.pricePNS * pos.lotLNS * 1e12, pos.pricePNS * 1e17, fee * 1e12);
    }
    function close(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.state != State.LIVE && m.state != State.CLOSING) revert NotLive();
        if (block.timestamp < m.startAt) revert TooEarly();
        Player storage p = _player(id);
        _observeLiquidation(id, p);
        if (!p.hasPos) revert NoPosition();
        _close(id, p);
    }
    function _close(uint256 id, Player storage p) private returns (bool flat) {
        MatchTradingAccount a = accountOf[id][p.addr];
        (IPerplTrading.AccountInfo memory beforeAccount, IPerplTrading.PositionInfoV2 memory beforePos,) = a.snapshot();
        flat = a.closePosition();
        _refresh(id, p);
        if (beforePos.lotLNS != 0 && flat) {
            (IPerplTrading.AccountInfo memory afterAccount,,) = a.snapshot();
            int256 netPnl = int256(afterAccount.balanceCNS) - int256(beforeAccount.balanceCNS + beforePos.depositCNS);
            uint256 px = IPerplExchange(address(exchange)).getPerpetualInfo(16).lastPNS;
            emit Closed(id, p.addr, 0, px * 1e17, netPnl * 1e12, 0); // net includes Perpl close fees and funding
        }
    }
    function liquidate(uint256 id, address who) external nonReentrant {
        uint8 ix = indices[id][who]; if (ix == 0) revert NotPlayer();
        if (!_observeLiquidation(id, players[id][ix - 1])) revert NotLiquidatable();
    }
    function _observeLiquidation(uint256 id, Player storage p) private returns (bool) {
        if (p.out || !p.hasPos) return false;
        (,IPerplTrading.PositionInfoV2 memory pos,) = accountOf[id][p.addr].snapshot();
        if (pos.lotLNS != 0) return false;
        _refresh(id, p); p.out = true; p.outRank = ++matches[id].outCount;
        emit Liquidated(id, p.addr, msg.sender, 0); return true;
    }
    function settle(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.state != State.LIVE && m.state != State.CLOSING) revert NotLive();
        if (block.timestamp < m.endAt) {
            for (uint256 i; i < players[id].length; i++) _observeLiquidation(id, players[id][i]);
            if (m.outCount == 0) revert TooEarly();
        }
        if (m.state != State.CLOSING) { m.state = State.CLOSING; emit Closing(id); }
        bool flat = true;
        for (uint256 i; i < players[id].length; i++) {
            Player storage p = players[id][i];
            // Progress on one account remains committed if another is halted or only partly fills.
            try this.finishPlayer(id, p.addr) returns (bool done) { if (!done) flat = false; }
            catch (bytes memory reason) { flat = false; emit CloseDeferred(id, p.addr, reason); }
        }
        if (!flat) return;
        m.state = State.SETTLED;
        Player[] storage ps = players[id];
        uint256[2] memory balances;
        for (uint256 i; i < 2; i++) {
            (IPerplTrading.AccountInfo memory a,,) = accountOf[id][ps[i].addr].snapshot();
            balances[i] = a.balanceCNS;
            ps[i].frozenEquity = int128(int256(a.balanceCNS * 1e12));
            ps[i].realized = int128(int256(a.balanceCNS * 1e12) - MARGIN);
            emit FinalBalance(id, ps[i].addr, a.balanceCNS);
        }
        uint256 pot = uint256(m.entry) * 2;
        uint256 rake;
        address[] memory winners;
        uint256[] memory payouts;
        if (balances[0] == balances[1]) {
            winners = new address[](2); payouts = new uint256[](2);
            for (uint256 i; i < 2; i++) { winners[i] = ps[i].addr; payouts[i] = m.entry; stake.safeTransfer(ps[i].addr, m.entry); }
        } else {
            uint256 winner = balances[0] > balances[1] ? 0 : 1;
            winners = new address[](1); payouts = new uint256[](1); rake = pot * rakeBps / 10_000;
            winners[0] = ps[winner].addr; payouts[0] = pot - rake;
            stake.safeTransfer(winners[0], pot - rake); stake.safeTransfer(treasury, rake);
        }
        emit Settled(id, winners, payouts, rake);
        for (uint256 i; i < 2; i++) _return(id, ps[i].addr);
    }
    /// @dev An external self-call isolates a failed exchange close from the other player.
    function finishPlayer(uint256 id, address who) external returns (bool) {
        if (msg.sender != address(this)) revert NotPlayer();
        Player storage p = players[id][indices[id][who] - 1];
        _observeLiquidation(id, p);
        if (!_close(id, p)) return false;
        (IPerplTrading.AccountInfo memory a, IPerplTrading.PositionInfoV2 memory pos,) = accountOf[id][who].snapshot();
        return pos.lotLNS == 0 && a.lockedBalanceCNS == 0 &&
            (a.positions.bank1 | a.positions.bank2 | a.positions.bank3 | a.positions.bank4) == 0;
    }
    function recover(uint256 id) external nonReentrant {
        if (!canRecover(id)) revert NotLive();
        Player storage p = _player(id);
        uint256 amount = accountOf[id][p.addr].recover();
        returnedCollateral[id][p.addr] += amount; emit CollateralReturned(id, p.addr, amount);
    }
    function _return(uint256 id, address who) private {
        try accountOf[id][who].returnCollateral() returns (uint256 amount) {
            returnedCollateral[id][who] += amount; emit CollateralReturned(id, who, amount);
        } catch {} // settled scoring is final; recovery retries are independent of the prize
    }
    function leave(uint256 id) external nonReentrant {
        Match storage m = matches[id]; if (m.state != State.OPEN) revert NotOpen();
        Player storage p = _player(id); if (p.addr != msg.sender) revert NotPlayer();
        address who = p.addr;
        delete indices[id][p.addr]; if (p.session != address(0)) delete indices[id][p.session];
        // A duel has at most one player while OPEN. Closing the empty lobby also enables direct account recovery.
        m.state = State.CANCELLED; m.nPlayers = 0;
        stake.safeTransfer(who, m.entry); _return(id, who);
        delete players[id]; emit PlayerLeft(id, who); emit Cancelled(id);
    }
    function cancel(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        bool expiredLobby = m.state == State.OPEN && block.timestamp >= m.createdAt + OPEN_TIMEOUT;
        bool expiredClose = (m.state == State.LIVE || m.state == State.CLOSING) && block.timestamp >= m.endAt + RECOVERY_TIMEOUT;
        if (m.createdAt == 0 || (!expiredLobby && !expiredClose)) revert TooEarly();
        _refund(id);
    }
    function emergencyCancel(uint256 id) external onlyOwner nonReentrant {
        Match storage m = matches[id];
        if (m.state != State.OPEN && !(m.state == State.LIVE && block.timestamp < m.startAt)) revert NotOpen();
        _refund(id); // admin cannot interrupt a trading round or redirect trading capital
    }
    function _refund(uint256 id) private {
        matches[id].state = State.CANCELLED;
        for (uint256 i; i < players[id].length; i++) {
            Player storage p = players[id][i];
            _refresh(id, p); stake.safeTransfer(p.addr, matches[id].entry); _return(id, p.addr);
        }
        emit Cancelled(id);
    }
    function canRecover(uint256 id) public view returns (bool) {
        return matches[id].state == State.SETTLED || matches[id].state == State.CANCELLED;
    }
    function _player(uint256 id) private view returns (Player storage p) {
        uint8 ix = indices[id][msg.sender]; if (ix == 0) revert NotPlayer(); p = players[id][ix - 1];
    }
    function _refresh(uint256 id, Player storage p) private {
        Player memory current = _viewPlayer(id, p);
        p.hasPos = current.hasPos; p.pos = current.pos; p.realized = current.realized; p.frozenEquity = current.frozenEquity;
    }
    function _viewPlayer(uint256 id, Player memory p) private view returns (Player memory) {
        (IPerplTrading.AccountInfo memory a, IPerplTrading.PositionInfoV2 memory pos, int256 equity) = accountOf[id][p.addr].snapshot();
        p.realized = int128((int256(a.balanceCNS + pos.depositCNS) - int256(tradingBudget)) * 1e12);
        p.frozenEquity = int128(equity * 1e12);
        p.hasPos = pos.lotLNS != 0;
        p.pos = p.hasPos ? Position(0, pos.positionType == 0, uint128(pos.pricePNS * pos.lotLNS * 1e12), uint128(pos.pricePNS * 1e17)) : Position(0,false,0,0);
        return p;
    }
    function getPlayers(uint256 id) external view returns (Player[] memory ps) {
        ps = players[id];
        if (matches[id].state == State.SETTLED || matches[id].state == State.CANCELLED) return ps;
        for (uint256 i; i < ps.length; i++) ps[i] = _viewPlayer(id, ps[i]);
    }
    function equities(uint256 id) external view returns (int256[] memory eq) {
        eq = new int256[](players[id].length);
        for (uint256 i; i < eq.length; i++) {
            if (canRecover(id)) eq[i] = players[id][i].frozenEquity;
            else (,,eq[i]) = accountOf[id][players[id][i].addr].snapshot();
            eq[i] *= canRecover(id) ? int256(1) : int256(1e12);
        }
    }
    function getMatch(uint256 id) external view returns (Match memory) { return matches[id]; }
    function playerIndex(uint256 id, address who) external view returns (uint8) { return indices[id][who]; }
    function findOpen(Mode mode, uint128 entry, uint8 maxPlayers, uint32 duration, uint256 lookback) external view returns (uint256) {
        uint256 stop = matchCount > lookback ? matchCount - lookback : 0;
        for (uint256 id = matchCount; id > stop; id--) {
            Match storage m = matches[id];
            if (m.state == State.OPEN && m.mode == mode && m.entry == entry && m.maxPlayers == maxPlayers &&
                m.duration == duration && block.timestamp < m.createdAt + OPEN_TIMEOUT) return id;
        }
        return 0;
    }
    function eliminate(uint256) external pure { revert BadParams(); }
}
