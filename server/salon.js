// Константы салона и правила записи (CLAUDE.md, п. 8). В БД не хранятся.

const SLOT_STEP = 30;          // шаг сетки, минут
const BOOKING_DAYS = 30;       // запись открыта на 30 дней вперёд
const CHANGE_LIMIT_HOURS = 24; // клиент может отменить или перенести не позже чем за 24 ч
const SALON_WEEKDAYS = [2, 3, 4, 5, 6]; // салон работает вт–сб (0 — вс … 6 — сб)
const SALON_OPEN = '10:00';
const SALON_CLOSE = '20:00';

const SALON = {
  name: 'Алла Зверобоева',
  phone: '+7 (900) 000-00-00',
  phoneHref: 'tel:+79000000000',
  email: 'hello@zveroboeva.ru',
  address: 'ул. Цветочная, 12, 2 этаж',
  timezone: 'Europe/Moscow',
  hours: [
    { days: 'Вторник — суббота', time: '10:00–20:00' },
    { days: 'Воскресенье, понедельник', time: null },
  ],
  hoursShort: 'вт–сб · 10:00–20:00',
  bookingDays: BOOKING_DAYS,
  slotStep: SLOT_STEP,
  changeLimitHours: CHANGE_LIMIT_HOURS,
};

module.exports = { SLOT_STEP, BOOKING_DAYS, CHANGE_LIMIT_HOURS, SALON_WEEKDAYS, SALON_OPEN, SALON_CLOSE, SALON };
