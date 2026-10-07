// Подключение к SQLite (встроенный node:sqlite).
// Путь к файлу — из DB_PATH, по умолчанию data/app.db.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

function openDatabase(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  const fullPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const db = new DatabaseSync(fullPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

// Выполнить fn внутри транзакции; при ошибке — откат
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
