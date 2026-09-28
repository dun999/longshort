// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/// @title ArenaCore — PnL-settled PvP trading matches.
/// @notice Players escrow an entry stake, then trade virtual leveraged perp positions priced by an
///         onchain oracle (Perpl mark price). Every open/close/liquidation/elimination is a tx.
///         When the match ends, relative equity decides who takes the pot. The pot is only ever the
///         players' stakes, so there is no house counterparty.
contract ArenaCore is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ───────────────────────────────────────────────────────────────
    enum Mode { DUEL, SQUAD, ROYALE }
    enum State { OPEN, LIVE, SETTLED, CANCELLED }

    struct Position {
        uint8 market;
        bool isLong;
        uint128 notional; // virtual USD, 1e18
        uint128 entryPx; // 1e18
    }

    struct Player {
        address addr;
        address session;
        uint8 team;
        uint8 leverage;
        bool out; // liquidated or eliminated
        uint8 outRank; // 1 = first out
        bool hasPos;
        int128 realized; // realized pnl net of fees, 1e18
        int128 frozenEquity; // equity at the moment the player went out
        Position pos;
    }

    struct Match {
        Mode mode;
        State state;
        uint8 maxPlayers;
        uint8 teamSize; // 0 for ROYALE (free-for-all)
        uint8 nPlayers;
        uint8 round; // royale eliminations performed
        uint8 outCount;
        uint32 duration;
        uint64 createdAt;
        uint64 startAt;
        uint64 endAt;
        uint128 entry; // stake token units
    }

    // ─── Constants / config ─────────────────────────────────────────────────
    int256 public constant MARGIN = 1000e18; // every player starts with 1000 virtual USD
    int256 public constant MAINT_BPS = 1000; // liquidated at 10% of starting margin
    uint256 public constant COUNTDOWN = 15; // class-select + VS screen before the bell
    uint256 public constant OPEN_TIMEOUT = 5 minutes;
    uint8 public constant NUM_MARKETS = 3; // 0 BTC, 1 ETH, 2 MON

    IERC20 public immutable stake;
    IPriceOracle public oracle;
    address public treasury;
    uint256 public feeBps = 1; // per side, on notional
    uint256 public rakeBps = 250;

    uint256 public matchCount;
    mapping(uint256 => Match) internal _matches;
    mapping(uint256 => Player[]) internal _players;
    mapping(uint256 => mapping(address => uint8)) internal _idxPlus1; // player or session -> index + 1

    // ─── Events ──────────────────────────────────────────────────────────────
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

    // ─── Errors ──────────────────────────────────────────────────────────────
    error BadParams();
    error NotOpen();
    error NotLive();
    error Full();
    error TeamFull();
    error AlreadyJoined();
    error NotPlayer();
    error PlayerOut();
    error NoPosition();
    error NotLiquidatable();
    error TooEarly();
    error BadPrice();

    constructor(IERC20 stake_, IPriceOracle oracle_, address treasury_, address owner_) Ownable(owner_) {
        stake = stake_;
        oracle = oracle_;
        treasury = treasury_;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────
    function setOracle(IPriceOracle oracle_) external onlyOwner {
        oracle = oracle_;
    }

    function setFees(uint256 feeBps_, uint256 rakeBps_, address treasury_) external onlyOwner {
        if (feeBps_ > 50 || rakeBps_ > 1000) revert BadParams();
        (feeBps, rakeBps, treasury) = (feeBps_, rakeBps_, treasury_);
    }

    /// @notice Escape hatch if the oracle dies mid-match: refunds every stake.
    function emergencyCancel(uint256 id) external onlyOwner {
        Match storage m = _matches[id];
        if (m.state != State.OPEN && m.state != State.LIVE) revert NotLive();
        _refundAll(id);
    }

    // ─── Lobby ───────────────────────────────────────────────────────────────
    /// @notice Create a match and join it as the first player, in one tx.
    function createMatch(
        Mode mode,
        uint128 entry,
        uint32 duration,
        uint8 maxPlayers,
        uint8 team,
        uint8 leverage,
        address session
    ) external payable nonReentrant returns (uint256 id) {
        uint8 teamSize;
        if (mode == Mode.DUEL) {
            if (maxPlayers != 2) revert BadParams();
            teamSize = 1;
        } else if (mode == Mode.SQUAD) {
            if (maxPlayers != 4 && maxPlayers != 6) revert BadParams();
            teamSize = maxPlayers / 2;
        } else {
            if (maxPlayers < 3 || maxPlayers > 8) revert BadParams();
        }
        if (duration < 30 || duration > 900) revert BadParams();

        id = ++matchCount;
        Match storage m = _matches[id];
        m.mode = mode;
        m.maxPlayers = maxPlayers;
        m.teamSize = teamSize;
        m.duration = duration;
        m.createdAt = uint64(block.timestamp);
        m.entry = entry;
        emit MatchCreated(id, mode, entry, maxPlayers, duration, msg.sender);
        _join(id, team, leverage, session);
    }

    function joinMatch(uint256 id, uint8 team, uint8 leverage, address session) external payable nonReentrant {
        _join(id, team, leverage, session);
    }

    function leave(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.state != State.OPEN) revert NotOpen();
        uint8 i1 = _idxPlus1[id][msg.sender];
        if (i1 == 0 || _players[id][i1 - 1].addr != msg.sender) revert NotPlayer();

        Player[] storage ps = _players[id];
        uint256 i = i1 - 1;
        Player memory leaving = ps[i];
        Player memory last = ps[ps.length - 1];
        ps[i] = last;
        ps.pop();
        delete _idxPlus1[id][leaving.addr];
        if (leaving.session != address(0)) delete _idxPlus1[id][leaving.session];
        if (i != ps.length) {
            _idxPlus1[id][last.addr] = uint8(i + 1);
            if (last.session != address(0)) _idxPlus1[id][last.session] = uint8(i + 1);
        }
        m.nPlayers--;
        stake.safeTransfer(msg.sender, m.entry);
        emit PlayerLeft(id, msg.sender);
    }

    /// @notice Anyone may cancel a lobby that did not fill in time.
    function cancel(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.state != State.OPEN) revert NotOpen();
        if (block.timestamp < m.createdAt + OPEN_TIMEOUT) revert TooEarly();
        _refundAll(id);
    }

    /// @notice Change leverage class while the lobby fills or during the pre-match countdown.
    function setClass(uint256 id, uint8 leverage) external {
        Match storage m = _matches[id];
        bool preBell = m.state == State.OPEN || (m.state == State.LIVE && block.timestamp < m.startAt);
        if (!preBell) revert NotOpen();
        if (leverage != 10 && leverage != 25 && leverage != 50) revert BadParams();
        uint8 i1 = _idxPlus1[id][msg.sender];
        if (i1 == 0) revert NotPlayer();
        Player storage p = _players[id][i1 - 1];
        p.leverage = leverage;
        emit ClassChanged(id, p.addr, leverage);
    }

    // ─── Trading (player or its session key) ────────────────────────────────
    /// @notice Open a position sized as a fraction of current equity × leverage.
    ///         An existing position is closed first, so a flip is one tx.
    function open(uint256 id, uint8 market, bool isLong, uint16 sizeBps) external nonReentrant {
        if (market >= NUM_MARKETS || sizeBps == 0 || sizeBps > 10_000) revert BadParams();
        (Match storage m, Player storage p) = _trader(id);
        if (p.hasPos) _close(id, p, _price(p.pos.market));
        if (_checkLiq(id, m, p, 0)) return;

        uint256 px = _price(market);
        int256 eq = MARGIN + p.realized;
        uint256 notional = uint256(eq) * p.leverage * sizeBps / 10_000;
        uint256 fee = notional * feeBps / 10_000;
        p.realized -= int128(int256(fee));
        p.pos = Position(market, isLong, uint128(notional), uint128(px));
        p.hasPos = true;
        emit Opened(id, p.addr, market, isLong, notional, px, fee);
    }

    function close(uint256 id) external nonReentrant {
        (Match storage m, Player storage p) = _trader(id);
        if (!p.hasPos) revert NoPosition();
        uint256 px = _price(p.pos.market);
        if (_checkLiq(id, m, p, px)) return;
        _close(id, p, px);
    }

    /// @notice Anyone can liquidate a player whose equity fell to the maintenance level.
    function liquidate(uint256 id, address player) external nonReentrant {
        Match storage m = _matches[id];
        if (m.state != State.LIVE || block.timestamp >= m.endAt) revert NotLive();
        Player storage p = _playerOf(id, player);
        if (p.out || !p.hasPos) revert NotLiquidatable();
        if (!_checkLiq(id, m, p, _price(p.pos.market))) revert NotLiquidatable();
    }

    /// @notice ROYALE: after each round boundary, the lowest-equity survivor is knocked out.
    function eliminate(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.mode != Mode.ROYALE || m.state != State.LIVE) revert NotLive();
        uint8 maxRounds = m.maxPlayers > 3 ? m.maxPlayers - 3 : 0;
        if (m.round >= maxRounds) revert BadParams();
        uint256 roundLen = m.duration / (uint256(maxRounds) + 1);
        uint256 due = m.startAt + roundLen * (uint256(m.round) + 1);
        if (block.timestamp < due || block.timestamp >= m.endAt) revert TooEarly();
        m.round++;

        uint256[NUM_MARKETS] memory pxs;
        Player[] storage ps = _players[id];
        uint256 alive;
        int256 worst = type(int256).max;
        uint256 worstIdx;
        for (uint256 i; i < ps.length; ++i) {
            if (ps[i].out) continue;
            alive++;
            int256 eq = _equity(ps[i], pxs);
            if (eq < worst) (worst, worstIdx) = (eq, i);
        }
        if (alive <= 3) return; // liquidations already thinned the field
        Player storage p = ps[worstIdx];
        if (p.hasPos) _close(id, p, _cached(pxs, p.pos.market));
        _knockOut(m, p);
        emit Eliminated(id, p.addr, p.frozenEquity, m.round);
    }

    // ─── Settlement ──────────────────────────────────────────────────────────
    function settle(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.state != State.LIVE) revert NotLive();
        if (block.timestamp < m.endAt && !_decided(id, m)) revert TooEarly();
        m.state = State.SETTLED;

        Player[] storage ps = _players[id];
        uint256[NUM_MARKETS] memory pxs;
        int256[] memory eq = new int256[](ps.length);
        for (uint256 i; i < ps.length; ++i) {
            Player storage p = ps[i];
            if (!p.out && p.hasPos) _close(id, p, _cached(pxs, p.pos.market));
            eq[i] = p.out ? int256(p.frozenEquity) : _clamp(MARGIN + p.realized);
        }

        uint256 pot = uint256(m.entry) * ps.length;
        if (m.mode == Mode.ROYALE) _payRoyale(id, ps, eq, pot);
        else _payTeams(id, m, ps, eq, pot);
    }

    function _payTeams(uint256 id, Match storage m, Player[] storage ps, int256[] memory eq, uint256 pot) internal {
        int256[2] memory teamEq;
        for (uint256 i; i < ps.length; ++i) teamEq[ps[i].team] += eq[i];
        if (teamEq[0] == teamEq[1]) {
            _refundSettled(id, ps, m.entry);
            return;
        }
        uint8 win = teamEq[0] > teamEq[1] ? 0 : 1;
        uint256 rake = pot * rakeBps / 10_000;
        uint256 share = (pot - rake) / m.teamSize;
        address[] memory winners = new address[](m.teamSize);
        uint256[] memory payouts = new uint256[](m.teamSize);
        uint256 k;
        for (uint256 i; i < ps.length; ++i) {
            if (ps[i].team != win) continue;
            winners[k] = ps[i].addr;
            payouts[k++] = share;
            stake.safeTransfer(ps[i].addr, share);
        }
        rake = pot - share * m.teamSize; // dust goes to treasury
        if (rake > 0) stake.safeTransfer(treasury, rake);
        emit Settled(id, winners, payouts, rake);
    }

    function _payRoyale(uint256 id, Player[] storage ps, int256[] memory eq, uint256 pot) internal {
        uint256 n = ps.length;
        uint256[] memory order = new uint256[](n);
        for (uint256 i; i < n; ++i) order[i] = i;
        // insertion sort: survivors by equity desc, then the out players by how late they went out
        for (uint256 i = 1; i < n; ++i) {
            uint256 cur = order[i];
            uint256 j = i;
            while (j > 0 && _ranksAbove(ps[cur], eq[cur], ps[order[j - 1]], eq[order[j - 1]])) {
                order[j] = order[j - 1];
                j--;
            }
            order[j] = cur;
        }
        uint256 rake = pot * rakeBps / 10_000;
        uint256 prize = pot - rake;
        uint16[3] memory split = [uint16(6000), 3000, 1000];
        address[] memory winners = new address[](3);
        uint256[] memory payouts = new uint256[](3);
        uint256 paid;
        for (uint256 k; k < 3; ++k) {
            uint256 amt = prize * split[k] / 10_000;
            winners[k] = ps[order[k]].addr;
            payouts[k] = amt;
            paid += amt;
            stake.safeTransfer(winners[k], amt);
        }
        rake = pot - paid;
        if (rake > 0) stake.safeTransfer(treasury, rake);
        emit Settled(id, winners, payouts, rake);
    }

    function _ranksAbove(Player storage a, int256 ea, Player storage b, int256 eb) internal view returns (bool) {
        if (a.out != b.out) return !a.out;
        if (!a.out) return ea > eb;
        return a.outRank > b.outRank;
    }

    // ─── Views ───────────────────────────────────────────────────────────────
    function getMatch(uint256 id) external view returns (Match memory) {
        return _matches[id];
    }

    function getPlayers(uint256 id) external view returns (Player[] memory) {
        return _players[id];
    }

    /// @notice Live equity per player at the current oracle prices (out players return frozen equity).
    function equities(uint256 id) external view returns (int256[] memory eq) {
        Player[] storage ps = _players[id];
        uint256[NUM_MARKETS] memory pxs;
        eq = new int256[](ps.length);
        for (uint256 i; i < ps.length; ++i) eq[i] = ps[i].out ? int256(ps[i].frozenEquity) : _equity(ps[i], pxs);
    }

    /// @notice Most recent joinable lobby for the given settings, or 0. Scans the last `lookback` matches.
    function findOpen(Mode mode, uint128 entry, uint8 maxPlayers, uint32 duration, uint256 lookback)
        external
        view
        returns (uint256)
    {
        uint256 stop = matchCount > lookback ? matchCount - lookback : 0;
        for (uint256 id = matchCount; id > stop; --id) {
            Match storage m = _matches[id];
            if (
                m.state == State.OPEN && m.mode == mode && m.entry == entry && m.maxPlayers == maxPlayers
                    && m.duration == duration && m.nPlayers < maxPlayers
                    && block.timestamp < m.createdAt + OPEN_TIMEOUT
            ) return id;
        }
        return 0;
    }

    function playerIndex(uint256 id, address who) external view returns (uint8) {
        return _idxPlus1[id][who];
    }

    // ─── Internals ───────────────────────────────────────────────────────────
    function _join(uint256 id, uint8 team, uint8 leverage, address session) internal {
        Match storage m = _matches[id];
        if (m.state != State.OPEN || m.createdAt == 0) revert NotOpen();
        if (m.nPlayers >= m.maxPlayers) revert Full();
        if (leverage != 10 && leverage != 25 && leverage != 50) revert BadParams();
        if (_idxPlus1[id][msg.sender] != 0) revert AlreadyJoined();
        if (session != address(0) && _idxPlus1[id][session] != 0) revert AlreadyJoined();

        if (m.mode == Mode.ROYALE) {
            team = 0;
        } else {
            if (team > 1) revert BadParams();
            uint256 count;
            Player[] storage cur = _players[id];
            for (uint256 i; i < cur.length; ++i) if (cur[i].team == team) count++;
            if (count >= m.teamSize) revert TeamFull();
        }

        stake.safeTransferFrom(msg.sender, address(this), m.entry);
        _players[id].push();
        Player storage p = _players[id][_players[id].length - 1];
        p.addr = msg.sender;
        p.session = session;
        p.team = team;
        p.leverage = leverage;
        uint8 idx = uint8(_players[id].length);
        _idxPlus1[id][msg.sender] = idx;
        if (session != address(0)) _idxPlus1[id][session] = idx;
        m.nPlayers++;
        emit PlayerJoined(id, msg.sender, team, leverage, session);

        if (msg.value > 0) {
            // top up the session key with gas so trades never pop a wallet
            (bool ok,) = (session == address(0) ? msg.sender : session).call{value: msg.value}("");
            if (!ok) revert BadParams();
        }

        if (m.nPlayers == m.maxPlayers) {
            m.state = State.LIVE;
            m.startAt = uint64(block.timestamp + COUNTDOWN);
            m.endAt = m.startAt + m.duration;
            emit MatchStarted(id, m.startAt, m.endAt);
        }
    }

    function _trader(uint256 id) internal view returns (Match storage m, Player storage p) {
        m = _matches[id];
        if (m.state != State.LIVE || block.timestamp < m.startAt || block.timestamp >= m.endAt) revert NotLive();
        uint8 i1 = _idxPlus1[id][msg.sender];
        if (i1 == 0) revert NotPlayer();
        p = _players[id][i1 - 1];
        if (p.out) revert PlayerOut();
    }

    function _playerOf(uint256 id, address who) internal view returns (Player storage) {
        uint8 i1 = _idxPlus1[id][who];
        if (i1 == 0) revert NotPlayer();
        return _players[id][i1 - 1];
    }

    function _close(uint256 id, Player storage p, uint256 px) internal {
        int256 pnl = _upnl(p.pos, px);
        uint256 fee = uint256(p.pos.notional) * feeBps / 10_000;
        p.realized += int128(pnl - int256(fee));
        p.hasPos = false;
        emit Closed(id, p.addr, p.pos.market, px, pnl, fee);
        delete p.pos;
    }

    /// @dev Liquidates `p` if equity is at or below maintenance. `px` = 0 means "no open position".
    function _checkLiq(uint256 id, Match storage m, Player storage p, uint256 px) internal returns (bool) {
        int256 eq = MARGIN + p.realized + (p.hasPos && px != 0 ? _upnl(p.pos, px) : int256(0));
        if (eq > MARGIN * MAINT_BPS / 10_000) return false;
        if (p.hasPos) {
            delete p.pos;
            p.hasPos = false;
        }
        p.realized = int128(-MARGIN);
        _knockOut(m, p);
        emit Liquidated(id, p.addr, msg.sender, px);
        return true;
    }

    function _knockOut(Match storage m, Player storage p) internal {
        p.out = true;
        p.outRank = ++m.outCount;
        p.frozenEquity = int128(_clamp(MARGIN + p.realized));
    }

    /// @dev Match can settle before the bell once only one side (or one royale player) remains.
    function _decided(uint256 id, Match storage m) internal view returns (bool) {
        Player[] storage ps = _players[id];
        uint256[2] memory aliveByTeam;
        uint256 alive;
        for (uint256 i; i < ps.length; ++i) {
            if (ps[i].out) continue;
            alive++;
            aliveByTeam[ps[i].team]++;
        }
        if (m.mode == Mode.ROYALE) return alive <= 1;
        return aliveByTeam[0] == 0 || aliveByTeam[1] == 0;
    }

    function _refundAll(uint256 id) internal {
        Match storage m = _matches[id];
        m.state = State.CANCELLED;
        Player[] storage ps = _players[id];
        for (uint256 i; i < ps.length; ++i) stake.safeTransfer(ps[i].addr, m.entry);
        emit Cancelled(id);
    }

    function _refundSettled(uint256 id, Player[] storage ps, uint256 entry) internal {
        address[] memory winners = new address[](ps.length);
        uint256[] memory payouts = new uint256[](ps.length);
        for (uint256 i; i < ps.length; ++i) {
            winners[i] = ps[i].addr;
            payouts[i] = entry;
            stake.safeTransfer(ps[i].addr, entry);
        }
        emit Settled(id, winners, payouts, 0);
    }

    function _price(uint8 market) internal view returns (uint256 px) {
        (px,) = oracle.price(market);
        if (px == 0) revert BadPrice();
    }

    /// @dev Lazily fills a price cache so a stale feed on an unused market can't block settlement.
    function _cached(uint256[NUM_MARKETS] memory pxs, uint8 market) internal view returns (uint256) {
        if (pxs[market] == 0) pxs[market] = _price(market);
        return pxs[market];
    }

    function _upnl(Position memory pos, uint256 px) internal pure returns (int256) {
        int256 move = (int256(px) - int256(uint256(pos.entryPx))) * int256(uint256(pos.notional)) / int256(uint256(pos.entryPx));
        return pos.isLong ? move : -move;
    }

    function _equity(Player storage p, uint256[NUM_MARKETS] memory pxs) internal view returns (int256) {
        int256 eq = MARGIN + p.realized;
        if (p.hasPos) eq += _upnl(p.pos, _cached(pxs, p.pos.market));
        return _clamp(eq);
    }

    function _clamp(int256 x) internal pure returns (int256) {
        return x < 0 ? int256(0) : x;
    }
}
