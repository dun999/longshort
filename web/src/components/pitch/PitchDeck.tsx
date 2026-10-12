'use client';
/*
 * /pitch: the pitch deck as a slideshow. Keys, buttons, swipe or the wheel move one slide at a time; the page
 * itself never scrolls. With a video link set, the pitch video is the first slide.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DECK_SLIDES } from './slides';
import { PITCH_VIDEO_URL, embedUrl } from './video';
import s from './pitch.module.css';

const video = PITCH_VIDEO_URL ? embedUrl(PITCH_VIDEO_URL) : null;
const SLIDES: ('video' | string)[] = [...(video ? ['video' as const] : []), ...DECK_SLIDES];

export function PitchDeck() {
  const [i, setI] = useState(0);
  const [scale, setScale] = useState(0);
  const [idle, setIdle] = useState(false);
  const [canFull, setCanFull] = useState(false); // iPhone browsers have no element fullscreen
  useEffect(() => setCanFull(!!document.fullscreenEnabled), []);
  const frame = useRef<HTMLIFrameElement>(null);
  const n = SLIDES.length;
  const go = useCallback((k: number) => setI(Math.max(0, Math.min(n - 1, k))), [n]);

  // fit the 1920×1080 canvas inside the window
  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);

  // the slide number lives in the URL, so a link can open a given slide
  useEffect(() => {
    const read = () => go((parseInt(location.hash.slice(1), 10) || 1) - 1);
    read();
    addEventListener('hashchange', read);
    return () => removeEventListener('hashchange', read);
  }, [go]);
  useEffect(() => {
    if (location.hash !== `#${i + 1}`) history.replaceState(null, '', `#${i + 1}`);
  }, [i]);

  // leaving the video slide pauses the video
  useEffect(() => {
    if (!video || i === 0 || !frame.current?.contentWindow) return;
    const w = frame.current.contentWindow;
    if (video.kind === 'youtube') w.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
    if (video.kind === 'vimeo') w.postMessage(JSON.stringify({ method: 'pause' }), '*');
  }, [i]);

  const full = useCallback(() => {
    const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void done?.catch(() => {});
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) (e.preventDefault(), setI((k) => Math.min(n - 1, k + 1)));
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) (e.preventDefault(), setI((k) => Math.max(0, k - 1)));
      else if (e.key === 'Home') setI(0);
      else if (e.key === 'End') setI(n - 1);
      else if (e.key === 'f' || e.key === 'F') full();
    };
    // a wheel or trackpad flick moves one slide; the deck never scrolls
    let lock = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 24 || Date.now() < lock) return;
      lock = Date.now() + 700;
      setI((k) => Math.max(0, Math.min(n - 1, k + Math.sign(d))));
    };
    addEventListener('keydown', key);
    addEventListener('wheel', wheel, { passive: false });
    return () => (removeEventListener('keydown', key), removeEventListener('wheel', wheel));
  }, [n, full]);

  // controls fade out while the pointer rests, so a recording shows only the slide
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => (setIdle(false), clearTimeout(t), (t = setTimeout(() => setIdle(true), 2500)));
    wake();
    addEventListener('pointermove', wake);
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);
    return () => (clearTimeout(t), removeEventListener('pointermove', wake), removeEventListener('pointerdown', wake), removeEventListener('keydown', wake));
  }, []);

  const x0 = useRef<number | null>(null);
  return (
    <div
      className={`${s.deck} ${idle ? s.idle : ''}`}
      onPointerDown={(e) => (x0.current = e.pointerType === 'mouse' ? null : e.clientX)}
      onPointerUp={(e) => {
        if (x0.current === null) return;
        const dx = e.clientX - x0.current;
        x0.current = null;
        if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
      }}
    >
      <div className={s.track} style={{ transform: `translate3d(${-i * 100}vw,0,0)` }}>
        {SLIDES.map((slide, k) => (
          <div key={k} className={s.panel} inert={k !== i} aria-roledescription="slide" aria-label={`${k + 1} of ${n}`}>
            <div className={s.stage} style={{ transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>
              {slide === 'video' ? (
                <section className={s.video}>
                  <p className={s.videoEyebrow}>Monad Metropolis · Pitch</p>
                  <p className={s.videoMark}>longshort<i>.fun</i></p>
                  <div className={s.frame}>
                    <iframe ref={frame} src={video!.src} title="longshort.fun pitch video" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
                  </div>
                  <div className={s.videoFoot}>
                    <span><b>Rifaldi</b> · Adhiya · Hikari</span>
                    <span>The deck follows →</span>
                  </div>
                </section>
              ) : (
                <div className={s.slide} dangerouslySetInnerHTML={{ __html: slide }} />
              )}
            </div>
          </div>
        ))}
      </div>
      <nav className={s.controls} aria-label="Slides">
        <button className={s.btn} onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M10 3 5 8l5 5" /></svg>
        </button>
        <div className={s.dots}>
          {SLIDES.map((_, k) => (
            <button key={k} className={`${s.dot} ${k === i ? s.dotOn : ''}`} onClick={() => go(k)} aria-label={`Slide ${k + 1}`} aria-current={k === i} />
          ))}
        </div>
        <span className={s.count}>{i + 1} / {n}</span>
        <button className={s.btn} onClick={() => go(i + 1)} disabled={i === n - 1} aria-label="Next slide">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </nav>
      {canFull && <button className={s.full} onClick={full} title="Fullscreen (F)">Fullscreen</button>}
    </div>
  );
}
