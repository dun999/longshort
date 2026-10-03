// Sent over SSH to Node on the deployment host. Contains no credentials.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [phase, release, what] = process.argv.slice(2);
if (!/^\d{8}T\d{6}Z-[0-9a-f]{7,40}$/.test(release ?? '') || !['all', 'web', 'keeper'].includes(what)) throw new Error('Invalid release');
const root = '/opt/longshort';
const dir = `${root}/releases/${release}`;
const config = Object.fromEntries(readFileSync(`${root}/keeper/.env.testnet`, 'utf8').split('\n').flatMap((line) => {
  const match = line.match(/^\s*(DB_PATH|PORT)\s*=\s*(.*?)\s*$/);
  return match ? [[match[1], match[2].replace(/^"(.*)"$/, '$1')]] : [];
}));
const dbPath = resolve(`${root}/keeper`, config.DB_PATH || 'longshort.db');
function quiet() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const count = db.prepare('SELECT COUNT(*) n FROM matches WHERE state IN (0,1,4)').get().n;
    if (count) throw new Error(`${count} rounds are still open or active. Deploy after they finish.`);
  } finally { db.close(); }
}
function restart(service) {
  const result = spawnSync('sudo', ['systemctl', 'restart', service], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${service} restart failed: ${result.stderr.trim()}`);
}
async function health() {
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
  for (let i = 0; i < 20; i++) {
    try {
      const result = await fetch(`http://127.0.0.1:${config.PORT || 8787}/health`, { signal: AbortSignal.timeout(2000) });
      const body = await result.json();
      if (body.ok && body.chainId === manifest.chainId && body.arena?.toLowerCase() === manifest.arena.toLowerCase() && body.recoveryMetadata === 1 && body.privateJournal === 1) return;
    } catch { /* Startup may still be validating chain bindings. */ }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error('Keeper health did not confirm the new API and deployment.');
}
if (phase === 'prepare') {
  quiet();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  try { db.exec('PRAGMA busy_timeout=5000'); db.prepare('VACUUM INTO ?').run(`${dir}/keeper.sqlite`); } finally { db.close(); }
  chmodSync(`${dir}/keeper.sqlite`, 0o600);
  copyFileSync(`${root}/keeper/dist/keeper.mjs`, `${dir}/keeper.previous.mjs`);
  chmodSync(`${dir}/keeper.previous.mjs`, 0o600);
  console.log(`Database snapshot and previous keeper saved in ${dir}`);
} else if (phase === 'keeper') {
  quiet();
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
  if (createHash('sha256').update(readFileSync(`${dir}/keeper.mjs`)).digest('hex') !== manifest.keeperSha256) throw new Error('Keeper artifact checksum differs.');
  copyFileSync(`${dir}/keeper.mjs`, `${root}/keeper/dist/keeper.mjs.next`);
  renameSync(`${root}/keeper/dist/keeper.mjs.next`, `${root}/keeper/dist/keeper.mjs`);
  try { restart('longshort-keeper'); await health(); console.log('Keeper activated and healthy.'); }
  catch (error) { copyFileSync(`${dir}/keeper.previous.mjs`, `${root}/keeper/dist/keeper.mjs`); restart('longshort-keeper'); throw error; }
} else if (phase === 'web') {
  quiet();
  await health();
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
  if (readFileSync(`${dir}/web/web/.next-prod/BUILD_ID`, 'utf8').trim() !== manifest.webBuildId) throw new Error('Web build ID differs.');
  const previous = `${dir}/web.previous`;
  renameSync(`${root}/web`, previous);
  symlinkSync(`${dir}/web`, `${root}/web`, 'dir');
  try {
    restart('longshort-web');
    const result = spawnSync('systemctl', ['is-active', '--quiet', 'longshort-web']);
    if (result.status !== 0) throw new Error('Web did not start.');
    let serving = false;
    for (let i = 0; i < 15; i++) {
      try {
        const response = await fetch('https://longshort.fun/gate', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
        if (response.status >= 200 && response.status < 400) { serving = true; break; }
      } catch { /* Caddy can see the brief restart before Next is listening. */ }
      await new Promise((done) => setTimeout(done, 1000));
    }
    if (!serving) throw new Error('Web did not answer through the public proxy.');
    console.log('Web activated. Previous web is retained for rollback.');
  } catch (error) { unlinkSync(`${root}/web`); renameSync(previous, `${root}/web`); restart('longshort-web'); throw error; }
} else throw new Error('Invalid release phase');
