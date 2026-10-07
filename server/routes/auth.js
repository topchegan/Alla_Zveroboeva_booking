// /api/auth: регистрация, вход, выход.

const express = require('express');
const { hashPassword, verifyPassword } = require('../password');
const { startSession, endSession } = require('../session');
const { ApiError } = require('../http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;

// Хеш для несуществующего email: проверка пароля занимает столько же времени
const dummyHash = hashPassword('dummy-password-for-timing');

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function str(v) { return typeof v === 'string' ? v : ''; }
function normEmail(v) { return str(v).trim().toLowerCase(); }
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role }; }

function authRouter(db) {
  const router = express.Router();

  router.post('/register', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const name = str(body.name).trim();
    const email = normEmail(body.email);
    const password = str(body.password);
    const confirm = str(body.passwordConfirm);

    if (!name) throw new ApiError(400, 'VALIDATION', 'Введите имя');
    if (name.length > 100) throw new ApiError(400, 'VALIDATION', 'Имя слишком длинное');
    if (!EMAIL_RE.test(email) || email.length > 254) throw new ApiError(400, 'VALIDATION', 'Проверьте email');
    if (password.length < MIN_PASSWORD) throw new ApiError(400, 'VALIDATION', `Пароль должен быть не короче ${MIN_PASSWORD} символов`);
    if (password.length > MAX_PASSWORD) throw new ApiError(400, 'VALIDATION', 'Пароль слишком длинный');
    if (password !== confirm) throw new ApiError(400, 'VALIDATION', 'Пароли не совпадают');

    const taken = () => new ApiError(409, 'EMAIL_TAKEN', 'Этот email уже зарегистрирован');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw taken();

    const hash = await hashPassword(password);
    let userId;
    try {
      // Роль всегда client: поле role из запроса не используется
      userId = Number(db.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'client', ?)")
        .run(name, email, hash, new Date().toISOString()).lastInsertRowid);
    } catch (err) {
      if (/UNIQUE constraint failed: users\.email/.test(err.message)) throw taken();
      throw err;
    }
    startSession(db, req, res, userId);
    res.status(201).json({ user: { id: userId, name, email, role: 'client' } });
  }));

  router.post('/login', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const email = normEmail(body.email);
    const password = str(body.password);
    if (!email || !password) throw new ApiError(400, 'VALIDATION', 'Введите email и пароль');

    const since = new Date(Date.now() - ATTEMPTS_WINDOW_MS).toISOString();
    const failed = db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND attempted_at > ?').get(email, since).n;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Слишком много попыток входа. Попробуйте через 15 минут');
    }

    const user = db.prepare('SELECT id, name, email, role, password_hash FROM users WHERE email = ?').get(email);
    const ok = password.length <= MAX_PASSWORD
      && await verifyPassword(password, user ? user.password_hash : await dummyHash)
      && Boolean(user);

    if (!ok) {
      db.prepare('DELETE FROM login_attempts WHERE attempted_at <= ?').run(since);
      db.prepare('INSERT INTO login_attempts (email, attempted_at) VALUES (?, ?)').run(email, new Date().toISOString());
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
    }

    db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
    startSession(db, req, res, user.id);
    res.json({ user: publicUser(user) });
  }));

  router.post('/logout', (req, res) => {
    endSession(db, req, res);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { authRouter };
