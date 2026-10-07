// Сервер онлайн-записи «Алла Зверобоева».
// Страницы и статика; база данных создаётся и наполняется при старте.
// Данные на страницах пока тестовые (public/js/mock-data.js) — API появится на следующих шагах.

const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./server/db');
const { runMigrations } = require('./server/migrate');
const { runSeed } = require('./server/seed');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PAGES_DIR = path.join(PUBLIC_DIR, 'pages');

// Адрес страницы → HTML-файл в public/pages
const PAGES = {
  '/': 'index.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/forgot-password': 'forgot-password.html',
  '/booking': 'booking.html',
  '/booking/success': 'booking-success.html',
  '/cabinet': 'cabinet.html',
  '/cabinet/reschedule': 'reschedule.html',
  '/admin': 'admin-appointments.html',
  '/admin/services': 'admin-services.html',
  '/admin/masters': 'admin-masters.html',
  '/admin/blocks': 'admin-blocks.html',
  '/403': '403.html',
};

for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(PAGES_DIR, file));
  });
}

// CSS и JS; HTML-страницы доступны только по адресам выше
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));

async function start() {
  const db = openDatabase();
  runMigrations(db);
  await runSeed(db);
  app.locals.db = db;

  const server = app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${server.address().port}`);
  });
}

start().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
