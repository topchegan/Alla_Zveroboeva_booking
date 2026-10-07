// Проверка регистрации и входа: npm run auth:check
// Запускает настоящий сервер на временной базе (data/app.db не трогает, .env не читает)
// и проверяет API по HTTP, как браузер.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { openDatabase } = require('../server/db');

const ROOT = path.join(__dirname, '..');
const DEMO_PASSWORD = 'check-demo-password';
const LEO = { name: 'Лео', email: 'leo@check.local', password: 'leo-password-123' };

const results = [];
function check(title, ok, details) {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${title}`);
  if (details) console.log(`   ${details}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`сервер не запустился за 15 с:\n${out}`)); }, 15000);
    const onData = (chunk) => {
      out += chunk;
      if (out.includes('Сервер запущен')) { clearTimeout(timer); resolve({ child, log: () => out }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`сервер завершился (код ${code}):\n${out}`)); });
  });
}

// Клиент с собственной cookie, как отдельный браузер
const allBodies = [];
function makeClient(base) {
  let cookie = '';
  let lastSetCookie = [];
  async function call(method, url, body) {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body),
    });
    lastSetCookie = res.headers.getSetCookie();
    for (const sc of lastSetCookie) {
      const [pair] = sc.split(';');
      const [name, value] = pair.split('=');
      if (name === 'az_session') cookie = value ? `az_session=${value}` : '';
    }
    const text = await res.text();
    allBodies.push(text);
    let data = null;
    try { data = JSON.parse(text); } catch { /* не JSON */ }
    return { status: res.status, data, location: res.headers.get('location') };
  }
  return {
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body ?? {}),
    token: () => (cookie ? cookie.slice('az_session='.length) : null),
    lastSetCookie: () => lastSetCookie,
  };
}

const short = (r) => `${r.status} ${JSON.stringify(r.data)}`;

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'az-auth-check-'));
  const dbPath = path.join(tmpDir, 'check.db');
  const port = await freePort();
  const env = { ...process.env };
  for (const k of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DEMO_PASSWORD', 'DB_PATH', 'PORT']) delete env[k];
  Object.assign(env, {
    DB_PATH: dbPath, PORT: String(port),
    ADMIN_EMAIL: 'admin@check.local', ADMIN_PASSWORD: 'check-admin-password', DEMO_PASSWORD,
  });
  const base = `http://127.0.0.1:${port}`;
  console.log(`Временная база: ${dbPath}\n`);

  let server = null;
  let db = null;
  try {
    server = await startServer(env);
    db = openDatabase(dbPath);

    // 1. Регистрация «Лео»
    const leo = makeClient(base);
    const reg = await leo.post('/api/auth/register', { ...LEO, passwordConfirm: LEO.password });
    const me1 = await leo.get('/api/me');
    check('1. Регистрация «Лео» → /api/me возвращает Лео, роль client',
      reg.status === 201 && me1.status === 200 && me1.data.name === LEO.name && me1.data.email === LEO.email && me1.data.role === 'client',
      `регистрация: ${reg.status}; /api/me: ${short(me1)}`);

    // 2. Попытка стать админом через регистрацию
    const hacker = makeClient(base);
    const regAdmin = await hacker.post('/api/auth/register', {
      name: 'Хакер', email: 'hacker@check.local', password: 'hacker-password', passwordConfirm: 'hacker-password', role: 'admin',
    });
    const meHacker = await hacker.get('/api/me');
    const dbRole = db.prepare('SELECT role FROM users WHERE email = ?').get('hacker@check.local')?.role;
    check('2. Регистрация с role=admin → роль всё равно client',
      regAdmin.status === 201 && meHacker.data?.role === 'client' && dbRole === 'client',
      `/api/me: role=${meHacker.data?.role}; в БД: role=${dbRole}`);

    // 3. Повторная регистрация и ошибки формы
    const guest = makeClient(base);
    const dup = await guest.post('/api/auth/register', { ...LEO, email: 'LEO@check.local', passwordConfirm: LEO.password });
    const shortPass = await guest.post('/api/auth/register', { name: 'А', email: 'a@check.local', password: '1234567', passwordConfirm: '1234567' });
    const mismatch = await guest.post('/api/auth/register', { name: 'А', email: 'a@check.local', password: '12345678', passwordConfirm: '12345679' });
    check('3. Повторная регистрация с тем же email (в другом регистре) → EMAIL_TAKEN',
      dup.status === 409 && dup.data?.code === 'EMAIL_TAKEN', short(dup));
    check('3a. Короткий пароль и несовпадающие пароли → VALIDATION с понятным текстом',
      shortPass.status === 400 && shortPass.data?.code === 'VALIDATION' && mismatch.status === 400 && mismatch.data?.code === 'VALIDATION',
      `${short(shortPass)}; ${short(mismatch)}`);

    // 4. Выход
    const leoToken = leo.token();
    const out = await leo.post('/api/auth/logout');
    const me2 = await leo.get('/api/me');
    const left = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?')
      .get(crypto.createHash('sha256').update(leoToken).digest('hex')).n;
    check('4. Выход → /api/me даёт 401, сессия удалена из БД',
      out.status === 200 && me2.status === 401 && me2.data?.code === 'UNAUTHORIZED' && left === 0,
      `/api/me: ${short(me2)}; сессий с этим токеном в БД: ${left}`);

    // 5. Неверный пароль и несуществующий email
    const wrongPass = await guest.post('/api/auth/login', { email: LEO.email, password: 'wrong-password' });
    const noUser = await guest.post('/api/auth/login', { email: 'nobody@check.local', password: 'wrong-password' });
    const same = wrongPass.status === noUser.status && JSON.stringify(wrongPass.data) === JSON.stringify(noUser.data);
    check('5. Вход с неверным паролем → INVALID_CREDENTIALS; с несуществующим email — тот же ответ',
      wrongPass.status === 401 && wrongPass.data?.code === 'INVALID_CREDENTIALS' && same,
      `неверный пароль: ${short(wrongPass)}; нет такого email: ${short(noUser)}`);

    // 6. Вход Лео
    const login = await leo.post('/api/auth/login', { email: LEO.email, password: LEO.password });
    const me3 = await leo.get('/api/me');
    check('6. Вход Лео с верным паролем → /api/me возвращает Лео',
      login.status === 200 && me3.status === 200 && me3.data.email === LEO.email, short(me3));

    // 7. Записи: у Лео пусто, у Ирины — только её
    const leoAppts = await leo.get('/api/me/appointments');
    const irina = makeClient(base);
    await irina.post('/api/auth/login', { email: 'irina@example.ru', password: DEMO_PASSWORD });
    const irinaAppts = await irina.get('/api/me/appointments');
    const irinaId = db.prepare('SELECT id FROM users WHERE email = ?').get('irina@example.ru').id;
    const expectedIds = db.prepare('SELECT id FROM appointments WHERE client_id = ? ORDER BY id').all(irinaId).map((r) => r.id);
    const gotIds = (irinaAppts.data || []).map((a) => a.id).sort((a, b) => a - b);
    const onlyHers = Array.isArray(irinaAppts.data) && irinaAppts.data.every((a) => a.clientId === irinaId);
    const total = db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
    check('7. /api/me/appointments: у Лео пусто',
      leoAppts.status === 200 && Array.isArray(leoAppts.data) && leoAppts.data.length === 0, short(leoAppts));
    check('7a. /api/me/appointments: у Ирины только её записи',
      irinaAppts.status === 200 && onlyHers && JSON.stringify(gotIds) === JSON.stringify(expectedIds),
      `id записей Ирины: [${gotIds}] (в БД у неё [${expectedIds}], всего записей в БД: ${total})`);
    const sample = irinaAppts.data?.[0] || {};
    const fields = ['id', 'serviceName', 'masterName', 'date', 'time', 'endTime', 'price', 'status', 'isPast', 'canChange'];
    check('7b. Формат записи подходит странице кабинета',
      fields.every((f) => f in sample), `пример: ${JSON.stringify(sample)}`);

    // 8. Cookie и хранение
    const leo2 = makeClient(base);
    await leo2.post('/api/auth/login', { email: LEO.email, password: LEO.password });
    const sc = leo2.lastSetCookie().find((c) => c.startsWith('az_session=')) || '';
    const token = leo2.token();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sessions = db.prepare('SELECT token_hash FROM sessions').all();
    const plain = sessions.some((s) => s.token_hash.includes(token));
    const hashed = sessions.some((s) => s.token_hash === tokenHash);
    check('8. Cookie сессии HttpOnly и SameSite=Lax, срок 30 дней',
      /;\s*HttpOnly/i.test(sc) && /;\s*SameSite=Lax/i.test(sc) && /Max-Age=2592000/.test(sc), sc.replace(token, '<токен>'));
    check('8a. В таблице sessions нет токена в открытом виде, хранится SHA-256',
      !plain && hashed, `сессий в БД: ${sessions.length}; найден хеш токена: ${hashed}; токен в открытом виде: ${plain}`);
    const leaks = allBodies.filter((b) => /password_hash|scrypt\$/.test(b) || b.includes(LEO.password) || b.includes(DEMO_PASSWORD));
    check('8b. В ответах API нет password_hash и паролей',
      leaks.length === 0, `проверено ответов: ${allBodies.length}; с утечкой: ${leaks.length}`);
    const log = server.log();
    check('8c. В логе сервера нет паролей',
      !log.includes(LEO.password) && !log.includes(DEMO_PASSWORD) && !log.includes('check-admin-password'));

    // 9. Ограничение попыток
    const brute = makeClient(base);
    const codes = [];
    for (let i = 1; i <= 11; i++) {
      const r = await brute.post('/api/auth/login', { email: 'maria@example.ru', password: `wrong-${i}` });
      codes.push(r.data?.code);
    }
    const blockedRight = await brute.post('/api/auth/login', { email: 'maria@example.ru', password: DEMO_PASSWORD });
    check('9. 10 неудачных входов → INVALID_CREDENTIALS, 11-я попытка → TOO_MANY_ATTEMPTS',
      codes.slice(0, 10).every((c) => c === 'INVALID_CREDENTIALS') && codes[10] === 'TOO_MANY_ATTEMPTS',
      `попытка 10: ${codes[9]}; попытка 11: ${codes[10]}`);
    check('9a. Пока действует блокировка, даже верный пароль не принимается (429)',
      blockedRight.status === 429 && blockedRight.data?.code === 'TOO_MANY_ATTEMPTS', short(blockedRight));

    // 10. Страницы
    const anon = makeClient(base);
    const cab = await anon.get('/cabinet');
    const resch = await anon.get('/cabinet/reschedule?id=1');
    const book = await anon.get('/booking');
    check('10. Гость, открывающий /cabinet, перенаправляется на /login',
      cab.status === 302 && cab.location === '/login?next=%2Fcabinet', `/cabinet → ${cab.status} ${cab.location}`);
    check('10a. /cabinet/reschedule и /booking для гостя — тоже на /login с возвратом',
      resch.status === 302 && resch.location === '/login?next=%2Fcabinet%2Freschedule%3Fid%3D1'
        && book.status === 302 && book.location === '/login?next=%2Fbooking',
      `${resch.location}; ${book.location}`);
    const loginPage = await leo.get('/login');
    const regPage = await leo.get('/register');
    const cabPage = await leo.get('/cabinet');
    check('10b. Вошедший: /login и /register → /cabinet, /cabinet открывается',
      loginPage.status === 302 && loginPage.location === '/cabinet' && regPage.location === '/cabinet' && cabPage.status === 200,
      `/login → ${loginPage.status} ${loginPage.location}; /register → ${regPage.location}; /cabinet → ${cabPage.status}`);
  } catch (err) {
    check('Проверка прервана ошибкой', false, err.stack || String(err));
  } finally {
    if (db) db.close();
    if (server) server.child.removeAllListeners('exit').kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\nИтог: ❌ не пройдено проверок: ${failed} из ${results.length}` : `\nИтог: ✅ все проверки пройдены (${results.length})`);
  process.exitCode = failed ? 1 : 0;
}

main();
