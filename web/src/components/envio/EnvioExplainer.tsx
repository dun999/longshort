'use client';
/*
 * envio.longshort.fun: how Envio HyperIndex turns Monad events into what the game shows. Everything on
 * this page is read live from the same GraphQL endpoint the leaderboard, profiles and reports use.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ADDR, MODES, Mode, explorerAddr, explorerTx, fmtUsd, shortAddr } from '@longshort/shared';
import { ARENA_ID, ENVIO_URL, EnvioMark, LEADERBOARD_QUERY, envioLeaderboard, envioMatch, envioOverview, envioQuery, type EnvioOverview } from '@/lib/envio';
import s from './envio.module.css';

// ─── what writes what (indexer/src/handlers/ArenaCore.ts) and what reads it (web/src/lib/envio.tsx) ───
type Src = 'arena' | 'perpl' | 'ausd';
const SOURCES: Record<Src, { name: string; role: string; addr: string }> = {
  arena: { name: 'PerplArena', role: 'Our game contract: rounds, seats, trades, payouts', addr: ADDR.arena },
  perpl: { name: 'Perpl', role: 'The BTC-PERP order book every trade fills on', addr: ADDR.perplExchange },
  ausd: { name: 'AUSD', role: 'Agora’s stablecoin: entries, budgets, prizes', addr: ADDR.stake },
};
const EVENTS: { id: string; src: Src; writes: string[]; note: string }[] = [
  { id: 'MatchCreated', src: 'arena', writes: ['Match', 'ArenaStats'], note: 'a lobby opens with its mode, entry, length and seats' },
  { id: 'PlayerJoined', src: 'arena', writes: ['Match', 'MatchPlayer', 'Trader', 'ArenaStats'], note: 'a player takes a seat and their entry is counted' },
  { id: 'PlayerLeft', src: 'arena', writes: ['Match', 'MatchPlayer', 'Trader', 'ArenaStats'], note: 'a player leaves an open lobby and the entry comes off the books' },
  { id: 'ClassChanged', src: 'arena', writes: ['MatchPlayer'], note: 'leverage changed before the bell' },
  { id: 'MatchStarted', src: 'arena', writes: ['Match'], note: 'the lobby is full and the start and end times are fixed' },
  { id: 'TradingAccountCreated', src: 'arena', writes: ['TradingAccount', 'VaultAddress', 'MatchPlayer'], note: 'the player’s isolated Perpl account for this round' },
  { id: 'Opened', src: 'arena', writes: ['Trade', 'Match', 'MatchPlayer', 'Trader', 'ArenaStats', 'DailyStat'], note: 'a long or short opened through the arena' },
  { id: 'Closed', src: 'arena', writes: ['Trade', 'MatchPlayer'], note: 'a position closed, with its realized PnL and fee' },
  { id: 'Liquidated', src: 'arena', writes: ['Trade', 'MatchPlayer', 'Trader', 'ArenaStats'], note: 'Perpl liquidated the position and the player is out' },
  { id: 'Eliminated', src: 'arena', writes: ['Trade', 'MatchPlayer', 'ArenaStats'], note: 'a Royale cut: the lowest balance is out with its equity frozen' },
  { id: 'Closing', src: 'arena', writes: ['Match'], note: 'the bell: every account is being flattened' },
  { id: 'FinalBalance', src: 'arena', writes: ['MatchPlayer', 'TradingAccount'], note: 'each account’s balance at the bell, which ranks the round' },
  { id: 'Settled', src: 'arena', writes: ['Match', 'MatchPlayer', 'Trader', 'ArenaStats', 'DailyStat'], note: 'results, payouts and XP for every player' },
  { id: 'Cancelled', src: 'arena', writes: ['Match', 'TradingAccount', 'ArenaStats'], note: 'a lobby that never filled; every entry refunded' },
  { id: 'OrderRequestV2', src: 'perpl', writes: ['PerplOrder'], note: 'Perpl’s order request, tied to one of our trading accounts by its transaction' },
  { id: 'TakerOrderFilledV2', src: 'perpl', writes: ['PerplFill', 'Match', 'MatchPlayer', 'Trader', 'ArenaStats', 'DailyStat'], note: 'an actual Perpl fill: price, size, fee and volume' },
  { id: 'Transfer', src: 'ausd', writes: ['TradingAccount'], note: 'AUSD leaving a trading account for its owner: returned collateral' },
];
const ENTITIES: { id: string; note: string }[] = [
  { id: 'Match', note: 'One round: state, players, volume, payout, settlement tx' },
  { id: 'MatchPlayer', note: 'A player in a round: leverage, result, payout, XP change' },
  { id: 'Trade', note: 'The arena’s open, close and liquidation log' },
  { id: 'TradingAccount', note: 'Isolated Perpl account: budget, final and returned balance' },
  { id: 'PerplOrder', note: 'Bridge from a Perpl order to our trading account' },
  { id: 'PerplFill', note: 'A real fill on Perpl: price, size, fee' },
  { id: 'VaultAddress', note: 'Account contract address → Perpl account' },
  { id: 'Trader', note: 'Lifetime record: XP, wins, losses, volume, earnings' },
  { id: 'ArenaStats', note: 'Arena-wide totals' },
  { id: 'DailyStat', note: 'Trades, volume and settled rounds per day' },
];
const SCREENS: { id: string; name: string; href?: string; reads: string[]; note: string }[] = [
  { id: 'leaderboard', name: 'Leaderboard', href: '/leaderboard', reads: ['Trader'], note: 'Ranked by XP, then wins. Names and bot labels join in from the game server.' },
  { id: 'profile', name: 'Player profile', reads: ['Trader', 'MatchPlayer', 'Match'], note: 'Lifetime record and the last 30 rounds.' },
  { id: 'report', name: 'Match report', reads: ['Match', 'MatchPlayer', 'TradingAccount', 'PerplFill', 'Trade'], note: 'Every fill, fee, payout and returned balance, with transaction links.' },
  { id: 'stats', name: 'Arena stats', href: '/stats', reads: ['ArenaStats', 'DailyStat', 'Match'], note: 'Totals, daily activity and rounds by mode.' },
];

type Focus = { kind: 'event' | 'entity' | 'screen'; id: string } | null;
function related(f: Focus) {
  if (!f) return null;
  const ev = new Set<string>(), en = new Set<string>(), sc = new Set<string>();
  if (f.kind === 'event') {
    ev.add(f.id);
    EVENTS.find((e) => e.id === f.id)?.writes.forEach((w) => en.add(w));
  } else if (f.kind === 'entity') {
    en.add(f.id);
    EVENTS.filter((e) => e.writes.includes(f.id)).forEach((e) => ev.add(e.id));
  } else {
    sc.add(f.id);
    SCREENS.find((x) => x.id === f.id)?.reads.forEach((r) => en.add(r));
    EVENTS.filter((e) => e.writes.some((w) => en.has(w))).forEach((e) => ev.add(e.id));
  }
  if (f.kind !== 'screen') SCREENS.filter((x) => x.reads.some((r) => en.has(r))).forEach((x) => sc.add(x.id));
  return { ev, en, sc };
}
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// ─── formatting ───
const int = (n?: number) => (n === undefined ? '—' : n.toLocaleString('en-US'));
const ausd = (n?: number, dp = 2) => (n === undefined ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })} AUSD`);
const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function usePoll<T>(load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const run = useCallback(() => load().then((d) => (setData(d), setError(undefined)), (e: Error) => setError(e.message)), [load]);
  useEffect(() => {
    void run();
    const t = setInterval(run, ms);
    return () => clearInterval(t);
  }, [run, ms]);
  return { data, error, reload: run };
}

export function EnvioExplainer() {
  const { data: o, error } = usePoll(envioOverview, 8000);
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={`${s.wrap} ${s.topRow}`}>
          <Link href="/play" className={s.brand}>
            <span>longshort<i>.fun</i></span>
            <span className={s.brandX}>×</span>
            <span className={s.brandEnvio}><EnvioMark size={15} /> Envio</span>
          </Link>
          <nav className={s.nav}>
            <a href="#pipeline">Pipeline</a>
            <a href="#leaderboard">Leaderboard</a>
            <a href="#round">One round</a>
            <a href="#activity">Activity</a>
            <a href="#design">Design</a>
          </nav>
        </div>
      </header>
      <main className={s.wrap}>
        <Hero o={o} error={error} />
        <Pipeline o={o} />
        <LeaderboardSection />
        <RoundTrace o={o} />
        <Activity o={o} />
        <Design />
        <footer className={s.foot}>
          <div className={s.footRow}>
            <span>
              Source:{' '}
              <a href="https://github.com/dun999/longshort/blob/main/indexer/config.yaml" target="_blank" rel="noreferrer">config.yaml</a> ·{' '}
              <a href="https://github.com/dun999/longshort/blob/main/indexer/schema.graphql" target="_blank" rel="noreferrer">schema.graphql</a> ·{' '}
              <a href="https://github.com/dun999/longshort/blob/main/indexer/src/handlers/ArenaCore.ts" target="_blank" rel="noreferrer">handlers</a> ·{' '}
              <a href="https://github.com/dun999/longshort/blob/main/web/src/lib/envio.tsx" target="_blank" rel="noreferrer">web queries</a>
            </span>
            <Link href="/play">Back to the arena →</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ─── hero ───
function Hero({ o, error }: { o?: EnvioOverview; error?: string }) {
  const sync = o?.sync;
  const behind = sync ? Math.max(0, sync.head - sync.block) : 0;
  const synced = sync && behind < 50;
  return (
    <section className={s.hero}>
      <div className={s.eyebrow}>Live data · Monad testnet · chain 10143</div>
      <h1 className={s.h1}>From onchain events to the leaderboard</h1>
      <p className={s.lede}>
        Envio HyperIndex reads three contracts on Monad: <b>our arena</b>, <b>Perpl’s order book</b> and <b>AUSD</b>. Seventeen event handlers turn them into ten
        GraphQL entities, and those entities are what the leaderboard, player profiles, match reports and stats show. Every number on this page is read live from that index.
      </p>
      <div className={s.syncRow}>
        <span className={s.pill}>
          <span className={`${s.dot} ${!sync ? s.dotOff : synced ? '' : s.dotWarn}`} />
          {!ENVIO_URL ? 'Envio endpoint not configured' : !sync ? (error ? 'Envio unreachable' : 'Connecting to Envio…') : synced ? 'In sync with the chain' : `Catching up · ${int(behind)} blocks behind`}
        </span>
        {sync && <span className={`${s.pill} ${s.num}`}>Indexed block {int(sync.block)}</span>}
        {sync && <span className={s.pill}>{sync.hyperSync ? 'Source: HyperSync' : 'Source: RPC fallback'}</span>}
        <span className={`${s.pill} ${s.mono}`} title={ARENA_ID}>arena {shortAddr(ARENA_ID)}</span>
      </div>
      {error && !o && <div className={s.error}>The index could not be read just now ({error}). The page retries every few seconds.</div>}
      <div className={s.kpis}>
        <Kpi label="Rounds settled" value={int(o?.stats?.settled)} sub={o?.stats ? `${int(o.stats.created)} lobbies opened` : ' '} />
        <Kpi label="Players" value={int(o?.stats?.players)} sub="unique wallets in rounds" />
        <Kpi label="Perpl fills" value={o ? `${int(o.rows.PerplFill.n)}${o.rows.PerplFill.capped ? '+' : ''}` : '—'} sub="real taker fills, attributed" />
        <Kpi label="Perpl volume" value={o?.stats ? fmtUsd(o.stats.volume) : '—'} sub="notional, from fills" />
        <Kpi label="Paid to winners" value={o?.stats ? ausd(o.stats.paidOut) : '—'} sub={o?.stats ? `${ausd(o.stats.rake)} rake` : ' '} />
      </div>
    </section>
  );
}
function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiLabel}>{label}</div>
      <div className={s.kpiValue}>{value}</div>
      <div className={s.kpiSub}>{sub}</div>
    </div>
  );
}

// ─── pipeline ───
function Pipeline({ o }: { o?: EnvioOverview }) {
  const [focus, setFocus] = useState<Focus>({ kind: 'screen', id: 'leaderboard' });
  const rel = useMemo(() => related(focus), [focus]);
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const engine = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; on: boolean }[]>([]);
  const ref = (key: string) => (el: HTMLElement | null) => void (el ? nodes.current.set(key, el) : nodes.current.delete(key));
  const pick = (f: NonNullable<Focus>) => setFocus((cur) => (cur?.kind === f.kind && cur.id === f.id ? null : f));

  // Edges: event → Envio → entity → screen, measured from the laid-out boxes.
  const measure = useCallback(() => {
    const root = box.current?.getBoundingClientRect();
    const eng = engine.current?.getBoundingClientRect();
    if (!root || !eng || getComputedStyle(box.current!.querySelector('svg')!).display === 'none') return setPaths([]);
    const at = (key: string) => nodes.current.get(key)?.getBoundingClientRect();
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = (x2 - x1) / 2;
      return `M${x1 - root.left},${y1 - root.top} C${x1 - root.left + dx},${y1 - root.top} ${x2 - root.left - dx},${y2 - root.top} ${x2 - root.left},${y2 - root.top}`;
    };
    const clampY = (y: number) => Math.min(eng.bottom - 24, Math.max(eng.top + 24, y));
    const out: { d: string; on: boolean }[] = [];
    for (const e of EVENTS) {
      const r = at(`ev:${e.id}`);
      if (r) out.push({ d: curve(r.right, r.top + r.height / 2, eng.left, clampY(r.top + r.height / 2)), on: !!rel?.ev.has(e.id) });
    }
    for (const n of ENTITIES) {
      const r = at(`en:${n.id}`);
      if (r) out.push({ d: curve(eng.right, clampY(r.top + r.height / 2), r.left, r.top + r.height / 2), on: !!rel?.en.has(n.id) });
    }
    for (const sc of SCREENS)
      for (const n of sc.reads) {
        const a = at(`en:${n}`), b = at(`sc:${sc.id}`);
        if (a && b) out.push({ d: curve(a.right, a.top + a.height / 2, b.left, b.top + b.height / 2), on: !!rel && rel.en.has(n) && rel.sc.has(sc.id) });
      }
    // highlighted paths last, so they draw over the quiet ones
    setPaths(out.sort((x, y) => Number(x.on) - Number(y.on)));
  }, [rel]);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure, o]);

  const cls = (kind: 'ev' | 'en' | 'sc', id: string) => {
    const set = kind === 'ev' ? rel?.ev : kind === 'en' ? rel?.en : rel?.sc;
    const self = focus && ((kind === 'ev' && focus.kind === 'event') || (kind === 'en' && focus.kind === 'entity') || (kind === 'sc' && focus.kind === 'screen')) && focus.id === id;
    return `${s.node} ${rel ? (set?.has(id) ? s.nodeOn : s.nodeDim) : ''} ${self ? s.nodeFocus : ''}`;
  };

  return (
    <section id="pipeline" className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <div className={s.eyebrow}>The pipeline</div>
          <h2 className={s.h2}>Seventeen events in, four screens out</h2>
          <p className={s.sub}>Pick any event, entity or screen to trace what it touches. Highlighted lines are the path that data takes through Envio.</p>
        </div>
      </div>
      <div ref={box} className={`${s.card} ${s.flow}`}>
        <svg className={s.edges} aria-hidden>
          {paths.map((p, i) => (
            <path key={i} d={p.d} className={`${s.edge} ${p.on ? s.edgeOn : ''}`} />
          ))}
        </svg>
        <div className={s.col}>
          <div className={s.colHead}>Monad contracts · events</div>
          {(Object.keys(SOURCES) as Src[]).map((src) => (
            <div key={src} className={s.source}>
              <div className={s.sourceName}>
                {SOURCES[src].name}
                <a href={explorerAddr(SOURCES[src].addr)} target="_blank" rel="noreferrer">{shortAddr(SOURCES[src].addr)} ↗</a>
              </div>
              <div className={s.sourceRole}>{SOURCES[src].role}</div>
              {EVENTS.filter((e) => e.src === src).map((e) => (
                <button key={e.id} ref={ref(`ev:${e.id}`)} className={`${cls('ev', e.id)} ${s.chip}`} aria-pressed={focus?.kind === 'event' && focus.id === e.id} onClick={() => pick({ kind: 'event', id: e.id })}>
                  {e.id}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className={s.col}>
          <div className={s.colHead}>Envio HyperIndex</div>
          <div ref={engine} className={s.engine}>
            <div className={s.engineTitle}><EnvioMark size={18} /> Envio</div>
            <div className={s.steps}>
              <div className={s.step}><b>HyperSync</b>Fetches the three contracts’ logs from block 67,943,161, with an RPC fallback.</div>
              <div className={s.step}><b>17 handlers</b>ArenaCore.ts applies each event to its entities, in chain order.</div>
              <div className={s.step}><b>Postgres</b>One row per entity, keyed by arena so deployments never mix.</div>
              <div className={s.step}><b>GraphQL</b>Hasura serves the reads; the browser queries it directly.</div>
            </div>
            <div className={s.engineSync}>
              {o?.sync ? (
                <>
                  Block <span className={s.num}>{int(o.sync.block)}</span> of <span className={s.num}>{int(o.sync.head)}</span>
                  <br />
                  {o.sync.hyperSync ? 'via HyperSync' : 'via RPC fallback'}
                </>
              ) : (
                'Reading sync status…'
              )}
            </div>
          </div>
        </div>
        <div className={s.col}>
          <div className={s.colHead}>Entities · rows now</div>
          {ENTITIES.map((n) => (
            <button key={n.id} ref={ref(`en:${n.id}`)} className={`${cls('en', n.id)} ${s.entity}`} aria-pressed={focus?.kind === 'entity' && focus.id === n.id} onClick={() => pick({ kind: 'entity', id: n.id })}>
              <span className={s.entityRow}>
                <span className={s.entityName}>{n.id}</span>
                <span className={`${s.entityCount} ${s.num}`}>{o ? `${int(o.rows[n.id]?.n)}${o.rows[n.id]?.capped ? '+' : ''}` : '…'}</span>
              </span>
              <span className={s.entityNote}>{n.note}</span>
            </button>
          ))}
        </div>
        <div className={s.col}>
          <div className={s.colHead}>What players see</div>
          {SCREENS.map((sc) => (
            <button key={sc.id} ref={ref(`sc:${sc.id}`)} className={`${cls('sc', sc.id)} ${s.screen}`} aria-pressed={focus?.kind === 'screen' && focus.id === sc.id} onClick={() => pick({ kind: 'screen', id: sc.id })}>
              <span className={s.screenName}>{sc.name}</span>
              <span className={s.screenReads}>reads {sc.reads.join(' · ')}</span>
              <span className={s.screenNote}>{sc.note}</span>
            </button>
          ))}
        </div>
      </div>
      <Explain focus={focus} rel={rel} onClear={() => setFocus(null)} />
    </section>
  );
}

function Explain({ focus, rel, onClear }: { focus: Focus; rel: ReturnType<typeof related>; onClear: () => void }) {
  let kind = 'Overview';
  let body: React.ReactNode = (
    <>
      Every event enters through Envio, which keeps <b>ten entities</b> current. Each screen reads only the entities it needs, so a settled round shows up everywhere at once.
    </>
  );
  if (focus && rel) {
    const en = [...rel.en], ev = [...rel.ev], sc = SCREENS.filter((x) => rel.sc.has(x.id)).map((x) => x.name);
    if (focus.kind === 'screen') {
      const screen = SCREENS.find((x) => x.id === focus.id)!;
      kind = 'Screen';
      body = (
        <>
          <b>{screen.name}</b> reads {list(en)}. Envio keeps {en.length > 1 ? 'them' : 'it'} current from {ev.length} events: {list(ev)}.
        </>
      );
    } else if (focus.kind === 'entity') {
      const n = ENTITIES.find((x) => x.id === focus.id)!;
      kind = 'Entity';
      body = (
        <>
          <b>{n.id}</b>: {n.note.charAt(0).toLowerCase() + n.note.slice(1)}. Written by {list(ev)}; shown on {sc.length ? list(sc) : 'no screen directly'}.
        </>
      );
    } else {
      const e = EVENTS.find((x) => x.id === focus.id)!;
      kind = `${SOURCES[e.src].name} event`;
      body = (
        <>
          <b>{e.id}</b>: {e.note}. Envio writes {list(en)}, and it shows on {list(sc)}.
        </>
      );
    }
  }
  return (
    <div className={`${s.card} ${s.explain}`} aria-live="polite">
      <span className={s.explainKind}>{kind}</span>
      <span className={s.explainText}>{body}</span>
      {focus ? <button className={s.ghostBtn} onClick={onClear}>Show all</button> : <span />}
    </div>
  );
}

// ─── leaderboard ───
const TRADER_WRITES: [string, React.ReactNode][] = [
  ['PlayerJoined', <>creates the <code>Trader</code> on first sight; adds the entry to <code>staked</code></>],
  ['PlayerLeft', <>takes that entry back off <code>staked</code></>],
  ['Opened', <>counts a trade</>],
  ['TakerOrderFilledV2', <>adds the Perpl fill’s notional to <code>volume</code> and its fee to <code>fees</code></>],
  ['Liquidated', <>counts a liquidation</>],
  ['Settled', <>adds the round to <code>matches</code>, <code>wins</code> or <code>losses</code>, payout minus entry to <code>earned</code>, and the XP change</>],
];
function LeaderboardSection() {
  const { data: rows } = usePoll(envioLeaderboard, 10_000);
  const [humans, setHumans] = useState(true);
  const [run, setRun] = useState<{ ms: number; json: string } | { error: string }>();
  const [busy, setBusy] = useState(false);
  const shown = (rows ?? []).filter((r) => !humans || !r.bot).slice(0, 10);
  const bots = (rows ?? []).filter((r) => r.bot).length;
  const top = Math.max(...shown.map((r) => r.xp), 1000);
  const runQuery = async () => {
    setBusy(true);
    try {
      const r = await envioQuery<{ Trader: unknown[] }>(LEADERBOARD_QUERY, { arena: ARENA_ID });
      setRun({ ms: r.ms, json: JSON.stringify({ Trader: r.data.Trader.slice(0, 2) }, null, 2).replace(/\n\s*\]\n\}$/, `\n    // … ${Math.max(0, r.data.Trader.length - 2)} more\n  ]\n}`) });
    } catch (e) {
      setRun({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="leaderboard" className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <div className={s.eyebrow}>The leaderboard</div>
          <h2 className={s.h2}>One entity, kept current by six events</h2>
          <p className={s.sub}>
            The leaderboard is a single query for <code className={s.mono}>Trader</code>. The work happens in the indexer: as events arrive, Envio updates each
            trader’s record, so the board never recomputes history in the browser.
          </p>
        </div>
      </div>
      <div className={s.lbGrid}>
        <div>
          <div className={`${s.card} ${s.writes}`}>
            {TRADER_WRITES.map(([ev, what]) => (
              <div key={ev} className={s.writeRow}>
                <span className={s.writeEvent}>{ev}</span>
                <span className={s.writeWhat}>{what}</span>
              </div>
            ))}
            <div className={s.xp}>
              <span className={s.xpTag}>Start <b>1,000 XP</b></span>
              <span className={s.xpTag}>Win <b>+50</b></span>
              <span className={s.xpTag}>Loss <b>−20</b>, never below 1,000</span>
              <span className={s.xpTag}>Draw <b>0</b></span>
            </div>
          </div>
          <div className={`${s.card} ${s.query}`}>
            <div className={s.queryBar}>
              <span className={s.mono}>POST /v1/graphql</span>
              <button className={s.runBtn} onClick={runQuery} disabled={busy}>{busy ? 'Running…' : 'Run on Envio'}</button>
            </div>
            <pre className={s.code}>{highlight(LEADERBOARD_QUERY)}</pre>
            {run && (
              <div className={s.response}>
                <div className={s.responseHead}>
                  <span>Response</span>
                  <span className={s.num}>{'ms' in run ? `${run.ms} ms` : 'failed'}</span>
                </div>
                <pre className={s.code}>{'json' in run ? run.json : run.error}</pre>
              </div>
            )}
          </div>
        </div>
        <div className={`${s.card} ${s.board}`}>
          <div className={s.boardHead}>
            <div>
              <div className={s.chartTitle}>Ranking, live from Envio</div>
              <div className={s.chartSub}>{bots ? `${bots} labelled bots hidden in Humans` : 'Names come from the game server, by address'}</div>
            </div>
            <div className={s.seg} role="group" aria-label="Who to rank">
              <button aria-pressed={humans} onClick={() => setHumans(true)}>Humans</button>
              <button aria-pressed={!humans} onClick={() => setHumans(false)}>Include bots</button>
            </div>
          </div>
          {!rows ? (
            <div className={s.empty}>Reading the index…</div>
          ) : !shown.length ? (
            <div className={s.empty}>No settled rounds yet{humans && bots ? ' for human players' : ''}.</div>
          ) : (
            shown.map((r, i) => (
              <div key={r.addr} className={s.lbRow}>
                <span className={`${s.lbRank} ${s.num}`}>{i + 1}</span>
                <span className={s.lbName} title={r.addr}>
                  {r.name ?? shortAddr(r.addr)}
                  {r.bot ? <small>BOT</small> : null}
                </span>
                <span className={s.bar} aria-hidden>
                  <i style={{ width: `${Math.max(2, ((r.xp - 1000) / Math.max(1, top - 1000)) * 100)}%` }} />
                </span>
                <span className={`${s.lbXp} ${s.num}`}>{int(r.xp)}</span>
                <span className={`${s.lbWl} ${s.num}`}>{r.wins}W · {r.losses}L</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/** Light GraphQL colouring: keywords, field names and variables. */
function highlight(q: string) {
  return q.split(/(\b(?:query|where|order_by|limit)\b|\$\w+|\b(?:_eq|_gt|desc)\b)/g).map((part, i) =>
    /^(query|where|order_by|limit|_eq|_gt|desc)$/.test(part) ? <span key={i} className={s.k}>{part}</span> : part.startsWith('$') ? <span key={i} className={s.v}>{part}</span> : part,
  );
}

// ─── one round, event by event ───
type Report = NonNullable<Awaited<ReturnType<typeof envioMatch>>>;
function RoundTrace({ o }: { o?: EnvioOverview }) {
  const [id, setId] = useState<number>();
  const [report, setReport] = useState<Report | null>();
  const recent = o?.recent ?? [];
  const current = id ?? recent[0]?.id;
  useEffect(() => {
    if (current === undefined) return;
    let live = true;
    setReport(undefined);
    envioMatch(current).then((r) => live && setReport(r), () => live && setReport(null));
    return () => void (live = false);
  }, [current]);
  const rows = useMemo(() => (report ? traceRows(report) : []), [report]);
  return (
    <section id="round" className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <div className={s.eyebrow}>One round, event by event</div>
          <h2 className={s.h2}>Follow a settled round through the index</h2>
          <p className={s.sub}>Each row is an event Envio indexed for this round, the entities it wrote, and the transaction it came from.</p>
        </div>
      </div>
      {recent.length > 0 && (
        <div className={s.matchPicker} role="group" aria-label="Recent settled rounds">
          {recent.map((m) => (
            <button key={m.id} className={s.matchChip} aria-pressed={m.id === current} onClick={() => setId(m.id)}>
              <b>#{m.id} · {MODES[m.mode as Mode]?.name ?? 'Round'}</b>
              <span>{m.players} players · {ago(m.settledAt)}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`${s.card} ${s.timeline}`}>
        {!o ? (
          <div className={s.empty}>Reading the index…</div>
        ) : !recent.length ? (
          <div className={s.empty}>No settled rounds indexed yet.</div>
        ) : report === undefined ? (
          <div className={s.empty}>Loading round #{current}…</div>
        ) : report === null ? (
          <div className={s.empty}>Round #{current} could not be read.</div>
        ) : (
          rows.map((r, i) => (
            <div key={i} className={s.tl}>
              <span className={`${s.tlTime} ${s.num}`}>{r.ts ? clock(r.ts) : r.when ?? '—'}</span>
              <span className={s.tlEvent}>
                {r.event}
                <span className={s.tlSrc}>{r.src}</span>
              </span>
              <span className={s.tlWhat}>
                {r.what}
                <span className={s.tlWrites}>{r.writes.map((w) => <span key={w}>{w}</span>)}</span>
              </span>
              {r.tx ? <a className={s.tlTx} href={explorerTx(r.tx)} target="_blank" rel="noreferrer">{r.tx.slice(0, 10)}… ↗</a> : <span />}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function traceRows(r: Report) {
  const name = (addr: string) => r.players.find((p: { addr: string }) => p.addr === addr)?.name ?? shortAddr(addr);
  const writes = (ev: string) => EVENTS.find((e) => e.id === ev)?.writes ?? [];
  const out: { ts?: number; when?: string; event: string; src: string; what: string; writes: string[]; tx?: string }[] = [];
  for (const a of r.accounts)
    out.push({ when: 'at entry', event: 'TradingAccountCreated', src: 'PerplArena', what: `${name(a.addr)} gets Perpl account #${a.account_id} with ${ausd(a.budget)} to trade`, writes: writes('TradingAccountCreated') });
  const timed: typeof out = [];
  for (const t of r.trades) {
    if (t.kind === 'open')
      timed.push({ ts: t.ts, event: 'Opened', src: 'PerplArena', what: `${name(t.addr)} ${t.is_long ? 'longs' : 'shorts'} BTC, ${fmtUsd(t.notional ?? 0)} notional`, writes: writes('Opened'), tx: t.tx });
    else if (t.kind === 'close')
      timed.push({ ts: t.ts, event: 'Closed', src: 'PerplArena', what: `${name(t.addr)} closes: ${(t.pnl ?? 0) >= 0 ? '+' : '−'}${fmtUsd(Math.abs(t.pnl ?? 0))}`, writes: writes('Closed'), tx: t.tx });
    else timed.push({ ts: t.ts, event: t.kind === 'liquidated' ? 'Liquidated' : 'Eliminated', src: 'PerplArena', what: `${name(t.addr)} is out`, writes: writes(t.kind === 'liquidated' ? 'Liquidated' : 'Eliminated'), tx: t.tx });
  }
  for (const f of r.fills)
    timed.push({
      ts: f.ts,
      event: 'TakerOrderFilledV2',
      src: 'Perpl',
      what: `Perpl fills ${(Number(f.lots) / 1e5).toFixed(4)} BTC at ${f.price.toLocaleString('en-US', { maximumFractionDigits: 1 })} for ${name(f.addr)} · fee ${ausd(f.fee, 4)}`,
      writes: writes('TakerOrderFilledV2'),
      tx: f.tx,
    });
  // a trade and its fill share a transaction: the arena event first, then Perpl's fill
  timed.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.tx === b.tx ? (a.src === 'Perpl' ? 1 : -1) : 0));
  out.push(...timed);
  const settledTs = r.match.settled_at ?? r.match.end_at ?? undefined;
  for (const a of r.accounts)
    if (a.final_balance !== null)
      out.push({ ts: settledTs, event: 'FinalBalance', src: 'PerplArena', what: `${name(a.addr)} ends the round with ${ausd(a.final_balance)} on Perpl`, writes: writes('FinalBalance'), tx: r.match.settle_tx ?? undefined });
  for (const p of r.players)
    out.push({
      ts: settledTs,
      event: 'Settled',
      src: 'PerplArena',
      what: `${name(p.addr)}: ${p.result ?? 'pending'}${p.payout ? `, paid ${ausd(p.payout)}` : ''}, ${p.xp_delta >= 0 ? '+' : '−'}${Math.abs(p.xp_delta)} XP to the leaderboard`,
      writes: writes('Settled'),
      tx: r.match.settle_tx ?? undefined,
    });
  for (const a of r.accounts)
    if (a.returned > 0)
      out.push({ ts: settledTs, event: 'Transfer', src: 'AUSD', what: `${ausd(a.returned)} returns from the trading account to ${name(a.addr)}`, writes: writes('Transfer'), tx: r.match.settle_tx ?? undefined });
  return out;
}

// ─── activity ───
function Activity({ o }: { o?: EnvioOverview }) {
  const daily = o?.daily ?? [];
  const label = (d: string) => d.slice(5).replace('-', '/');
  return (
    <section id="activity" className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <div className={s.eyebrow}>Aggregates</div>
          <h2 className={s.h2}>Totals the indexer keeps, not the browser</h2>
          <p className={s.sub}><code className={s.mono}>DailyStat</code> and <code className={s.mono}>ArenaStats</code> are updated inside the handlers, so these charts are one small query each.</p>
        </div>
      </div>
      <div className={s.charts}>
        <ChartCard title="Trades per day" sub="DailyStat.trades · last 14 days" rows={daily.map((d) => ({ k: label(d.date), v: d.trades, text: `${int(d.trades)} trades` }))} />
        <ChartCard title="Perpl volume per day" sub="DailyStat.volume · notional" rows={daily.map((d) => ({ k: label(d.date), v: d.volume, text: fmtUsd(d.volume) }))} />
        <ModeCard byMode={o?.byMode} />
      </div>
    </section>
  );
}

function ChartCard({ title, sub, rows }: { title: string; sub: string; rows: { k: string; v: number; text: string }[] }) {
  const [table, setTable] = useState(false);
  return (
    <div className={`${s.card} ${s.chartCard}`}>
      <div className={s.chartHead}>
        <div>
          <div className={s.chartTitle}>{title}</div>
          <div className={s.chartSub}>{sub}</div>
        </div>
        <button className={s.tableToggle} aria-pressed={table} onClick={() => setTable((t) => !t)}>{table ? 'Chart' : 'Table'}</button>
      </div>
      {table ? (
        <table className={s.dataTable}>
          <thead><tr><th>Day</th><th>{title.split(' ')[0]}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.k}><td className={s.num}>{r.k}</td><td className={s.num}>{r.text}</td></tr>)}</tbody>
        </table>
      ) : rows.length ? (
        <Bars rows={rows} />
      ) : (
        <div className={s.empty}>No activity indexed yet.</div>
      )}
    </div>
  );
}

/** Columns from one baseline: ≤24px wide, 4px rounded tops, hairline grid, a tooltip per bar on hover or focus. */
function Bars({ rows }: { rows: { k: string; v: number; text: string }[] }) {
  const W = 360, H = 170, top = 10, bottom = 22, left = 34;
  const max = Math.max(...rows.map((r) => r.v), 1);
  const nice = niceMax(max);
  const band = (W - left) / rows.length;
  const bw = Math.min(24, band - 4);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / nice);
  const [tip, setTip] = useState<{ x: number; y: number; r: (typeof rows)[number] }>();
  const ticks = [0, nice / 2, nice];
  return (
    <div className={s.plot}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rows.map((r) => `${r.k}: ${r.text}`).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? s.baseline : s.grid} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className={s.axisText}>{compact(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = left + band * i + band / 2;
          const h = Math.max(0, y(0) - y(r.v));
          const x = cx - bw / 2;
          const rad = Math.min(4, h);
          const d = h > 0 ? `M${x},${y(0)} V${y(0) - h + rad} Q${x},${y(0) - h} ${x + rad},${y(0) - h} H${x + bw - rad} Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + rad} V${y(0)} Z` : '';
          const show = () => setTip({ x: (cx / W) * 100, y: ((y(0) - h) / H) * 100, r });
          return (
            <g key={r.k}>
              <rect x={cx - band / 2} y={top} width={band} height={H - top - bottom} className={s.barHit} tabIndex={0} onPointerEnter={show} onPointerLeave={() => setTip(undefined)} onFocus={show} onBlur={() => setTip(undefined)} aria-label={`${r.k}: ${r.text}`} />
              {d && <path d={d} className={s.barMark} />}
              {(i === 0 || i === rows.length - 1 || rows.length <= 7) && <text x={cx} y={H - 6} textAnchor="middle" className={s.axisText}>{r.k}</text>}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className={s.tip} style={{ left: `${tip.x}%`, top: `${tip.y}%` }}>
          <b>{tip.r.text}</b>
          {tip.r.k}
        </div>
      )}
    </div>
  );
}
const niceMax = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
};
const compact = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : `${+v.toFixed(1)}`);

function ModeCard({ byMode }: { byMode?: number[] }) {
  const [table, setTable] = useState(false);
  const rows = [Mode.DUEL, Mode.SQUAD, Mode.ROYALE].map((m, i) => ({ k: MODES[m].name, v: byMode?.[i] ?? 0 }));
  const max = Math.max(...rows.map((r) => r.v), 1);
  return (
    <div className={`${s.card} ${s.chartCard}`}>
      <div className={s.chartHead}>
        <div>
          <div className={s.chartTitle}>Settled rounds by mode</div>
          <div className={s.chartSub}>Match.mode where state is SETTLED</div>
        </div>
        <button className={s.tableToggle} aria-pressed={table} onClick={() => setTable((t) => !t)}>{table ? 'Chart' : 'Table'}</button>
      </div>
      {table ? (
        <table className={s.dataTable}>
          <thead><tr><th>Mode</th><th>Rounds</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.k}><td>{r.k}</td><td className={s.num}>{int(r.v)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className={s.hbars}>
          {rows.map((r) => (
            <div key={r.k} className={s.hbar} title={`${r.k}: ${r.v} settled`}>
              <span>{r.k}</span>
              <span className={s.hbarTrack}><span className={s.hbarFill} style={{ width: `${(r.v / max) * 100}%`, display: 'block' }} /></span>
              <span className={`${s.hbarVal} ${s.num}`}>{byMode ? int(r.v) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── design choices ───
function Design() {
  return (
    <section id="design" className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <div className={s.eyebrow}>Design choices</div>
          <h2 className={s.h2}>Why the index is shaped this way</h2>
        </div>
      </div>
      <div className={s.notes}>
        <div className={`${s.card} ${s.note}`}>
          <div className={s.noteTitle}>Perpl doesn’t know about matches. The index joins them.</div>
          <p className={s.noteText}>
            Perpl’s <code>TakerOrderFilledV2</code> carries no account. Its <code>OrderRequestV2</code> does, in the same transaction, so a <code>PerplOrder</code> keyed by transaction hash
            bridges every fill to our <code>TradingAccount</code>, and from there to the round and the player. Volume and fees on the leaderboard are real Perpl fills.
          </p>
        </div>
        <div className={`${s.card} ${s.note}`}>
          <div className={s.noteTitle}>Returned collateral, even outside the arena</div>
          <p className={s.noteText}>
            <code>VaultAddress</code> maps each trading-account contract to its Perpl account. Any AUSD <code>Transfer</code> from that address to its owner is recorded as returned, including a
            player recovering funds directly, without the arena’s settle call.
          </p>
        </div>
        <div className={`${s.card} ${s.note}`}>
          <div className={s.noteTitle}>Arena-scoped IDs</div>
          <p className={s.noteText}>
            Rounds are <code>&lt;arena&gt;-&lt;matchId&gt;</code> and traders <code>&lt;arena&gt;-&lt;wallet&gt;</code>, and every query filters by the live arena. A redeployed contract starts a
            clean season without deleting the old one.
          </p>
        </div>
        <div className={`${s.card} ${s.note}`}>
          <div className={s.noteTitle}>Fast by default, never stuck</div>
          <p className={s.noteText}>
            HyperSync is the primary source with two RPC fallbacks. In the app, every Envio read falls back to the game server if the index is unreachable, and each page labels which
            source it shows.
          </p>
        </div>
      </div>
    </section>
  );
}
