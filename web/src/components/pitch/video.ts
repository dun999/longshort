/** The pitch video shown as the deck's first slide. Empty: the deck starts at the cover. */
export const PITCH_VIDEO_URL = '';

/** A YouTube, Vimeo or Loom share link as its embeddable player URL (null for anything else). */
export function embedUrl(url: string): { src: string; kind: 'youtube' | 'vimeo' | 'loom' } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const yt = host === 'youtu.be' ? u.pathname.slice(1) : host.endsWith('youtube.com') ? (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1]) : null;
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1`, kind: 'youtube' };
  const vimeo = host.endsWith('vimeo.com') ? u.pathname.match(/(\d{6,})/)?.[1] : null;
  if (vimeo) return { src: `https://player.vimeo.com/video/${vimeo}?dnt=1`, kind: 'vimeo' };
  const loom = host.endsWith('loom.com') ? u.pathname.match(/\/(?:share|embed)\/([\w-]+)/)?.[1] : null;
  if (loom) return { src: `https://www.loom.com/embed/${loom}?hide_owner=true&hide_share=true`, kind: 'loom' };
  return null;
}
