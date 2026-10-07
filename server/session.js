// Сессии входа: случайный токен в cookie, в БД — только его SHA-256.

const crypto = require('node:crypto');

const COOKIE_NAME = 'az_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* битое значение пропускаем */ }
  }
  return out;
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure };
}

// Создать сессию и поставить cookie. Заодно удаляет просроченные сессии.
function startSession(db, req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, hashToken(token), now.toISOString(), new Date(now.getTime() + SESSION_MS).toISOString());
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: SESSION_MS });
}

function endSession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// Middleware: req.user = { id, name, email, role } или null
function loadUser(db) {
  const find = db.prepare(`SELECT u.id, u.name, u.email, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const row = token ? find.get(hashToken(token), new Date().toISOString()) : null;
    req.user = row ? { id: row.id, name: row.name, email: row.email, role: row.role } : null;
    next();
  };
}

module.exports = { COOKIE_NAME, hashToken, startSession, endSession, loadUser };
