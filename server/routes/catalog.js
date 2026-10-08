// Каталог и свободное время: салон, услуги, опция дизайна, мастера, даты и слоты.
// Открыто всем — персональных данных здесь нет. Неактивные услуги и мастера не показываются.

const express = require('express');
const { SALON } = require('../salon');
const { ApiError } = require('../http');
const {
  NAILS, parseNails, designOptionRow, activeService, resolveVisit, checkDate, calcSlots, availableDates,
} = require('../slots');

const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// { 2: ['10:00', '18:00'], … } → «вт–пт · 10:00–18:00»
function scheduleText(schedule) {
  const days = WEEK_ORDER.filter((d) => schedule[d]);
  if (!days.length) return 'график не задан';
  const groups = [];
  for (const d of days) {
    const key = schedule[d].join('–');
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(d); else groups.push({ key, days: [d] });
  }
  return groups.map((g) => {
    const idx = g.days.map((d) => WEEK_ORDER.indexOf(d));
    const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    const daysText = consecutive && g.days.length > 2
      ? `${WD_SHORT[g.days[0]]}–${WD_SHORT[g.days[g.days.length - 1]]}`
      : g.days.map((d) => WD_SHORT[d]).join(', ');
    return `${daysText} · ${g.key}`;
  }).join('; ');
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}

function serviceView(s) {
  return { id: s.id, name: s.name, duration: s.duration_min, price: s.price, isNail: Boolean(s.is_nail), active: Boolean(s.is_active) };
}

function masterView(db, m) {
  const schedule = {};
  for (const r of db.prepare('SELECT weekday, start_time, end_time FROM master_schedule WHERE master_id = ? ORDER BY weekday').all(m.id)) {
    schedule[r.weekday] = [r.start_time, r.end_time];
  }
  const services = db.prepare(`SELECT s.id, s.name FROM master_services ms JOIN services s ON s.id = ms.service_id
    WHERE ms.master_id = ? AND s.is_active = 1 ORDER BY s.id`).all(m.id);
  return {
    id: m.id,
    name: m.name,
    initials: initials(m.name),
    role: m.specialization,
    serviceIds: services.map((s) => s.id),
    serviceNames: services.map((s) => s.name),
    doesDesign: Boolean(m.does_design),
    active: Boolean(m.is_active),
    schedule,
    scheduleText: scheduleText(schedule),
  };
}

function designOptionView(db) {
  const o = designOptionRow(db);
  const designers = db.prepare('SELECT name FROM masters WHERE is_active = 1 AND does_design = 1 ORDER BY id').all();
  return {
    name: o.name,
    pricePerTwoNails: o.price_per_two_nails,
    nails: NAILS,
    extraMinutes: [
      { maxNails: 4, minutes: o.extra_min_2_4 },
      { maxNails: 10, minutes: o.extra_min_6_10 },
    ],
    designers: designers.map((d) => d.name),
  };
}

function catalogRouter(db) {
  const router = express.Router();

  router.get('/salon', (req, res) => res.json(SALON));

  router.get('/services', (req, res) => {
    res.json(db.prepare('SELECT * FROM services WHERE is_active = 1 ORDER BY id').all().map(serviceView));
  });

  router.get('/design-option', (req, res) => res.json(designOptionView(db)));

  // Без параметров — все активные мастера; с serviceId — выполняющие услугу; с designNails — и дизайн
  router.get('/masters', (req, res) => {
    const { serviceId, designNails } = req.query;
    let service = null;
    if (serviceId !== undefined) service = activeService(db, serviceId);
    const nails = parseNails(designNails);
    if (nails && !service) throw new ApiError(400, 'VALIDATION', 'Укажите услугу');
    if (nails && !service.is_nail) throw new ApiError(400, 'VALIDATION', 'Дизайн ногтей доступен только к ногтевым услугам');

    let sql = 'SELECT m.* FROM masters m WHERE m.is_active = 1';
    const params = [];
    if (service) { sql += ' AND EXISTS (SELECT 1 FROM master_services ms WHERE ms.master_id = m.id AND ms.service_id = ?)'; params.push(service.id); }
    if (nails) sql += ' AND m.does_design = 1';
    res.json(db.prepare(`${sql} ORDER BY m.id`).all(...params).map((m) => masterView(db, m)));
  });

  router.get('/available-dates', (req, res) => {
    const visit = resolveVisit(db, req.query);
    res.json(availableDates(db, { masterId: visit.master.id, duration: visit.duration }));
  });

  router.get('/slots', (req, res) => {
    const visit = resolveVisit(db, req.query);
    checkDate(req.query.date);
    res.json(calcSlots(db, { masterId: visit.master.id, date: req.query.date, duration: visit.duration }));
  });

  return router;
}

module.exports = { catalogRouter };
