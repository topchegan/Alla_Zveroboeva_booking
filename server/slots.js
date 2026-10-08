// Расчёт свободного времени — единственное место на сервере.
// Используется выдачей слотов, созданием записи и переносом (CLAUDE.md, п. 8).

const { ApiError } = require('./http');
const { SLOT_STEP, BOOKING_DAYS } = require('./salon');
const { toMin, fromMin, mskNow, addDays, weekdayOf, mskToEpoch } = require('./time');

const NAILS = [2, 4, 6, 8, 10];

const invalid = (message) => new ApiError(400, 'VALIDATION', message);

function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s; }
function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

// id из запроса (строка или число) → целое > 0 или null
function parseId(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
// Число ногтей: пусто / 0 / null → 0; иначе одно из NAILS, либо ошибка
function parseNails(v) {
  if (v === undefined || v === null || v === '' || v === 0 || v === '0') return 0;
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);
  if (!NAILS.includes(n)) throw invalid('Неверное число ногтей: допустимо 2, 4, 6, 8 или 10');
  return n;
}

function designOptionRow(db) {
  return db.prepare('SELECT * FROM design_option WHERE id = 1').get();
}
function designMinutes(nails, option) {
  if (!nails) return 0;
  return nails <= 4 ? option.extra_min_2_4 : option.extra_min_6_10;
}
function designPrice(nails, option) {
  return nails ? (nails / 2) * option.price_per_two_nails : 0;
}

// Активная услуга по id, иначе VALIDATION
function activeService(db, serviceId) {
  const id = parseId(serviceId);
  const service = id && db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!service || !service.is_active) throw invalid('Услуга недоступна');
  return service;
}

// Проверка визита: услуга, мастер, дизайн. Цена и длительность — только отсюда.
function resolveVisit(db, { serviceId, masterId, designNails }) {
  const service = activeService(db, serviceId);
  const nails = parseNails(designNails);
  const mid = parseId(masterId);
  const master = mid && db.prepare('SELECT * FROM masters WHERE id = ?').get(mid);
  if (!master || !master.is_active) throw invalid('Мастер недоступен');
  if (!db.prepare('SELECT 1 FROM master_services WHERE master_id = ? AND service_id = ?').get(master.id, service.id)) {
    throw invalid('Мастер не выполняет эту услугу');
  }
  const option = designOptionRow(db);
  if (nails) {
    if (!service.is_nail) throw invalid('Дизайн ногтей доступен только к ногтевым услугам');
    if (!master.does_design) throw invalid('Мастер не выполняет дизайн ногтей');
  }
  return {
    service, master, nails,
    duration: service.duration_min + designMinutes(nails, option),
    price: service.price + designPrice(nails, option),
  };
}

// Дата в окне записи: сегодня … сегодня + 29 дней (по Москве)
function checkDate(date) {
  if (!isDate(date)) throw invalid('Укажите дату в формате ГГГГ-ММ-ДД');
  const today = mskNow().date;
  if (date < today || date > addDays(today, BOOKING_DAYS - 1)) {
    throw invalid(`Запись открыта на ${BOOKING_DAYS} дней вперёд`);
  }
}

// Рабочий ли день: есть график и нет блокировки на весь день
function workingHours(db, masterId, weekday) {
  const hours = db.prepare('SELECT start_time, end_time FROM master_schedule WHERE master_id = ? AND weekday = ?').get(masterId, weekday);
  if (!hours) return null;
  const allDay = db.prepare('SELECT 1 FROM blocks WHERE master_id = ? AND weekday = ? AND all_day = 1').get(masterId, weekday);
  return allDay ? null : hours;
}

// Свободные начала визита длительностью duration минут у мастера на дату.
// Учитываются: график, еженедельные блокировки, действующие записи мастера
// (кроме excludeId — переносимой записи), конец смены, прошедшее время сегодня.
function calcSlots(db, { masterId, date, duration, excludeId = null }) {
  const now = mskNow();
  if (date < now.date) return [];
  const weekday = weekdayOf(date);
  const hours = workingHours(db, masterId, weekday);
  if (!hours) return [];

  const busy = db.prepare('SELECT start_time, end_time FROM blocks WHERE master_id = ? AND weekday = ? AND all_day = 0')
    .all(masterId, weekday)
    .map((b) => [toMin(b.start_time), toMin(b.end_time)]);

  // Записи, задевающие этот день; интервалы — в минутах от полуночи даты
  const dayStart = `${date} 00:00`;
  const dayEnd = `${addDays(date, 1)} 00:00`;
  const base = mskToEpoch(dayStart);
  const appts = db.prepare(`SELECT id, start_at, end_at FROM appointments
    WHERE master_id = ? AND status = 'active' AND start_at < ? AND end_at > ?`).all(masterId, dayEnd, dayStart);
  for (const a of appts) {
    if (excludeId && a.id === excludeId) continue;
    busy.push([(mskToEpoch(a.start_at) - base) / 60000, (mskToEpoch(a.end_at) - base) / 60000]);
  }

  const out = [];
  const end = toMin(hours.end_time);
  for (let t = toMin(hours.start_time); t + duration <= end; t += SLOT_STEP) {
    if (date === now.date && t <= now.minutes) continue;
    if (busy.some(([from, to]) => t < to && t + duration > from)) continue;
    out.push(fromMin(t));
  }
  return out;
}

// Лента дат на 30 дней: working — рабочий день мастера, hasSlots — есть свободное время
function availableDates(db, { masterId, duration, excludeId = null }) {
  const today = mskNow().date;
  const out = [];
  for (let i = 0; i < BOOKING_DAYS; i++) {
    const date = addDays(today, i);
    const weekday = weekdayOf(date);
    const working = Boolean(workingHours(db, masterId, weekday));
    out.push({ date, weekday, working, hasSlots: working && calcSlots(db, { masterId, date, duration, excludeId }).length > 0 });
  }
  return out;
}

module.exports = {
  NAILS, isDate, isTime, parseId, parseNails, designOptionRow, designMinutes, designPrice,
  activeService, resolveVisit, checkDate, calcSlots, availableDates,
};
