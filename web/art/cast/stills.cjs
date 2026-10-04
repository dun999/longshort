/*
 * Renders the 2D stills of the cast from the live three.js models (the /dev/cast turntable):
 *   public/cast/<id>.webp            head-and-shoulders avatar (character picker)
 *   public/cast/lounge/<id>.webp     the lounge pose with its props, no foothold (landing roster, reduced motion)
 *   public/cast/lounge/<id>-loop.webp  the 4 s lounge loop as an animated WebP, 15 fps, same frame as the still.
 *                                    Roster images are opaque, on the landing's ink (#0a0a0d) with a violet floor glow
 *                                    baked in: alpha costs about three times the bytes in an animated WebP.
 *   src/assets/cast/lounge.json      the roster images' pixel sizes
 *   src/assets/cast/<id>-<pose>.png  idle / win / out on the foothold (share card)
 * Needs `next dev` on :3000, Playwright, and Python with Pillow.
 *   PLAYWRIGHT=/path/to/node_modules/playwright node web/art/cast/stills.cjs [--lounge] [id ...]   (--lounge: the roster only)
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
const POSE = { idle: 0, win: 0.63, out: 0.5 };
const FPS = 15;
const LOOP = 4; // seconds: anims.py lounge clips run frames 1-121 at 30 fps
const args = process.argv.slice(2);
const loungeOnly = args.includes('--lounge');
const ids = args.filter((a) => a !== '--lounge').length ? args.filter((a) => a !== '--lounge') : Object.keys(CAST);
const HIDE = 'nextjs-portal{display:none!important} .scanlines{display:none!important} .ui > *:not(main){display:none!important} html,body,.ui,main{background:transparent!important}';

(async () => {
  const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const shot = async (page, q, file) => {
    await page.goto(`http://localhost:3000/dev/cast?${q}&bg=none&accent=${encodeURIComponent(ACCENT)}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.addStyleTag({ content: HIDE });
    await page.waitForFunction(() => window.__castReady, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(TMP, file), omitBackground: true });
  };
  const tall = await b.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 2 });
  const square = await b.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  for (const id of ids) {
    const { az, head } = CAST[id];
    if (!loungeOnly) for (const [clip, at] of Object.entries(POSE)) await shot(tall, `c=${id}&portrait=1&clip=${clip}&at=${at}&az=${az}`, `${id}-${clip}.png`);
    // the lounge loop: one page load, then step the held frame
    await shot(tall, `c=${id}&portrait=1&clip=lounge&at=0&az=${CAST[id].laz ?? az}&base=0`, `${id}-lounge-0.png`);
    for (let f = 1; f < FPS * LOOP; f++) {
      await tall.evaluate((t) => window.__castAt(t), f / FPS);
      await tall.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
      await tall.screenshot({ path: path.join(TMP, `${id}-lounge-${f}.png`), omitBackground: true });
    }
    if (!loungeOnly) await shot(square, `c=${id}&bust=${head}&clip=idle&at=0&az=${az + 8}`, `${id}-bust.png`);
  }
  await b.close();
  fs.mkdirSync(path.join(WEB, 'public/cast/lounge'), { recursive: true });
  fs.mkdirSync(path.join(WEB, 'src/assets/cast'), { recursive: true });
  execFileSync('python3', ['-c', `
from PIL import Image
import sys
tmp, web, ids = sys.argv[1], sys.argv[2], sys.argv[4:]  # argv[3]: the frame count
def fit(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
for id in (ids if ${!loungeOnly ? 'True' : 'False'} else []):
    # share card: one crop for the three poses so the foothold sits in the same place
    ims = {p: Image.open(f'{tmp}/{id}-{p}.png').convert('RGBA') for p in ('idle', 'win', 'out')}
    bb = [im.getbbox() for im in ims.values()]
    box = (max(0, min(b[0] for b in bb) - 16), max(0, min(b[1] for b in bb) - 16), min(1200, max(b[2] for b in bb) + 16), min(1600, max(b[3] for b in bb) + 16))
    for p, im in ims.items():
        fit(im.crop(box), 720).save(f'{web}/src/assets/cast/{id}-{p}.png', optimize=True)
    Image.open(f'{tmp}/{id}-bust.png').convert('RGBA').resize((192, 192), Image.LANCZOS).save(f'{web}/public/cast/{id}.webp', 'WEBP', quality=88, method=6)
# landing roster: one shared scale (same camera for all), so a pigeon stays pigeon-sized next to the gladiator;
# one crop per character covering every frame of its loop, so the figure doesn't jump between frames
import json
n = int(sys.argv[3])
k = 0.5
sizes_path = f'{web}/src/assets/cast/lounge.json'
try:
    sizes = json.load(open(sizes_path))
except FileNotFoundError:
    sizes = {}
from PIL import ImageDraw, ImageFilter
INK = (10, 10, 13)
for id in ids:
    frames = [Image.open(f'{tmp}/{id}-lounge-{f}.png').convert('RGBA') for f in range(n)]
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
json.dump({i: sizes[i] for i in sorted(sizes)}, open(sizes_path, 'w'), indent=2)
`, TMP, WEB, String(FPS * LOOP), ...ids], { stdio: 'inherit' });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('stills written for', ids.join(', '));
})();
