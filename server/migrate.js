// Применение нумерованных SQL-миграций из migrations/.
// Применённые записываются в schema_migrations и повторно не выполняются.

const fs = require('node:fs');
const path = require('node:path');
const { transaction } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function runMigrations(db, log = console.log) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
    });
    log(`[migrate] применена ${file}`);
    count++;
  }
  if (count === 0) log('[migrate] новых миграций нет');
  return count;
}

module.exports = { runMigrations };
