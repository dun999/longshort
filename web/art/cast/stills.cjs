/*
 * Renders the 2D stills of the cast from the live three.js models: the share-card figures
 * (src/assets/cast/<class>-<pose>.png) and the small portraits (public/cast/<class>.webp).
 * Needs `next dev` on :3000 (it uses the /dev/cast turntable), Playwright, and Python with Pillow.
 *   PLAYWRIGHT=/path/to/node_modules/playwright node web/art/cast/stills.cjs
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const WEB = path.resolve(__dirname, '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-'));
const TONE = { tank: '#6f9fc0', scout: '#b3a27a', sniper: '#c46a5e' };
const AZ = { tank: -22, scout: -16, sniper: -24 };
const POSE = { idle: 0, win: 0.63, out: 0.5 };

(async () => {
  const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const p = await b.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 2 });
  for (const cls of Object.keys(TONE))
    for (const [clip, at] of Object.entries(POSE)) {
      const q = `c=${cls}&portrait=1&bg=none&clip=${clip}&at=${at}&az=${AZ[cls]}&accent=${encodeURIComponent(TONE[cls])}`;
      await p.goto(`http://localhost:3000/dev/cast?${q}`, { waitUntil: 'networkidle', timeout: 120000 });
      await p.addStyleTag({ content: 'nextjs-portal{display:none!important} .scanlines{display:none!important} .ui > *:not(main){display:none!important} html,body,.ui,main{background:transparent!important}' });
      await p.waitForFunction(() => window.__castReady, null, { timeout: 60000 });
      await p.waitForTimeout(1200);
      await p.screenshot({ path: path.join(TMP, `${cls}-${clip}.png`), omitBackground: true });
    }
  await b.close();
  // one crop per class (the union of its poses) so the foothold sits in the same place in every pose
  execFileSync('python3', ['-c', `
from PIL import Image
import sys
tmp, web = sys.argv[1], sys.argv[2]
for cls in ('tank', 'scout', 'sniper'):
    ims = {p: Image.open(f'{tmp}/{cls}-{p}.png').convert('RGBA') for p in ('idle', 'win', 'out')}
    bb = [im.getbbox() for im in ims.values()]
    box = (max(0, min(b[0] for b in bb) - 16), max(0, min(b[1] for b in bb) - 16), min(1200, max(b[2] for b in bb) + 16), min(1600, max(b[3] for b in bb) + 16))
    for p, im in ims.items():
        c = im.crop(box)
        c = c.resize((round(c.width * 720 / c.height), 720), Image.LANCZOS)
        c.save(f'{web}/src/assets/cast/{cls}-{p}.png', optimize=True)
        if p == 'idle':
            c.resize((round(c.width * 360 / c.height), 360), Image.LANCZOS).save(f'{web}/public/cast/{cls}.webp', 'WEBP', quality=88, method=6)
`, TMP, WEB], { stdio: 'inherit' });
  console.log('stills written');
})();
