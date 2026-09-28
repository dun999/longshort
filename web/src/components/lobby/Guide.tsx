'use client';
/*
 * How-to-play guide for first-time players: a short coach-mark tour. Steps about lobby controls
 * spotlight the real control (by its data-tour attribute); steps about the match itself are a
 * centred card with a small illustration. Opens once on the first visit to /play, then from the
 * "How to play" link (or /play?guide=1).
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { sfx } from '@/lib/sfx';
import { useT } from '@/lib/i18n';

const DONE = 'ls.guide.v1';
export const guideSeen = () => {
  try {
    return localStorage.getItem(DONE) === '1';
  } catch {
    return true; // storage blocked: never nag
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(DONE, '1');
  } catch {}
};

type Art = 'intro' | 'trade' | 'win';
interface Step {
  target?: 'mode' | 'class' | 'play' | 'party';
  art?: Art;
  n: 1 | 2 | 3 | 4 | 5 | 6 | 7; // gd.{n}t / gd.{n}b in the dictionary
}

const STEPS: Step[] = [
  { art: 'intro', n: 1 },
  { target: 'mode', n: 2 },
  { target: 'class', n: 3 },
  { target: 'party', n: 4 },
  { target: 'play', n: 5 },
  { art: 'trade', n: 6 },
  { art: 'win', n: 7 },
];

function ArtBox({ art }: { art: Art }) {
  const t = useT();
  if (art === 'intro')
    return (
      <div className="gd-art">
        <div className="gd-big num">$1,000</div>
        <div className="gd-tickers num">
          <span>BTC</span>
          <span>ETH</span>
          <span>MON</span>
          <span className="text-dim">{t('gd.clock')}</span>
        </div>
      </div>
    );
  if (art === 'trade')
    return (
      <div className="gd-art gd-trade" aria-hidden>
        <span className="long">▲ Long</span>
        <span className="close">{t('hud.close')}</span>
        <span className="short">Short ▼</span>
      </div>
    );
  return (
    <div className="gd-art">
      <div className="gd-victory">{t('rs.victory')}</div>
      <div className="num text-[13px] text-gold">{t('gd.paid')}</div>
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number };

export function Guide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  // track the highlighted control through resizes and scrolls
  const measure = useCallback(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    const r = el?.getBoundingClientRect();
    setBox(r && r.width ? { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 } : null);
  }, [step]);
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => (window.removeEventListener('resize', measure), window.removeEventListener('scroll', measure, true));
  }, [open, measure]);

  const close = useCallback(() => {
    markSeen();
    onClose();
  }, [onClose]);
  const next = useCallback(() => (sfx.click(), last ? close() : setI((n) => n + 1)), [last, close]);
  const back = useCallback(() => (sfx.click(), setI((n) => Math.max(0, n - 1))), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') (e.preventDefault(), next());
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, close]);

  // card beside the spotlight: below it when there's room, otherwise above; centred when nothing is highlighted.
  // (positioned by a wrapper: the card's own transform belongs to its entrance animation)
  const W = Math.min(380, vw - 24);
  const H = step?.art ? 360 : 260;
  let pos: React.CSSProperties | undefined;
  if (box) {
    const left = Math.min(Math.max(12, box.x + box.w / 2 - W / 2), vw - W - 12);
    pos = box.y + box.h + 12 + H < vh ? { left, top: box.y + box.h + 12 } : { left, bottom: Math.max(12, vh - box.y + 12) };
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="gd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={t('gd.kicker')}>
          {box ? (
            <motion.div className="gd-spot" initial={false} animate={{ left: box.x, top: box.y, width: box.w, height: box.h }} transition={{ type: 'spring', stiffness: 320, damping: 32 }} />
          ) : (
            <div className="gd-dim" />
          )}
          <div className={box ? 'gd-pos' : 'gd-center'} style={pos}>
          <AnimatePresence mode="wait">
            <motion.div key={i} className="gd-card" style={{ width: W }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
              <div className="gd-head">
                <span className="gd-count">
                  {String(i + 1).padStart(2, '0')}
                  <em>/{String(STEPS.length).padStart(2, '0')}</em>
                </span>
                <span className="gd-kicker">{t('gd.kicker')}</span>
                <button className="gd-skip" onClick={close}>
                  {t('gd.skip')}
                </button>
              </div>
              <h2 className="gd-title">{t(`gd.${step.n}t`)}</h2>
              {step.art && <ArtBox art={step.art} />}
              <p className="gd-body">{t(`gd.${step.n}b`)}</p>
              <div className="gd-foot">
                <div className="gd-dots" aria-hidden>
                  {STEPS.map((_, k) => (
                    <i key={k} className={k === i ? 'on' : k < i ? 'done' : ''} />
                  ))}
                </div>
                {i > 0 && (
                  <button className="gbtn ghost sm" onClick={back}>
                    {t('gd.back')}
                  </button>
                )}
                {last ? (
                  <button className="btn-play sm" onClick={() => (close(), router.push('/practice'))}>
                    {t('gd.practice')}
                  </button>
                ) : (
                  <button className="btn-play sm" onClick={next}>
                    {t('gd.next')}
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
