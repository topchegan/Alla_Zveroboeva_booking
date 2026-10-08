// Записи: выборка и формат, который ждут страницы (как appointmentView в public/js/api.js).

const { DAY_MS, fromMin, toMin, mskToEpoch } = require('./time');
const { CHANGE_LIMIT_HOURS } = require('./salon');
const { designMinutes, designPrice, designOptionRow } = require('./slots');

const CHANGE_LIMIT_MS = CHANGE_LIMIT_HOURS * DAY_MS / 24; // клиент может отменить или перенести не позже чем за 24 ч

const SELECT_VIEW = `SELECT a.*, s.name AS service_name, m.name AS master_name, u.name AS client_name
  FROM appointments a
  JOIN services s ON s.id = a.service_id
  JOIN masters m ON m.id = a.master_id
  JOIN users u ON u.id = a.client_id`;

// До начала визита не меньше 24 ч
function clientCanChange(row) {
  return mskToEpoch(row.start_at) - Date.now() >= CHANGE_LIMIT_MS;
}

// row — appointments + service_name, master_name, client_name; option — строка design_option
function appointmentView(row, option, forClient) {
  const date = row.start_at.slice(0, 10);
  const time = row.start_at.slice(11, 16);
  const start = mskToEpoch(row.start_at);
  const now = Date.now();
  const startsIn = start - now;
  const nails = row.design_nails || null;
  return {
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

module.exports = { appointmentView, listClientAppointments, findClientAppointment, clientAppointmentView, clientCanChange };
