// Сервер онлайн-записи «Алла Зверобоева».
// При старте: база данных (миграции и начальные данные) → API → страницы и статика.
// Все страницы работают через API; права проверяются на сервере (страницы и /api/admin/*).

const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./server/db');
const { runMigrations } = require('./server/migrate');
const { runSeed } = require('./server/seed');
const { loadUser } = require('./server/session');
const { requireJson, requireAdmin, apiNotFound, apiErrorHandler } = require('./server/http');
const { authRouter } = require('./server/routes/auth');
const { meRouter } = require('./server/routes/me');
const { catalogRouter } = require('./server/routes/catalog');
const { appointmentsRouter } = require('./server/routes/appointments');
const { adminRouter } = require('./server/routes/admin');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PAGES_DIR = path.join(PUBLIC_DIR, 'pages');

// Адрес страницы → HTML-файл в public/pages и кто может её открыть:
//   user  — только вошедший (гостя — на /login?next=…);
//   client — только клиент (гостя — на /login?next=…, администратора — в /admin:
//            по паспорту записи создают клиенты);
//   guest — только гость (вошедшего — в кабинет или админ-панель);
//   admin — только администратор (гостя — на /login?next=…, клиенту — 403 и страница «Нет доступа»:
//           файл админки клиенту не отдаётся вообще, адрес в строке браузера не меняется).
const PAGES = {
  '/': { file: 'index.html' },
  '/login': { file: 'login.html', access: 'guest' },
  '/register': { file: 'register.html', access: 'guest' },
  '/forgot-password': { file: 'forgot-password.html' },
  '/booking': { file: 'booking.html', access: 'client' },
  '/booking/success': { file: 'booking-success.html', access: 'user' },
  '/cabinet': { file: 'cabinet.html', access: 'user' },
  '/cabinet/reschedule': { file: 'reschedule.html', access: 'user' },
  '/admin': { file: 'admin-appointments.html', access: 'admin' },
  '/admin/services': { file: 'admin-services.html', access: 'admin' },
  '/admin/masters': { file: 'admin-masters.html', access: 'admin' },
  '/admin/blocks': { file: 'admin-blocks.html', access: 'admin' },
  '/403': { file: '403.html' },
};

function homeFor(user) {
  return user.role === 'admin' ? '/admin' : '/cabinet';
}

function createApp(db) {
  const app = express();
  app.set('trust proxy', 1); // в Codespaces https завершается на прокси — для флага Secure у cookie
  app.disable('x-powered-by');

  app.use(loadUser(db));

  // API. Роль для /api/admin/* проверяется первой — до разбора тела и любых маршрутов
  app.use('/api/admin', requireAdmin);
  app.use('/api', express.json({ limit: '10kb' }), requireJson);
  app.use('/api/auth', authRouter(db));
  app.use('/api/me', meRouter(db));
  app.use('/api/appointments', appointmentsRouter(db));
  app.use('/api/admin', adminRouter(db));
  app.use('/api', catalogRouter(db));
  app.use('/api', apiNotFound);
  app.use('/api', apiErrorHandler);

  // Страницы
  for (const [route, page] of Object.entries(PAGES)) {
    app.get(route, (req, res) => {
      if (page.access && page.access !== 'guest' && !req.user) {
        return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
      }
      if (page.access === 'client' && req.user.role !== 'client') {
        return res.redirect(302, homeFor(req.user));
      }
      if (page.access === 'admin' && req.user.role !== 'admin') {
        return res.status(403).sendFile(path.join(PAGES_DIR, '403.html'));
      }
      if (page.access === 'guest' && req.user) {
        return res.redirect(302, homeFor(req.user));
      }
      res.sendFile(path.join(PAGES_DIR, page.file));
    });
  }

  // CSS и JS; HTML-страницы доступны только по адресам выше
  app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
  app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));

  return app;
}

async function start() {
  const db = openDatabase();
  runMigrations(db);
  await runSeed(db);

  const app = createApp(db);
  const server = app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${server.address().port}`);
  });
}

start().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
