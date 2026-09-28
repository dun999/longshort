'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { sfx } from '@/lib/sfx';
import { useT } from '@/lib/i18n';

/**
 * One tap to post a result, like a music app's share sheet. Link targets (X, WhatsApp, Telegram,
 * Facebook) get the /s/… link, whose tags make the network unfurl the server-rendered card: nothing
 * to download. Instagram has no web composer, so on phones the 9:16 card goes straight into the
 * native share sheet as an image; it's fetched when the sheet opens because iOS only allows sharing
 * inside the tap itself.
 */
/** The share glyph for buttons that open this sheet. */
export const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 15V3m-4.5 4.5L12 3l4.5 4.5M5 12v8h14v-8" />
  </svg>
);

export function ShareSheet({ code, text, onClose }: { code: string; text: string; onClose: () => void }) {
  const t = useT();
  const url = `${location.origin}/s/${code}`;
  const card = `/s/${code}/card`;
  const [story, setStory] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);
  const [phone] = useState(() => matchMedia('(pointer: coarse)').matches && !!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }));

  // a ranked card appears once the keeper has recorded the settlement, usually already; retry briefly if not
  useEffect(() => {
    if (!phone) return;
    let dead = false;
    const load = (n: number): Promise<void> =>
      fetch(`${card}?f=story`)
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => void (!dead && setStory(new File([b], 'longshort-result.png', { type: 'image/png' }))))
        .catch(() => (n < 4 && !dead ? new Promise<void>((ok) => setTimeout(ok, 1500)).then(() => load(n + 1)) : undefined));
    void load(0);
    return () => void (dead = true);
  }, [card, phone]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);

  const enc = encodeURIComponent;
  const copy = async () => {
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const save = async () => {
    const blob = await fetch(card).then((r) => r.blob());
    const href = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href, download: 'longshort-result.png' }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  type Target = { k: string; label: string; href?: string; go?: () => void; busy?: boolean };
  const targets: Target[] = [
    { k: 'x', label: 'X', href: `https://x.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
    phone ? { k: 'ig', label: 'Instagram', busy: !story, go: () => story && void navigator.share({ files: [story] }).catch(() => {}) } : { k: 'save', label: t('sh.save'), go: () => void save() },
    { k: 'wa', label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
    { k: 'tg', label: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
    { k: 'fb', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    { k: 'copy', label: copied ? t('sh.copied') : t('sh.copy'), go: () => void copy() },
    ...(navigator.share ? [{ k: 'more', label: t('sh.more'), go: () => void navigator.share({ text, url }).catch(() => {}) }] : []),
  ];

  return createPortal(
    <div className="sh" role="dialog" aria-modal="true" aria-label={t('sh.title')}>
      <motion.div className="sh-dim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      <motion.div className="sh-panel" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <div className="sh-head">
          <span>{t('sh.title')}</span>
          <button onClick={onClose} aria-label={t('sh.close')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={retry} src={retry ? `${card}?r=${retry}` : card} alt="" className="sh-card" onError={() => retry < 4 && setTimeout(() => setRetry((r) => r + 1), 1500)} />
        <p className="sh-note">{t('sh.note')}</p>
        <div className="sh-grid">
          {targets.map((x) => {
            const body = (
              <>
                <i className={`sh-ico ${x.k}`}>{ICONS[x.k]}</i>
                <span>{x.busy ? t('sh.preparing') : x.label}</span>
              </>
            );
            return x.href ? (
              <a key={x.k} href={x.href} target="_blank" rel="noreferrer" className="sh-tile" onClick={() => sfx.click()}>
                {body}
              </a>
            ) : (
              <button key={x.k} className="sh-tile" disabled={x.busy} onClick={() => (sfx.click(), x.go?.())}>
                {body}
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

const ICONS: Record<string, React.ReactNode> = {
  x: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.18h1.7L7.4 4.73H5.58z" />
    </svg>
  ),
  ig: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  wa: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5zm0 17.3c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-2.8.8.8-2.7-.2-.3A7.8 7.8 0 1 1 12 19.8z" />
      <path d="M16.3 14.2c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.4 6.4 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.9 2.3 1 2.5c.1.2 1.7 2.6 4.1 3.7 1.5.7 2.1.7 2.9.6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.3-.2z" />
    </svg>
  ),
  tg: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.4 4.2 2.9 11.3c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.2-14.9c.3-1.3-.5-1.9-1.6-1.7zM8.6 14l9.2-5.8c.5-.3.8-.1.5.2l-7.6 6.9-.3 3.2z" />
    </svg>
  ),
  fb: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.5 21v-7.8h2.6l.4-3.1h-3V8.2c0-.9.3-1.5 1.5-1.5h1.6V4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.3H7.8v3.1h2.6V21z" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12m-5-5 5 5 5-5M4 20h16" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
};
