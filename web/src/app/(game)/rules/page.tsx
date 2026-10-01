'use client';
import { useEffect } from 'react';
import { ADDR, REAL_TRADING, CLASSES, FEE_BPS, MODES, Mode, RAKE_BPS, explorerAddr, type ClassId, STAKE } from '@longshort/shared';
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
      <Section t="Classes = leverage">
        {(Object.keys(CLASSES) as ClassId[]).map((id) => (
          <p key={id}>
            <b>
              {CLASSES[id].name} · {CLASSES[id].leverage}x
            </b>{' '}
            ({CLASSES[id].blurb}) At full size you are liquidated once equity falls to 10% of starting margin, which is a ~{(90 / CLASSES[id].leverage).toFixed(1)}% adverse move.
          </p>
        ))}
        <p>You can switch class while the lobby fills and during the pre-match countdown. It&apos;s fixed once the bell rings.</p>
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

function LiveRules() {
  return <div className="mx-auto grid max-w-4xl gap-4 px-4 py-8">
    <div className="flex items-end justify-between"><h1 className="font-display text-4xl font-bold uppercase">Rules &amp; Risks</h1><BackButton /></div>
    <Section t="Your AUSD balance">
      <p>Sign in with Mera and claim <b>200 testnet AUSD</b> once per wallet. The claim is an actual AUSD transfer and appears after its transaction confirms.</p>
      <p>A 5 AUSD duel transfers <b>5 AUSD to the prize pot and 100 AUSD to your isolated Perpl trading account</b>. Your wallet therefore decreases by 105 AUSD when you join. The trading balance belongs to you and is separate from the prize.</p>
      <p><b>You can lose your entry and some or all of the trading balance.</b> No other wallet funds collateralize the account. The testnet tokens have no monetary value.</p>
    </Section>
    <Section t="BTC Duel">
      <p>Two players start with equal 100 AUSD trading balances. After a 15 second countdown, trade BTC for 60 seconds at 5x leverage. Long and Short submit real Perpl orders; Close reduces the actual position.</p>
      <p>Opening orders use fill-or-kill and immediate-or-cancel with a 1% price limit relative to the current mark. A rejected order does not change the position. Closing orders are reduce-only and can fill partially; the game keeps retrying the remainder.</p>
      <p>Perpl&apos;s actual fees, funding, order-book fills and liquidations affect the balance. Displayed order sizes are estimates. Practice uses virtual positions and has no stake.</p>
    </Section>
    <Section t="Settlement and recovery">
      <p>The round enters <b>Closing</b> at the bell. No new exposure is allowed. The pot is paid only once both accounts have no positions or locked orders.</p>
      <p>The higher final Perpl balance wins. A 10 AUSD pot pays 9.75 AUSD to the winner and 0.25 AUSD to the treasury. Equal final balances refund both entries with no rake.</p>
      <p>Your remaining trading collateral returns to your wallet separately from the prize. If a withdrawal is temporarily unavailable, use Recover funds from the result or report. Withdrawals always go to the original wallet owner.</p>
      <p>Leaving an unfilled lobby returns entry and trading collateral. Unfilled lobbies expire after 5 minutes. If closing stays unavailable for 5 minutes after the bell, anyone can cancel the contest and refund the entries. Actual trading losses are not reversed; remaining collateral can be recovered when Perpl permits closing and withdrawal.</p>
    </Section>
    <Section t="Passkeys and contracts">
      <p>Mera derives an owner wallet from your passkey and a separate trading key for each match. The trading key can trade during the round; it cannot redirect collateral or spend the prize pot. The sponsor pays network fees for passkey and guest accounts.</p>
      <p>Arena: <a className="link break-all" href={explorerAddr(ADDR.arena)}>{ADDR.arena}</a></p>
      <p>AUSD: <a className="link break-all" href={explorerAddr(ADDR.stake)}>{ADDR.stake}</a></p>
      <p>Perpl: <a className="link break-all" href={explorerAddr(ADDR.perplExchange)}>{ADDR.perplExchange}</a></p>
      <p>Testnet software. Contracts are unaudited. Guest wallets are stored in this browser and are lost if you clear its data.</p>
    </Section>
  </div>;
}
