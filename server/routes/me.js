// /api/me: текущий пользователь, его записи и уведомления.
// Только свои данные: все выборки — по client_id = req.user.id; чужое уведомление по id → 404 NOT_FOUND.

const express = require('express');
const { ApiError, requireUser } = require('../http');
const { parseId } = require('../slots');
const { listClientAppointments } = require('../appointments');
const { listNotifications, unreadCount, markRead, findNotification, notificationView } = require('../notifications');

const MAX_READ_IDS = 100;

function meRouter(db) {
  const router = express.Router();
  router.use(requireUser);

  router.get('/', (req, res) => {
    res.json(req.user);
  });

  // Только записи текущего пользователя
  router.get('/appointments', (req, res) => {
    res.json(listClientAppointments(db, req.user.id));
  });

  /* Уведомления: создаются только при переносе и отмене записи администратором */

  router.get('/notifications', (req, res) => {
    res.json(listNotifications(db, req.user.id));
  });

  router.get('/notifications/unread-count', (req, res) => {
    res.json({ count: unreadCount(db, req.user.id) });
  });

  // Клиент открыл уведомления: { ids: [...] } — отмечаются только свои
  router.post('/notifications/read', (req, res) => {
    const raw = (req.body || {}).ids;
    if (!Array.isArray(raw) || raw.length > MAX_READ_IDS) {
      throw new ApiError(400, 'VALIDATION', 'Передайте список уведомлений');
    }
    const ids = raw.map(parseId);
    if (ids.some((id) => !id)) throw new ApiError(400, 'VALIDATION', 'Неверный номер уведомления');
    markRead(db, req.user.id, ids);
    res.json({ count: unreadCount(db, req.user.id) });
  });

  router.post('/notifications/:id/read', (req, res) => {
    const id = parseId(req.params.id);
    const row = id && findNotification(db, id, req.user.id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Уведомление не найдено');
    markRead(db, req.user.id, [row.id]);
    res.json(notificationView(findNotification(db, row.id, req.user.id)));
  });

  return router;
}

module.exports = { meRouter };
