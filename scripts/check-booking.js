// Проверка расчёта свободного времени, записи и конфликта слотов: npm run booking:check
// Запускает настоящий сервер на временной базе (data/app.db не трогает, .env не читает),
// без демо-записей, и проверяет API по HTTP, как браузер.
// Шаг 6 — расчёт слотов; шаг 7 — создание, отмена, перенос; шаг 8 — одновременная запись.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openDatabase } = require('../server/db');
const { mskNow, addDays, weekdayOf, toMin, fromMin, stamp } = require('../server/time');

const ROOT = path.join(__dirname, '..');
const ADMIN = { email: 'admin@check.local', password: 'check-admin-password' };
const PASSWORD = 'client-password-123';

// Мастера и услуги из справочника (CLAUDE.md, п. 8)
const ANNA = 1, MARINA = 2, ELENA = 3;
const MANICURE = 1, MANI_PEDI = 2, BROWS = 4;
const TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

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
    const headers = { Accept: 'application/json' };
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
    return { status: res.status, data, location: res.headers.get('location') };
  }
  return {
    label,
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body ?? {}),
  };
}

const short = (r) => `${r.status} ${JSON.stringify(r.data)}`;
const code = (r) => `${r.status} ${r.data && r.data.code}`;
const isErr = (r, status, c) => r.status === status && r.data && r.data.code === c;
const list = (a) => (Array.isArray(a) ? `[${a.join(', ')}]` : JSON.stringify(a));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Ближайший такой день недели не раньше чем через minDays дней (по Москве)
function nextWeekday(weekday, minDays) {
  let d = addDays(mskNow().date, minDays);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}
function slotsUrl(masterId, serviceId, date, designNails) {
  return `/api/slots?masterId=${masterId}&serviceId=${serviceId}&date=${date}${designNails ? `&designNails=${designNails}` : ''}`;
}
function range(from, to) {
  const out = [];
  for (let t = toMin(from); t <= toMin(to); t += 30) out.push(fromMin(t));
  return out;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'az-booking-check-'));
  const dbPath = path.join(tmpDir, 'check.db');
  const port = await freePort();
  const env = { ...process.env };
  for (const k of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DEMO_PASSWORD', 'DB_PATH', 'PORT']) delete env[k];
  Object.assign(env, { DB_PATH: dbPath, PORT: String(port), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password });
  const base = `http://127.0.0.1:${port}`;
  console.log(`Временная база: ${dbPath} (без демо-записей)`);
  console.log(`Сегодня по Москве: ${mskNow().date}`);

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
      return c;
    };
    const clientA = await register('Клиент А', 'a@check.local');
    const clientB = await register('Клиент Б', 'b@check.local');
    const admin = makeClient(base, 'Администратор');
    await admin.post('/api/auth/login', ADMIN);
    const activeCount = (masterId, startAt) => db.prepare(
      "SELECT COUNT(*) AS n FROM appointments WHERE master_id = ? AND start_at = ? AND status = 'active'",
    ).get(masterId, startAt).n;

    /* ======================= Шаг 6 ======================= */
    section('Шаг 6 — расчёт свободного времени');

    const thu = nextWeekday(THU, 1);
    const annaThu = await guest.get(slotsUrl(ANNA, MANICURE, thu));
    const expectedAnna = [...range('10:00', '11:30'), ...range('14:00', '16:30')];
    check(`6.1 Анна, четверг ${thu}, маникюр с покрытием (90 мин) → 10:00–11:30 и 14:00–16:30`,
      annaThu.status === 200 && same(annaThu.data, expectedAnna), `слоты: ${list(annaThu.data)}`);
    const lunchFree = (annaThu.data || []).filter((t) => t >= '12:00' && t <= '13:30');
    check('6.1a Нет 12:00–13:30 (визит задел бы обед 13:00–14:00); последний слот 16:30 (конец ровно в 18:00)',
      lunchFree.length === 0 && (annaThu.data || []).at(-1) === '16:30',
      `слотов в 12:00–13:30: ${lunchFree.length}; последний: ${(annaThu.data || []).at(-1)}`);

    const annaThuDesign = await guest.get(slotsUrl(ANNA, MANICURE, thu, 6));
    check('6.2 То же с дизайном 6 ногтей (90 + 30 = 120 мин) → последний слот 16:00',
      annaThuDesign.status === 200 && same(annaThuDesign.data, [...range('10:00', '11:00'), ...range('14:00', '16:00')]),
      `слоты: ${list(annaThuDesign.data)}`);

    const fri = nextWeekday(FRI, 1);
    const marinaFri = await guest.get(slotsUrl(MARINA, BROWS, fri));
    const blockHit = (marinaFri.data || []).filter((t) => toMin(t) < toMin('17:00') && toMin(t) + 40 > toMin('15:00'));
    check(`6.3 Марина, пятница ${fri} без записей, коррекция бровей (40 мин) → нет 15:00–17:00`,
      marinaFri.status === 200 && blockHit.length === 0 && same(marinaFri.data, [...range('11:00', '14:00'), ...range('17:00', '19:00')]),
      `слоты: ${list(marinaFri.data)}`);

    const sat = nextWeekday(SAT, 1);
    const elenaSat = await guest.get(slotsUrl(ELENA, MANICURE, sat));
    const elenaDates = await guest.get(`/api/available-dates?masterId=${ELENA}&serviceId=${MANICURE}`);
    const sats = (elenaDates.data || []).filter((d) => d.weekday === SAT);
    check(`6.4 Елена, суббота ${sat} (выходной) → слотов нет`,
      elenaSat.status === 200 && same(elenaSat.data, []), `слоты: ${list(elenaSat.data)}`);
    check('6.4a В ленте дат Елены все субботы неактивны',
      elenaDates.status === 200 && elenaDates.data.length === 30 && sats.length > 0 && sats.every((d) => !d.working && !d.hasSlots),
      `дат в ленте: ${elenaDates.data && elenaDates.data.length}; суббот: ${sats.length}, активных: ${sats.filter((d) => d.working).length}`);

    const wed = nextWeekday(WED, 2);
    const before = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    const booked = await clientA.post('/api/appointments', { serviceId: MANICURE, masterId: ANNA, date: wed, time: '12:00' });
    const after = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    const overlapping = ['11:00', '11:30', '12:00', '12:30', '13:00'];
    check(`6.5 После записи на ${wed} 12:00 (Анна, 90 мин) слот исчез вместе с пересекающимися 11:00–13:00`,
      booked.status === 201 && overlapping.every((t) => before.data.includes(t) && !after.data.includes(t))
        && after.data.includes('10:30') && after.data.includes('13:30'),
      `до: ${list(before.data)}\n   после: ${list(after.data)}`);

    const designElena = await guest.get(slotsUrl(ELENA, MANICURE, nextWeekday(TUE, 1), 2));
    const designElenaMasters = await guest.get(`/api/masters?serviceId=${MANICURE}&designNails=2`);
    check('6.6 Дизайн у Елены → 400 VALIDATION; мастера с дизайном для маникюра — только Анна',
      isErr(designElena, 400, 'VALIDATION') && same((designElenaMasters.data || []).map((m) => m.name), ['Анна Ковалева']),
      `слоты: ${short(designElena)}; мастера: ${list((designElenaMasters.data || []).map((m) => m.name))}`);

    db.prepare('UPDATE services SET is_active = 0 WHERE id = ?').run(MANI_PEDI);
    const services = await guest.get('/api/services');
    const disabledSlots = await guest.get(slotsUrl(ANNA, MANI_PEDI, wed));
    const disabledCreate = await clientA.post('/api/appointments', { serviceId: MANI_PEDI, masterId: ANNA, date: wed, time: '15:00' });
    db.prepare('UPDATE services SET is_active = 1 WHERE id = ?').run(MANI_PEDI);
    check('6.7 Отключённая услуга «Маникюр и педикюр» не видна в каталоге, слоты и запись → VALIDATION',
      services.status === 200 && !services.data.some((s) => s.id === MANI_PEDI) && services.data.length === 4
        && isErr(disabledSlots, 400, 'VALIDATION') && isErr(disabledCreate, 400, 'VALIDATION'),
      `услуги: ${list(services.data.map((s) => s.name))}; слоты: ${code(disabledSlots)}; запись: ${code(disabledCreate)}`);

    const bad = {
      'мастер не выполняет услугу (Марина, маникюр)': await guest.get(slotsUrl(MARINA, MANICURE, wed)),
      'дизайн к неногтевой услуге': await guest.get(slotsUrl(ANNA, BROWS, wed, 2)),
      'неверное число ногтей (3)': await guest.get(slotsUrl(ANNA, MANICURE, wed, 3)),
      'дата вне окна (+30 дней)': await guest.get(slotsUrl(ANNA, MANICURE, addDays(mskNow().date, 30))),
      'дата в прошлом': await guest.get(slotsUrl(ANNA, MANICURE, addDays(mskNow().date, -1))),
      'несуществующий мастер': await guest.get(slotsUrl(99, MANICURE, wed)),
    };
    check('6.8 Прочие неверные параметры → 400 VALIDATION',
      Object.values(bad).every((r) => isErr(r, 400, 'VALIDATION')),
      Object.entries(bad).map(([k, r]) => `${k}: ${code(r)}`).join('\n   '));

    const now = mskNow();
    const todayLists = [];
    for (const [m, s] of [[ANNA, MANICURE], [MARINA, BROWS], [ELENA, BROWS]]) {
      const r = await guest.get(slotsUrl(m, s, now.date));
      todayLists.push(r.data);
    }
    check('6.9 Сегодня прошедшее время не показывается (по Москве)',
      todayLists.every((l) => Array.isArray(l) && l.every((t) => toMin(t) > now.minutes)),
      `сейчас ${fromMin(now.minutes)}; слоты сегодня: ${todayLists.map(list).join(' · ')}`);

    /* ======================= Шаг 7 ======================= */
    section('Шаг 7 — создание, отмена и перенос записи');

    const tue = nextWeekday(TUE, 2);
    const created = await clientA.post('/api/appointments', {
      serviceId: MANICURE, masterId: ANNA, date: tue, time: '10:00', designNails: 4, price: 1, duration: 1,
    });
    const mine = await clientA.get('/api/me/appointments');
    const row = created.data && db.prepare('SELECT price, duration_min, start_at, end_at FROM appointments WHERE id = ?').get(created.data.id);
    check(`7.1 Клиент А записался (Анна, ${tue} 10:00, маникюр + дизайн 4 ногтя, в запросе price=1, duration=1)`,
      created.status === 201 && mine.data.some((a) => a.id === created.data.id),
      `ответ: 201 id=${created.data && created.data.id}; в /api/me/appointments: ${list(mine.data.map((a) => `#${a.id} ${a.date} ${a.time}`))}`);
    check('7.1a Цена и длительность посчитаны сервером: 1800 + 2×300 = 2400 ₽, 90 + 15 = 105 мин',
      created.data.price === 2400 && created.data.duration === 105 && row.price === 2400 && row.duration_min === 105,
      `ответ: ${created.data.price} ₽, ${created.data.duration} мин; в БД: ${row.price} ₽, ${row.duration_min} мин, ${row.start_at} – ${row.end_at}`);

    const sameSlot = await clientB.post('/api/appointments', { serviceId: MANICURE, masterId: ANNA, date: tue, time: '10:00' });
    const overlapSlot = await clientB.post('/api/appointments', { serviceId: MANICURE, masterId: ANNA, date: tue, time: '11:30' });
    check('7.2 Клиент Б на тот же слот → 409 SLOT_TAKEN', isErr(sameSlot, 409, 'SLOT_TAKEN'), short(sameSlot));
    check('7.2a Клиент Б на пересекающийся слот 11:30 (запись А идёт до 11:45) → 409 SLOT_TAKEN',
      isErr(overlapSlot, 409, 'SLOT_TAKEN'), short(overlapSlot));

    const body = { serviceId: MANICURE, masterId: ANNA, date: tue, time: '15:00' };
    const byGuest = await guest.post('/api/appointments', body);
    const byAdmin = await admin.post('/api/appointments', body);
    check('7.3 Гость → 401 UNAUTHORIZED; администратор → 403 FORBIDDEN',
      isErr(byGuest, 401, 'UNAUTHORIZED') && isErr(byAdmin, 403, 'FORBIDDEN'), `гость: ${short(byGuest)}; админ: ${short(byAdmin)}`);

    const aId = created.data.id;
    const foreign = {
      'GET /api/appointments/:id': await clientB.get(`/api/appointments/${aId}`),
      'POST …/cancel': await clientB.post(`/api/appointments/${aId}/cancel`),
      'POST …/reschedule': await clientB.post(`/api/appointments/${aId}/reschedule`, { date: tue, time: '15:00' }),
      'GET …/slots': await clientB.get(`/api/appointments/${aId}/slots?date=${tue}`),
    };
    const missing = await clientB.get('/api/appointments/999999');
    const stillActive = db.prepare('SELECT status, start_at FROM appointments WHERE id = ?').get(aId);
    check('7.4 Клиент Б запрашивает, отменяет и переносит запись клиента А → 404 NOT_FOUND, как для несуществующей',
      Object.values(foreign).every((r) => isErr(r, 404, 'NOT_FOUND') && same(r.data, missing.data))
        && stillActive.status === 'active' && stillActive.start_at === `${tue} 10:00`,
      `${Object.entries(foreign).map(([k, r]) => `${k}: ${short(r)}`).join('\n   ')}\n   несуществующая #999999: ${short(missing)}; запись А в БД: ${stillActive.status}, ${stillActive.start_at}`);

    // Запись «меньше 24 ч» ставится напрямую в базу: через API так близко записаться может не получиться
    const soon = new Date(Date.now() + 3 * 3600000);
    const soonMsk = mskNow();
    const soonMin = Math.ceil((soonMsk.minutes + 180) / 30) * 30;
    const aUserId = db.prepare('SELECT id FROM users WHERE email = ?').get('a@check.local').id;
    const iso = soon.toISOString();
    const soonId = Number(db.prepare(`INSERT INTO appointments
      (client_id, master_id, service_id, design_nails, start_at, end_at, duration_min, price, status, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, 40, 1200, 'active', ?, ?)`)
      .run(aUserId, MARINA, BROWS, stamp(soonMsk.date, soonMin), stamp(soonMsk.date, soonMin + 40), iso, iso).lastInsertRowid);
    const lateCancel = await clientA.post(`/api/appointments/${soonId}/cancel`);
    const lateMove = await clientA.post(`/api/appointments/${soonId}/reschedule`, { date: fri, time: '11:00' });
    const lateRow = db.prepare('SELECT status, start_at FROM appointments WHERE id = ?').get(soonId);
    check(`7.5 Запись меньше чем за 24 ч (${stamp(soonMsk.date, soonMin)}): отмена и перенос → 409 TOO_LATE, запись не изменилась`,
      isErr(lateCancel, 409, 'TOO_LATE') && isErr(lateMove, 409, 'TOO_LATE') && lateRow.status === 'active' && lateRow.start_at === stamp(soonMsk.date, soonMin),
      `отмена: ${short(lateCancel)}\n   перенос: ${code(lateMove)}`);

    const wedId = booked.data.id;
    const countBefore = db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
    const cancel = await clientA.post(`/api/appointments/${wedId}/cancel`);
    const cancelRow = db.prepare('SELECT status, cancelled_by FROM appointments WHERE id = ?').get(wedId);
    const countAfter = db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
    const freed = await guest.get(slotsUrl(ANNA, MANICURE, wed));
    check(`7.6 Отмена записи #${wedId} (${wed} 12:00) → cancelled, cancelled_by = client, запись осталась в БД`,
      cancel.status === 200 && cancel.data.status === 'cancelled' && cancelRow.status === 'cancelled'
        && cancelRow.cancelled_by === 'client' && countAfter === countBefore,
      `ответ: status=${cancel.data.status}, cancelledBy=${cancel.data.cancelledBy}; в БД: ${cancelRow.status}/${cancelRow.cancelled_by}; записей в БД: ${countBefore} → ${countAfter}`);
    check('7.6a Слот снова свободен: 11:00–13:00 вернулись в список',
      overlapping.every((t) => freed.data.includes(t)), `слоты ${wed}: ${list(freed.data)}`);
    const again = await clientA.post(`/api/appointments/${wedId}/cancel`);
    const moveCancelled = await clientA.post(`/api/appointments/${wedId}/reschedule`, { date: wed, time: '12:00' });
    check('7.6b Повторная отмена и перенос отменённой записи → 409 ALREADY_CANCELLED',
      isErr(again, 409, 'ALREADY_CANCELLED') && isErr(moveCancelled, 409, 'ALREADY_CANCELLED'),
      `отмена: ${short(again)}; перенос: ${code(moveCancelled)}`);

    // Перенос записи А (вт 10:00–11:45) — слоты считаются без неё самой
    const regular = await guest.get(`${slotsUrl(ANNA, MANICURE, tue, 4)}`);
    const forMove = await clientA.get(`/api/appointments/${aId}/slots?date=${tue}`);
    check('7.7 Слоты для переноса не учитывают саму запись: 10:00 и 10:30 есть в слотах переноса, но не в обычных',
      forMove.status === 200 && ['10:00', '10:30'].every((t) => forMove.data.includes(t) && !regular.data.includes(t)),
      `обычные: ${list(regular.data)}\n   для переноса: ${list(forMove.data)}`);

    const blocker = await clientB.post('/api/appointments', { serviceId: MANICURE, masterId: ANNA, date: tue, time: '16:00' });
    const intoTaken = await clientA.post(`/api/appointments/${aId}/reschedule`, { date: tue, time: '15:00' });
    check('7.7a Перенос на время, пересекающееся с записью Б (16:00) → 409 SLOT_TAKEN',
      blocker.status === 201 && isErr(intoTaken, 409, 'SLOT_TAKEN'), short(intoTaken));

    const total1 = db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
    const move = await clientA.post(`/api/appointments/${aId}/reschedule`, { date: tue, time: '14:00' });
    const total2 = db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
    const moved = db.prepare('SELECT start_at, end_at, status, price, duration_min FROM appointments WHERE id = ?').get(aId);
    const afterMove = await guest.get(slotsUrl(ANNA, MANICURE, tue, 4));
    check(`7.8 Перенос #${aId} на ${tue} 14:00 → тот же id, число записей не изменилось`,
      move.status === 200 && move.data.id === aId && total1 === total2 && moved.start_at === `${tue} 14:00` && moved.end_at === `${tue} 15:45`,
      `ответ: id=${move.data.id} ${move.data.date} ${move.data.time}–${move.data.endTime}; записей в БД: ${total1} → ${total2}; в БД: ${moved.start_at} – ${moved.end_at}, ${moved.price} ₽, ${moved.duration_min} мин`);
    check('7.8a Старое время 10:00 свободно, новое 14:00 занято',
      afterMove.data.includes('10:00') && !afterMove.data.includes('14:00'), `слоты ${tue} (105 мин): ${list(afterMove.data)}`);

    const pageAdmin = await admin.get('/booking');
    const pageClient = await clientA.get('/booking');
    const pageGuest = await guest.get('/booking');
    check('7.9 /booking: администратор → /admin, клиент — страница, гость → /login',
      pageAdmin.status === 302 && pageAdmin.location === '/admin' && pageClient.status === 200
        && pageGuest.status === 302 && pageGuest.location === '/login?next=%2Fbooking',
      `админ: ${pageAdmin.status} ${pageAdmin.location}; клиент: ${pageClient.status}; гость: ${pageGuest.status} ${pageGuest.location}`);

    /* ======================= Шаг 8 ======================= */
    section('Шаг 8 — конфликт слотов (одновременная запись)');

    const clientV = await register('Клиент В', 'v@check.local');
    const clientG = await register('Клиент Г', 'g@check.local');
    const elenaDay = nextWeekday(THU, 2);
    const times = ['10:00', '11:00', '12:00', '13:00', '14:00'];
    const free = await guest.get(slotsUrl(ELENA, BROWS, elenaDay));
    check(`8.0 Слоты Елены ${elenaDay} (коррекция бровей, 40 мин) свободны: ${times.join(', ')}`,
      times.every((t) => free.data.includes(t)), `слоты: ${list(free.data)}`);

    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      const pair = i % 2 ? [clientG, clientV] : [clientV, clientG]; // порядок отправки чередуется
      const req = { serviceId: BROWS, masterId: ELENA, date: elenaDay, time };
      const answers = await Promise.all(pair.map((c) => c.post('/api/appointments', req)));
      const ok = answers.filter((r) => r.status === 201);
      const taken = answers.filter((r) => isErr(r, 409, 'SLOT_TAKEN'));
      const inDb = activeCount(ELENA, `${elenaDay} ${time}`);
      const who = answers.map((r, k) => `${pair[k].label} → ${r.status === 201 ? `201 (запись #${r.data.id})` : code(r)}`).join('; ');
      check(`8.${i + 1} Раунд ${i + 1}, ${elenaDay} ${time}: ровно один 201 и один 409 SLOT_TAKEN, в БД одна active-запись`,
        ok.length === 1 && taken.length === 1 && inDb === 1, `${who}; active-записей на это время в БД: ${inDb}`);
    }
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
