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

/// @notice AUSD matches ranked by actual, flat Perpl balances: Duel (1v1), Squad (2v2) and Royale (8 players,
///         lowest equity cut each round). Entry stakes only fund the prize pool; every player trades BTC from
///         an isolated Perpl account funded with a separate trading budget that returns to them afterwards.
///         Leverage: Duel and Royale players pick their own; a Squad side shares the leverage its leader picks.
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
    error PlayerOut(); error NoPosition(); error TooEarly(); error NotLiquidatable(); error NotFlat(); error NotLeader();

    constructor(IERC20 token_, IPerplTrading exchange_, address treasury_, address owner_) Ownable(owner_) {
        (,,,uint256 decimals,address collateral,) = exchange_.getExchangeInfo();
        IPerplExchange.PerpetualInfo memory info = IPerplExchange(address(exchange_)).getPerpetualInfo(16);
        if (collateral != address(token_) || decimals != 6 || treasury_ == address(0) ||
            info.priceDecimals != 1 || info.lotDecimals != 5 || exchange_.getMinAccountOpenCNS() > 100e6) revert BadParams();
        stake = token_; exchange = exchange_; treasury = treasury_; tradingBudget = 100e6;
        accountImplementation = address(new MatchTradingAccount(exchange_, token_));
    }

    /// @notice Fixed formats: Duel 2 players / 60 s, Squad 2v2 / 120 s, Royale 8 players / 180 s.
    function formatOf(Mode mode) public pure returns (uint8 maxPlayers, uint8 teamSize, uint32 duration) {
        if (mode == Mode.DUEL) return (2, 1, 60);
        if (mode == Mode.SQUAD) return (4, 2, 120);
        return (8, 0, 180);
    }
    /// @notice Leverage classes stay inside Perpl's BTC limit (15x initial margin).
    function validLeverage(uint8 leverage) public pure returns (bool) { return leverage == 5 || leverage == 10 || leverage == 15; }

    function createMatch(Mode mode, uint128 entry, uint32 duration, uint8 maxPlayers, uint8 team, uint8 leverage, address session)
        external payable nonReentrant returns (uint256 id)
    {
        (uint8 max, uint8 teamSize, uint32 length) = formatOf(mode);
        if (maxPlayers != max || duration != length ||
            (entry != 5e6 && entry != 20e6 && entry != 50e6) || msg.value != 0) revert BadParams();
        id = ++matchCount;
        matches[id] = Match(mode, State.OPEN, max, teamSize, 0, 0, 0, length, uint64(block.timestamp), 0, 0, entry);
        emit MatchCreated(id, mode, entry, max, length, msg.sender);
        _join(id, team, leverage, session);
    }
    function joinMatch(uint256 id, uint8 team, uint8 leverage, address session) external payable nonReentrant {
        if (msg.value != 0) revert BadParams();
        _join(id, team, leverage, session);
    }
    function _join(uint256 id, uint8 team, uint8 leverage, address session) private {
        Match storage m = matches[id];
        if (m.createdAt == 0 || m.state != State.OPEN || block.timestamp >= m.createdAt + OPEN_TIMEOUT) revert NotOpen();
        if (!validLeverage(leverage) || m.nPlayers >= m.maxPlayers) revert BadParams();
        if (indices[id][msg.sender] != 0 || (session != address(0) && indices[id][session] != 0)) revert AlreadyJoined();
        if (m.mode == Mode.ROYALE) team = 0;
        else {
            if (team > 1) revert BadParams();
            uint256 count;
            Player[] storage cur = players[id];
            for (uint256 i; i < cur.length; i++) if (cur[i].team == team) count++;
            if (count >= m.teamSize) revert BadParams();
            // A Squad side plays at one leverage: whoever sat down first on it (the leader) sets it.
            if (count != 0 && m.mode == Mode.SQUAD) leverage = cur[_leader(id, team)].leverage;
        }
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
        if (m.nPlayers == m.maxPlayers) {
            m.state = State.LIVE; m.startAt = uint64(block.timestamp + COUNTDOWN); m.endAt = m.startAt + m.duration;
            emit MatchStarted(id, m.startAt, m.endAt);
        }
    }
    /// @notice Change leverage class while the lobby fills or during the countdown. In a Squad only the side's
    ///         leader can, and the change applies to the whole side.
    function setClass(uint256 id, uint8 leverage) external {
        Match storage m = matches[id];
        if (!validLeverage(leverage)) revert BadParams();
        if (m.state != State.OPEN && !(m.state == State.LIVE && block.timestamp < m.startAt)) revert NotOpen();
        Player storage p = _player(id);
        if (m.mode != Mode.SQUAD) { p.leverage = leverage; emit ClassChanged(id, p.addr, leverage); return; }
        Player[] storage ps = players[id];
        if (ps[_leader(id, p.team)].addr != p.addr) revert NotLeader();
        for (uint256 i; i < ps.length; i++) {
            if (ps[i].team != p.team) continue;
            ps[i].leverage = leverage; emit ClassChanged(id, ps[i].addr, leverage);
        }
    }
    /// @dev A side's leader is its earliest seated player still in the lobby.
    function _leader(uint256 id, uint8 team) private view returns (uint256) {
        Player[] storage ps = players[id];
        for (uint256 i; i < ps.length; i++) if (ps[i].team == team) return i;
        revert NotPlayer();
    }
    function open(uint256 id, uint8 market, bool isLong, uint16 sizeBps) external nonReentrant {
        Match storage m = matches[id];
        if (m.state != State.LIVE || block.timestamp < m.startAt || block.timestamp >= m.endAt) revert NotLive();
        if (market != 0 || sizeBps == 0 || sizeBps > 10_000) revert BadParams();
        Player storage p = _player(id);
        if (p.out) revert PlayerOut();
        if (_observeLiquidation(id, p)) return;
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
    /// @dev Perpl liquidates on its own; the arena only records that the position is gone.
    function _observeLiquidation(uint256 id, Player storage p) private returns (bool) {
        if (p.out || !p.hasPos) return false;
        (,IPerplTrading.PositionInfoV2 memory pos,) = accountOf[id][p.addr].snapshot();
        if (pos.lotLNS != 0) return false;
        _refresh(id, p); p.out = true; p.outRank = ++matches[id].outCount;
        emit Liquidated(id, p.addr, msg.sender, 0); return true;
    }
    /// @notice ROYALE: at each round boundary the alive player with the lowest Perpl equity is cut. Their
    ///         position is closed on Perpl; their remaining balance still returns to them after settlement.
    function eliminate(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.mode != Mode.ROYALE || m.state != State.LIVE) revert NotLive();
        uint8 rounds = m.maxPlayers - 3;
        if (m.round >= rounds) revert BadParams();
        uint256 due = m.startAt + uint256(m.duration) / (uint256(rounds) + 1) * (uint256(m.round) + 1);
        if (block.timestamp < due || block.timestamp >= m.endAt) revert TooEarly();
        m.round++;
        Player[] storage ps = players[id];
        uint256 alive;
        int256 worst = type(int256).max;
        uint256 worstIdx;
        for (uint256 i; i < ps.length; i++) {
            _observeLiquidation(id, ps[i]);
            if (ps[i].out) continue;
            alive++;
            (,, int256 eq) = accountOf[id][ps[i].addr].snapshot();
            if (eq < worst) (worst, worstIdx) = (eq, i);
        }
        if (alive <= 3) return; // liquidations already thinned the field
        Player storage p = ps[worstIdx];
        // A halted or partial close must not block the cut: the remainder is flattened at settlement.
        if (p.hasPos) try this.finishPlayer(id, p.addr) {} catch (bytes memory reason) { emit CloseDeferred(id, p.addr, reason); }
        _refresh(id, p);
        p.out = true; p.outRank = ++m.outCount;
        emit Eliminated(id, p.addr, p.frozenEquity, m.round);
    }
    function settle(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.state != State.LIVE && m.state != State.CLOSING) revert NotLive();
        if (m.state == State.LIVE && block.timestamp < m.endAt) {
            for (uint256 i; i < players[id].length; i++) _observeLiquidation(id, players[id][i]);
            if (!_decided(id, m)) revert TooEarly();
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
        uint256 n = ps.length;
        uint256[] memory balances = new uint256[](n);
        for (uint256 i; i < n; i++) {
            (IPerplTrading.AccountInfo memory a,,) = accountOf[id][ps[i].addr].snapshot();
            balances[i] = a.balanceCNS;
            ps[i].frozenEquity = int128(int256(a.balanceCNS * 1e12));
            ps[i].realized = int128(int256(a.balanceCNS * 1e12) - MARGIN);
            emit FinalBalance(id, ps[i].addr, a.balanceCNS);
        }
        uint256 pot = uint256(m.entry) * n;
        if (m.mode == Mode.ROYALE) _payRoyale(id, ps, balances, pot);
        else _payTeams(id, m, ps, balances, pot);
        for (uint256 i; i < n; i++) _return(id, ps[i].addr);
    }
    /// @dev Duel and Squad: the side with the larger summed final balance takes the pot minus rake, split
    ///      equally among its players. Equal sides get their entries back with no rake.
    function _payTeams(uint256 id, Match storage m, Player[] storage ps, uint256[] memory balances, uint256 pot) private {
        uint256[2] memory side;
        for (uint256 i; i < ps.length; i++) side[ps[i].team] += balances[i];
        address[] memory winners;
        uint256[] memory payouts;
        if (side[0] == side[1]) {
            winners = new address[](ps.length); payouts = new uint256[](ps.length);
            for (uint256 i; i < ps.length; i++) { winners[i] = ps[i].addr; payouts[i] = m.entry; stake.safeTransfer(ps[i].addr, m.entry); }
            emit Settled(id, winners, payouts, 0);
            return;
        }
        uint8 win = side[0] > side[1] ? 0 : 1;
        uint256 share = (pot - pot * rakeBps / 10_000) / m.teamSize;
        winners = new address[](m.teamSize); payouts = new uint256[](m.teamSize);
        uint256 k;
        for (uint256 i; i < ps.length; i++) {
            if (ps[i].team != win) continue;
            winners[k] = ps[i].addr; payouts[k++] = share;
            stake.safeTransfer(ps[i].addr, share);
        }
        uint256 rake = pot - share * m.teamSize; // rounding dust goes with the rake
        if (rake != 0) stake.safeTransfer(treasury, rake);
        emit Settled(id, winners, payouts, rake);
    }
    /// @dev Royale: survivors rank by final balance, then cut or liquidated players by how late they went out.
    ///      The top three are paid 60% / 30% / 10% of the pot minus rake.
    function _payRoyale(uint256 id, Player[] storage ps, uint256[] memory balances, uint256 pot) private {
        uint256 n = ps.length;
        uint256[] memory order = new uint256[](n);
        for (uint256 i; i < n; i++) order[i] = i;
        for (uint256 i = 1; i < n; i++) {
            uint256 cur = order[i];
            uint256 j = i;
            while (j > 0 && _ranksAbove(ps[cur], balances[cur], ps[order[j - 1]], balances[order[j - 1]])) { order[j] = order[j - 1]; j--; }
            order[j] = cur;
        }
        uint256 prize = pot - pot * rakeBps / 10_000;
        uint16[3] memory split = [uint16(6000), 3000, 1000];
        address[] memory winners = new address[](3);
        uint256[] memory payouts = new uint256[](3);
        uint256 paid;
        for (uint256 k; k < 3; k++) {
            uint256 amount = prize * split[k] / 10_000;
            winners[k] = ps[order[k]].addr; payouts[k] = amount; paid += amount;
            stake.safeTransfer(winners[k], amount);
        }
        uint256 rake = pot - paid;
        if (rake != 0) stake.safeTransfer(treasury, rake);
        emit Settled(id, winners, payouts, rake);
    }
    function _ranksAbove(Player storage a, uint256 balanceA, Player storage b, uint256 balanceB) private view returns (bool) {
        if (a.out != b.out) return !a.out;
        if (!a.out) return balanceA > balanceB;
        return a.outRank > b.outRank;
    }
    /// @dev Early settlement only when nothing left can change the order: nobody can still trade in a
    ///      Duel or Squad, or at most one player remains in a Royale.
    function _decided(uint256 id, Match storage m) private view returns (bool) {
        uint256 alive;
        for (uint256 i; i < players[id].length; i++) if (!players[id][i].out) alive++;
        return m.mode == Mode.ROYALE ? alive <= 1 : alive == 0;
    }
    /// @dev An external self-call isolates a failed exchange close from the other players.
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
    /// @notice Leave a lobby before it fills: the entry and the untouched trading budget both come back.
    function leave(uint256 id) external nonReentrant {
        Match storage m = matches[id]; if (m.state != State.OPEN) revert NotOpen();
        uint8 ix = indices[id][msg.sender];
        if (ix == 0 || players[id][ix - 1].addr != msg.sender) revert NotPlayer();
        Player[] storage ps = players[id];
        uint256 i = ix - 1;
        Player memory leaving = ps[i];
        Player memory last = ps[ps.length - 1];
        ps[i] = last; ps.pop();
        delete indices[id][leaving.addr]; if (leaving.session != address(0)) delete indices[id][leaving.session];
        if (i != ps.length) {
            indices[id][last.addr] = uint8(i + 1);
            if (last.session != address(0)) indices[id][last.session] = uint8(i + 1);
        }
        m.nPlayers--;
        stake.safeTransfer(leaving.addr, m.entry);
        // No trade can happen before the bell, so the budget is withdrawable; a failure reverts and the seat stays.
        uint256 amount = accountOf[id][leaving.addr].returnCollateral();
        returnedCollateral[id][leaving.addr] += amount; emit CollateralReturned(id, leaving.addr, amount);
        emit PlayerLeft(id, leaving.addr);
        if (m.nPlayers == 0) { m.state = State.CANCELLED; emit Cancelled(id); }
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
                m.duration == duration && m.nPlayers < m.maxPlayers && block.timestamp < m.createdAt + OPEN_TIMEOUT) return id;
        }
        return 0;
    }
}
