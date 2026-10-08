// Время по Москве (UTC+3 без перехода на летнее время).

const MSK_OFFSET_MIN = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n) { return String(n).padStart(2, '0'); }
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function fromMin(m) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
function mskNow() {
  const d = new Date(Date.now() + MSK_OFFSET_MIN * 60000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
function parseDate(date) { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function addDays(date, n) {
  const d = new Date(parseDate(date) + n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function weekdayOf(date) { return new Date(parseDate(date)).getUTCDay(); }
// 'YYYY-MM-DD HH:MM' по Москве → миллисекунды от эпохи
function mskToEpoch(stamp) {
  const [date, time] = stamp.split(' ');
  return parseDate(date) + (toMin(time) - MSK_OFFSET_MIN) * 60000;
}

// 'YYYY-MM-DD' + минуты от полуночи → 'YYYY-MM-DD HH:MM' (переход через полночь учитывается)
function stamp(date, minutes) {
  return `${addDays(date, Math.floor(minutes / 1440))} ${fromMin(minutes % 1440)}`;
}

module.exports = { MSK_OFFSET_MIN, DAY_MS, pad, toMin, fromMin, mskNow, parseDate, addDays, weekdayOf, mskToEpoch, stamp };
