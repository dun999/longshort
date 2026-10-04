'use client';
import { useEffect } from 'react';
import { ADDR, REAL_TRADING, CLASSES, ENTRY_TIERS, FEE_BPS, MODES, Mode, PERPL_BTC_MAINT, RAKE_BPS, TRADING_BUDGET, explorerAddr, liqMove, payouts, royaleRounds, type ClassId, STAKE } from '@longshort/shared';
import { useScene } from '@/lib/scene';
import { BackButton } from '@/components/ui/BackButton';

const Section = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <section className="panel p-6">
    <h2 className="font-display text-xl font-bold tracking-[0.12em] uppercase">{t}</h2>
    <div className="mt-3 grid gap-2 text-sm leading-relaxed text-muted [&_b]:text-white">{children}</div>
  </section>
);

export default function Rules() {
  useEffect(() => useScene.getState().set({ shot: 'backdrop', slots: [] }), []);
  if (REAL_TRADING) return <LiveRules />;
  return (
    <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-4xl gap-4 px-4 py-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="panel-title">Read before you stake</div>
          <h1 className="font-display text-4xl font-bold tracking-[0.12em] uppercase">Rules &amp; Risks</h1>
        </div>
        <BackButton />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Max loss', 'Your entry stake. Never more.'],
          ['Fill price', 'Perpl onchain mark, in the block your tx lands.'],
          ['Costs', `${RAKE_BPS / 100}% rake on decided pots · ${FEE_BPS} bp fee per side.`],
          ['Refunds', 'Unfilled lobbies (5 min) and ties are refunded in full.'],
        ].map(([k, v]) => (
          <div key={k} className="panel p-3">
            <div className="panel-title">{k}</div>
            <div className="mt-1 text-sm text-[var(--text)]">{v}</div>
          </div>
        ))}
      </div>
      <Section t="What you can lose">
        <p>
          <b>Only your entry stake.</b> It is escrowed in the ArenaCore contract when you join. In-match positions are <b>virtual</b>: every player starts with the same 1,000 USD of
          margin, and PnL is computed from Perpl&apos;s onchain mark price. You never owe more than your entry, and there is no house on the other side of your trade.
        </p>
        <p>If you leave before the lobby fills, or it doesn&apos;t fill within 5 minutes, your stake is refunded in full. Ties are refunded too, with no rake.</p>
      </Section>
      <Section t="How winners are decided">
        {[Mode.DUEL, Mode.SQUAD, Mode.ROYALE].map((m) => (
          <p key={m}>
            <b>{MODES[m].name}</b> ({MODES[m].tagline}):{' '}
            {m === Mode.DUEL && 'the higher final equity takes the pot. If one player is liquidated, the match can settle immediately.'}
            {m === Mode.SQUAD && 'the team with the higher combined equity wins, and each winner receives an equal share of the pot.'}
            {m === Mode.ROYALE &&
              'the lowest-equity survivor is eliminated at every round boundary until three remain. The top three are paid 60 / 30 / 10%, ranked by survival first and final equity second.'}
          </p>
        ))}
        <p>
          A <b>{RAKE_BPS / 100}% rake</b> is taken from decided pots. The trading fee is <b>{FEE_BPS} bp per side</b> on notional, and it reduces your equity.
        </p>
      </Section>
      <Section t="Leverage">
        {(Object.keys(CLASSES) as ClassId[]).map((id) => (
          <p key={id}>
            <b>
              {CLASSES[id].leverage}x · {CLASSES[id].role}
            </b>{' '}
            At full size you are liquidated once equity falls to 10% of starting margin, which is a ~{(liqMove(CLASSES[id].leverage) * 100).toFixed(1)}% adverse move.
          </p>
        ))}
        <p>You can switch leverage while the lobby fills and during the pre-match countdown. It&apos;s fixed once the bell rings. Your character is separate and purely cosmetic: any character plays at any leverage.</p>
      </Section>
      <Section t="Pricing & execution">
        <p>
          Every open, close, liquidation and elimination is a transaction on Monad. Fills use the price that ArenaCore reads from Perpl&apos;s exchange contract (the fresher of mark and oracle
          price, and at most 60s old) <b>in the block your transaction lands in</b>, not the price on your screen when you clicked. On a fast-moving market the two can differ.
        </p>
        <p>
          If the price feed goes stale, trades revert instead of filling at an old price. If the oracle fails mid-match, an owner-only emergency cancel refunds every stake. Anyone can call
          liquidate and settle. A keeper does this automatically, so you don&apos;t have to trust it to do it.
        </p>
        <p>
          With a browser wallet, trades are signed by a <b>session key</b> stored in this browser. It can only trade inside matches you joined and can never move your stake. Guest mode stores
          a burner key in your browser, so clearing site data loses that wallet.
        </p>
      </Section>
      <Section t="Contracts">
        <p>
          ArenaCore{' '}
          <a className="link num" href={explorerAddr(ADDR.arena)} target="_blank" rel="noreferrer">
            {ADDR.arena}
          </a>
        </p>
        <p>
          Stake token ({STAKE}){' '}
          <a className="link num" href={explorerAddr(ADDR.stake)} target="_blank" rel="noreferrer">
            {ADDR.stake}
          </a>
        </p>
        <p>
          Price source: Perpl exchange{' '}
          <a className="link num" href={explorerAddr(ADDR.perplExchange)} target="_blank" rel="noreferrer">
            {ADDR.perplExchange}
          </a>
          {ADDR.mockOracleActive && ' (mirrored into a local oracle on this dev deployment)'}
        </p>
        <p className="text-gold">Testnet software. It is unaudited, and stakes have no monetary value.</p>
      </Section>
    </div>
  );
}

const pctOf = (lev: number) => `${(liqMove(lev) * 100).toFixed(liqMove(lev) < 0.1 ? 1 : 0)}%`;
const money = (n: number) => `${n.toFixed(2)} AUSD`;

function LiveRules() {
  const entry = ENTRY_TIERS[0];
  const duel = payouts(Mode.DUEL, entry, MODES[Mode.DUEL].maxPlayers);
  const squad = payouts(Mode.SQUAD, entry, MODES[Mode.SQUAD].maxPlayers);
  const royale = payouts(Mode.ROYALE, entry, MODES[Mode.ROYALE].maxPlayers);
  const { rounds, roundLen } = royaleRounds(MODES[Mode.ROYALE].maxPlayers, MODES[Mode.ROYALE].duration);
  const rake = RAKE_BPS / 100;
  const classes = Object.keys(CLASSES) as ClassId[];
  const size = (lev: number) => TRADING_BUDGET * 0.95 * lev;
  return <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-4xl gap-4 px-4 py-8">
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="panel-title">Read before you play</div>
        <h1 className="font-display text-4xl font-bold tracking-[0.12em] uppercase">Rules &amp; Risks</h1>
      </div>
      <BackButton />
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ['You put in', `An entry (${ENTRY_TIERS.join(', ')} AUSD) for the prize pot, plus ${TRADING_BUDGET} AUSD for your own trading account.`],
        ['You can lose', `Your entry, and some or all of the ${TRADING_BUDGET} AUSD trading balance. Nothing else in your wallet.`],
        ['You can win', `The pot minus a ${rake}% rake. Duel winner, the winning Squad team, or Royale's top three.`],
        ['You trade', 'BTC only, with real orders on Perpl. Long if you think it rises, Short if you think it falls.'],
      ].map(([k, v]) => (
        <div key={k} className="panel p-3">
          <div className="panel-title">{k}</div>
          <div className="mt-1 text-sm text-[var(--text)]">{v}</div>
        </div>
      ))}
    </div>

    <Section t="Your AUSD">
      <p>Sign in with a Mera passkey (or as a guest) and claim <b>200 testnet AUSD</b> once per wallet. You can also deposit your own testnet AUSD: send it to your account address on Monad testnet from the account menu&apos;s Deposit screen.</p>
      <p>Joining a {entry} AUSD match moves <b>{entry} AUSD into the prize pot</b>, held by the arena contract, and <b>{TRADING_BUDGET} AUSD into a Perpl trading account that only your match can use</b>. Your wallet therefore drops by {entry + TRADING_BUDGET} AUSD when you join. Whatever is left in the trading account comes back to you after the round, separately from any prize.</p>
      <p><b>You can lose your entry and some or all of the trading balance.</b> No other funds in your wallet back the trading account. Testnet AUSD has no monetary value, and nothing here is financial advice.</p>
    </Section>

    <Section t="Leverage and risk">
      <p>Leverage multiplies your position: the same balance controls a bigger bet, so wins <b>and</b> losses grow, and a smaller BTC move against you knocks you out. Perpl closes a BTC position once its equity falls to {Math.round(PERPL_BTC_MAINT * 100)}% of the position size, and caps BTC at 15x.</p>
      <div className="scroll-thin overflow-x-auto">
        <table className="num w-full min-w-[460px] text-left text-xs">
          <thead className="text-dim"><tr>{['Leverage', 'Risk', 'Full-size position', 'Knocked out by a move of about', 'Perpl fees per full-size round trip'].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{classes.map((id) => {
            const lev = CLASSES[id].leverage;
            return <tr key={id} className="border-t border-line"><td className="p-2 font-semibold text-white">{lev}x</td><td className="p-2 font-sans">{CLASSES[id].role}</td><td className="p-2">{money(size(lev))}</td><td className="p-2 text-gold">{pctOf(lev)}</td><td className="p-2">≈ {money(size(lev) * FEE_BPS * 2 / 10_000)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <p>Figures assume your whole balance (100% size) and ignore funding and the bid-ask spread. Smaller sizes (25% or 50%) cut the position and push the knock-out point further away.</p>
      <p><b>Who picks:</b> in Duel and Royale, every player picks their own leverage. In Squad, each team plays at one leverage, picked by its <b>team leader</b>: the first player seated on that team, which is the party leader when you queue with a friend. The other teammate&apos;s pick follows it. Leverage can change while the lobby fills and during the 15 second countdown, and lock at the bell.</p>
    </Section>

    <Section t="Modes and payouts">
      <p>The <b>pot</b> is every player&apos;s entry added together. When a match has a winner, <b>{rake}% of the pot</b> goes to the treasury as rake, and the rest is paid by the arena contract in the settlement transaction. Rounding dust also goes to the treasury.</p>
      <p><b>Duel</b> ({MODES[Mode.DUEL].tagline}). The bigger final Perpl balance takes the pot minus rake. With a {entry} AUSD entry: pot {money(duel.pot)}, the winner receives <b>{money(duel.first)}</b>. Exactly equal balances refund both entries with no rake.</p>
      <p><b>Squad</b> ({MODES[Mode.SQUAD].tagline}). A team&apos;s score is its two players&apos; final balances added together. The bigger total wins, and the pot minus rake is split equally between the two winners. With a {entry} AUSD entry: pot {money(squad.pot)}, each winner receives <b>{money(squad.first)}</b>. A knocked-out teammate&apos;s remaining balance still counts. Equal team totals refund every entry with no rake.</p>
      <p><b>Royale</b> ({MODES[Mode.ROYALE].tagline}). Every {roundLen} seconds ({rounds} cuts in a {MODES[Mode.ROYALE].duration} second round) the player still in the game with the <b>lowest equity</b> (balance plus the open position&apos;s profit or loss at Perpl&apos;s mark price) is cut: their position is closed on Perpl and they can no longer trade. Knocked-out players are out too. The final ranking puts everyone still in first, ordered by final balance, then everyone who went out, latest out ranked highest. The pot minus rake pays <b>60% / 30% / 10%</b> to the top three. With a {entry} AUSD entry: pot {money(royale.pot)}, paying <b>{money(royale.first)}</b>, <b>{money(royale.second!)}</b> and <b>{money(royale.third!)}</b>. Survivors with exactly equal balances are ordered by seat.</p>
      <p><b>Ending early:</b> a Duel or Squad round ends early only when nobody can trade any more. A Royale ends early once a single player is left.</p>
    </Section>

    <Section t="Trading and execution">
      <p>Every match trades BTC on Perpl. Long and Short send real orders from your isolated account: immediate-or-cancel, fill-or-kill, with a 1% price limit around the mark. A rejected order leaves your position unchanged. Size is a share of your balance (25%, 50% or 100%) times your leverage, using 95% of the balance so fees fit. Opening a new trade closes the current one first.</p>
      <p>Close sends a reduce-only order and can fill partly; the remainder can be closed again. Fills happen at Perpl&apos;s order book in the block your transaction lands in, which can differ from the price on screen. Perpl&apos;s actual trading fees, funding and liquidations change your balance. The in-match Ping meter shows how long each of your orders took to confirm.</p>
      <p>Practice is different: it is a free simulation against a bot on live BTC prices, with no account, stake or real orders.</p>
    </Section>

    <Section t="Settlement, refunds and recovery">
      <p>At the bell the round enters <b>Closing</b>: no new positions, every open one is closed on Perpl, and the pot is paid only once every account is flat. Your remaining trading balance then returns to your wallet. If a withdrawal is temporarily unavailable, use Recover funds on the result or report screen; recovered capital always goes to the original owner.</p>
      <p>Leaving a lobby before it fills returns your entry and trading balance. Lobbies that don&apos;t fill within 5 minutes can be cancelled by anyone, refunding everyone. If closing stays impossible for 5 minutes after the bell, anyone can cancel the match and refund the entries; real trading losses are not reversed. The owner can cancel only before the bell, never during a round.</p>
    </Section>

    <Section t="Bots and fairness">
      <p>Every player in a match has the same entry, the same {TRADING_BUDGET} AUSD trading balance, the same market and the same clock. The arena contract enforces the formats, the leverage classes and the Squad leader rule; nobody can trade before the bell or after it.</p>
      <p>Bots are labelled <b>BOT</b>. They only fill empty seats, after about 12 seconds, when you turn on <b>Match with bots</b> in Settings. Bots trade real Perpl orders from their own AUSD, follow the same rules, and can win or lose like anyone else.</p>
    </Section>

    <Section t="Accounts">
      <p><b>Passkey (Mera):</b> your owner wallet is derived from your passkey, with a separate trading key for each match. No seed phrase or extension, and the same passkey restores the account on another device. A match key can trade during its round; it cannot move your prize, your wallet or your returned capital.</p>
      <p><b>Guest:</b> a wallet kept in this browser, for judges and devices without passkeys. Export its private key from the account menu to keep it: clearing this browser without a copy loses the account, and anyone who sees the exported key controls its funds.</p>
      <p>The sponsor pays network fees for passkey and guest accounts. A browser wallet can still finish old rounds and recover capital from the recovery page.</p>
    </Section>

    <Section t="Contracts">
      <p>Arena: <a className="link break-all" href={explorerAddr(ADDR.arena)} target="_blank" rel="noreferrer">{ADDR.arena}</a></p>
      <p>AUSD: <a className="link break-all" href={explorerAddr(ADDR.stake)} target="_blank" rel="noreferrer">{ADDR.stake}</a></p>
      <p>Perpl: <a className="link break-all" href={explorerAddr(ADDR.perplExchange)} target="_blank" rel="noreferrer">{ADDR.perplExchange}</a></p>
      <p className="text-gold">Testnet software. The contracts are unaudited and testnet tokens have no monetary value.</p>
    </Section>
  </div>;
}
