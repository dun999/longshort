'use client';
import { useEffect, useState } from 'react';
import { LANGS, useLang, useT } from '@/lib/i18n';
import { music } from '@/lib/music';
import { sfx } from '@/lib/sfx';
import { useSettings } from '@/lib/settings';

/** Bots, language, music and sound: shared by the desktop settings card and the phone menu. */
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
