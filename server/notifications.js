// Уведомления клиенту в личном кабинете (без email/SMS): перенос и отмена записи администратором.
// Создаются в той же транзакции, что и изменение записи. Клиент видит и читает только свои.

const { weekdayOf } = require('./time');

const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MN_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// 'YYYY-MM-DD HH:MM' ×2 → 'чт 15 окт 15:00–16:00'
function fmtInterval(startAt, endAt) {
  const date = startAt.slice(0, 10);
  const [, m, d] = date.split('-').map(Number);
  return `${WD_SHORT[weekdayOf(date)]} ${d} ${MN_SHORT[m - 1]} ${startAt.slice(11, 16)}–${endAt.slice(11, 16)}`;
}

// «к кому»: женские имя и фамилия из справочника — в дательном падеже («к Елене Смирновой»);
// для остальных имён склонение не угадываем — «к мастеру Имя Фамилия»
function toMaster(name) {
  const words = String(name).trim().split(/\s+/);
  const first = words[0] || '';
  const last = words[1] || '';
  let firstDat = null;
  if (/ия$/.test(first)) firstDat = first.replace(/ия$/, 'ии');
  else if (/ья$/.test(first)) firstDat = first.replace(/ья$/, 'ье');
  else if (/[^аеёиоуыэюя]а$/.test(first)) firstDat = first.replace(/а$/, 'е');
  const lastDat = /(ова|ева|ёва|ина|ына)$/.test(last) ? last.replace(/а$/, 'ой')
    : /ая$/.test(last) ? last.replace(/ая$/, 'ой') : null;
  if (words.length === 2 && firstDat && lastDat) return `к ${firstDat} ${lastDat}`;
  return `к мастеру ${name}`;
}

function rescheduleText(row, newStart, newEnd) {
  return `Администратор перенёс вашу запись «${row.service_name}» ${toMaster(row.master_name)}: ` +
    `было ${fmtInterval(row.start_at, row.end_at)}, стало ${fmtInterval(newStart, newEnd)}`;
}

function cancelText(row) {
  return `Администратор отменил вашу запись «${row.service_name}» ${toMaster(row.master_name)} ` +
    `на ${fmtInterval(row.start_at, row.end_at)}`;
}

// row — запись с service_name и master_name (SELECT_VIEW) в состоянии до изменения
function notifyRescheduled(db, row, newStart, newEnd) {
  db.prepare(`INSERT INTO notifications
    (client_id, appointment_id, kind, text, old_start_at, old_end_at, new_start_at, new_end_at, created_at)
    VALUES (?, ?, 'rescheduled', ?, ?, ?, ?, ?, ?)`)
    .run(row.client_id, row.id, rescheduleText(row, newStart, newEnd), row.start_at, row.end_at, newStart, newEnd,
      new Date().toISOString());
}

function notifyCancelled(db, row) {
  db.prepare(`INSERT INTO notifications
    (client_id, appointment_id, kind, text, old_start_at, old_end_at, created_at)
    VALUES (?, ?, 'cancelled', ?, ?, ?, ?)`)
    .run(row.client_id, row.id, cancelText(row), row.start_at, row.end_at, new Date().toISOString());
}

function notificationView(n) {
  return {
    id: n.id,
    appointmentId: n.appointment_id,
    kind: n.kind,
    text: n.text,
    oldStartAt: n.old_start_at,
    oldEndAt: n.old_end_at,
    newStartAt: n.new_start_at,
    newEndAt: n.new_end_at,
    createdAt: n.created_at,
    isRead: n.read_at !== null,
  };
}

// Только уведомления этого клиента, сначала новые
function listNotifications(db, clientId) {
  return db.prepare('SELECT * FROM notifications WHERE client_id = ? ORDER BY created_at DESC, id DESC')
    .all(clientId).map(notificationView);
}

function unreadCount(db, clientId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE client_id = ? AND read_at IS NULL').get(clientId).n;
}

// Отметить прочитанными свои уведомления из ids; чужие и несуществующие id не затрагиваются.
// Возвращает число отмеченных.
function markRead(db, clientId, ids) {
  const stmt = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND client_id = ? AND read_at IS NULL');
  const now = new Date().toISOString();
  let n = 0;
  for (const id of ids) n += Number(stmt.run(now, id, clientId).changes);
  return n;
}

// Своё уведомление по id или null — чужое и несуществующее неотличимы
function findNotification(db, id, clientId) {
  return db.prepare('SELECT * FROM notifications WHERE id = ? AND client_id = ?').get(id, clientId) || null;
}

module.exports = {
  fmtInterval, toMaster, notifyRescheduled, notifyCancelled, notificationView,
  listNotifications, unreadCount, markRead, findNotification,
};
