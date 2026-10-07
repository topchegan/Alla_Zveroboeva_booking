// Запись в формате, который ждут страницы (как appointmentView в public/js/api.js).

const { DAY_MS, fromMin, toMin, mskToEpoch } = require('./time');

const CHANGE_LIMIT_MS = DAY_MS; // клиент может отменить или перенести не позже чем за 24 ч

function designMinutes(nails, option) {
  if (!nails) return 0;
  return nails <= 4 ? option.extra_min_2_4 : option.extra_min_6_10;
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
    designPrice: nails ? (nails / 2) * option.price_per_two_nails : 0,
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
  const option = db.prepare('SELECT * FROM design_option WHERE id = 1').get();
  const rows = db.prepare(`SELECT a.*, s.name AS service_name, m.name AS master_name, u.name AS client_name
    FROM appointments a
    JOIN services s ON s.id = a.service_id
    JOIN masters m ON m.id = a.master_id
    JOIN users u ON u.id = a.client_id
    WHERE a.client_id = ?
    ORDER BY a.start_at, a.id`).all(clientId);
  return rows.map((r) => appointmentView(r, option, true));
}

module.exports = { appointmentView, listClientAppointments };
