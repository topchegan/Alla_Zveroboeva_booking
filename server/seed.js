// Начальные данные. Каждая группа вставляется только в пустые таблицы,
// поэтому повторный запуск ничего не дублирует.

const { transaction } = require('./db');
const { hashPassword } = require('./password');
const { toMin, fromMin, mskNow, addDays, weekdayOf, stamp } = require('./time');
const { BOOKING_DAYS } = require('./salon');
const { calcSlots } = require('./slots');

/* ---------- Справочники — строго по CLAUDE.md, п. 8 ---------- */

const SERVICES = [
  { id: 1, name: 'Маникюр с покрытием гель-лаком', duration: 90,  price: 1800, isNail: 1 },
  { id: 2, name: 'Маникюр и педикюр',              duration: 150, price: 3200, isNail: 1 },
  { id: 3, name: 'Наращивание ногтей',             duration: 150, price: 2800, isNail: 1 },
  { id: 4, name: 'Коррекция и окрашивание бровей', duration: 40,  price: 1200, isNail: 0 },
  { id: 5, name: 'Ламинирование бровей',           duration: 60,  price: 1800, isNail: 0 },
];

const DESIGN_OPTION = { name: 'Дизайн ногтей', pricePerTwoNails: 300, extraMin24: 15, extraMin610: 30 };

// Дни недели: 0 — вс … 6 — сб
const MASTERS = [
  {
    id: 1, name: 'Анна Ковалева', specialization: 'Мастер маникюра и педикюра', doesDesign: 1,
    serviceIds: [1, 2, 3], weekdays: [2, 3, 4, 5], hours: ['10:00', '18:00'],
  },
  {
    id: 2, name: 'Марина Орлова', specialization: 'Мастер по бровям', doesDesign: 0,
    serviceIds: [4, 5], weekdays: [3, 4, 5, 6], hours: ['11:00', '20:00'],
  },
  {
    id: 3, name: 'Елена Смирнова', specialization: 'Универсальный мастер · ногти и брови', doesDesign: 0,
    serviceIds: [1, 3, 4, 5], weekdays: [2, 4, 6], hours: ['10:00', '19:00'],
  },
];

const BLOCKS = [
  { masterId: 1, weekday: 4, allDay: 0, from: '13:00', to: '14:00', reason: 'обед' },
  { masterId: 2, weekday: 5, allDay: 0, from: '15:00', to: '17:00', reason: 'личное время' },
  { masterId: 3, weekday: 6, allDay: 1, from: null,    to: null,    reason: 'выходной' },
];

/* ---------- Демо-клиенты и записи — как в public/js/mock-data.js ---------- */

const DEMO_CLIENTS = [
  { key: 1, name: 'Ирина Петрова',  email: 'irina@example.ru' },
  { key: 2, name: 'Ольга Смирнова', email: 'olga@example.ru' },
  { key: 3, name: 'Мария Иванова',  email: 'maria@example.ru' },
];

// next — ближайший такой день недели не раньше чем через minDays дней;
// prev — прошедший такой день недели;
// soonest — ближайшее рабочее время мастера (желательно в пределах 24 ч).
const DEMO_APPOINTMENTS = [
  { n: 1, client: 1, serviceId: 1, masterId: 1, when: { type: 'next', weekday: 3, minDays: 2 }, time: '10:00', status: 'active' },
  { n: 2, client: 1, serviceId: 4, masterId: 2, when: { type: 'soonest' }, status: 'active' },
  { n: 3, client: 1, serviceId: 5, masterId: 3, when: { type: 'next', weekday: 2, minDays: 1 }, time: '14:00', status: 'cancelled', cancelledBy: 'admin' },
  { n: 4, client: 1, serviceId: 1, masterId: 1, when: { type: 'prev', weekday: 3 }, time: '10:00', status: 'active' },
  { n: 5, client: 2, serviceId: 5, masterId: 2, when: { type: 'next', weekday: 5, minDays: 1 }, time: '11:00', status: 'active' },
  { n: 6, client: 3, serviceId: 3, masterId: 3, when: { type: 'next', weekday: 4, minDays: 1 }, time: '15:00', status: 'active' },
];

/* ---------- Даты ---------- */

function nextWeekday(today, weekday, minDays) {
  let d = addDays(today, minDays || 0);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}
function prevWeekday(today, weekday) {
  let d = addDays(today, -1);
  while (weekdayOf(d) !== weekday) d = addDays(d, -1);
  return d;
}
/* ---------- Группы seed ---------- */

function isEmpty(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0;
}

function seedCatalog(db, log) {
  if (!isEmpty(db, 'services')) return;
  transaction(db, () => {
    const insService = db.prepare('INSERT INTO services (id, name, duration_min, price, is_nail, is_active) VALUES (?, ?, ?, ?, ?, 1)');
    for (const s of SERVICES) insService.run(s.id, s.name, s.duration, s.price, s.isNail);

    db.prepare('INSERT INTO design_option (id, name, price_per_two_nails, extra_min_2_4, extra_min_6_10) VALUES (1, ?, ?, ?, ?)')
      .run(DESIGN_OPTION.name, DESIGN_OPTION.pricePerTwoNails, DESIGN_OPTION.extraMin24, DESIGN_OPTION.extraMin610);

    const insMaster = db.prepare('INSERT INTO masters (id, name, specialization, does_design, is_active) VALUES (?, ?, ?, ?, 1)');
    const insMS = db.prepare('INSERT INTO master_services (master_id, service_id) VALUES (?, ?)');
    const insSchedule = db.prepare('INSERT INTO master_schedule (master_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
    for (const m of MASTERS) {
      insMaster.run(m.id, m.name, m.specialization, m.doesDesign);
      for (const sid of m.serviceIds) insMS.run(m.id, sid);
      for (const wd of m.weekdays) insSchedule.run(m.id, wd, m.hours[0], m.hours[1]);
    }

    const insBlock = db.prepare('INSERT INTO blocks (master_id, weekday, all_day, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?, ?)');
    for (const b of BLOCKS) insBlock.run(b.masterId, b.weekday, b.allDay, b.from, b.to, b.reason);
  });
  log(`[seed] справочники: ${SERVICES.length} услуг, опция дизайна, ${MASTERS.length} мастера, графики, ${BLOCKS.length} блокировки`);
}

async function seedAdmin(db, env, log) {
  if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n > 0) return;
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    log('[seed] ВНИМАНИЕ: администратор не создан — задайте ADMIN_EMAIL и ADMIN_PASSWORD в .env и перезапустите сервер');
    return;
  }
  const hash = await hashPassword(password);
  db.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES ('Алла', ?, ?, 'admin', ?)")
    .run(email, hash, new Date().toISOString());
  log(`[seed] администратор создан: ${email}`);
}

// Ближайшее свободное время мастера для визита duration минут — тем же расчётом слотов,
// что и запись клиента (график, блокировки, уже вставленные записи, прошедшее время сегодня).
function findSoonestSlot(db, masterId, duration) {
  const now = mskNow();
  for (let i = 0; i < BOOKING_DAYS; i++) {
    const date = addDays(now.date, i);
    const [first] = calcSlots(db, { masterId, date, duration });
    if (!first) continue;
    const minutes = toMin(first);
    return { date, minutes, hoursAhead: (i * 1440 + minutes - now.minutes) / 60 };
  }
  return null;
}

async function seedDemo(db, env, log) {
  if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'client'").get().n > 0) return;
  const password = env.DEMO_PASSWORD || '';
  if (!password) {
    log('[seed] ВНИМАНИЕ: демо-клиенты не созданы — задайте DEMO_PASSWORD в .env и перезапустите сервер');
    return;
  }
  const hashes = [];
  for (let i = 0; i < DEMO_CLIENTS.length; i++) hashes.push(await hashPassword(password));

  const services = new Map(db.prepare('SELECT id, duration_min, price FROM services').all().map((s) => [s.id, s]));
  const today = mskNow().date;
  const messages = [];
  let created = 0;

  transaction(db, () => {
    const createdAt = new Date().toISOString();
    const insUser = db.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'client', ?)");
    const userIds = new Map();
    DEMO_CLIENTS.forEach((c, i) => {
      userIds.set(c.key, Number(insUser.run(c.name, c.email, hashes[i], createdAt).lastInsertRowid));
    });
    const insAppt = db.prepare(`INSERT INTO appointments
      (id, client_id, master_id, service_id, design_nails, start_at, end_at, duration_min, price, status, cancelled_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insert = (spec, date, minutes) => {
      const s = services.get(spec.serviceId);
      insAppt.run(spec.n, userIds.get(spec.client), spec.masterId, spec.serviceId,
        stamp(date, minutes), stamp(date, minutes + s.duration_min), s.duration_min, s.price,
        spec.status, spec.cancelledBy || null, createdAt, createdAt);
      created++;
    };

    // Сначала записи с фиксированной датой, затем «ближайшая» — в свободное от них время
    for (const spec of DEMO_APPOINTMENTS) {
      if (spec.when.type === 'soonest') continue;
      const date = spec.when.type === 'prev' ? prevWeekday(today, spec.when.weekday) : nextWeekday(today, spec.when.weekday, spec.when.minDays);
      insert(spec, date, toMin(spec.time));
    }
    for (const spec of DEMO_APPOINTMENTS) {
      if (spec.when.type !== 'soonest') continue;
      const slot = findSoonestSlot(db, spec.masterId, services.get(spec.serviceId).duration_min);
      if (!slot) {
        messages.push(`[seed] ВНИМАНИЕ: демо-запись #${spec.n} не создана — у мастера нет свободного времени в ближайшие ${BOOKING_DAYS} дней`);
        continue;
      }
      insert(spec, slot.date, slot.minutes);
      const where = `${slot.date} ${fromMin(slot.minutes)} (через ${slot.hoursAhead.toFixed(1)} ч)`;
      messages.push(slot.hoursAhead < 24
        ? `[seed] демо-запись #${spec.n} (меньше 24 ч до визита): ${where}`
        : `[seed] демо-запись #${spec.n}: в ближайшие 24 ч у мастера нет рабочего времени — поставлена на ближайшее рабочее время ${where}`);
    }
  });
  messages.forEach((m) => log(m));
  log(`[seed] демо-клиенты: ${DEMO_CLIENTS.length}, демо-записи: ${created}`);
}

async function runSeed(db, env = process.env, log = console.log) {
  seedCatalog(db, log);
  await seedAdmin(db, env, log);
  await seedDemo(db, env, log);
}

module.exports = { runSeed };
