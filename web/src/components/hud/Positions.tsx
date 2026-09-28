'use client';
import { CLASSES, MARKETS, classOf, fmtPx, fmtUsd, liqPrice, upnl, type MarketSymbol } from '@longshort/shared';
import type { MatchView } from '@/lib/match';
import { TEAM_COLOR } from '@/lib/scene';
import { PlayerMark } from '../PlayerMark';
import { PanelHeader } from '../ui/Hint';
import { useT } from '@/lib/i18n';

/** Every player's live position in one dense, terminal-style table. */
export function Positions({ m }: { m: MatchView }) {
  const t = useT();
  const rows = [...m.players].sort((a, b) => Number(b.isMe) - Number(a.isMe) || b.equity - a.equity);
  const teams = m.mode !== 2;
  return (
    <div className="panel scroll-thin max-h-[200px] overflow-auto">
      <div className="px-2 pt-1.5">
        <PanelHeader title={t('hud.positions')} sub={t('hud.positionsSub')} hint="Everyone's trades are public onchain, so you can read your rivals. uPnL is unrealized profit, Liq is the price that knocks a player out, and Equity is their current score." />
      </div>
      <table className="num w-full min-w-[720px] text-[11px]">
        <thead className="sticky top-0 bg-[var(--panel-solid)]">
          <tr className="text-left text-[9px] tracking-[0.12em] text-dim uppercase">
            {(['trader', 'class', 'side', 'mkt', 'size', 'entry', 'mark', 'upnl', 'liq', 'realized', 'equity'] as const).map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-semibold ${i >= 4 ? 'text-right' : ''}`}>
                {t(`hud.col.${h}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const px = p.pos ? m.prices[MARKETS[p.pos.market] as MarketSymbol] : undefined;
            const u = p.pos && px ? upnl(p.pos, px) : 0;
            return (
              <tr key={p.addr} className={`border-t border-line ${p.isMe ? 'bg-white/[0.03]' : ''} ${p.out ? 'text-dim line-through decoration-dim/40' : ''}`}>
                <td className="max-w-[140px] truncate px-2 py-1 font-sans font-semibold">
                  {teams && <span className="mr-1.5 inline-block h-2 w-[3px] align-middle" style={{ background: TEAM_COLOR[p.team] }} />}
                  <PlayerMark addr={p.addr} size={14} className="mr-1.5 inline-block align-middle" />
                  {p.name}
                  {p.isMe && <span className="ml-1 text-[9px] text-[var(--accent)] uppercase">{t('hud.you')}</span>}
                  {p.bot && <span className="ml-1 text-[9px] text-dim uppercase">{t('hud.bot')}</span>}
                </td>
                <td className="px-2 py-1 text-muted">
                  {CLASSES[classOf(p.leverage)].name} {p.leverage}x
                </td>
                {p.pos ? (
                  <>
                    <td className={`px-2 py-1 font-semibold ${p.pos.isLong ? 'up' : 'down'}`}>{p.pos.isLong ? 'LONG' : 'SHORT'}</td>
                    <td className="px-2 py-1">{MARKETS[p.pos.market]}</td>
                    <td className="px-2 py-1 text-right">{fmtUsd(p.pos.notional)}</td>
                    <td className="px-2 py-1 text-right text-muted">{fmtPx(p.pos.entryPx)}</td>
                    <td className="px-2 py-1 text-right">{px ? fmtPx(px) : '…'}</td>
                    <td className={`px-2 py-1 text-right ${u >= 0 ? 'up' : 'down'}`}>{fmtUsd(u, true)}</td>
                    <td className="px-2 py-1 text-right text-gold/80">{fmtPx(liqPrice(p.realized, p.pos))}</td>
                  </>
                ) : (
                  <td colSpan={7} className="px-2 py-1 text-dim">
                    {t(p.out ? 'hud.out' : 'hud.flat')}
                  </td>
                )}
                <td className={`px-2 py-1 text-right ${p.realized >= 0 ? 'up' : 'down'}`}>{fmtUsd(p.realized, true)}</td>
                <td className="px-2 py-1 text-right font-semibold">{fmtUsd(p.equity)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
