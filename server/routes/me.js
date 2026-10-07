// /api/me: текущий пользователь и его записи.

const express = require('express');
const { requireUser } = require('../http');
const { listClientAppointments } = require('../appointments');

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

  return router;
}

module.exports = { meRouter };
