/* ============================================================
   ТЕСТОВЫЕ ДАННЫЕ (этап 1).
   Справочники — строго по CLAUDE.md, раздел 8. Записи — из прототипа.
   Используется только в public/js/api.js; на этапе 2 файл будет удалён.
   ============================================================ */
window.MOCK_DATA = (function(){

  /* Дни недели: 0 — вс, 1 — пн, … 6 — сб (как Date#getDay) */

  var salon = {
    name: 'Алла Зверобоева',
    phone: '+7 (900) 000-00-00',
    phoneHref: 'tel:+79000000000',
    email: 'hello@zveroboeva.ru',
    address: 'ул. Цветочная, 12, 2 этаж',
    timezone: 'Europe/Moscow',
    hours: [
      { days: 'Вторник — суббота', time: '10:00–20:00' },
      { days: 'Воскресенье, понедельник', time: null }
    ],
    hoursShort: 'вт–сб · 10:00–20:00',
    bookingDays: 30,      // запись открыта на 30 дней вперёд
    slotStep: 30,         // шаг сетки, минут
    changeLimitHours: 24  // клиент может отменить/перенести не позже чем за 24 ч
  };

  var services = [
    { id: 1, name: 'Маникюр с покрытием гель-лаком', price: 1800, duration: 90,  isNail: true,  active: true },
    { id: 2, name: 'Маникюр и педикюр',              price: 3200, duration: 150, isNail: true,  active: true },
    { id: 3, name: 'Наращивание ногтей',             price: 2800, duration: 150, isNail: true,  active: true },
    { id: 4, name: 'Коррекция и окрашивание бровей', price: 1200, duration: 40,  isNail: false, active: true },
    { id: 5, name: 'Ламинирование бровей',           price: 1800, duration: 60,  isNail: false, active: true }
  ];

  /* «Дизайн ногтей» — только доп. опция к ногтевым услугам */
  var designOption = {
    name: 'Дизайн ногтей',
    pricePerTwoNails: 300,
    nails: [2, 4, 6, 8, 10],
    extraMinutes: [
      { maxNails: 4,  minutes: 15 },  // 2–4 ногтя: +15 мин
      { maxNails: 10, minutes: 30 }   // 6–10 ногтей: +30 мин
    ]
  };

  var masters = [
    {
      id: 1, name: 'Анна Ковалева', initials: 'АК', role: 'Мастер маникюра и педикюра',
      serviceIds: [1, 2, 3], doesDesign: true, active: true,
      schedule: { 2: ['10:00', '18:00'], 3: ['10:00', '18:00'], 4: ['10:00', '18:00'], 5: ['10:00', '18:00'] }
    },
    {
      id: 2, name: 'Марина Орлова', initials: 'МО', role: 'Мастер по бровям',
      serviceIds: [4, 5], doesDesign: false, active: true,
      schedule: { 3: ['11:00', '20:00'], 4: ['11:00', '20:00'], 5: ['11:00', '20:00'], 6: ['11:00', '20:00'] }
    },
    {
      id: 3, name: 'Елена Смирнова', initials: 'ЕС', role: 'Универсальный мастер · ногти и брови',
      serviceIds: [1, 3, 4, 5], doesDesign: false, active: true,
      schedule: { 2: ['10:00', '19:00'], 4: ['10:00', '19:00'], 6: ['10:00', '19:00'] }
    }
  ];

  /* Еженедельные блокировки */
  var blocks = [
    { id: 1, masterId: 1, weekday: 4, from: '13:00', to: '14:00', allDay: false, reason: 'обед' },
    { id: 2, masterId: 2, weekday: 5, from: '15:00', to: '17:00', allDay: false, reason: 'личное время' },
    { id: 3, masterId: 3, weekday: 6, from: null,    to: null,    allDay: true,  reason: 'выходной' }
  ];

  var users = [
    { id: 1,   name: 'Ирина Петрова',   email: 'irina@example.ru',  role: 'client' },
    { id: 2,   name: 'Ольга Смирнова',  email: 'olga@example.ru',   role: 'client' },
    { id: 3,   name: 'Мария Иванова',   email: 'maria@example.ru',  role: 'client' },
    { id: 100, name: 'Алла Зверобоева', email: 'admin@example.ru',  role: 'admin' }
  ];

  /* Записи из прототипа. Даты задаются относительно сегодняшнего дня (по Москве),
     чтобы всегда были видны все состояния. Конкретные даты вычисляет api.js:
       next     — ближайший такой день недели не раньше чем через minDays дней;
       prev     — прошедший такой день недели;
       within24 — ближайшее свободное время мастера в пределах 24 часов. */
  var appointments = [
    { id: 1, clientId: 1, serviceId: 1, masterId: 1, when: { type: 'next', weekday: 3, minDays: 2 }, time: '10:00', status: 'active' },
    { id: 2, clientId: 1, serviceId: 4, masterId: 2, when: { type: 'within24' }, status: 'active' },
    { id: 3, clientId: 1, serviceId: 5, masterId: 3, when: { type: 'next', weekday: 2, minDays: 1 }, time: '14:00', status: 'cancelled', cancelledBy: 'admin' },
    { id: 4, clientId: 1, serviceId: 1, masterId: 1, when: { type: 'prev', weekday: 3 }, time: '10:00', status: 'active' },
    { id: 5, clientId: 2, serviceId: 5, masterId: 2, when: { type: 'next', weekday: 5, minDays: 1 }, time: '11:00', status: 'active' },
    { id: 6, clientId: 3, serviceId: 3, masterId: 3, when: { type: 'next', weekday: 4, minDays: 1 }, time: '15:00', status: 'active' }
  ];

  return {
    salon: salon,
    services: services,
    designOption: designOption,
    masters: masters,
    blocks: blocks,
    users: users,
    appointments: appointments
  };
})();
