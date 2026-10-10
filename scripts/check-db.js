// Проверка базы данных: npm run db:check
// Работает на временной базе во временной папке (data/app.db не трогает, .env не читает).

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openDatabase } = require('../server/db');

const ROOT = path.join(__dirname, '..');
const TABLES = ['schema_migrations', 'users', 'sessions', 'login_attempts', 'services', 'design_option', 'masters',
  'master_services', 'master_schedule', 'blocks', 'appointments', 'notifications'];
const MIGRATIONS = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((f) => /^\d+_.+\.sql$/.test(f));
const EXPECTED_AFTER_SEED = {
  schema_migrations: MIGRATIONS.length, users: 4, sessions: 0, login_attempts: 0, services: 5, design_option: 1, masters: 3,
  master_services: 9, master_schedule: 11, blocks: 3, appointments: 6, notifications: 0,
};

const results = [];
function check(title, ok, details) {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${title}`);
  if (details) console.log(`   ${details}`);
}

// Запустить настоящий сервер на временной базе, дождаться старта и остановить
function startServerOnce(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`сервер не запустился за 15 с:\n${out}`)); }, 15000);
    const onData = (chunk) => {
      out += chunk;
      if (out.includes('Сервер запущен')) { clearTimeout(timer); child.kill(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => { clearTimeout(timer); resolve(out); });
  });
}

// Свободный порт, чтобы не мешать запущенному серверу разработки
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function countRows(dbPath) {
  const db = openDatabase(dbPath);
  const counts = {};
  for (const t of TABLES) counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  db.close();
  return counts;
}

function printCounts(first, second) {
  console.log('\n   таблица              1-й запуск   2-й запуск');
  for (const t of TABLES) {
    console.log(`   ${t.padEnd(20)} ${String(first[t]).padStart(10)}   ${String(second[t]).padStart(10)}`);
  }
  console.log('');
}

function serverLog(out) {
  return out.trim().split('\n')
    .filter((l) => !l.includes('ExperimentalWarning') && !l.includes('--trace-warnings'))
    .map((l) => `   | ${l}`).join('\n');
}

function tryRun(fn) {
  try { fn(); return null; } catch (err) { return err; }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'az-db-check-'));
  const dbPath = path.join(tmpDir, 'check.db');
  const env = { ...process.env };
  for (const k of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DEMO_PASSWORD', 'DB_PATH', 'PORT']) delete env[k];
  Object.assign(env, {
    DB_PATH: dbPath, PORT: String(await freePort()),
    ADMIN_EMAIL: 'admin@check.local', ADMIN_PASSWORD: 'check-admin-password', DEMO_PASSWORD: 'check-demo-password',
  });

  console.log(`Временная база: ${dbPath}\n`);

  try {
    // 1. Первый запуск на пустой базе
    const out1 = await startServerOnce(env);
    console.log('Лог сервера, 1-й запуск:\n' + serverLog(out1) + '\n');
    const first = countRows(dbPath);
    const seedOk = TABLES.every((t) => first[t] === EXPECTED_AFTER_SEED[t]);
    check('1. Первый запуск на пустой базе: миграции применены, seed создал справочники, админа и демо-данные',
      MIGRATIONS.every((f) => out1.includes(`применена ${f}`)) && out1.includes('Сервер запущен') && seedOk,
      seedOk ? 'количество строк совпадает с ожидаемым' : `ожидалось: ${JSON.stringify(EXPECTED_AFTER_SEED)}`);

    // 2. Повторный запуск
    const out2 = await startServerOnce(env);
    console.log('Лог сервера, 2-й запуск:\n' + serverLog(out2) + '\n');
    const second = countRows(dbPath);
    const same = TABLES.every((t) => first[t] === second[t]);
    check('2. Повторный запуск: миграции не применяются второй раз, seed не дублируется',
      out2.includes('новых миграций нет') && !out2.includes('[seed]') && same,
      same ? 'количество строк после 1-го и 2-го запуска одинаковое' : 'количество строк изменилось');
    printCounts(first, second);

    const db = openDatabase(dbPath);
    const a = db.prepare("SELECT * FROM appointments WHERE status = 'active' ORDER BY id LIMIT 1").get();
    const insert = db.prepare(`INSERT INTO appointments
      (client_id, master_id, service_id, design_nails, start_at, end_at, duration_min, price, status, cancelled_by, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();

    // 3. Вторая активная запись к тому же мастеру на то же время
    const err3 = tryRun(() => insert.run(a.client_id, a.master_id, a.service_id, a.start_at, a.end_at,
      a.duration_min, a.price, 'active', null, now, now));
    check(`3. Вторая активная запись к мастеру #${a.master_id} на ${a.start_at} отклонена базой`,
      Boolean(err3 && /UNIQUE constraint failed/.test(err3.message)),
      err3 ? `ошибка: ${err3.message}` : 'запись вставилась — ограничение не работает');

    // 4. Отменённая запись на то же время
    const err4 = tryRun(() => insert.run(a.client_id, a.master_id, a.service_id, a.start_at, a.end_at,
      a.duration_min, a.price, 'cancelled', 'admin', now, now));
    check(`4. Отменённая запись к мастеру #${a.master_id} на ${a.start_at} вставляется без ошибки`,
      !err4, err4 ? `ошибка: ${err4.message}` : 'вставлена');

    // 5. Удаление мастера, у которого есть записи
    const err5 = tryRun(() => db.prepare('DELETE FROM masters WHERE id = ?').run(a.master_id));
    check(`5. Удаление мастера #${a.master_id}, у которого есть записи, запрещено`,
      Boolean(err5 && /FOREIGN KEY constraint failed/.test(err5.message)),
      err5 ? `ошибка: ${err5.message}` : 'мастер удалён — внешний ключ не работает');

    // Дополнительно: демо-записи согласованы с графиками и блокировками
    const bad = db.prepare(`
      SELECT a.id, a.start_at, a.end_at FROM appointments a
      WHERE a.status = 'active' AND (
        NOT EXISTS (SELECT 1 FROM master_schedule s
          WHERE s.master_id = a.master_id
            AND s.weekday = CAST(strftime('%w', substr(a.start_at, 1, 10)) AS INTEGER)
            AND s.start_time <= substr(a.start_at, 12) AND substr(a.end_at, 12) <= s.end_time
            AND substr(a.start_at, 1, 10) = substr(a.end_at, 1, 10))
        OR EXISTS (SELECT 1 FROM blocks b
          WHERE b.master_id = a.master_id
            AND b.weekday = CAST(strftime('%w', substr(a.start_at, 1, 10)) AS INTEGER)
            AND (b.all_day = 1 OR (b.start_time < substr(a.end_at, 12) AND substr(a.start_at, 12) < b.end_time))))
    `).all();
    check('Доп. Все действующие демо-записи внутри графика мастера и не попадают на блокировки',
      bad.length === 0, bad.length ? `нарушения: ${JSON.stringify(bad)}` : null);

    const demo2 = db.prepare(`SELECT a.start_at, a.end_at, m.name AS master FROM appointments a
      JOIN masters m ON m.id = a.master_id WHERE a.id = 2`).get();
    if (demo2) console.log(`\n   Демо-запись #2: ${demo2.master}, ${demo2.start_at}–${demo2.end_at.slice(11)} (Москва)`);
    db.close();
  } catch (err) {
    check('Проверка прервана ошибкой', false, err.stack || String(err));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\nИтог: ❌ не пройдено проверок: ${failed} из ${results.length}` : `\nИтог: ✅ все проверки пройдены (${results.length})`);
  process.exitCode = failed ? 1 : 0;
}

main();
