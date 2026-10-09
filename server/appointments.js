// Записи: выборка, формат для страниц и перенос — общий для клиента и администратора.

const { transaction } = require('./db');
const { ApiError } = require('./http');
const { DAY_MS, fromMin, toMin, mskToEpoch, stamp } = require('./time');
const { CHANGE_LIMIT_HOURS } = require('./salon');
const { isTime, checkDate, calcSlots, designMinutes, designPrice, designOptionRow } = require('./slots');

const CHANGE_LIMIT_MS = CHANGE_LIMIT_HOURS * DAY_MS / 24; // клиент может отменить или перенести не позже чем за 24 ч

const SELECT_VIEW = `SELECT a.*, s.name AS service_name, m.name AS master_name, u.name AS client_name, u.email AS client_email
  FROM appointments a
  JOIN services s ON s.id = a.service_id
  JOIN masters m ON m.id = a.master_id
  JOIN users u ON u.id = a.client_id`;

const slotTaken = () => new ApiError(409, 'SLOT_TAKEN', 'Это время уже заняли, выберите другое.');

// Нарушение уникального индекса «у мастера одно действующее начало» → SLOT_TAKEN
function isUniqueError(err) {
  return /UNIQUE constraint failed/i.test(String(err && err.message));
}

function checkDateTime(body) {
  checkDate(body.date);
  if (!isTime(body.time)) throw new ApiError(400, 'VALIDATION', 'Укажите время в формате ЧЧ:ММ');
}

// До начала визита не меньше 24 ч
function clientCanChange(row) {
  return mskToEpoch(row.start_at) - Date.now() >= CHANGE_LIMIT_MS;
}

// Визит уже начался или прошёл
function isStarted(row) {
  return mskToEpoch(row.start_at) <= Date.now();
}

// row — appointments + service_name, master_name, client_name, client_email; option — строка design_option.
// forClient: canChange по правилу 24 ч; иначе (админ) — любая будущая действующая запись, и есть clientEmail.
function appointmentView(row, option, forClient) {
  const date = row.start_at.slice(0, 10);
  const time = row.start_at.slice(11, 16);
  const start = mskToEpoch(row.start_at);
  const now = Date.now();
  const startsIn = start - now;
  const nails = row.design_nails || null;
  const view = {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    masterId: row.master_id,
    masterName: row.master_name,
    date,
    time,
    endTime: fromMin((toMin(time) + row.duration_min) % 1440),
    duration: row.duration_min,
    designNails: nails,
    designPrice: designPrice(nails, option),
    designMinutes: designMinutes(nails, option),
    price: row.price,
    status: row.status,
    cancelledBy: row.cancelled_by,
    isPast: start + row.duration_min * 60000 <= now,
    isStarted: startsIn <= 0,
    canChange: row.status === 'active' && (forClient ? startsIn >= CHANGE_LIMIT_MS : startsIn > 0),
  };
  if (!forClient) view.clientEmail = row.client_email;
  return view;
}

function listClientAppointments(db, clientId) {
  const option = designOptionRow(db);
  const rows = db.prepare(`${SELECT_VIEW} WHERE a.client_id = ? ORDER BY a.start_at, a.id`).all(clientId);
  return rows.map((r) => appointmentView(r, option, true));
}

// Запись клиента по id (с названиями) или null — чужая и несуществующая неотличимы
function findClientAppointment(db, id, clientId) {
  return db.prepare(`${SELECT_VIEW} WHERE a.id = ? AND a.client_id = ?`).get(id, clientId) || null;
}

function clientAppointmentView(db, id, clientId) {
  const row = findClientAppointment(db, id, clientId);
  return row ? appointmentView(row, designOptionRow(db), true) : null;
}

// Любая запись по id (для администратора) или null
function findAppointment(db, id) {
  return db.prepare(`${SELECT_VIEW} WHERE a.id = ?`).get(id) || null;
}

function adminAppointmentView(db, id) {
  const row = findAppointment(db, id);
  return row ? appointmentView(row, designOptionRow(db), false) : null;
}

// Все записи с фильтрами (для администратора): { date, masterId, status }, order — 'asc' | 'desc'
function listAllAppointments(db, { date, masterId, status }, order) {
  const where = [];
  const params = [];
  if (date) { where.push('a.start_at >= ? AND a.start_at < ?'); params.push(`${date} 00:00`, `${date} 24:00`); }
  if (masterId) { where.push('a.master_id = ?'); params.push(masterId); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  const sql = `${SELECT_VIEW}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY a.start_at ${dir}, a.id ${dir}`;
  const option = designOptionRow(db);
  return db.prepare(sql).all(...params).map((r) => appointmentView(r, option, false));
}

// Перенос записи на { date, time } — в транзакции BEGIN IMMEDIATE.
// load() заново читает запись внутри транзакции, check(row) — правила роли (24 ч для клиента и т.п.).
// Новое время проверяется той же calcSlots без учёта самой записи; меняется время той же записи.
function moveAppointment(db, { load, check, date, time }) {
  transaction(db, () => {
    const row = load();
    check(row);
    const free = calcSlots(db, { masterId: row.master_id, date, duration: row.duration_min, excludeId: row.id });
    if (!free.includes(time)) throw slotTaken();
    const start = toMin(time);
    try {
      db.prepare('UPDATE appointments SET start_at = ?, end_at = ?, updated_at = ? WHERE id = ?')
        .run(stamp(date, start), stamp(date, start + row.duration_min), new Date().toISOString(), row.id);
    } catch (err) {
      if (isUniqueError(err)) throw slotTaken();
      throw err;
    }
  });
}

// Отмена: запись не удаляется, меняется статус; время сразу снова свободно
function cancelAppointment(db, id, by) {
  db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = ?, updated_at = ? WHERE id = ? AND status = 'active'")
    .run(by, new Date().toISOString(), id);
}

module.exports = {
  SELECT_VIEW, slotTaken, isUniqueError, checkDateTime, clientCanChange, isStarted,
  appointmentView, listClientAppointments, findClientAppointment, clientAppointmentView,
  findAppointment, adminAppointmentView, listAllAppointments, moveAppointment, cancelAppointment,
};
