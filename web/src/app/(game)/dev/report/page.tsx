'use client';
/* Dev-only QA harness: the match report over a fixed sample duel (no chain, no indexer). 404 in production. */
import { notFound } from 'next/navigation';
import { useEffect } from 'react';
import { MARGIN, Mode } from '@longshort/shared';
import { ReportView, type ReportData } from '@/components/match/Report';
import { useScene } from '@/lib/scene';

const ME = '0x816f4de03028ed8a296ea3c3a94e2a09c7536a47';
const BOT = '0x20b0c479c08e9d3402095c665ba2794990ae7149';
const T0 = 1_791_816_672;
const TX = (n: number) => `0x${n.toString(16).padStart(4, '0')}7fb046c018458c08f9e869970cf663def96ad0eea8363b55d6d3ac5679`.slice(0, 66);

const SAMPLE: ReportData = {
  source: 'envio',
  match: { id: 11, mode: Mode.DUEL, entry: 5, duration: 60, state: 2, start_at: T0, end_at: T0 + 60, rake: 0.25, settle_tx: TX(99) },
  players: [
    { addr: ME, name: 'SwiftViper10', bot: false, team: 0, leverage: 5, character: 'gladiator', result: 'win', payout: 9.75, final_equity: 99.445602, xp_delta: 50 },
    { addr: BOT, name: 'bot·Vega', bot: true, team: 1, leverage: 10, character: 'pirate', result: 'loss', payout: 0, final_equity: 98.960274, xp_delta: -20 },
  ],
  trades: [
    { kind: 'open', addr: BOT, market: 0, is_long: 0, notional: 237.2, price: 83977.6, pnl: null, fee: 0.083, ts: T0 + 4, tx: TX(1) },
    { kind: 'open', addr: ME, market: 0, is_long: 1, notional: 237.0, price: 83981.9, pnl: null, fee: 0.083, ts: T0 + 9, tx: TX(2) },
    { kind: 'close', addr: BOT, market: 0, is_long: null, notional: null, price: 83950.1, pnl: -0.08, fee: 0.083, ts: T0 + 21, tx: TX(3) },
    { kind: 'close', addr: ME, market: 0, is_long: null, notional: null, price: 83960.0, pnl: -0.06, fee: 0.083, ts: T0 + 26, tx: TX(4) },
    { kind: 'open', addr: ME, market: 0, is_long: 0, notional: 236.73, price: 83947.4, pnl: null, fee: 0.083, ts: T0 + 31, tx: TX(5) },
    { kind: 'open', addr: BOT, market: 0, is_long: 1, notional: 473.63, price: 83977.4, pnl: null, fee: 0.166, ts: T0 + 38, tx: TX(6) },
  ],
  accounts: [
    { addr: ME, account: ME, account_id: '1119', budget: MARGIN, final_balance: 99.445602, returned: 99.445602 },
    { addr: BOT, account: BOT, account_id: '1120', budget: MARGIN, final_balance: 98.960274, returned: 98.960274 },
  ],
  fills: [
    { addr: BOT, order_type: 1, price: 83977.6, notional: 237.2, fee: 0.083, tx: TX(1), log_index: 0 },
    { addr: ME, order_type: 0, price: 83981.9, notional: 237.0, fee: 0.083, tx: TX(2), log_index: 0 },
    { addr: BOT, order_type: 3, price: 83950.1, notional: 237.1, fee: 0.083, tx: TX(3), log_index: 0 },
    { addr: ME, order_type: 2, price: 83960.0, notional: 236.9, fee: 0.083, tx: TX(4), log_index: 0 },
    { addr: ME, order_type: 1, price: 83947.4, notional: 236.73, fee: 0.083, tx: TX(5), log_index: 0 },
    { addr: BOT, order_type: 0, price: 83977.4, notional: 473.63, fee: 0.166, tx: TX(6), log_index: 0 },
  ],
};

function Fixture() {
  useEffect(() => useScene.getState().set({ shot: 'backdrop', slots: [] }), []);
  return <ReportView id={11} data={SAMPLE} reload={() => {}} />;
}

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Fixture />;
}
