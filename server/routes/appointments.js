// /api/appointments: запись клиента — создание, просмотр, отмена, перенос.
// Только свои записи: чужая или несуществующая → 404 NOT_FOUND (не раскрываем, что она есть).
// Время проверяется в транзакции BEGIN IMMEDIATE той же функцией calcSlots, что выдаёт слоты.

const express = require('express');
const { transaction } = require('../db');
const { ApiError, requireUser } = require('../http');
const { toMin, stamp } = require('../time');
const { parseId, resolveVisit, checkDate, calcSlots, availableDates } = require('../slots');
const {
  slotTaken, isUniqueError, checkDateTime, findClientAppointment, clientAppointmentView, clientCanChange,
  moveAppointment, cancelAppointment,
} = require('../appointments');

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Запись не найдена');

function appointmentsRouter(db) {
  const router = express.Router();
  router.use(requireUser);

  // Своя запись по :id или 404
  function own(req) {
    const id = parseId(req.params.id);
    const row = id && findClientAppointment(db, id, req.user.id);
    if (!row) throw notFound();
    return row;
  }
  // Можно ли клиенту менять запись: действующая и не позже чем за 24 ч
  function checkChangeable(row, action) {
    if (row.status === 'cancelled') throw new ApiError(409, 'ALREADY_CANCELLED', 'Запись уже отменена');
    if (!clientCanChange(row)) {
      throw new ApiError(409, 'TOO_LATE', `${action} запись можно не позже чем за 24 часа. Свяжитесь с администратором.`);
    }
  }

  router.post('/', (req, res) => {
    // По паспорту записи создают клиенты
    if (req.user.role !== 'client') throw new ApiError(403, 'FORBIDDEN', 'Записи создают клиенты');
    const body = req.body || {};
    const visit = resolveVisit(db, body);
    checkDateTime(body);

    const id = transaction(db, () => {
      const free = calcSlots(db, { masterId: visit.master.id, date: body.date, duration: visit.duration });
      if (!free.includes(body.time)) throw slotTaken();
      const start = toMin(body.time);
      const now = new Date().toISOString();
      try {
        return Number(db.prepare(`INSERT INTO appointments
          (client_id, master_id, service_id, design_nails, start_at, end_at, duration_min, price, status, cancelled_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`)
          .run(req.user.id, visit.master.id, visit.service.id, visit.nails,
            stamp(body.date, start), stamp(body.date, start + visit.duration), visit.duration, visit.price, now, now)
          .lastInsertRowid);
      } catch (err) {
        if (isUniqueError(err)) throw slotTaken();
        throw err;
      }
    });
    res.status(201).json(clientAppointmentView(db, id, req.user.id));
  });

  router.get('/:id', (req, res) => {
    const row = own(req);
    res.json(clientAppointmentView(db, row.id, req.user.id));
  });

  router.post('/:id/cancel', (req, res) => {
    const row = own(req);
    checkChangeable(row, 'Отменить');
    cancelAppointment(db, row.id, 'client');
    res.json(clientAppointmentView(db, row.id, req.user.id));
  });

  // Даты и слоты для переноса: мастер и длительность — из самой записи, сама запись не мешает
  router.get('/:id/available-dates', (req, res) => {
    const row = own(req);
    res.json(availableDates(db, { masterId: row.master_id, duration: row.duration_min, excludeId: row.id }));
  });

  router.get('/:id/slots', (req, res) => {
    const row = own(req);
    checkDate(req.query.date);
    res.json(calcSlots(db, { masterId: row.master_id, date: req.query.date, duration: row.duration_min, excludeId: row.id }));
  });

  router.post('/:id/reschedule', (req, res) => {
    checkChangeable(own(req), 'Перенести');
    const body = req.body || {};
    checkDateTime(body);
    moveAppointment(db, {
      load: () => own(req),
      check: (row) => checkChangeable(row, 'Перенести'),
      date: body.date,
      time: body.time,
    });
    res.json(clientAppointmentView(db, parseId(req.params.id), req.user.id));
  });

  return router;
}

module.exports = { appointmentsRouter };
