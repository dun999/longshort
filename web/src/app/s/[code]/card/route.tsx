/* eslint-disable @next/next/no-img-element -- Satori draws plain <img>; next/image has no meaning in an image response */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { MODES, STAKE, fmtUsd, CHARACTER_INFO, characterOf, type CharacterId } from '@longshort/shared';
import { sigil } from '@/lib/sigil';
import { OUTCOME_WORD, signedPct, type CardData } from '@/lib/shareLink';
import { resolveCard } from '../resolve';

/**
 * The result card as a PNG, rendered on the server so a shared link unfurls with it on X, Telegram,
 * WhatsApp etc. without the player downloading anything. `?f=story` is the 9:16 version the share
 * sheet hands to Instagram through the native share sheet.
 */
export const runtime = 'nodejs';

// standalone output chdirs to the app dir, so this resolves in dev and in production alike
const FONTS = path.join(process.cwd(), 'src/assets/fonts');
let fonts: Promise<{ name: string; data: Buffer; weight: 500 | 600 | 700 | 800 }[]> | undefined;
const loadFonts = () =>
  (fonts ??= Promise.all(
    (
      [
        ['Chakra', 'ChakraPetch-SemiBold.ttf', 600],
        ['Chakra', 'ChakraPetch-Bold.ttf', 700],
        ['Saira', 'SairaExtraCondensed-ExtraBold.ttf', 800],
        ['Jet', 'JetBrainsMono-Medium.ttf', 500],
        ['Jet', 'JetBrainsMono-Bold.ttf', 700],
      ] as const
    ).map(async ([name, file, weight]) => ({ name, data: await readFile(path.join(FONTS, file)), weight })),
  ));

/** The player's character, posed for the outcome (rendered from the arena models, see web/art/cast). */
const CAST = path.join(process.cwd(), 'src/assets/cast');
const POSE: Record<CardData['outcome'], 'win' | 'out' | 'idle'> = { win: 'win', loss: 'out', draw: 'idle', over: 'idle' };
type Figure = { src: string; w: number; h: number };
const figures = new Map<string, Promise<Figure>>();
const figure = (id: CharacterId, pose: string) => {
  const k = `${id}-${pose}`;
  if (!figures.has(k))
    figures.set(
      k,
      readFile(path.join(CAST, `${k}.png`)).then((b) => ({ src: `data:image/png;base64,${b.toString('base64')}`, w: b.readUInt32BE(16), h: b.readUInt32BE(20) })),
    );
  return figures.get(k)!;
};

const C = { bg: '#0c0d10', panel: '#14161b', line: '#242831', text: '#e7e5e0', muted: '#969ba5', dim: '#626873', up: '#4aa37c', down: '#d25a55', bone: '#e7e1d3' };
const TONE = { win: '#ffc857', loss: '#d25a55', draw: '#a9b8d4', over: '#a9b8d4' };

function hex(hsl: string) {
  const [h, s, l] = hsl.match(/[\d.]+/g)!.map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function Sigil({ addr, size }: { addr: string; size: number }) {
  const { cells, fg, alt } = sigil(addr);
  const u = size / 7;
  return (
    <div style={{ display: 'flex', position: 'relative', width: size, height: size, background: '#15171c' }}>
      {cells.map(([x, y, two]) => (
        <div key={`${x}${y}`} style={{ position: 'absolute', left: (x + 1) * u, top: (y + 1) * u, width: u + 0.5, height: u + 0.5, background: hex(two ? alt : fg) }} />
      ))}
    </div>
  );
}

const Diamond = ({ size }: { size: number }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, background: C.bone, transform: 'rotate(45deg)' }}>
    <div style={{ display: 'flex', width: size * 0.42, height: size * 0.42, background: C.bg }} />
  </div>
);

/** Award line; the site's diamond mark stands in for a star (the display fonts have no ★). */
const Award = ({ text, size }: { text: string; size: number }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.7, fontFamily: 'Chakra', fontWeight: 700, fontSize: size, letterSpacing: size / 6, color: TONE.win }}>
    <div style={{ display: 'flex', width: size * 0.5, height: size * 0.5, background: TONE.win, transform: 'rotate(45deg)' }} />
    {text.toUpperCase()}
  </div>
);

function Brand({ c, big }: { c: CardData; big?: boolean }) {
  const s = big ? 1.5 : 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 * s }}>
        <Diamond size={26 * s} />
        <div style={{ display: 'flex', fontFamily: 'Chakra', fontWeight: 700, fontSize: 26 * s, letterSpacing: 5 * s, color: C.text }}>
          LONGSHORT<span style={{ color: C.dim }}>.FUN</span>
        </div>
      </div>
      <div style={{ display: 'flex', fontFamily: 'Chakra', fontWeight: 600, fontSize: 18 * s, letterSpacing: 4 * s, color: C.muted }}>
        {`${MODES[c.mode].name.toUpperCase()} · ${c.practice ? 'PRACTICE' : `MATCH #${c.id}`}`}
      </div>
    </div>
  );
}

const detail = (c: CardData) => `${CHARACTER_INFO[characterOf(c.addr, c.character)].name} · ${c.leverage}x${c.rival ? `  ·  vs ${c.rival}` : c.place && c.of ? `  ·  ${c.place} of ${c.of}` : ''}`.toUpperCase();
const money = (c: CardData) => `${fmtUsd(c.equity)} final equity${c.payout > 0 ? ` · +${c.payout.toFixed(2)} ${STAKE} won` : ''}`;
const roiTone = (c: CardData) => (c.roi > 0.005 ? C.up : c.roi < -0.005 ? C.down : C.text);

function Landscape({ c, fig }: { c: CardData; fig: Figure }) {
  const tone = TONE[c.outcome];
  const word = OUTCOME_WORD[c.outcome].toUpperCase();
  return (
    <div style={{ display: 'flex', position: 'relative', width: 1200, height: 630, background: C.bg, overflow: 'hidden' }}>
      {/* the site's diagonal cut, in the outcome colour, with the player's sigil on it */}
      <div style={{ display: 'flex', position: 'absolute', top: -40, right: -170, width: 560, height: 720, background: tone, opacity: 0.1, transform: 'skewX(-16deg)' }} />
      <div style={{ display: 'flex', position: 'absolute', top: -40, right: 340, width: 3, height: 720, background: tone, opacity: 0.5, transform: 'skewX(-16deg)' }} />
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: 1200, height: 8, background: tone }} />
      <img alt="" src={fig.src} width={Math.round((fig.w * 430) / fig.h)} height={430} style={{ position: 'absolute', top: 104, right: 150 }} />

      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '56px 72px 52px' }}>
        <Brand c={c} />
        <div style={{ display: 'flex', marginTop: 34, fontFamily: 'Saira', fontWeight: 800, fontSize: word.length > 7 ? 150 : 190, lineHeight: 0.9, letterSpacing: 2, color: tone, transform: 'skewX(-9deg)', transformOrigin: 'bottom left' }}>
          {word}
        </div>
        <div style={{ display: 'flex', marginTop: 18, fontFamily: 'Jet', fontWeight: 700, fontSize: 92, lineHeight: 1, color: roiTone(c) }}>{signedPct(c.roi)}</div>
        <div style={{ display: 'flex', marginTop: 14, fontFamily: 'Jet', fontWeight: 500, fontSize: 22, color: C.muted }}>{`ROI · ${money(c)}`}</div>

        <div style={{ display: 'flex', marginTop: 'auto', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ display: 'flex', padding: 3, border: `2px solid ${C.line}`, background: C.panel }}>
                <Sigil addr={c.addr} size={38} />
              </div>
              <div style={{ display: 'flex', fontFamily: 'Chakra', fontWeight: 700, fontSize: 34, color: C.text }}>{c.name}</div>
              <div style={{ display: 'flex', fontFamily: 'Chakra', fontWeight: 600, fontSize: 18, letterSpacing: 3, color: C.muted }}>{detail(c)}</div>
            </div>
            {c.award && <Award text={c.award} size={18} />}
          </div>
          <div style={{ display: 'flex', fontFamily: 'Jet', fontWeight: 500, fontSize: 17, color: C.dim }}>{c.practice ? 'live prices · nothing at stake' : 'settled onchain · monad'}</div>
        </div>
      </div>
    </div>
  );
}

function Story({ c, fig }: { c: CardData; fig: Figure }) {
  const tone = TONE[c.outcome];
  const word = OUTCOME_WORD[c.outcome].toUpperCase();
  return (
    <div style={{ display: 'flex', position: 'relative', width: 1080, height: 1920, background: C.bg, overflow: 'hidden' }}>
      <div style={{ display: 'flex', position: 'absolute', top: 560, left: -200, width: 1500, height: 520, background: tone, opacity: 0.09, transform: 'skewY(-14deg)' }} />
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: 1080, height: 14, background: tone }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', padding: '130px 90px 150px' }}>
        <Brand c={c} big />
        <img alt="" src={fig.src} width={Math.round((fig.w * 640) / fig.h)} height={640} style={{ marginTop: 90 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 30 }}>
          <div style={{ display: 'flex', padding: 4, border: `3px solid ${C.line}`, background: C.panel }}>
            <Sigil addr={c.addr} size={56} />
          </div>
          <div style={{ display: 'flex', fontFamily: 'Chakra', fontWeight: 700, fontSize: 52, color: C.text }}>{c.name}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 10, fontFamily: 'Chakra', fontWeight: 600, fontSize: 26, letterSpacing: 5, color: C.muted }}>{detail(c)}</div>
        <div style={{ display: 'flex', marginTop: 40, fontFamily: 'Saira', fontWeight: 800, fontSize: word.length > 7 ? 200 : 270, lineHeight: 0.9, letterSpacing: 3, color: tone, transform: 'skewX(-9deg)' }}>{word}</div>
        <div style={{ display: 'flex', marginTop: 30, fontFamily: 'Jet', fontWeight: 700, fontSize: 150, lineHeight: 1, color: roiTone(c) }}>{signedPct(c.roi)}</div>
        <div style={{ display: 'flex', marginTop: 22, fontFamily: 'Jet', fontWeight: 500, fontSize: 30, color: C.muted }}>{money(c)}</div>
        {c.award && (
          <div style={{ display: 'flex', marginTop: 34 }}>
            <Award text={c.award} size={28} />
          </div>
        )}
        <div style={{ display: 'flex', marginTop: 'auto', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', padding: '26px 64px', background: C.bone, color: C.bg, fontFamily: 'Chakra', fontWeight: 700, fontSize: 38, letterSpacing: 8 }}>BEAT ME · LONGSHORT.FUN</div>
          <div style={{ display: 'flex', fontFamily: 'Jet', fontWeight: 500, fontSize: 24, color: C.dim }}>{c.practice ? 'live prices · nothing at stake' : 'settled onchain · monad'}</div>
        </div>
      </div>
    </div>
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = await resolveCard(code);
  if (!c) return new Response('Not found', { status: 404 });
  const story = new URL(req.url).searchParams.get('f') === 'story';
  const fig = await figure(characterOf(c.addr, c.character), POSE[c.outcome]);
  return new ImageResponse(story ? <Story c={c} fig={fig} /> : <Landscape c={c} fig={fig} />, {
    ...(story ? { width: 1080, height: 1920 } : { width: 1200, height: 630 }),
    fonts: await loadFonts(),
    // a settled result never changes; practice links carry their whole card
    headers: { 'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable' },
  });
}
