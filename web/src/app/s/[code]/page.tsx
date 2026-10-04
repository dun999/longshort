import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MODES } from '@longshort/shared';
import { OUTCOME_WORD, shareText, signedPct } from '@/lib/shareLink';
import { privateMode } from '@/lib/gate';
import { resolveCard } from './resolve';

/** Shared results require the same access session as the game. */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'longshort.fun';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const c = await resolveCard(code);
  if (!c) return { title: 'longshort.fun' };
  const base = await origin();
  const title = `${c.name} · ${OUTCOME_WORD[c.outcome]} ${signedPct(c.roi)} · longshort.fun`;
  const description = shareText(c, false);
  const image = { url: `${base}/s/${code}/card`, width: 1200, height: 630, alt: `${OUTCOME_WORD[c.outcome]} ${signedPct(c.roi)} in a ${MODES[c.mode].name}` };
  return {
    title,
    description,
    openGraph: { title, description, url: `${base}/s/${code}`, siteName: 'longshort.fun', type: 'website', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function SharePage({ params }: Props) {
  const { code } = await params;
  const c = await resolveCard(code);
  if (!c) notFound();
  return (
    <div className="share-page">
      <div className="share-page-inner">
        <Link href="/" className="share-page-brand">
          <i />
          LONGSHORT<span>.FUN</span>
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/s/${code}/card`} width={1200} height={630} alt={`${c.name}: ${OUTCOME_WORD[c.outcome]} ${signedPct(c.roi)}`} className="share-page-card" />
        <h1>{shareText(c, false)}</h1>
        {/* private preview: the card, and nothing that pitches the game */}
        {privateMode() ? (
          <p className="share-page-private">
            <i /> Private preview · invite only
          </p>
        ) : (
          <>
            <p>60-second PvP perp matches on live prices. Duel, squad up or survive the royale.</p>
            <div className="share-page-cta">
              <Link href="/" className="btn-play">
                Play longshort.fun
              </Link>
              <Link href="/practice" className="gbtn ghost">
                Free practice round
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
