// Проверка уведомлений клиента: npm run notifications:check
// Запускает настоящий сервер на временной базе (data/app.db не трогает, .env не читает),
// без демо-записей, и проверяет по HTTP, как браузер (шаг 14):
//   перенос и отмена администратором → уведомление клиенту и пометка в карточке;
//   перенос и отмена самим клиентом → уведомлений нет;
//   чужие уведомления недоступны; после прочтения счётчик 0.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openDatabase } = require('../server/db');
const { mskNow, addDays, weekdayOf, fromMin } = require('../server/time');

const ROOT = path.join(__dirname, '..');
const ADMIN = { email: 'admin@check.local', password: 'check-admin-password' };
const PASSWORD = 'client-password-123';

// Мастера и услуги из справочника (CLAUDE.md, п. 8)
const ANNA = 1, ELENA = 3;
const MANICURE = 1, BROWS = 4, LAMINATION = 5;
const THU = 4;

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
    return { status: res.status, data, text };
  }
  return {
    label,
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body ?? {}),
  };
}

const short = (r) => `${r.status} ${JSON.stringify(r.data)}`;
const isErr = (r, status, c) => r.status === status && r.data && r.data.code === c;

function nextWeekday(weekday, minDays) {
  let d = addDays(mskNow().date, minDays);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}

// Ожидаемый формат времени в тексте: «чт 15 окт 15:00–16:00» (считается здесь независимо от сервера)
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function human(date, from, to) {
  const [, m, d] = date.split('-').map(Number);
  return `${WD[weekdayOf(date)]} ${d} ${MN[m - 1]} ${from}–${to}`;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'az-notif-check-'));
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
    const sveta = await register('Светлана', 'sveta@check.local');
    const olga = await register('Ольга', 'olga@check.local');
    const admin = makeClient(base, 'Администратор');
    const login = await admin.post('/api/auth/login', ADMIN);
    if (login.status !== 200) throw new Error(`вход администратора: ${short(login)}`);

    const book = async (c, serviceId, masterId, date, time) => {
      const r = await c.post('/api/appointments', { serviceId, masterId, date, time });
      if (r.status !== 201) throw new Error(`запись ${c.label} ${date} ${time}: ${short(r)}`);
      return r.data;
    };
    const dbCount = (clientId) => db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE client_id = ?').get(clientId).n;
    const unread = async (c) => (await c.get('/api/me/notifications/unread-count')).data.count;
    const myAppt = async (c, id) => (await c.get('/api/me/appointments')).data.find((a) => a.id === id);

    // Четверг не раньше чем через 3 дня — правило 24 ч не мешает клиенту переносить и отменять
    const thu = nextWeekday(THU, 3);
    console.log(`Дата визитов: ${thu} (чт)`);

    /* ============ Перенос администратором ============ */
    section('Перенос записи администратором');

    const lam = await book(sveta, LAMINATION, ELENA, thu, '15:00');
    check('14.0 До переноса: у клиентки 0 уведомлений, пометки нет',
      await unread(sveta) === 0 && (await myAppt(sveta, lam.id)).rescheduledBy === null);

    const moved = await admin.post(`/api/admin/appointments/${lam.id}/reschedule`, { date: thu, time: '15:30' });
    check('14.1 Администратор переносит «Ламинирование бровей» к Елене Смирновой 15:00 → 15:30', moved.status === 200,
      `${moved.status} ${moved.data && `${moved.data.date} ${moved.data.time}–${moved.data.endTime}`}`);

    const count1 = await unread(sveta);
    const list1 = (await sveta.get('/api/me/notifications')).data;
    const n1 = list1[0];
    const expected = `Администратор перенёс вашу запись «Ламинирование бровей» к Елене Смирновой: ` +
      `было ${human(thu, '15:00', '16:00')}, стало ${human(thu, '15:30', '16:30')}`;
    check('14.2 У клиентки 1 непрочитанное уведомление', count1 === 1 && list1.length === 1 && n1.isRead === false,
      `счётчик: ${count1}, в списке: ${list1.length}`);
    check('14.3 Текст: услуга, мастер, было → стало', n1 && n1.text === expected, `«${n1 && n1.text}»`);
    check('14.4 В уведомлении сохранены старое и новое время, тип «rescheduled», номер записи',
      n1 && n1.kind === 'rescheduled' && n1.appointmentId === lam.id
        && n1.oldStartAt === `${thu} 15:00` && n1.oldEndAt === `${thu} 16:00`
        && n1.newStartAt === `${thu} 15:30` && n1.newEndAt === `${thu} 16:30`,
      n1 && `было ${n1.oldStartAt}–${n1.oldEndAt.slice(11)}, стало ${n1.newStartAt}–${n1.newEndAt.slice(11)}`);

    const card1 = await myAppt(sveta, lam.id);
    const cabinetJs = (await sveta.get('/js/pages/cabinet.js')).text;
    const cabinetHtml = (await sveta.get('/cabinet')).text;
    const uiJs = (await sveta.get('/js/ui.js')).text;
    check('14.5 Карточка: та же запись с новым временем и rescheduledBy = admin → пометка «Время изменено администратором»',
      card1.time === '15:30' && card1.endTime === '16:30' && card1.rescheduledBy === 'admin'
        && cabinetJs.includes("rescheduledBy === 'admin'") && cabinetJs.includes('Время изменено администратором'),
      `${card1.date} ${card1.time}–${card1.endTime}, rescheduledBy: ${card1.rescheduledBy}`);
    check('14.5a Страницы: блок уведомлений в кабинете и счётчик у «Мои записи» в шапке',
      cabinetHtml.includes('id="cab-notifs"') && uiJs.includes('data-notif-count') && uiJs.includes('getUnreadCount'));

    /* ============ Отмена администратором ============ */
    section('Отмена записи администратором');

    const mani = await book(sveta, MANICURE, ANNA, thu, '10:00');
    const cancelled = await admin.post(`/api/admin/appointments/${mani.id}/cancel`);
    const list2 = (await sveta.get('/api/me/notifications')).data;
    const n2 = list2[0];
    const expected2 = `Администратор отменил вашу запись «Маникюр с покрытием гель-лаком» к Анне Ковалевой на ${human(thu, '10:00', '11:30')}`;
    check('14.6 Отмена администратором → новое уведомление (всего 2 непрочитанных)',
      cancelled.status === 200 && list2.length === 2 && await unread(sveta) === 2 && n2.kind === 'cancelled' && n2.appointmentId === mani.id,
      `«${n2 && n2.text}»`);
    check('14.6a Текст отмены: услуга, мастер, время; в карточке «Отменена администратором» (cancelledBy = admin)',
      n2.text === expected2 && n2.newStartAt === null && (await myAppt(sveta, mani.id)).cancelledBy === 'admin');

    const again = await admin.post(`/api/admin/appointments/${mani.id}/cancel`);
    check('14.6b Повторная отмена → 409, лишнего уведомления нет',
      isErr(again, 409, 'ALREADY_CANCELLED') && dbCount(sveta.id) === 2, short(again));

    const other = await book(olga, BROWS, ELENA, thu, '10:00');
    const busy = await admin.post(`/api/admin/appointments/${lam.id}/reschedule`, { date: thu, time: '10:00' });
    check('14.6c Перенос администратором на занятое время → 409, уведомления нет (транзакция откатилась)',
      isErr(busy, 409, 'SLOT_TAKEN') && dbCount(sveta.id) === 2 && dbCount(olga.id) === 0, short(busy));

    /* ============ Действия самого клиента ============ */
    section('Перенос и отмена самим клиентом — без уведомлений');

    const selfMove = await olga.post(`/api/appointments/${other.id}/reschedule`, { date: thu, time: '11:00' });
    check('14.7 Клиентка переносит свою запись → уведомлений нет, пометки нет',
      selfMove.status === 200 && dbCount(olga.id) === 0 && await unread(olga) === 0
        && (await myAppt(olga, other.id)).rescheduledBy === 'client',
      `${selfMove.status} ${selfMove.data && selfMove.data.time}; уведомлений в БД: ${dbCount(olga.id)}`);
    const selfCancel = await olga.post(`/api/appointments/${other.id}/cancel`);
    const olgaList = (await olga.get('/api/me/notifications')).data;
    check('14.8 Клиентка отменяет свою запись → уведомлений нет',
      selfCancel.status === 200 && selfCancel.data.cancelledBy === 'client' && dbCount(olga.id) === 0 && olgaList.length === 0,
      `${selfCancel.status}; список: ${JSON.stringify(olgaList)}`);

    const svetaSelf = await sveta.post(`/api/appointments/${lam.id}/reschedule`, { date: thu, time: '16:00' });
    check('14.9 Клиентка сама переносит запись, которую перенёс админ → нового уведомления нет, пометка снята',
      svetaSelf.status === 200 && dbCount(sveta.id) === 2 && (await myAppt(sveta, lam.id)).rescheduledBy === 'client',
      `${svetaSelf.status}; уведомлений: ${dbCount(sveta.id)}, rescheduledBy: ${(await myAppt(sveta, lam.id)).rescheduledBy}`);

    /* ============ Чужие уведомления ============ */
    section('Чужие уведомления недоступны');

    const svetaIds = list2.map((n) => n.id);
    const olgaSees = (await olga.get('/api/me/notifications')).data;
    check('14.10 Другая клиентка: список пуст, счётчик 0', olgaSees.length === 0 && await unread(olga) === 0,
      `список: ${JSON.stringify(olgaSees)}`);
    const foreign = await olga.post(`/api/me/notifications/${svetaIds[0]}/read`);
    const missing = await olga.post('/api/me/notifications/999999/read');
    check('14.11 Чужое уведомление по id → 404 NOT_FOUND (как и несуществующее)',
      isErr(foreign, 404, 'NOT_FOUND') && isErr(missing, 404, 'NOT_FOUND'), `${short(foreign)}; несуществующее: ${short(missing)}`);
    const foreignBulk = await olga.post('/api/me/notifications/read', { ids: svetaIds });
    check('14.12 Попытка отметить чужие прочитанными списком → у владелицы они остались непрочитанными',
      foreignBulk.status === 200 && foreignBulk.data.count === 0 && await unread(sveta) === 2,
      `ответ Ольге: ${short(foreignBulk)}; у Светланы непрочитанных: ${await unread(sveta)}`);
    const guestList = await guest.get('/api/me/notifications');
    const guestCount = await guest.get('/api/me/notifications/unread-count');
    check('14.13 Гость → 401 UNAUTHORIZED', isErr(guestList, 401, 'UNAUTHORIZED') && isErr(guestCount, 401, 'UNAUTHORIZED'));
    const bad = await sveta.post('/api/me/notifications/read', { ids: 'все' });
    check('14.13a Неверный запрос на прочтение → 400 VALIDATION', isErr(bad, 400, 'VALIDATION'), short(bad));

    /* ============ Прочтение ============ */
    section('Прочтение');

    const read = await sveta.post('/api/me/notifications/read', { ids: svetaIds });
    const after = (await sveta.get('/api/me/notifications')).data;
    check('14.14 Клиентка открыла уведомления → счётчик 0, оба прочитаны и остаются в списке',
      read.status === 200 && read.data.count === 0 && await unread(sveta) === 0
        && after.length === 2 && after.every((n) => n.isRead),
      `ответ: ${short(read)}`);
    const readOne = await sveta.post(`/api/me/notifications/${svetaIds[0]}/read`);
    check('14.15 Повторное прочтение своего по id → 200, счётчик по-прежнему 0',
      readOne.status === 200 && readOne.data.isRead === true && await unread(sveta) === 0, `${readOne.status}`);
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
