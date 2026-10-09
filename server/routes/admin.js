// /api/admin: админ-панель — записи, услуги, опция дизайна, мастера, блокировки.
// Подключается за requireAdmin (server.js): гость → 401, клиент → 403 FORBIDDEN.
// Администратор отменяет и переносит записи без правила 24 ч, но не начавшиеся и не прошедшие визиты.

const express = require('express');
const { transaction } = require('../db');
const { ApiError } = require('../http');
const { toMin, mskNow, stamp, weekdayOf } = require('../time');
const { SALON_WEEKDAYS, SALON_OPEN, SALON_CLOSE } = require('../salon');
const { isDate, isTime, parseId, checkDate, calcSlots, availableDates, designOptionRow } = require('../slots');
const {
  SELECT_VIEW, checkDateTime, isStarted, findAppointment, adminAppointmentView, listAllAppointments,
  moveAppointment, cancelAppointment, appointmentView,
} = require('../appointments');
const { serviceView, masterView, designOptionView } = require('./catalog');

const ON_DAY = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
const MAX_NAME = 100;

const invalid = (message) => new ApiError(400, 'VALIDATION', message);
const notFound = (message) => new ApiError(404, 'NOT_FOUND', message);

/* ---------- Проверка полей ---------- */

function text(v, field, required = true) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw invalid(`Заполните поле «${field}»`);
  if (s.length > MAX_NAME) throw invalid(`Поле «${field}» слишком длинное`);
  return s;
}
// Целое число > 0 (число или строка из цифр), не больше max
function positiveInt(v, field, max) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN);
  if (!Number.isSafeInteger(n) || n <= 0) throw invalid(`«${field}» — целое число больше нуля`);
  if (n > max) throw invalid(`«${field}» — не больше ${max}`);
  return n;
}
function flag(v, field) {
  if (typeof v !== 'boolean') throw invalid(`Не указано «${field}»`);
  return v ? 1 : 0;
}

// «1 будущая запись — она сохранится», «3 будущие записи — они сохранятся», «5 будущих записей — …»
function futureText(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} будущая запись — она сохранится, при необходимости отмените или перенесите её`;
  const noun = m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'будущие записи' : 'будущих записей';
  return `${n} ${noun} — они сохранятся, при необходимости отмените или перенесите их`;
}

function nowStamp() {
  const now = mskNow();
  return stamp(now.date, now.minutes);
}

/* ---------- Услуги ---------- */

function readService(body) {
  return {
    name: text(body.name, 'Название'),
    duration: positiveInt(body.duration, 'Длительность', 600),
    price: positiveInt(body.price, 'Цена', 1000000),
    isNail: flag(body.isNail, 'Ногтевая услуга'),
  };
}

function readDesignOption(body) {
  return {
    pricePerTwoNails: positiveInt(body.pricePerTwoNails, 'Цена за 2 ногтя', 100000),
    extraMin24: positiveInt(body.extraMin24, 'Минуты для 2–4 ногтей', 240),
    extraMin610: positiveInt(body.extraMin610, 'Минуты для 6–10 ногтей', 240),
  };
}

/* ---------- Мастера ---------- */

// schedule: { "2": ["10:00", "18:00"], … } — только рабочие дни
function readSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw invalid('Укажите график работы');
  const out = [];
  for (const [key, hours] of Object.entries(schedule)) {
    const weekday = /^[0-6]$/.test(key) ? Number(key) : NaN;
    if (Number.isNaN(weekday)) throw invalid('Неверный день недели в графике');
    if (!SALON_WEEKDAYS.includes(weekday)) {
      throw invalid('Салон работает со вторника по субботу: понедельник и воскресенье не могут быть рабочими днями мастера');
    }
    if (!Array.isArray(hours) || hours.length !== 2 || !isTime(hours[0]) || !isTime(hours[1])) {
      throw invalid(`Укажите время работы ${ON_DAY[weekday]} в формате ЧЧ:ММ`);
    }
    const [start, end] = hours;
    if (toMin(start) >= toMin(end)) throw invalid(`${ON_DAY[weekday][0].toUpperCase()}${ON_DAY[weekday].slice(1)} начало смены должно быть раньше конца`);
    if (toMin(start) < toMin(SALON_OPEN) || toMin(end) > toMin(SALON_CLOSE)) {
      throw invalid(`Смена ${ON_DAY[weekday]} должна быть в часы работы салона: ${SALON_OPEN}–${SALON_CLOSE}`);
    }
    out.push({ weekday, start, end });
  }
  if (!out.length) throw invalid('Отметьте хотя бы один рабочий день');
  return out;
}

function readMaster(db, body) {
  const name = text(body.name, 'Имя');
  const specialization = text(body.specialization, 'Специализация');
  if (!Array.isArray(body.serviceIds) || !body.serviceIds.length) throw invalid('Выберите хотя бы одну услугу мастера');
  const serviceIds = [...new Set(body.serviceIds.map(parseId))];
  const services = serviceIds.map((id) => id && db.prepare('SELECT id, is_nail FROM services WHERE id = ?').get(id));
  if (services.some((s) => !s)) throw invalid('Среди услуг мастера есть несуществующая');
  const doesDesign = flag(body.doesDesign, 'Дизайн ногтей');
  if (doesDesign && !services.some((s) => s.is_nail)) {
    throw invalid('Дизайн ногтей выполняется только вместе с ногтевой услугой — отметьте хотя бы одну');
  }
  return { name, specialization, serviceIds, doesDesign, schedule: readSchedule(body.schedule) };
}

function saveMasterLinks(db, masterId, data) {
  db.prepare('DELETE FROM master_services WHERE master_id = ?').run(masterId);
  db.prepare('DELETE FROM master_schedule WHERE master_id = ?').run(masterId);
  const insMS = db.prepare('INSERT INTO master_services (master_id, service_id) VALUES (?, ?)');
  for (const sid of data.serviceIds) insMS.run(masterId, sid);
  const insSchedule = db.prepare('INSERT INTO master_schedule (master_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
  for (const d of data.schedule) insSchedule.run(masterId, d.weekday, d.start, d.end);
}

/* ---------- Блокировки ---------- */

function blockView(b) {
  return {
    id: b.id,
    masterId: b.master_id,
    masterName: b.master_name,
    weekday: b.weekday,
    allDay: Boolean(b.all_day),
    from: b.start_time,
    to: b.end_time,
    reason: b.reason,
  };
}

const SELECT_BLOCK = 'SELECT b.*, m.name AS master_name FROM blocks b JOIN masters m ON m.id = b.master_id';

function readBlock(db, body) {
  const masterId = parseId(body.masterId);
  if (!masterId || !db.prepare('SELECT 1 FROM masters WHERE id = ?').get(masterId)) throw invalid('Выберите мастера');
  const weekday = typeof body.weekday === 'number' ? body.weekday : (/^[0-6]$/.test(String(body.weekday)) ? Number(body.weekday) : NaN);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw invalid('Выберите день недели');
  const allDay = flag(body.allDay, 'Весь день');
  let from = null, to = null;
  if (!allDay) {
    if (!isTime(body.from) || !isTime(body.to)) throw invalid('Укажите время блокировки в формате ЧЧ:ММ');
    if (toMin(body.from) >= toMin(body.to)) throw invalid('Начало блокировки должно быть раньше конца');
    from = body.from; to = body.to;
  }
  return { masterId, weekday, allDay, from, to, reason: text(body.reason, 'Причина', false) };
}

// Будущие действующие записи мастера, которые попадают на блокировку
function blockConflicts(db, block) {
  const option = designOptionRow(db);
  const rows = db.prepare(`${SELECT_VIEW}
    WHERE a.master_id = ? AND a.status = 'active' AND a.start_at > ? ORDER BY a.start_at, a.id`).all(block.masterId, nowStamp());
  return rows.filter((a) => {
    if (weekdayOf(a.start_at.slice(0, 10)) !== block.weekday) return false;
    if (block.allDay) return true;
    const start = toMin(a.start_at.slice(11, 16));
    return start < toMin(block.to) && start + a.duration_min > toMin(block.from);
  }).map((r) => appointmentView(r, option, false));
}

/* ---------- Маршруты ---------- */

function adminRouter(db) {
  const router = express.Router();

  const futureCount = (column, id) => db.prepare(
    `SELECT COUNT(*) AS n FROM appointments WHERE ${column} = ? AND status = 'active' AND start_at > ?`,
  ).get(id, nowStamp()).n;

  /* ===== Записи ===== */

  router.get('/appointments', (req, res) => {
    const { date, masterId, status, order } = req.query;
    if (date && !isDate(date)) throw invalid('Укажите дату в формате ГГГГ-ММ-ДД');
    const mid = masterId ? parseId(masterId) : null;
    if (masterId && !mid) throw invalid('Неверный мастер');
    if (status && status !== 'active' && status !== 'cancelled') throw invalid('Неверный статус');
    if (order && order !== 'asc' && order !== 'desc') throw invalid('Неверная сортировка');
    res.json(listAllAppointments(db, { date, masterId: mid, status }, order));
  });

  function anyAppointment(req) {
    const id = parseId(req.params.id);
    const row = id && findAppointment(db, id);
    if (!row) throw notFound('Запись не найдена');
    return row;
  }
  function checkAdminChangeable(row, action) {
    if (row.status === 'cancelled') throw new ApiError(409, 'ALREADY_CANCELLED', 'Запись уже отменена');
    if (isStarted(row)) throw new ApiError(409, 'TOO_LATE', `${action} нельзя: визит уже начался или прошёл`);
  }

  router.post('/appointments/:id/cancel', (req, res) => {
    const row = anyAppointment(req);
    checkAdminChangeable(row, 'Отменить');
    cancelAppointment(db, row.id, 'admin');
    res.json(adminAppointmentView(db, row.id));
  });

  router.get('/appointments/:id/available-dates', (req, res) => {
    const row = anyAppointment(req);
    res.json(availableDates(db, { masterId: row.master_id, duration: row.duration_min, excludeId: row.id }));
  });

  router.get('/appointments/:id/slots', (req, res) => {
    const row = anyAppointment(req);
    checkDate(req.query.date);
    res.json(calcSlots(db, { masterId: row.master_id, date: req.query.date, duration: row.duration_min, excludeId: row.id }));
  });

  router.post('/appointments/:id/reschedule', (req, res) => {
    checkAdminChangeable(anyAppointment(req), 'Перенести');
    const body = req.body || {};
    checkDateTime(body);
    moveAppointment(db, {
      load: () => anyAppointment(req),
      check: (row) => checkAdminChangeable(row, 'Перенести'),
      date: body.date,
      time: body.time,
    });
    res.json(adminAppointmentView(db, parseId(req.params.id)));
  });

  /* ===== Услуги ===== */

  function serviceById(req) {
    const id = parseId(req.params.id);
    const row = id && db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!row) throw notFound('Услуга не найдена');
    return row;
  }

  router.get('/services', (req, res) => {
    res.json(db.prepare('SELECT * FROM services ORDER BY id').all().map(serviceView));
  });

  router.post('/services', (req, res) => {
    const d = readService(req.body || {});
    const id = Number(db.prepare('INSERT INTO services (name, duration_min, price, is_nail, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(d.name, d.duration, d.price, d.isNail).lastInsertRowid);
    res.status(201).json(serviceView(db.prepare('SELECT * FROM services WHERE id = ?').get(id)));
  });

  // Цена и длительность уже созданных записей не меняются: они хранятся в самих записях
  router.put('/services/:id', (req, res) => {
    const row = serviceById(req);
    const d = readService(req.body || {});
    db.prepare('UPDATE services SET name = ?, duration_min = ?, price = ?, is_nail = ? WHERE id = ?')
      .run(d.name, d.duration, d.price, d.isNail, row.id);
    res.json(serviceView(db.prepare('SELECT * FROM services WHERE id = ?').get(row.id)));
  });

  // Отключение не отменяет записи; про будущие записи — предупреждение
  router.post('/services/:id/active', (req, res) => {
    const row = serviceById(req);
    const active = flag((req.body || {}).active, 'Доступна при записи');
    db.prepare('UPDATE services SET is_active = ? WHERE id = ?').run(active, row.id);
    const future = active ? 0 : futureCount('service_id', row.id);
    res.json({
      service: serviceView(db.prepare('SELECT * FROM services WHERE id = ?').get(row.id)),
      futureCount: future,
      warning: future ? `У услуги ${futureText(future)}` : null,
    });
  });

  router.get('/design-option', (req, res) => res.json(designOptionView(db)));

  router.put('/design-option', (req, res) => {
    const d = readDesignOption(req.body || {});
    db.prepare('UPDATE design_option SET price_per_two_nails = ?, extra_min_2_4 = ?, extra_min_6_10 = ? WHERE id = 1')
      .run(d.pricePerTwoNails, d.extraMin24, d.extraMin610);
    res.json(designOptionView(db));
  });

  /* ===== Мастера ===== */

  function masterById(req) {
    const id = parseId(req.params.id);
    const row = id && db.prepare('SELECT * FROM masters WHERE id = ?').get(id);
    if (!row) throw notFound('Мастер не найден');
    return row;
  }
  const masterOut = (id) => masterView(db, db.prepare('SELECT * FROM masters WHERE id = ?').get(id), true);

  router.get('/masters', (req, res) => {
    res.json(db.prepare('SELECT * FROM masters ORDER BY id').all().map((m) => masterView(db, m, true)));
  });

  router.post('/masters', (req, res) => {
    const d = readMaster(db, req.body || {});
    const id = transaction(db, () => {
      const newId = Number(db.prepare('INSERT INTO masters (name, specialization, does_design, is_active) VALUES (?, ?, ?, 1)')
        .run(d.name, d.specialization, d.doesDesign).lastInsertRowid);
      saveMasterLinks(db, newId, d);
      return newId;
    });
    res.status(201).json(masterOut(id));
  });

  // Новый график сразу меняет свободное время; уже созданные записи не трогаются
  router.put('/masters/:id', (req, res) => {
    const row = masterById(req);
    const d = readMaster(db, req.body || {});
    transaction(db, () => {
      db.prepare('UPDATE masters SET name = ?, specialization = ?, does_design = ? WHERE id = ?')
        .run(d.name, d.specialization, d.doesDesign, row.id);
      saveMasterLinks(db, row.id, d);
    });
    res.json(masterOut(row.id));
  });

  router.post('/masters/:id/active', (req, res) => {
    const row = masterById(req);
    const active = flag((req.body || {}).active, 'Доступен при записи');
    db.prepare('UPDATE masters SET is_active = ? WHERE id = ?').run(active, row.id);
    const future = active ? 0 : futureCount('master_id', row.id);
    res.json({
      master: masterOut(row.id),
      futureCount: future,
      warning: future ? `У мастера ${futureText(future)}` : null,
    });
  });

  /* ===== Блокировки ===== */

  router.get('/blocks', (req, res) => {
    res.json(db.prepare(`${SELECT_BLOCK} ORDER BY b.master_id, b.weekday, b.all_day DESC, b.start_time, b.id`).all().map(blockView));
  });

  // Блокировка добавляется, даже если на это время есть записи: они не отменяются, админ видит их список
  router.post('/blocks', (req, res) => {
    const d = readBlock(db, req.body || {});
    const id = Number(db.prepare('INSERT INTO blocks (master_id, weekday, all_day, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(d.masterId, d.weekday, d.allDay, d.from, d.to, d.reason).lastInsertRowid);
    const conflicts = blockConflicts(db, d);
    res.status(201).json({
      block: blockView(db.prepare(`${SELECT_BLOCK} WHERE b.id = ?`).get(id)),
      conflicts,
      warning: conflicts.length
        ? `Блокировка пересекается с записями: ${futureText(conflicts.length)}`
        : null,
    });
  });

  router.delete('/blocks/:id', (req, res) => {
    const id = parseId(req.params.id);
    const row = id && db.prepare('SELECT id FROM blocks WHERE id = ?').get(id);
    if (!row) throw notFound('Блокировка не найдена');
    db.prepare('DELETE FROM blocks WHERE id = ?').run(row.id);
    res.json({ id: row.id });
  });

  return router;
}

module.exports = { adminRouter };
