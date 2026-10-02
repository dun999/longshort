'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { LANGS, useLang, useT } from '@/lib/i18n';
import { music } from '@/lib/music';
import { sfx } from '@/lib/sfx';
import { useSettings } from '@/lib/settings';

/** Every setting in one card, centered over the page on desktop and phones alike. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  // portalled: the top bar's backdrop-filter would otherwise trap this fixed overlay inside the bar
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        // m-auto centers the card, yet a card taller than the screen (a phone in landscape) scrolls from its top
        <motion.div className="st-overlay fixed inset-0 z-50 flex overflow-y-auto bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            className="dialog-panel panel m-auto w-full max-w-[420px] p-5 sm:p-6"
            style={{ background: 'var(--panel-solid)' }}
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-4 border-b border-line pb-4">
              <h2 id="settings-title" className="font-display text-2xl font-bold tracking-wide uppercase">
                {t('set.title')}
              </h2>
              <button className="grid h-[44px] w-[44px] shrink-0 place-items-center border border-line text-dim transition-colors hover:border-[var(--line-hi)] hover:text-[var(--text)]" onClick={onClose} aria-label={t('ui.close')}>
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M1 1l10 10M11 1L1 11" />
                </svg>
              </button>
            </div>
            <Settings />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Bots, language, music and sound. */
export function Settings() {
  const t = useT();
  const { lang, set } = useLang();
  const { allowBots, setAllowBots } = useSettings();
  const [musicOn, setMusicOn] = useState(true);
  const [vol, setVol] = useState(0.55);
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    setMusicOn(music.isOn());
    setVol(music.volume());
    setSoundOn(!sfx.isMuted());
  }, []);
  return (
    <div className="st grid divide-y divide-[var(--line)] [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
      <div className="grid gap-1.5">
        <div className="st-row">
          <span>{t('set.bots')}</span>
          <div className="seg">
            {[true, false].map((on) => (
              <button key={String(on)} aria-pressed={allowBots === on} className={allowBots === on ? 'on' : ''} onClick={() => setAllowBots(on)}>
                <span>{t(on ? 'set.on' : 'set.off')}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] leading-relaxed text-dim">{t('set.botsHelp')}</p>
      </div>
      <div className="st-row">
        <span>{t('set.language')}</span>
        <div className="seg">
          {LANGS.map((l) => (
            <button key={l.id} className={lang === l.id ? 'on' : ''} onClick={() => (sfx.click(), set(l.id))} title={l.label}>
              <span>{l.short}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2.5">
        <div className="st-row">
          <span>{t('set.music')}</span>
          <div className="seg">
            {[true, false].map((on) => (
              <button key={String(on)} className={musicOn === on ? 'on' : ''} onClick={() => (music.setOn(on), setMusicOn(on))}>
                <span>{t(on ? 'set.on' : 'set.off')}</span>
              </button>
            ))}
          </div>
        </div>
        {musicOn && (
          <label className="st-row">
            <span>{t('set.volume')}</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={vol}
              onChange={(e) => (setVol(Number(e.target.value)), music.setVolume(Number(e.target.value)))}
              className="st-range"
              aria-label={t('set.volume')}
            />
          </label>
        )}
        <div className="st-row">
          <span>{t('set.sound')}</span>
          <div className="seg">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                className={soundOn === on ? 'on' : ''}
                onClick={() => {
                  if (on !== soundOn) sfx.toggle();
                  setSoundOn(on);
                  if (on) sfx.click();
                }}
              >
                <span>{t(on ? 'set.on' : 'set.off')}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
