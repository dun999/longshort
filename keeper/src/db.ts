import { DatabaseSync } from 'node:sqlite';
import { env } from './env';

export const db = new DatabaseSync(env.dbPath);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, mode INTEGER, entry REAL, max_players INTEGER, duration INTEGER,
  state INTEGER DEFAULT 0, creator TEXT, created_at INTEGER, start_at INTEGER, end_at INTEGER,
  settle_tx TEXT, rake REAL DEFAULT 0, create_tx TEXT
);
CREATE TABLE IF NOT EXISTS players (
  match_id INTEGER, addr TEXT, team INTEGER, leverage INTEGER, session TEXT,
  result TEXT, payout REAL DEFAULT 0, final_equity REAL, xp_delta INTEGER DEFAULT 0,
  PRIMARY KEY (match_id, addr)
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER, addr TEXT, kind TEXT, market INTEGER,
  is_long INTEGER, notional REAL, price REAL, pnl REAL, fee REAL, tx TEXT, block INTEGER, ts INTEGER
);
CREATE INDEX IF NOT EXISTS trades_match ON trades(match_id);
CREATE UNIQUE INDEX IF NOT EXISTS trades_uniq ON trades(tx, kind, addr);
CREATE INDEX IF NOT EXISTS trades_addr ON trades(addr);
CREATE TABLE IF NOT EXISTS profiles (
  addr TEXT PRIMARY KEY, name TEXT, xp INTEGER DEFAULT 1000, wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0, matches INTEGER DEFAULT 0, volume REAL DEFAULT 0,
  earned REAL DEFAULT 0, bot INTEGER DEFAULT 0, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS profiles_name_search ON profiles(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS profiles_addr_search ON profiles(addr COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS lobby_options (
  match_id INTEGER PRIMARY KEY, allow_bots INTEGER NOT NULL DEFAULT 0,
  rematch_of INTEGER
);
CREATE TABLE IF NOT EXISTS rematches (
  source_id INTEGER PRIMARY KEY, creator TEXT NOT NULL, token TEXT NOT NULL,
  match_id INTEGER UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, addr TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS matches_state ON matches(state, mode, entry);
CREATE INDEX IF NOT EXISTS players_addr ON players(addr);
`);

// additive migrations: cosmetic character per profile; lobby details so matchmaking sees a lobby before the indexer does
for (const sql of [
  'ALTER TABLE profiles ADD COLUMN avatar TEXT',
  'ALTER TABLE lobby_options ADD COLUMN mode INTEGER',
  'ALTER TABLE lobby_options ADD COLUMN entry REAL',
  'ALTER TABLE lobby_options ADD COLUMN created_at INTEGER',
]) {
  try {
    db.exec(sql);
  } catch {}
}
db.exec('CREATE INDEX IF NOT EXISTS lobby_options_queue ON lobby_options(mode, entry, created_at)');

export const getMeta = (k: string) => (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
export const setMeta = (k: string, v: string) => db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(k, v);

export function ensureProfile(addr: string, bot = false, name?: string) {
  db.prepare(
    'INSERT OR IGNORE INTO profiles (addr, name, bot, created_at) VALUES (?, ?, ?, ?)',
  ).run(addr.toLowerCase(), name ?? null, bot ? 1 : 0, Math.floor(Date.now() / 1000));
}
