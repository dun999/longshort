'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * "?" badge that explains a component on hover/focus.
 * The tooltip renders in a body portal: panels use clip-path, which would otherwise cut it off.
 */
export function Hint({ text }: { text: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom > window.innerHeight - 140;
    const half = Math.min(128, (window.innerWidth - 24) / 2); // w-64 at 14px root = 224px, capped to the viewport
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, half + 12), window.innerWidth - half - 12), y: up ? r.top - 8 : r.bottom + 8, up });
  };
  // touch: a tap toggles it and a tap anywhere else closes it (no hover on phones)
  useEffect(() => {
    if (!pos) return;
    const away = (e: PointerEvent) => e.target !== ref.current && setPos(null);
    const hide = () => setPos(null);
    document.addEventListener('pointerdown', away);
    window.addEventListener('scroll', hide, true);
    return () => (document.removeEventListener('pointerdown', away), window.removeEventListener('scroll', hide, true));
  }, [pos]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={text}
        onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setPos(null)}
        onPointerUp={(e) => e.pointerType !== 'mouse' && (pos ? setPos(null) : show())}
        onFocus={show}
        onBlur={() => setPos(null)}
        className="relative grid h-[15px] w-[15px] shrink-0 cursor-help place-items-center rounded-full border border-[var(--line-hi)] text-[9px] font-bold text-muted after:absolute after:-inset-[15px] after:content-[''] hover:border-[var(--accent)] hover:text-[var(--text)]"
      >
        ?
      </button>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-64 max-w-[calc(100vw-24px)] border border-[var(--line-hi)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text)]"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.up ? '-100%' : '0'})`, background: 'var(--panel-solid)' }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}

/** Standard panel header: NAME (?) · what it is ········ right-side slot. */
export function PanelHeader({ title, sub, hint, right }: { title: string; sub?: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="phead min-w-0 flex-1 items-center!">
        <h3>{title}</h3>
        {hint && <Hint text={hint} />}
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}
