'use client';
/**
 * Post-match share card: a 1200×630 PNG (the X/OG card size) drawn on a canvas with the site's own
 * fonts, then handed to the native share sheet, or downloaded where sharing files isn't supported.
 */

export interface ShareCard {
  outcome: string; // Victory / Defeat / Draw / Match over
  tone: 'win' | 'loss' | 'neutral';
  roi: number; // % on starting margin
  equity: number;
  name: string;
  cls: string; // "Scout · 25x"
  mode: string;
  rival?: string;
  award?: string;
  practice: boolean;
}

const TONE = { win: '#ffc857', loss: '#d25a55', neutral: '#a9b8d4' };

const font = (v: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fallback;

function draw(c: ShareCard): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const saira = font('--font-saira', 'sans-serif');
  const chakra = font('--font-chakra', 'sans-serif');
  const jet = font('--font-jet', 'monospace');
  const tone = TONE[c.tone];

  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(0, 0, W, H);
  // one diagonal cut in the outcome colour, the site's section motif
  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.moveTo(W - 330, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H);
  ctx.lineTo(W - 190, H);
  ctx.closePath();
  ctx.globalAlpha = 0.14;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillRect(0, 0, W, 6);

  // brand
  ctx.fillStyle = '#e7e5e0';
  ctx.font = `700 22px ${chakra}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('LONGSHORT.FUN', 72, 84);
  ctx.fillStyle = '#626873';
  ctx.font = `600 16px ${chakra}`;
  ctx.fillText(`${c.mode.toUpperCase()}${c.practice ? ' · PRACTICE' : ' · RANKED'}`, 72, 116);

  // outcome word
  ctx.fillStyle = tone;
  ctx.font = `italic 800 170px ${saira}`;
  ctx.fontStretch = 'extra-condensed';
  ctx.letterSpacing = '0px';
  ctx.fillText(c.outcome.toUpperCase(), 64, 300);
  ctx.fontStretch = 'normal';

  // ROI
  const roi = `${c.roi > 0 ? '+' : c.roi < 0 ? '−' : ''}${Math.abs(c.roi).toFixed(2)}%`;
  ctx.fillStyle = c.roi > 0 ? '#4aa37c' : c.roi < 0 ? '#d25a55' : '#e7e5e0';
  ctx.font = `700 96px ${jet}`;
  ctx.fillText(roi, 72, 430);
  ctx.fillStyle = '#969ba5';
  ctx.font = `500 22px ${jet}`;
  ctx.fillText(`ROI · $${c.equity.toFixed(2)} final equity`, 76, 470);

  // player line
  ctx.fillStyle = '#e7e5e0';
  ctx.font = `700 30px ${chakra}`;
  ctx.letterSpacing = '1px';
  ctx.fillText(c.name, 72, 560);
  const nameW = ctx.measureText(c.name).width;
  ctx.fillStyle = '#969ba5';
  ctx.font = `600 18px ${chakra}`;
  ctx.letterSpacing = '3px';
  ctx.fillText(`${c.cls.toUpperCase()}${c.rival ? `  ·  VS ${c.rival.toUpperCase()}` : ''}`, 72 + nameW + 24, 558);
  if (c.award) {
    ctx.fillStyle = '#ffc857';
    ctx.fillText(`★ ${c.award.toUpperCase()}`, 72, 596);
  }
  ctx.fillStyle = '#626873';
  ctx.font = `500 16px ${jet}`;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'right';
  ctx.fillText('settled onchain · monad', W - 72, 596);
  return cv;
}

/** Share (native sheet) or download the card. Resolves to what happened, for the button label. */
export async function shareResult(c: ShareCard): Promise<'shared' | 'saved' | 'cancelled'> {
  await document.fonts.ready;
  const blob = await new Promise<Blob | null>((r) => draw(c).toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not draw the card');
  const file = new File([blob], `longshort-${c.outcome.toLowerCase().replace(/\s/g, '-')}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `${c.outcome} on longshort.fun · ${c.roi >= 0 ? '+' : ''}${c.roi.toFixed(2)}% ROI` });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
