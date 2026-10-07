// Ответы API: ошибки в формате { code, message }.

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendError(res, status, code, message) {
  res.status(status).json({ code, message });
}

// POST/PUT/PATCH/DELETE к API — только JSON (вместе с SameSite=Lax защищает от CSRF)
function requireJson(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.is('application/json')) return sendError(res, 415, 'VALIDATION', 'Ожидается JSON');
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return sendError(res, 401, 'UNAUTHORIZED', 'Войдите в аккаунт');
  next();
}

function apiNotFound(req, res) {
  sendError(res, 404, 'NOT_FOUND', 'Не найдено');
}

// Последний обработчик: ошибки API. В лог — только текст ошибки, без тела запроса.
// eslint-disable-next-line no-unused-vars
function apiErrorHandler(err, req, res, next) {
  if (err instanceof ApiError) return sendError(res, err.status, err.code, err.message);
  if (err.type === 'entity.parse.failed') return sendError(res, 400, 'VALIDATION', 'Некорректный JSON');
  if (err.type === 'entity.too.large') return sendError(res, 413, 'VALIDATION', 'Слишком большой запрос');
  console.error(`[api] ${req.method} ${req.path}: ${err.message}`);
  sendError(res, 500, 'INTERNAL', 'Ошибка сервера. Попробуйте ещё раз');
}

module.exports = { ApiError, sendError, requireJson, requireUser, apiNotFound, apiErrorHandler };
