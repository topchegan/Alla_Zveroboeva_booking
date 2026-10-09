// Проверка админ-панели: npm run admin:check
// Запускает настоящий сервер на временной базе (data/app.db не трогает, .env не читает),
// без демо-записей, и проверяет страницы и API по HTTP, как браузер.
// Шаг 9 — защита /admin и /api/admin/*; шаг 10 — услуги и мастера; шаг 11 — записи и блокировки.
// В конце запускает booking:check, auth:check и db:check.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { openDatabase } = require('../server/db');
const { mskNow, addDays, weekdayOf, toMin, fromMin, stamp, mskToEpoch } = require('../server/time');

const ROOT = path.join(__dirname, '..');
const ADMIN = { email: 'admin@check.local', password: 'check-admin-password' };
const PASSWORD = 'client-password-123';

// Мастера и услуги из справочника (CLAUDE.md, п. 8)
const ANNA = 1, MARINA = 2, ELENA = 3;
const MANICURE = 1, BROWS = 4;
const WED = 3, FRI = 5;

const results = [];
function check(title, ok, details) {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${title}`);
  if (details) console.log(`   ${details}`);
}
function section(title) { console.log(`\n=== ${title} ===`); }

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
function makeClient(base, label) {
  let cookie = '';
  async function call(method, url, body) {
    const headers = { Accept: method === 'GET' && !url.startsWith('/api') ? 'text/html' : 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const [name, value] = pair.split('=');
      if (name === 'az_session') cookie = value ? `az_session=${value}` : '';
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* не JSON */ }
    return { status: res.status, data, text, location: res.headers.get('location') };
  }
  return {
    label,
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body ?? {}),
    put: (url, body) => call('PUT', url, body ?? {}),
    del: (url) => call('DELETE', url, {}),
  };
}

const short = (r) => `${r.status} ${JSON.stringify(r.data)}`;
const code = (r) => `${r.status} ${r.data && r.data.code}`;
const isErr = (r, status, c) => r.status === status && r.data && r.data.code === c;
const list = (a) => (Array.isArray(a) ? `[${a.join(', ')}]` : JSON.stringify(a));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function nextWeekday(weekday, minDays) {
  let d = addDays(mskNow().date, minDays);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}
function slotsUrl(masterId, serviceId, date, designNails) {
  return `/api/slots?masterId=${masterId}&serviceId=${serviceId}&date=${date}${designNails ? `&designNails=${designNails}` : ''}`;
}
// Тело мастера для PUT из ответа GET /api/admin/masters
function masterBody(m, patch) {
  return {
    name: m.name, specialization: m.specialization, serviceIds: m.serviceIds, doesDesign: m.doesDesign, schedule: m.schedule, ...patch,
  };
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'az-admin-check-'));
  const dbPath = path.join(tmpDir, 'check.db');
  const port = await freePort();
  const env = { ...process.env };
  for (const k of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DEMO_PASSWORD', 'DB_PATH', 'PORT']) delete env[k];
  Object.assign(env, { DB_PATH: dbPath, PORT: String(port), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password });
  const base = `http://127.0.0.1:${port}`;
  console.log(`Временная база: ${dbPath} (без демо-записей)`);
  const now0 = mskNow();
  console.log(`Сейчас по Москве: ${now0.date} ${fromMin(now0.minutes)}`);

  let server = null;
  let db = null;
  try {
    server = await startServer(env);
    db = openDatabase(dbPath);
    const guest = makeClient(base, 'Гость');
    const register = async (label, email) => {
      const c = makeClient(base, label);
      const r = await c.post('/api/auth/register', { name: label, email, password: PASSWORD, passwordConfirm: PASSWORD });
      if (r.status !== 201) throw new Error(`регистрация ${email}: ${short(r)}`);
      c.id = r.data.user.id;
      return c;
    };
    const clientA = await register('Клиент А', 'a@check.local');
    const clientB = await register('Клиент Б', 'b@check.local');
    const admin = makeClient(base, 'Администратор');
    const login = await admin.post('/api/auth/login', ADMIN);
    if (login.status !== 200) throw new Error(`вход администратора: ${short(login)}`);

    // Запись напрямую в базу (как в booking:check) — для записей «меньше 24 ч» и прошедших
    const insertAppt = (clientId, masterId, serviceId, date, time, duration, price) => {
      const iso = new Date().toISOString();
      const start = toMin(time);
      return Number(db.prepare(`INSERT INTO appointments
        (client_id, master_id, service_id, design_nails, start_at, end_at, duration_min, price, status, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(clientId, masterId, serviceId, stamp(date, start), stamp(date, start + duration), duration, price, iso, iso).lastInsertRowid);
    };
    const row = (id) => db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    const total = () => db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;

    /* ======================= Шаг 9 ======================= */
    section('Шаг 9 — защищённая админ-панель');

    const ADMIN_PAGES = ['/admin', '/admin/services', '/admin/masters', '/admin/blocks'];
    const guestPages = await Promise.all(ADMIN_PAGES.map((p) => guest.get(p)));
    check('9.1 Гость: /admin, /admin/services, /admin/masters, /admin/blocks → 302 /login?next=…',
      guestPages.every((r, i) => r.status === 302 && r.location === `/login?next=${encodeURIComponent(ADMIN_PAGES[i])}`),
      guestPages.map((r, i) => `${ADMIN_PAGES[i]}: ${r.status} ${r.location}`).join('; '));

    // Данные, которых не должно быть в ответе клиенту: разметка и скрипты админки, email клиентов
    const ADMIN_MARKERS = ['data-admin-tabs', 'aa-list', 'services-list', 'masters-list', 'bl-list', 'service-form',
      'master-form', 'bl-form', 'modal-admin', '/js/pages/admin-', 'b@check.local', 'Перенести запись'];
    const clientPages = await Promise.all(ADMIN_PAGES.map((p) => clientA.get(p)));
    const leaks = clientPages.map((r) => ADMIN_MARKERS.filter((m) => r.text.includes(m)));
    check('9.2 Клиент: все 4 страницы админки → 403 «Нет доступа», адрес не меняется (без редиректа)',
      clientPages.every((r) => r.status === 403 && !r.location && r.text.includes('Нет доступа')),
      clientPages.map((r, i) => `${ADMIN_PAGES[i]}: ${r.status}${r.text.includes('Нет доступа') ? ' «Нет доступа»' : ''}`).join('; '));
    check('9.2a В HTML для клиента нет данных админки (списков записей, клиентов, форм, скриптов admin-*.js)',
      leaks.every((l) => l.length === 0), leaks.map((l, i) => `${ADMIN_PAGES[i]}: ${l.length ? `найдено ${list(l)}` : 'чисто'}`).join('; '));

    const adminPages = await Promise.all(ADMIN_PAGES.map((p) => admin.get(p)));
    check('9.3 Администратор: все 4 страницы → 200, это страницы админки',
      adminPages.every((r) => r.status === 200 && r.text.includes('data-admin-tabs')),
      adminPages.map((r, i) => `${ADMIN_PAGES[i]}: ${r.status}`).join('; '));

    const ADMIN_API = [
      ['GET', '/api/admin/appointments'], ['POST', '/api/admin/appointments/1/cancel'],
      ['GET', '/api/admin/appointments/1/available-dates'], ['GET', '/api/admin/appointments/1/slots?date=2030-01-01'],
      ['POST', '/api/admin/appointments/1/reschedule'],
      ['GET', '/api/admin/services'], ['POST', '/api/admin/services'], ['PUT', '/api/admin/services/1'],
      ['POST', '/api/admin/services/1/active'], ['GET', '/api/admin/design-option'], ['PUT', '/api/admin/design-option'],
      ['GET', '/api/admin/masters'], ['POST', '/api/admin/masters'], ['PUT', '/api/admin/masters/1'],
      ['POST', '/api/admin/masters/1/active'],
      ['GET', '/api/admin/blocks'], ['POST', '/api/admin/blocks'], ['DELETE', '/api/admin/blocks/1'],
      ['GET', '/api/admin/no-such-route'],
    ];
    const callAs = (c, [method, url]) => (method === 'GET' ? c.get(url) : method === 'POST' ? c.post(url) : method === 'PUT' ? c.put(url) : c.del(url));
    const asClient = [];
    const asGuest = [];
    for (const r of ADMIN_API) { asClient.push(await callAs(clientA, r)); asGuest.push(await callAs(guest, r)); }
    const badClient = ADMIN_API.filter((r, i) => !isErr(asClient[i], 403, 'FORBIDDEN'));
    const badGuest = ADMIN_API.filter((r, i) => !isErr(asGuest[i], 401, 'UNAUTHORIZED'));
    check(`9.4 Клиент на всех /api/admin/* (${ADMIN_API.length} маршрутов, включая несуществующий) → 403 FORBIDDEN`,
      badClient.length === 0, badClient.length ? `не 403: ${badClient.map((r) => r.join(' ')).join(', ')}` : `пример: ${short(asClient[0])}`);
    check('9.4a Гость на тех же маршрутах → 401 UNAUTHORIZED',
      badGuest.length === 0, badGuest.length ? `не 401: ${badGuest.map((r) => r.join(' ')).join(', ')}` : `пример: ${short(asGuest[0])}`);
    const dbUnchanged = db.prepare('SELECT COUNT(*) AS n FROM blocks').get().n === 3
      && db.prepare('SELECT is_active FROM services WHERE id = 1').get().is_active === 1;
    check('9.4b После этих запросов клиента и гостя данные не изменились (блокировок 3, услуга #1 активна)', dbUnchanged);

    const CLIENT_PAGES = ['/', '/booking', '/booking/success', '/cabinet', '/cabinet/reschedule', '/forgot-password', '/403'];
    const cp = await Promise.all(CLIENT_PAGES.map((p) => clientA.get(p)));
    const withLink = CLIENT_PAGES.filter((p, i) => /href=["']\/admin/.test(cp[i].text) || cp[i].status !== 200);
    const uiJs = fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8');
    const adminLinks = uiJs.match(/href="\/admin"/g) || [];
    const linkOnlyForAdmin = adminLinks.length === 1 && /user\.role === 'admin'\s*\?\s*'<a[^']*href="\/admin"/.test(uiJs);
    const pageScripts = fs.readdirSync(path.join(ROOT, 'public/js/pages')).filter((f) => !f.startsWith('admin-'));
    const scriptLinks = pageScripts.filter((f) => /href=["']\/admin/.test(fs.readFileSync(path.join(ROOT, 'public/js/pages', f), 'utf8')));
    check(`9.5 На клиентских страницах нет ссылки на /admin (${CLIENT_PAGES.join(', ')})`,
      withLink.length === 0 && scriptLinks.length === 0 && linkOnlyForAdmin,
      `HTML со ссылкой: ${list(withLink)}; скрипты клиентских страниц со ссылкой: ${list(scriptLinks)}; `
        + `в шапке (ui.js) ссылка «Админ-панель» только для role === 'admin': ${linkOnlyForAdmin ? 'да' : 'нет'}`);

    const files = walk(ROOT).map((p) => path.relative(ROOT, p));
    const mockFiles = files.filter((p) => /mock-data/i.test(p));
    const mockRefs = files.filter((p) => /\.(js|html)$/.test(p) && !p.startsWith('scripts/') && !p.startsWith('prototype/')
      && /mock-data|MOCK_DATA|az-mock/.test(fs.readFileSync(path.join(ROOT, p), 'utf8')));
    const mockUrl = await guest.get('/js/mock-data.js');
    check('9.6 В проекте нет mock-data.js и ссылок на тестовые данные; /js/mock-data.js → 404',
      mockFiles.length === 0 && mockRefs.length === 0 && mockUrl.status === 404,
      `файлы: ${list(mockFiles)}; ссылки в коде: ${list(mockRefs)}; GET /js/mock-data.js: ${mockUrl.status}`);

    /* ======================= Шаг 10 ======================= */
    section('Шаг 10 — услуги и мастера');

    const newService = await admin.post('/api/admin/services', { name: 'Проверочная услуга', duration: 60, price: 1500, isNail: false });
    const SVC = newService.data && newService.data.id;
    const catalog1 = await guest.get('/api/services');
    check('10.1 Админ добавил услугу «Проверочная услуга» (60 мин, 1500 ₽) → 201, она есть в каталоге',
      newService.status === 201 && catalog1.data.some((s) => s.id === SVC && s.name === 'Проверочная услуга'),
      `ответ: ${short(newService)}`);

    const tue = nextWeekday(2, 2);
    const newMaster = await admin.post('/api/admin/masters', {
      name: 'Вера Проверкина', specialization: 'Мастер для проверки', serviceIds: [SVC], doesDesign: false,
      schedule: { 2: ['10:00', '16:00'], 4: ['12:00', '18:00'] },
    });
    const MST = newMaster.data && newMaster.data.id;
    const masters1 = await guest.get(`/api/masters?serviceId=${SVC}`);
    const slots1 = await guest.get(slotsUrl(MST, SVC, tue));
    check(`10.2 Админ добавил мастера «Вера Проверкина» (вт 10–16, чт 12–18) → 201; она в каталоге для новой услуги, слоты ${tue} 10:00–15:00`,
      newMaster.status === 201 && same(masters1.data.map((m) => m.id), [MST]) && slots1.data[0] === '10:00' && slots1.data.at(-1) === '15:00',
      `мастера услуги: ${list(masters1.data.map((m) => m.name))}; слоты: ${list(slots1.data)}`);

    const booked = await clientA.post('/api/appointments', { serviceId: SVC, masterId: MST, date: tue, time: '11:00' });
    const BOOKED = booked.data && booked.data.id;
    check(`10.3 Клиент А записался на новую услугу к новому мастеру (${tue} 11:00) → 201, 1500 ₽`,
      booked.status === 201 && booked.data.price === 1500 && booked.data.duration === 60, short(booked));

    const edit = await admin.put(`/api/admin/services/${SVC}`, { name: 'Проверочная услуга', duration: 90, price: 2500, isNail: false });
    const oldRow = row(BOOKED);
    const mine1 = (await clientA.get('/api/me/appointments')).data.find((a) => a.id === BOOKED);
    const slots2 = await guest.get(slotsUrl(MST, SVC, tue));
    check('10.4 Цена 1500 → 2500 ₽, длительность 60 → 90 мин: старая запись сохранила 1500 ₽ и 60 мин',
      edit.status === 200 && edit.data.price === 2500 && oldRow.price === 1500 && oldRow.duration_min === 60
        && mine1.price === 1500 && mine1.duration === 60 && mine1.endTime === '12:00',
      `услуга: ${short(edit)}; запись в БД: ${oldRow.price} ₽, ${oldRow.duration_min} мин; у клиента: ${mine1.price} ₽, ${mine1.time}–${mine1.endTime}`);
    check('10.4a Новые слоты считаются по 90 мин: последний 14:30', slots2.data.at(-1) === '14:30', `слоты: ${list(slots2.data)}`);

    const offSvc = await admin.post(`/api/admin/services/${SVC}/active`, { active: false });
    const catalog2 = await guest.get('/api/services');
    const offSlots = await guest.get(slotsUrl(MST, SVC, tue));
    const offCreate = await clientB.post('/api/appointments', { serviceId: SVC, masterId: MST, date: tue, time: '14:00' });
    const mine2 = (await clientA.get('/api/me/appointments')).data.find((a) => a.id === BOOKED);
    const adm2 = (await admin.get('/api/admin/appointments')).data.find((a) => a.id === BOOKED);
    const adminSvcs = await admin.get('/api/admin/services');
    check('10.5 Услуга отключена: в ответе предупреждение о 1 будущей записи; запись не отменена',
      offSvc.status === 200 && offSvc.data.futureCount === 1 && /1 будущая запись — она сохранится/.test(offSvc.data.warning) && row(BOOKED).status === 'active',
      `предупреждение: «${offSvc.data.warning}»`);
    check('10.5a Отключённой услуги нет в каталоге, слоты и новая запись → 400 VALIDATION; в админке она есть со статусом «отключена»',
      !catalog2.data.some((s) => s.id === SVC) && isErr(offSlots, 400, 'VALIDATION') && isErr(offCreate, 400, 'VALIDATION')
        && adminSvcs.data.some((s) => s.id === SVC && s.active === false),
      `каталог: ${list(catalog2.data.map((s) => s.id))}; слоты: ${code(offSlots)}; запись: ${code(offCreate)}`);
    check('10.5b Старая запись показывает название отключённой услуги у клиента и в админке',
      mine2.serviceName === 'Проверочная услуга' && adm2.serviceName === 'Проверочная услуга' && mine2.status === 'active',
      `кабинет: «${mine2.serviceName}», ${mine2.status}; админка: «${adm2.serviceName}»`);
    await admin.post(`/api/admin/services/${SVC}/active`, { active: true });

    const offMst = await admin.post(`/api/admin/masters/${MST}/active`, { active: false });
    const masters2 = await guest.get(`/api/masters?serviceId=${SVC}`);
    const allMasters = await guest.get('/api/masters');
    const offMstSlots = await guest.get(slotsUrl(MST, SVC, tue));
    const mine3 = (await clientA.get('/api/me/appointments')).data.find((a) => a.id === BOOKED);
    const adm3 = (await admin.get('/api/admin/appointments')).data.find((a) => a.id === BOOKED);
    check('10.6 Мастер отключён: предупреждение «У мастера 1 будущая запись — она сохранится…»; запись active',
      offMst.status === 200 && offMst.data.futureCount === 1 && /^У мастера 1 будущая запись — она сохранится/.test(offMst.data.warning)
        && row(BOOKED).status === 'active', `предупреждение: «${offMst.data.warning}»`);
    check('10.6a Отключённого мастера нет в каталоге, его слоты → 400 VALIDATION',
      masters2.data.length === 0 && !allMasters.data.some((m) => m.id === MST) && isErr(offMstSlots, 400, 'VALIDATION'),
      `мастера услуги: ${list(masters2.data.map((m) => m.name))}; слоты: ${code(offMstSlots)}`);
    check('10.6b Старая запись показывает имя отключённого мастера у клиента и в админке',
      mine3.masterName === 'Вера Проверкина' && adm3.masterName === 'Вера Проверкина',
      `кабинет: «${mine3.masterName}»; админка: «${adm3.masterName}»`);

    const wed = nextWeekday(WED, 2);
    const anna = (await admin.get('/api/admin/masters')).data.find((m) => m.id === ANNA);
    const annaBefore = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    const shorter = await admin.put(`/api/admin/masters/${ANNA}`, masterBody(anna, { schedule: { ...anna.schedule, [WED]: ['12:00', '16:00'] } }));
    const annaAfter = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    await admin.put(`/api/admin/masters/${ANNA}`, masterBody(anna));
    const annaRestored = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    check(`10.7 График Анны в среду 10–18 → 12–16: слоты ${wed} сразу 12:00–14:30; после возврата — снова 10:00–16:30`,
      shorter.status === 200 && annaBefore.data[0] === '10:00' && annaAfter.data[0] === '12:00' && annaAfter.data.at(-1) === '14:30'
        && same(annaRestored.data, annaBefore.data),
      `до: ${list(annaBefore.data)}\n   после: ${list(annaAfter.data)}`);

    const sched = (s) => masterBody(anna, { schedule: s });
    const bad = {
      'услуга: пустое название': await admin.post('/api/admin/services', { name: '  ', duration: 60, price: 100, isNail: false }),
      'услуга: длительность 0': await admin.post('/api/admin/services', { name: 'X', duration: 0, price: 100, isNail: false }),
      'услуга: цена 0': await admin.post('/api/admin/services', { name: 'X', duration: 60, price: 0, isNail: false }),
      'услуга: цена −5': await admin.put(`/api/admin/services/${SVC}`, { name: 'X', duration: 60, price: -5, isNail: false }),
      'услуга: длительность «abc»': await admin.post('/api/admin/services', { name: 'X', duration: 'abc', price: 100, isNail: false }),
      'дизайн: цена за 2 ногтя 0': await admin.put('/api/admin/design-option', { pricePerTwoNails: 0, extraMin24: 15, extraMin610: 30 }),
      'мастер: пустое имя': await admin.put(`/api/admin/masters/${ANNA}`, masterBody(anna, { name: '' })),
      'мастер: пустая специализация': await admin.put(`/api/admin/masters/${ANNA}`, masterBody(anna, { specialization: '' })),
      'мастер: нет услуг': await admin.put(`/api/admin/masters/${ANNA}`, masterBody(anna, { serviceIds: [] })),
      'мастер: начало 18:00 = конец 18:00': await admin.put(`/api/admin/masters/${ANNA}`, sched({ 2: ['18:00', '18:00'] })),
      'мастер: начало позже конца': await admin.put(`/api/admin/masters/${ANNA}`, sched({ 2: ['17:00', '12:00'] })),
      'мастер: нет рабочих дней': await admin.put(`/api/admin/masters/${ANNA}`, sched({})),
      'мастер: дизайн без ногтевых услуг': await admin.post('/api/admin/masters', masterBody(anna, { serviceIds: [BROWS] })),
      'блокировка: начало позже конца': await admin.post('/api/admin/blocks', { masterId: ANNA, weekday: WED, allDay: false, from: '15:00', to: '14:00' }),
    };
    const badSalon = {
      'рабочий понедельник': await admin.put(`/api/admin/masters/${ANNA}`, sched({ 1: ['10:00', '18:00'] })),
      'рабочее воскресенье': await admin.post('/api/admin/masters', masterBody(anna, { name: 'Новая', schedule: { 0: ['10:00', '18:00'] } })),
      'смена с 09:00': await admin.put(`/api/admin/masters/${ANNA}`, sched({ 2: ['09:00', '18:00'] })),
      'смена до 21:00': await admin.put(`/api/admin/masters/${ANNA}`, sched({ 6: ['11:00', '21:00'] })),
    };
    const annaAfterBad = (await admin.get('/api/admin/masters')).data.find((m) => m.id === ANNA);
    check('10.8 Неверные данные услуг, опции дизайна, мастеров и блокировок → 400 VALIDATION',
      Object.values(bad).every((r) => isErr(r, 400, 'VALIDATION')),
      Object.entries(bad).map(([k, r]) => `${k}: ${code(r)} — ${r.data && r.data.message}`).join('\n   '));
    check('10.8a График только в дни и часы салона (вт–сб, 10:00–20:00), иначе 400 VALIDATION с понятным текстом',
      Object.values(badSalon).every((r) => isErr(r, 400, 'VALIDATION')),
      Object.entries(badSalon).map(([k, r]) => `${k}: ${code(r)} — ${r.data && r.data.message}`).join('\n   '));
    check('10.8b После неверных запросов мастер не изменился',
      same(masterBody(annaAfterBad), masterBody(anna)), `график: ${annaAfterBad.scheduleText}`);

    const design = await admin.put('/api/admin/design-option', { pricePerTwoNails: 400, extraMin24: 20, extraMin610: 30 });
    const pubDesign = await guest.get('/api/design-option');
    await admin.put('/api/admin/design-option', { pricePerTwoNails: 300, extraMin24: 15, extraMin610: 30 });
    check('10.9 Опция «Дизайн ногтей» редактируется: 400 ₽ за 2 ногтя, +20 мин за 2–4 видны в каталоге',
      design.status === 200 && pubDesign.data.pricePerTwoNails === 400 && pubDesign.data.extraMinutes[0].minutes === 20,
      `каталог: ${JSON.stringify({ price: pubDesign.data.pricePerTwoNails, extra: pubDesign.data.extraMinutes })}`);

    /* ======================= Шаг 11 ======================= */
    section('Шаг 11 — записи и расписание');

    // Ближайшие свободные слоты в пределах суток (рабочее время мастеров) — для записей «меньше 24 ч»
    const nowMs = Date.now();
    const candidates = [];
    for (const [masterId, serviceId, duration, price] of [[MARINA, BROWS, 40, 1200], [ELENA, BROWS, 40, 1200], [ANNA, MANICURE, 90, 1800]]) {
      for (const date of [mskNow().date, addDays(mskNow().date, 1)]) {
        const r = await guest.get(slotsUrl(masterId, serviceId, date));
        for (const time of r.data || []) {
          const diff = mskToEpoch(`${date} ${time}`) - nowMs;
          if (diff > 30 * 60000 && diff < 23 * 3600000) candidates.push({ masterId, serviceId, duration, price, date, time });
        }
      }
    }
    const overlaps = (a, b) => a.masterId === b.masterId && a.date === b.date
      && toMin(a.time) < toMin(b.time) + b.duration && toMin(b.time) < toMin(a.time) + a.duration;
    const near1 = candidates[0] || null;
    const near2 = candidates.find((c) => near1 && !overlaps(c, near1)) || null;
    const realSlots = Boolean(near1 && near2);
    // В вс/пн (и сб вечером) у мастеров нет рабочего времени в ближайшие сутки — тогда запись ставится через ~3 ч
    // вне графика: правило 24 ч и отмена/перенос админом проверяются так же, но «слот снова свободен» — по ближайшей смене
    const fallbackAt = () => {
      const n = mskNow();
      const m = Math.ceil((n.minutes + 180) / 30) * 30;
      return { date: addDays(n.date, Math.floor(m / 1440)), time: fromMin(m % 1440) };
    };
    const soonA = near1 || { masterId: MARINA, serviceId: BROWS, duration: 40, price: 1200, ...fallbackAt() };
    const soonB = near2 || { masterId: ELENA, serviceId: BROWS, duration: 40, price: 1200, ...fallbackAt() };
    if (!realSlots) console.log('   (в ближайшие 24 ч у мастеров нет рабочего времени — записи «меньше 24 ч» ставятся вне графика)');

    const bBooking = await clientB.post('/api/appointments', { serviceId: BROWS, masterId: MARINA, date: nextWeekday(FRI, 1), time: '11:00' });
    const all = await admin.get('/api/admin/appointments');
    const clients = new Set(all.data.map((a) => a.clientEmail));
    const sorted = all.data.every((a, i, arr) => i === 0 || `${arr[i - 1].date} ${arr[i - 1].time}` <= `${a.date} ${a.time}`);
    const byMaster = await admin.get(`/api/admin/appointments?masterId=${MARINA}`);
    const byDate = await admin.get(`/api/admin/appointments?date=${tue}`);
    const desc = await admin.get('/api/admin/appointments?order=desc');
    check('11.1 Админ видит записи всех клиентов (с email), отсортированные по времени',
      bBooking.status === 201 && clients.has('a@check.local') && clients.has('b@check.local') && sorted
        && all.data.every((a) => a.clientName && a.clientEmail && a.serviceName && a.masterName && a.price && a.status),
      `записей: ${all.data.length}; клиенты: ${list([...clients])}`);
    check('11.1a Фильтры по мастеру и дате, обратная сортировка',
      byMaster.data.length > 0 && byMaster.data.every((a) => a.masterId === MARINA) && byDate.data.every((a) => a.date === tue)
        && byDate.data.some((a) => a.id === BOOKED) && same(desc.data.map((a) => a.id), all.data.map((a) => a.id).reverse()),
      `мастер ${MARINA}: ${byMaster.data.length}; дата ${tue}: ${byDate.data.length}`);

    // Отмена админом записи «меньше 24 ч»
    const c1 = insertAppt(clientA.id, soonA.masterId, soonA.serviceId, soonA.date, soonA.time, soonA.duration, soonA.price);
    const slotsBusy = await guest.get(slotsUrl(soonA.masterId, soonA.serviceId, soonA.date));
    const clientTry = await clientA.post(`/api/appointments/${c1}/cancel`);
    const totalBefore = total();
    const admCancel = await admin.post(`/api/admin/appointments/${c1}/cancel`);
    const c1Row = row(c1);
    const c1Client = (await clientA.get('/api/me/appointments')).data.find((a) => a.id === c1);
    const slotsFreed = await guest.get(slotsUrl(soonA.masterId, soonA.serviceId, soonA.date));
    check(`11.2 Запись «меньше 24 ч» (${soonA.date} ${soonA.time}): клиент получает 409 TOO_LATE, админ отменяет → cancelled, cancelled_by = admin`,
      isErr(clientTry, 409, 'TOO_LATE') && admCancel.status === 200 && c1Row.status === 'cancelled' && c1Row.cancelled_by === 'admin'
        && total() === totalBefore,
      `клиент: ${code(clientTry)}; админ: ${admCancel.status} ${admCancel.data.status}/${admCancel.data.cancelledBy}; в БД: ${c1Row.status}/${c1Row.cancelled_by}; записей: ${totalBefore} → ${total()}`);
    check('11.2a У клиента в /api/me/appointments та же запись: status cancelled, cancelledBy admin («Отменена администратором»)',
      c1Client && c1Client.status === 'cancelled' && c1Client.cancelledBy === 'admin',
      `#${c1}: ${c1Client && `${c1Client.status}/${c1Client.cancelledBy}`}`);
    if (realSlots) {
      check(`11.2b Слот ${soonA.time} снова свободен`,
        !slotsBusy.data.includes(soonA.time) && slotsFreed.data.includes(soonA.time),
        `до отмены: ${slotsBusy.data.includes(soonA.time) ? 'есть' : 'нет'}; после: ${slotsFreed.data.includes(soonA.time) ? 'есть' : 'нет'}`);
    } else {
      const wedSlot = await clientA.post('/api/appointments', { serviceId: MANICURE, masterId: ANNA, date: wed, time: '10:00' });
      await admin.post(`/api/admin/appointments/${wedSlot.data.id}/cancel`);
      const freed = await guest.get(slotsUrl(ANNA, MANICURE, wed));
      check(`11.2b Слот снова свободен (проверено на записи к Анне ${wed} 10:00)`, freed.data.includes('10:00'), `слоты: ${list(freed.data)}`);
    }
    const again = await admin.post(`/api/admin/appointments/${c1}/cancel`);
    const moveCancelled = await admin.post(`/api/admin/appointments/${c1}/reschedule`, { date: nextWeekday(FRI, 1), time: '14:00' });
    check('11.2c Повторная отмена и перенос отменённой записи админом → 409 ALREADY_CANCELLED',
      isErr(again, 409, 'ALREADY_CANCELLED') && isErr(moveCancelled, 409, 'ALREADY_CANCELLED'), `${code(again)}; ${code(moveCancelled)}`);

    // Перенос админом записи «меньше 24 ч»
    const m1 = insertAppt(clientA.id, soonB.masterId, soonB.serviceId, soonB.date, soonB.time, soonB.duration, soonB.price);
    const clientMove = await clientA.post(`/api/appointments/${m1}/reschedule`, { date: nextWeekday(FRI, 1), time: '12:00' });
    const dates = await admin.get(`/api/admin/appointments/${m1}/available-dates`);
    const target = dates.data.find((d) => d.hasSlots && d.date > addDays(mskNow().date, 1));
    const targetSlots = await admin.get(`/api/admin/appointments/${m1}/slots?date=${target.date}`);
    const targetTime = targetSlots.data[Math.floor(targetSlots.data.length / 2)];
    const before2 = total();
    const admMove = await admin.post(`/api/admin/appointments/${m1}/reschedule`, { date: target.date, time: targetTime });
    const m1Row = row(m1);
    const m1Client = (await clientA.get('/api/me/appointments')).data.find((a) => a.id === m1);
    const oldDay = await guest.get(slotsUrl(soonB.masterId, soonB.serviceId, soonB.date));
    const newDay = await guest.get(slotsUrl(soonB.masterId, soonB.serviceId, target.date));
    check(`11.3 Перенос админом записи «меньше 24 ч» #${m1} (${soonB.date} ${soonB.time} → ${target.date} ${targetTime}); клиенту это → 409 TOO_LATE`,
      isErr(clientMove, 409, 'TOO_LATE') && admMove.status === 200 && admMove.data.id === m1 && total() === before2
        && m1Row.start_at === `${target.date} ${targetTime}` && m1Row.status === 'active',
      `клиент: ${code(clientMove)}; админ: ${admMove.status} id=${admMove.data.id} ${admMove.data.date} ${admMove.data.time}; записей: ${before2} → ${total()}`);
    check('11.3a У клиента та же запись с новым временем',
      m1Client && m1Client.date === target.date && m1Client.time === targetTime && m1Client.status === 'active',
      `кабинет: #${m1Client && m1Client.id} ${m1Client && `${m1Client.date} ${m1Client.time}`}`);
    check(`11.3b Новое время занято${realSlots ? ', старое снова свободно' : ''}`,
      !newDay.data.includes(targetTime) && (!realSlots || oldDay.data.includes(soonB.time)),
      `${target.date}: ${targetTime} ${newDay.data.includes(targetTime) ? 'свободно' : 'занято'}; ${soonB.date}: ${soonB.time} ${oldDay.data.includes(soonB.time) ? 'свободно' : 'занято'}`);

    const occupied = await clientB.post('/api/appointments', {
      serviceId: soonB.serviceId, masterId: soonB.masterId, date: target.date,
      time: (await guest.get(slotsUrl(soonB.masterId, soonB.serviceId, target.date))).data[0],
    });
    const intoTaken = await admin.post(`/api/admin/appointments/${m1}/reschedule`, { date: target.date, time: occupied.data.time });
    const pastDate = await admin.post(`/api/admin/appointments/${m1}/reschedule`, { date: addDays(mskNow().date, -1), time: '12:00' });
    check('11.4 Перенос на занятое время → 409 SLOT_TAKEN; на вчерашний день → 400 VALIDATION; запись не изменилась',
      occupied.status === 201 && isErr(intoTaken, 409, 'SLOT_TAKEN') && isErr(pastDate, 400, 'VALIDATION')
        && row(m1).start_at === `${target.date} ${targetTime}`,
      `занятое ${occupied.data.time}: ${short(intoTaken)}; вчера: ${code(pastDate)}`);

    const past = insertAppt(clientA.id, ANNA, MANICURE, addDays(mskNow().date, -2), '10:00', 90, 1800);
    const pastCancel = await admin.post(`/api/admin/appointments/${past}/cancel`);
    const pastMove = await admin.post(`/api/admin/appointments/${past}/reschedule`, { date: wed, time: '14:00' });
    check('11.5 Прошедшую запись админ не отменяет и не переносит → 409 TOO_LATE',
      isErr(pastCancel, 409, 'TOO_LATE') && isErr(pastMove, 409, 'TOO_LATE') && row(past).status === 'active',
      `отмена: ${short(pastCancel)}; перенос: ${code(pastMove)}`);

    // Блокировки
    const wedBefore = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    const addBlock = await admin.post('/api/admin/blocks', { masterId: ANNA, weekday: WED, allDay: false, from: '12:00', to: '13:00', reason: 'проверка' });
    const wedBlocked = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    const blocks = await admin.get('/api/admin/blocks');
    const delBlock = await admin.del(`/api/admin/blocks/${addBlock.data.block.id}`);
    const wedRestored = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    const gone = ['11:00', '11:30', '12:00', '12:30'];
    check(`11.6 Блокировка Анны ср 12:00–13:00 убирает слоты ${wed} 11:00–12:30 (визит 90 мин задел бы её), 10:30 остаётся (визит кончается ровно в 12:00)`,
      addBlock.status === 201 && blocks.data.some((b) => b.id === addBlock.data.block.id)
        && gone.every((t) => wedBefore.data.includes(t) && !wedBlocked.data.includes(t)) && wedBlocked.data.includes('10:30') && wedBlocked.data.includes('13:00'),
      `до: ${list(wedBefore.data)}\n   с блокировкой: ${list(wedBlocked.data)}`);
    check('11.6a Удаление блокировки возвращает слоты',
      delBlock.status === 200 && same(wedRestored.data, wedBefore.data), `после удаления: ${list(wedRestored.data)}`);

    const fri = nextWeekday(FRI, 1);
    const friAppt = await clientA.post('/api/appointments', { serviceId: MANICURE, masterId: ANNA, date: fri, time: '10:00' });
    const over = await admin.post('/api/admin/blocks', { masterId: ANNA, weekday: FRI, allDay: false, from: '10:30', to: '11:00', reason: 'проверка' });
    const overAll = await admin.post('/api/admin/blocks', { masterId: ANNA, weekday: FRI, allDay: true, reason: 'проверка' });
    const noOverlap = await admin.post('/api/admin/blocks', { masterId: ANNA, weekday: FRI, allDay: false, from: '16:00', to: '17:00' });
    check(`11.7 Блокировка поверх записи (Анна, ${fri} 10:00–11:30): 201, запись осталась active, в ответе предупреждение со списком`,
      over.status === 201 && over.data.conflicts.length === 1 && over.data.conflicts[0].id === friAppt.data.id
        && /Блокировка пересекается с записями: 1 будущая запись/.test(over.data.warning)
        && overAll.status === 201 && overAll.data.conflicts.some((a) => a.id === friAppt.data.id)
        && row(friAppt.data.id).status === 'active',
      `предупреждение: «${over.data.warning}»; записи: ${list(over.data.conflicts.map((a) => `#${a.id} ${a.clientName} ${a.date} ${a.time}`))}`);
    check('11.7a Блокировка, не задевающая записи (16:00–17:00), → без предупреждения',
      noOverlap.status === 201 && noOverlap.data.conflicts.length === 0 && noOverlap.data.warning === null, short(noOverlap).slice(0, 160));
    for (const b of [over, overAll, noOverlap]) await admin.del(`/api/admin/blocks/${b.data.block.id}`);
    const missingBlock = await admin.del('/api/admin/blocks/999999');
    check('11.7b Удаление несуществующей блокировки → 404 NOT_FOUND', isErr(missingBlock, 404, 'NOT_FOUND'), short(missingBlock));
  } catch (err) {
    check('Проверка прервана ошибкой', false, err.stack || String(err));
  } finally {
    if (db) db.close();
    if (server) server.child.removeAllListeners('exit').kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  section('Остальные проверки проекта');
  for (const script of ['booking:check', 'auth:check', 'db:check']) {
    const r = spawnSync('npm', ['run', '--silent', script], { cwd: ROOT, encoding: 'utf8', env: process.env });
    const summary = (`${r.stdout}`.match(/Итог: .*/g) || ['нет итога']).at(-1);
    check(`npm run ${script}: ${summary}`, r.status === 0);
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\nИтог: ❌ не пройдено проверок: ${failed} из ${results.length}` : `\nИтог: ✅ все проверки пройдены (${results.length})`);
  process.exitCode = failed ? 1 : 0;
}

main();
