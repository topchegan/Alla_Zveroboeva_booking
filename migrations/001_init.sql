-- 001_init.sql — начальная схема базы данных.
--
-- Соглашения:
--   * время визита — текст по Москве 'YYYY-MM-DD HH:MM' (сравнивается как строка);
--   * служебные метки (created_at, updated_at, expires_at) — UTC, ISO-8601;
--   * деньги — целые рубли, длительность — целые минуты;
--   * флаги — 0/1;
--   * день недели — 0 = вс … 6 = сб (как Date#getDay во фронтенде).

-- Пользователи: клиенты и администратор
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,                       -- 'scrypt$<соль hex>$<хеш hex>'
  role          TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  created_at    TEXT NOT NULL
);

-- Сессии входа: хранится только хеш токена (SHA-256)
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX ix_sessions_user ON sessions(user_id);
CREATE INDEX ix_sessions_expires ON sessions(expires_at);

-- Услуги. Отключение — флагом is_active, не удалением
CREATE TABLE services (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  duration_min  INTEGER NOT NULL CHECK (duration_min > 0),
  price         INTEGER NOT NULL CHECK (price >= 0),
  is_nail       INTEGER NOT NULL DEFAULT 0 CHECK (is_nail IN (0, 1)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- Настройки доп. опции «Дизайн ногтей» — ровно одна строка.
-- Варианты числа ногтей (2, 4, 6, 8, 10) заданы паспортом и проверяются в appointments.
CREATE TABLE design_option (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  name                TEXT NOT NULL DEFAULT 'Дизайн ногтей',
  price_per_two_nails INTEGER NOT NULL CHECK (price_per_two_nails >= 0),
  extra_min_2_4       INTEGER NOT NULL CHECK (extra_min_2_4 >= 0),   -- 2–4 ногтя
  extra_min_6_10      INTEGER NOT NULL CHECK (extra_min_6_10 >= 0)   -- 6–10 ногтей
);

-- Мастера. Отключение — флагом is_active, не удалением
CREATE TABLE masters (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  specialization  TEXT NOT NULL,
  does_design     INTEGER NOT NULL DEFAULT 0 CHECK (does_design IN (0, 1)),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- Какие услуги выполняет мастер.
-- CASCADE безопасен: мастера или услугу с записями удалить нельзя (RESTRICT в appointments).
CREATE TABLE master_services (
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (master_id, service_id)
);
CREATE INDEX ix_master_services_service ON master_services(service_id);

-- График работы: один интервал на день недели
CREATE TABLE master_schedule (
  id          INTEGER PRIMARY KEY,
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TEXT NOT NULL,                          -- 'HH:MM'
  end_time    TEXT NOT NULL,                          -- 'HH:MM'
  CHECK (start_time < end_time),
  UNIQUE (master_id, weekday)
);

-- Еженедельные блокировки: интервал времени или весь день
CREATE TABLE blocks (
  id          INTEGER PRIMARY KEY,
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  all_day     INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  start_time  TEXT,                                   -- 'HH:MM', NULL при all_day = 1
  end_time    TEXT,                                   -- 'HH:MM', NULL при all_day = 1
  reason      TEXT NOT NULL DEFAULT '',
  CHECK ((all_day = 1 AND start_time IS NULL AND end_time IS NULL)
      OR (all_day = 0 AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time))
);
CREATE INDEX ix_blocks_master_weekday ON blocks(master_id, weekday);

-- Записи. Не удаляются: отмена меняет статус.
-- Цена и длительность фиксируются на момент записи (услуга + дизайн).
CREATE TABLE appointments (
  id            INTEGER PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  master_id     INTEGER NOT NULL REFERENCES masters(id) ON DELETE RESTRICT,
  service_id    INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  design_nails  INTEGER NOT NULL DEFAULT 0 CHECK (design_nails IN (0, 2, 4, 6, 8, 10)),
  start_at      TEXT NOT NULL,                        -- 'YYYY-MM-DD HH:MM', Москва
  end_at        TEXT NOT NULL,                        -- 'YYYY-MM-DD HH:MM', Москва
  duration_min  INTEGER NOT NULL CHECK (duration_min > 0),
  price         INTEGER NOT NULL CHECK (price >= 0),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_by  TEXT CHECK (cancelled_by IN ('client', 'admin')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (end_at > start_at),
  CHECK ((status = 'active' AND cancelled_by IS NULL)
      OR (status = 'cancelled' AND cancelled_by IS NOT NULL))
);

-- Защита от двойной записи на уровне БД: у мастера не может быть двух
-- действующих визитов с одним и тем же началом. Отменённые записи не мешают.
-- ВАЖНО: пересечение интервалов (визиты с разным началом, но перекрывающиеся
-- по времени) этот индекс не ловит — оно проверяется в транзакции
-- (BEGIN IMMEDIATE) при создании и переносе записи, шаг 7.
CREATE UNIQUE INDEX ux_appointments_master_start_active
  ON appointments(master_id, start_at) WHERE status = 'active';

CREATE INDEX ix_appointments_client_start ON appointments(client_id, start_at);
CREATE INDEX ix_appointments_master_start ON appointments(master_id, start_at);
