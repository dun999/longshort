/*
 * Renders the 2D stills of the cast from the live three.js models (the /dev/cast turntable):
 *   public/cast/<id>.webp            head-and-shoulders avatar (character picker)
 *   public/cast/lounge/<id>.webp     the lounge pose with its props, no foothold (landing roster, reduced motion)
 *   public/cast/lounge/<id>-loop.webp  the 4 s lounge loop as an animated WebP, 15 fps, same frame as the still.
 *                                    Roster images are opaque, on the landing's ink (#0a0a0d) with a violet floor glow
 *                                    baked in: alpha costs about three times the bytes in an animated WebP.
 *   src/assets/cast/lounge.json      the roster images' pixel sizes
 *   public/cast/result/<id>-cheer.webp, <id>-sulk.webp  the victory dance and the defeat as transparent animated
 *                                    WebPs, 15 fps, no foothold (result cards); <id>-cheer-still.webp, <id>-sulk-still.webp
 *                                    and <id>-idle.webp are single frames of the same crop (reduced motion, no result yet)
 *   src/assets/cast/result.json      the result images' pixel sizes and where the feet are, as fractions
 *   src/assets/cast/<id>-<pose>.png  idle, win (the top of the cheer's jump) and out (the sulk's deepest slump) on the
 *                                    foothold (share card)
 * Needs `next dev` on :3000, Playwright, and Python with Pillow.
 *   PLAYWRIGHT=/path/to/node_modules/playwright node web/art/cast/stills.cjs [--lounge | --result] [id ...]
 *   --lounge: the landing roster only; --result: the result-card loops and the share-card poses only
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const WEB = path.resolve(__dirname, '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-'));
const ACCENT = '#7c5cff'; // stills carry the brand violet where the arena would show the player's colour
// per character: camera azimuth, and the head's height for the avatar crop
const CAST = {
  gladiator: { az: -22, head: 1.78 }, sniper: { az: -24, head: 1.72 }, pathfinder: { az: -16, head: 1.7 }, pirate: { az: -18, head: 1.74 },
  pigeon: { az: -30, head: 1.3, laz: -68 }, keone: { az: -14, head: 1.7 },
};
// share-card poses: [clip, seconds] (anims.py: the cheer's jump tops out at frame 41, the sulk slumps deepest at 77)
const POSE = { idle: ['idle', 0], win: ['cheer', 40 / 30], out: ['sulk', 76 / 30] };
const FPS = 15;
const LOOP = { lounge: 4, cheer: 64 / 30, sulk: 3 }; // seconds: anims.py runs lounge 1-121, cheer 1-65, sulk 1-91 at 30 fps
const frames = (clip) => Math.round(FPS * LOOP[clip]);
const args = process.argv.slice(2);
const only = args.includes('--lounge') ? 'lounge' : args.includes('--result') ? 'result' : null;
const named = args.filter((a) => !a.startsWith('--'));
const ids = named.length ? named : Object.keys(CAST);
const HIDE = 'nextjs-portal{display:none!important} .scanlines{display:none!important} .ui > *:not(main){display:none!important} html,body,.ui,main{background:transparent!important}';

(async () => {
  const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const shot = async (page, q, file) => {
    await page.goto(`http://localhost:3000/dev/cast?${q}&bg=none&accent=${encodeURIComponent(ACCENT)}`, { waitUntil: 'load', timeout: 120000 });
    await page.addStyleTag({ content: HIDE });
    await page.waitForFunction(() => window.__castReady, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(TMP, file), omitBackground: true });
  };
  // a whole loop: one page load, then step the held frame
  const loop = async (page, q, clip, name) => {
    await shot(page, `${q}&clip=${clip}&at=0`, `${name}-0.png`);
    for (let f = 1; f < frames(clip); f++) {
      await page.evaluate((t) => window.__castAt(t), f / FPS);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
      await page.screenshot({ path: path.join(TMP, `${name}-${f}.png`), omitBackground: true });
    }
  };
  const tall = await b.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 2 });
  const square = await b.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  for (const id of ids) {
    const { az, head } = CAST[id];
    if (only !== 'lounge') {
      for (const [pose, [clip, at]] of Object.entries(POSE)) await shot(tall, `c=${id}&portrait=1&clip=${clip}&at=${at}&az=${az}`, `${id}-${pose}.png`);
      await shot(tall, `c=${id}&portrait=1&clip=idle&at=0&az=${az}&base=0`, `${id}-rest.png`);
      for (const clip of ['cheer', 'sulk']) await loop(tall, `c=${id}&portrait=1&az=${az}&base=0`, clip, `${id}-${clip}`);
    }
    if (only !== 'result') await loop(tall, `c=${id}&portrait=1&az=${CAST[id].laz ?? az}&base=0`, 'lounge', `${id}-lounge`);
    if (!only) await shot(square, `c=${id}&bust=${head}&clip=idle&at=0&az=${az + 8}`, `${id}-bust.png`);
  }
  await b.close();
  for (const dir of ['public/cast/lounge', 'public/cast/result', 'src/assets/cast']) fs.mkdirSync(path.join(WEB, dir), { recursive: true });
  execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw, ImageFilter
import json, sys
tmp, web, ids = sys.argv[1], sys.argv[2], sys.argv[4:]
only = None if sys.argv[3] == 'null' else sys.argv[3]
n = {'lounge': ${frames('lounge')}, 'cheer': ${frames('cheer')}, 'sulk': ${frames('sulk')}}
def fit(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
def union(boxes):
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
def load(path, default):
    try:
        return json.load(open(path))
    except FileNotFoundError:
        return default
for id in (ids if only != 'lounge' else []):
    # share card: one crop for the three poses so the foothold sits in the same place
    ims = {p: Image.open(f'{tmp}/{id}-{p}.png').convert('RGBA') for p in ('idle', 'win', 'out')}
    bb = union([im.getbbox() for im in ims.values()])
    box = (max(0, bb[0] - 16), max(0, bb[1] - 16), min(1200, bb[2] + 16), min(1600, bb[3] + 16))
    for p, im in ims.items():
        fit(im.crop(box), 720).save(f'{web}/src/assets/cast/{id}-{p}.png', optimize=True)
if only is None:
    for id in ids:
        Image.open(f'{tmp}/{id}-bust.png').convert('RGBA').resize((192, 192), Image.LANCZOS).save(f'{web}/public/cast/{id}.webp', 'WEBP', quality=88, method=6)

# result cards: one shared scale (the same camera for all), so a pigeon stays pigeon-sized next to the gladiator;
# one crop per character covering both loops and the rest pose, so the feet stand on the same spot in all of them
K = 0.36
result_path = f'{web}/src/assets/cast/result.json'
result = load(result_path, {})
for id in (ids if only != 'lounge' else []):
    loops = {c: [Image.open(f'{tmp}/{id}-{c}-{f}.png').convert('RGBA') for f in range(n[c])] for c in ('cheer', 'sulk')}
    rest = Image.open(f'{tmp}/{id}-rest.png').convert('RGBA')
    bb = union([im.getbbox() for fs in loops.values() for im in fs] + [rest.getbbox()])
    pad = 12
    box = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(rest.width, bb[2] + pad), min(rest.height, bb[3] + pad))
    size = (round((box[2] - box[0]) * K), round((box[3] - box[1]) * K))
    shrink = lambda im: im.crop(box).resize(size, Image.LANCZOS)
    for c, fs in loops.items():
        out = [shrink(im) for im in fs]
        out[0].save(f'{web}/public/cast/result/{id}-{c}.webp', 'WEBP', save_all=True, append_images=out[1:], duration=round(1000 / ${FPS}), loop=0, quality=78, alpha_quality=70, method=6, minimize_size=True)
    # stills: the cheer's jump, the sulk's deepest slump (the share card's poses), and standing at rest
    still = {'cheer': loops['cheer'][round(${POSE.win[1]} * ${FPS})], 'sulk': loops['sulk'][round(${POSE.out[1]} * ${FPS})]}
    for c, im in still.items():
        shrink(im).save(f'{web}/public/cast/result/{id}-{c}-still.webp', 'WEBP', quality=84, alpha_quality=80, method=6)
    shrink(rest).save(f'{web}/public/cast/result/{id}-idle.webp', 'WEBP', quality=84, alpha_quality=80, method=6)
    # where the feet are at rest (the centre of the lowest rows), as fractions of the image
    a = rest.crop(box).getchannel('A')
    fb = a.getbbox()
    feet = a.crop((0, fb[3] - 24, a.width, fb[3])).getbbox()
    result[id] = {'w': size[0], 'h': size[1], 'x': round((feet[0] + feet[2]) / 2 / a.width, 4), 'y': round(fb[3] / a.height, 4)}
    print(id, 'result', size[0], size[1], result[id])
if only != 'lounge':
    json.dump({i: result[i] for i in sorted(result)}, open(result_path, 'w'), indent=2)

# landing roster: one shared scale (same camera for all), so a pigeon stays pigeon-sized next to the gladiator;
# one crop per character covering every frame of its loop, so the figure doesn't jump between frames
k = 0.5
sizes_path = f'{web}/src/assets/cast/lounge.json'
sizes = load(sizes_path, {})
INK = (10, 10, 13)
for id in (ids if only != 'result' else []):
    frames = [Image.open(f'{tmp}/{id}-lounge-{f}.png').convert('RGBA') for f in range(n['lounge'])]
    bb = [im.getbbox() for im in frames]
    w, h = frames[0].size
    pad = 28
    box = (max(0, min(b[0] for b in bb) - pad), max(0, min(b[1] for b in bb) - pad), min(w, max(b[2] for b in bb) + pad), min(h, max(b[3] for b in bb) + 64))
    # the floor glow: a soft violet ellipse where the feet meet the ground
    ground = Image.new('RGBA', (box[2] - box[0], box[3] - box[1]), INK + (255,))
    glow = Image.new('RGBA', ground.size, (0, 0, 0, 0))
    cx, cy = ground.width / 2, max(b[3] for b in bb) - box[1] - 6
    rx = min(190, ground.width / 2 - 60)  # fades out before the image's edge, which must stay pure ink
    ImageDraw.Draw(glow).ellipse((cx - rx, cy - 18, cx + rx, cy + 18), fill=(124, 92, 255, 64))
    ground.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
    size = (round(ground.width * k), round(ground.height * k))
    out = []
    for im in frames:
        f = ground.copy()
        f.alpha_composite(im.crop(box))
        out.append(f.convert('RGB').resize(size, Image.LANCZOS))
    out[0].save(f'{web}/public/cast/lounge/{id}.webp', 'WEBP', quality=86, method=6)
    out[0].save(f'{web}/public/cast/lounge/{id}-loop.webp', 'WEBP', save_all=True, append_images=out[1:], duration=round(1000 / ${FPS}), loop=0, quality=74, method=6, minimize_size=True)
    sizes[id] = list(size)
    print(id, 'lounge', *size)
if only != 'result':
    json.dump({i: sizes[i] for i in sorted(sizes)}, open(sizes_path, 'w'), indent=2)
`, TMP, WEB, String(only), ...ids], { stdio: 'inherit' });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('stills written for', ids.join(', '));
})();
