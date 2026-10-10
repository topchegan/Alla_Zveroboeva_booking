-- 003_notifications.sql — уведомления клиенту в личном кабинете (без email/SMS).
--
-- Уведомление создаётся только когда запись клиента изменил администратор:
-- перенос ('rescheduled') или отмена ('cancelled'). Действия самого клиента уведомлений не создают.
-- Текст собирается на сервере в момент события и дальше не меняется.

-- Кто сделал последний перенос записи: NULL — переносов не было.
-- 'admin' → в карточке клиента пометка «Время изменено администратором»;
-- перенос самим клиентом записывает 'client' и снимает пометку.
ALTER TABLE appointments ADD COLUMN rescheduled_by TEXT CHECK (rescheduled_by IN ('client', 'admin'));

CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id  INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('rescheduled', 'cancelled')),
  text            TEXT NOT NULL,
  old_start_at    TEXT NOT NULL,                      -- 'YYYY-MM-DD HH:MM', Москва — время до изменения
  old_end_at      TEXT NOT NULL,
  new_start_at    TEXT,                               -- новое время; NULL для отмены
  new_end_at      TEXT,
  created_at      TEXT NOT NULL,                      -- UTC, ISO-8601
  read_at         TEXT,                               -- UTC, ISO-8601; NULL — не прочитано
  CHECK ((kind = 'rescheduled' AND new_start_at IS NOT NULL AND new_end_at IS NOT NULL)
      OR (kind = 'cancelled' AND new_start_at IS NULL AND new_end_at IS NULL))
);
CREATE INDEX ix_notifications_client ON notifications(client_id, created_at);
CREATE INDEX ix_notifications_client_unread ON notifications(client_id) WHERE read_at IS NULL;
