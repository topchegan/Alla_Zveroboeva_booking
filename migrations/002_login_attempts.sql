-- 002_login_attempts.sql — неудачные попытки входа для ограничения подбора пароля.
-- Не больше 10 неудачных попыток за 15 минут на один email (в том числе несуществующий).
-- Пишутся только неудачные попытки; успешный вход очищает записи этого email,
-- записи старше 15 минут удаляются при каждой новой неудаче.

CREATE TABLE login_attempts (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL COLLATE NOCASE,   -- в нижнем регистре
  attempted_at  TEXT NOT NULL                   -- UTC, ISO-8601
);
CREATE INDEX ix_login_attempts_email_time ON login_attempts(email, attempted_at);
