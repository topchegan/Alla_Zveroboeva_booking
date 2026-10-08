/* ============================================================
   API — единственная точка доступа к данным для всех страниц.

   Клиентские функции (пользователь, каталог, свободное время, запись,
   отмена и перенос) — запросы к серверному API.
   Функции администратора пока работают на тестовых данных из mock-data.js
   (состояние — в localStorage); mock-data.js подключён только на страницах
   админки, и тестовое состояние создаётся при первом вызове admin-функции.
   На этапе 3 их тела заменятся на запросы к API; имена функций, параметры
   и формат ответов останутся прежними.

   Ошибка — отклонённый Promise с объектом { code, message }:
     VALIDATION          — неверные данные;
     NOT_FOUND           — объект не найден (или чужая запись);
     SLOT_TAKEN          — выбранное время уже занято;
     TOO_LATE            — до визита меньше 24 часов (для клиента);
     ALREADY_CANCELLED   — запись уже отменена;
     UNAUTHORIZED        — нужно войти;
     FORBIDDEN           — действие недоступно для этой роли;
     EMAIL_TAKEN         — email уже зарегистрирован;
     INVALID_CREDENTIALS — неверный email или пароль;
     TOO_MANY_ATTEMPTS   — слишком много неудачных попыток входа;
     NETWORK, INTERNAL   — нет связи с сервером / ошибка сервера.
   ============================================================ */
window.API = (function(){
  var STORAGE_KEY = 'az-mock-v1';
  var DAY_MS = 24 * 60 * 60 * 1000;
  var MSK_OFFSET_MIN = 180; // Москва: UTC+3 без перехода на летнее время

  /* ---------- Время по Москве ---------- */
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function toMin(hhmm){ var p = hhmm.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function fromMin(m){ return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function mskNow(){
    var shifted = new Date(Date.now() + MSK_OFFSET_MIN * 60000);
    return {
      date: shifted.getUTCFullYear() + '-' + pad(shifted.getUTCMonth() + 1) + '-' + pad(shifted.getUTCDate()),
      minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
      epoch: Date.now()
    };
  }
  function parseDate(date){
    var p = date.split('-');
    return Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  function addDays(date, n){
    var d = new Date(parseDate(date) + n * DAY_MS);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function weekdayOf(date){ return new Date(parseDate(date)).getUTCDay(); }
  /* Момент начала визита (мс от эпохи) по московской дате и времени */
  function toEpoch(date, time){ return parseDate(date) + (toMin(time) - MSK_OFFSET_MIN) * 60000; }
  function isDate(s){ return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function isTime(s){ return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

  /* ---------- Состояние заглушки (только админка) ---------- */
  var state = null, SEED = null;
  function ensureState(){
    if (state) return;
    SEED = window.MOCK_DATA;
    if (!SEED) throw new Error('mock-data.js не подключён');
    load();
  }

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function save(){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* без хранилища — только в памяти */ }
  }
  function load(){
    var today = mskNow().date;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        // Тестовые записи привязаны к сегодняшнему дню — раз в сутки данные пересоздаются
        if (parsed && parsed.seedDate === today) { state = parsed; return; }
      }
    } catch (e) { /* повреждённые данные — создаём заново */ }
    state = buildState(today);
    save();
  }

  function buildState(today){
    var s = {
      seedDate: today,
      salon: clone(SEED.salon),
      services: clone(SEED.services),
      designOption: clone(SEED.designOption),
      masters: clone(SEED.masters),
      blocks: clone(SEED.blocks),
      users: clone(SEED.users),
      appointments: []
    };
    var deferred = [];
    SEED.appointments.forEach(function(spec){
      if (spec.when.type === 'within24') { deferred.push(spec); return; }
      var date = spec.when.type === 'prev' ? prevWeekday(today, spec.when.weekday) : nextWeekday(today, spec.when.weekday, spec.when.minDays);
      s.appointments.push(makeSeedAppointment(s, spec, date, spec.time));
    });
    // Запись «меньше чем за 24 часа»: ближайшее свободное время мастера в пределах суток
    deferred.forEach(function(spec){
      var service = byId(s.services, spec.serviceId);
      var now = mskNow();
      var found = null;
      for (var i = 0; i <= 1 && !found; i++) {
        var date = addDays(today, i);
        var slots = calcSlots(s, spec.masterId, date, service.duration, null);
        for (var k = 0; k < slots.length; k++) {
          var diff = toEpoch(date, slots[k]) - now.epoch;
          if (diff > 0 && diff < DAY_MS) { found = { date: date, time: slots[k] }; break; }
        }
      }
      if (!found) {
        // В ближайшие сутки мастер не работает — ставим запись через ~20 ч (только для демонстрации правила 24 ч)
        var t = new Date(now.epoch + 20 * 3600000 + MSK_OFFSET_MIN * 60000);
        var m = Math.floor((t.getUTCHours() * 60 + t.getUTCMinutes()) / 30) * 30;
        found = { date: t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()), time: fromMin(m) };
      }
      s.appointments.push(makeSeedAppointment(s, spec, found.date, found.time));
    });
    s.appointments.sort(function(a, b){ return a.id - b.id; });
    return s;
  }
  function makeSeedAppointment(s, spec, date, time){
    var service = byId(s.services, spec.serviceId);
    return {
      id: spec.id, clientId: spec.clientId, serviceId: spec.serviceId, masterId: spec.masterId,
      date: date, time: time, duration: service.duration, designNails: null, price: service.price,
      status: spec.status, cancelledBy: spec.cancelledBy || null
    };
  }
  function nextWeekday(today, weekday, minDays){
    var d = addDays(today, minDays || 0);
    while (weekdayOf(d) !== weekday) d = addDays(d, 1);
    return d;
  }
  function prevWeekday(today, weekday){
    var d = addDays(today, -1);
    while (weekdayOf(d) !== weekday) d = addDays(d, -1);
    return d;
  }
  function byId(list, id){
    id = Number(id);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function nextId(list){
    return list.reduce(function(max, x){ return Math.max(max, x.id); }, 0) + 1;
  }

  /* ---------- Запросы к серверу ---------- */
  function request(method, url, body){
    var opts = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(data){
        if (res.ok) return data;
        throw (data && data.code) ? data : { code: 'INTERNAL', message: 'Ошибка сервера. Попробуйте ещё раз' };
      });
    }, function(){
      throw { code: 'NETWORK', message: 'Нет связи с сервером. Проверьте подключение' };
    });
  }

  /* Текущий пользователь: один запрос на загрузку страницы (шапка и страница используют общий ответ) */
  var mePromise = null;
  function fetchMe(){
    if (!mePromise) {
      mePromise = request('GET', '/api/me').catch(function(err){
        if (err && err.code === 'UNAUTHORIZED') return null;
        mePromise = null;
        throw err;
      });
    }
    return mePromise;
  }

  /* ---------- Ответы заглушки ---------- */
  function ok(data, ms){
    return new Promise(function(resolve){ setTimeout(function(){ resolve(clone(data)); }, ms || 120); });
  }
  function fail(code, message, ms){
    return new Promise(function(resolve, reject){ setTimeout(function(){ reject({ code: code, message: message }); }, ms || 120); });
  }

  /* ---------- Правила расчёта ---------- */
  function designExtraMinutes(nails){
    if (!nails) return 0;
    var rules = state.designOption.extraMinutes;
    for (var i = 0; i < rules.length; i++) if (nails <= rules[i].maxNails) return rules[i].minutes;
    return rules[rules.length - 1].minutes;
  }
  function designPrice(nails){ return nails ? (nails / 2) * state.designOption.pricePerTwoNails : 0; }

  /* Свободные слоты мастера на дату для визита длительностью duration минут.
     Учитываются: график, еженедельные блокировки, действующие записи,
     конец смены, прошедшее время сегодня (по Москве). */
  function calcSlots(s, masterId, date, duration, excludeAppointmentId){
    var master = byId(s.masters, masterId);
    if (!master) return [];
    var weekday = weekdayOf(date);
    var hours = master.schedule[weekday];
    if (!hours) return [];
    var busy = [];
    for (var i = 0; i < s.blocks.length; i++) {
      var b = s.blocks[i];
      if (b.masterId !== master.id || b.weekday !== weekday) continue;
      if (b.allDay) return [];
      busy.push([toMin(b.from), toMin(b.to)]);
    }
    s.appointments.forEach(function(a){
      if (a.masterId !== master.id || a.date !== date || a.status !== 'active') return;
      if (excludeAppointmentId && a.id === Number(excludeAppointmentId)) return;
      busy.push([toMin(a.time), toMin(a.time) + a.duration]);
    });
    var now = mskNow();
    var step = s.salon.slotStep;
    var start = toMin(hours[0]), end = toMin(hours[1]);
    var out = [];
    for (var t = start; t + duration <= end; t += step) {
      if (date === now.date && t <= now.minutes) continue;
      var free = true;
      for (var k = 0; k < busy.length; k++) {
        if (t < busy[k][1] && t + duration > busy[k][0]) { free = false; break; }
      }
      if (free) out.push(fromMin(t));
    }
    return out;
  }
  function inBookingWindow(date){
    var today = mskNow().date;
    return date >= today && date <= addDays(today, state.salon.bookingDays - 1);
  }

  /* ---------- Представление данных ---------- */
  var WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  function scheduleText(schedule){
    var order = [1, 2, 3, 4, 5, 6, 0];
    var days = order.filter(function(d){ return schedule[d]; });
    if (!days.length) return 'график не задан';
    // Группируем по одинаковым часам: «вт–пт · 10:00–18:00»
    var groups = [];
    days.forEach(function(d){
      var key = schedule[d].join('–');
      var g = groups.length && groups[groups.length - 1].key === key ? groups[groups.length - 1] : null;
      if (g) g.days.push(d); else groups.push({ key: key, days: [d] });
    });
    return groups.map(function(g){
      var idx = g.days.map(function(d){ return order.indexOf(d); });
      var consecutive = idx.every(function(v, i){ return i === 0 || v === idx[i - 1] + 1; });
      var daysText = consecutive && g.days.length > 2
        ? WD_SHORT[g.days[0]] + '–' + WD_SHORT[g.days[g.days.length - 1]]
        : g.days.map(function(d){ return WD_SHORT[d]; }).join(', ');
      return daysText + ' · ' + g.key;
    }).join('; ');
  }
  function masterView(m){
    var v = clone(m);
    v.scheduleText = scheduleText(m.schedule);
    v.serviceNames = m.serviceIds.map(function(id){ var s = byId(state.services, id); return s ? s.name : null; }).filter(Boolean);
    return v;
  }
  function appointmentView(a, forClient){
    var service = byId(state.services, a.serviceId);
    var master = byId(state.masters, a.masterId);
    var client = byId(state.users, a.clientId);
    var start = toEpoch(a.date, a.time);
    var now = Date.now();
    var isPast = start + a.duration * 60000 <= now;
    var startsIn = start - now;
    var v = {
      id: a.id,
      clientId: a.clientId,
      clientName: client ? client.name : '—',
      serviceId: a.serviceId,
      serviceName: service ? service.name : '—',
      masterId: a.masterId,
      masterName: master ? master.name : '—',
      date: a.date,
      time: a.time,
      endTime: fromMin(toMin(a.time) + a.duration),
      duration: a.duration,
      designNails: a.designNails,
      designPrice: designPrice(a.designNails),
      designMinutes: designExtraMinutes(a.designNails),
      price: a.price,
      status: a.status,
      cancelledBy: a.cancelledBy,
      isPast: isPast,
      isStarted: startsIn <= 0
    };
    v.canChange = a.status === 'active' && (forClient ? startsIn >= state.salon.changeLimitHours * 3600000 : startsIn > 0);
    return v;
  }
  function blockView(b){
    var v = clone(b);
    var m = byId(state.masters, b.masterId);
    v.masterName = m ? m.name : '—';
    return v;
  }
  function sortByTime(a, b){ return (a.date + a.time).localeCompare(b.date + b.time); }

  function checkNewTime(appointment, date, time, forClient){
    if (!isDate(date) || !isTime(time)) return fail('VALIDATION', 'Выберите дату и время');
    if (forClient && !inBookingWindow(date)) return fail('VALIDATION', 'Запись открыта на 30 дней вперёд');
    var slots = calcSlots(state, appointment.masterId, date, appointment.duration, appointment.id);
    if (slots.indexOf(time) === -1) return fail('SLOT_TAKEN', 'Это время уже заняли, выберите другое.');
    return null;
  }

  /* Параметры запроса: пустые значения не передаются */
  function qs(params){
    var parts = [];
    for (var k in params) {
      if (params[k] === undefined || params[k] === null || params[k] === '' || params[k] === false) continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  var api = {
    /* ===== Пользователь (серверное API) ===== */
    /* { id, name, email, role } или null для гостя */
    getCurrentUser: fetchMe,
    login: function(email, password){
      return request('POST', '/api/auth/login', { email: email, password: password }).then(function(r){
        mePromise = Promise.resolve(r.user);
        return r.user;
      });
    },
    /* data: { name, email, password, passwordConfirm } */
    register: function(data){
      data = data || {};
      return request('POST', '/api/auth/register', {
        name: data.name, email: data.email, password: data.password, passwordConfirm: data.passwordConfirm
      }).then(function(r){
        mePromise = Promise.resolve(r.user);
        return r.user;
      });
    },
    logout: function(){
      return request('POST', '/api/auth/logout', {}).then(function(){ mePromise = Promise.resolve(null); return null; });
    },

    /* ===== Каталог (серверное API) ===== */
    getSalonInfo: function(){ return request('GET', '/api/salon'); },
    /* Только активные услуги */
    getServices: function(){ return request('GET', '/api/services'); },
    getDesignOption: function(){ return request('GET', '/api/design-option'); },
    /* Активные мастера; filter: { serviceId, designNails } — только выполняющие услугу (и дизайн, если выбран) */
    getMasters: function(filter){
      filter = filter || {};
      return request('GET', '/api/masters' + qs({ serviceId: filter.serviceId, designNails: filter.designNails }));
    },

    /* ===== Запись (клиент, серверное API) ===== */
    /* Даты на 30 дней вперёд: working — рабочий день мастера, hasSlots — есть свободное время */
    getAvailableDates: function(masterId, serviceId, designNails){
      return request('GET', '/api/available-dates' + qs({ masterId: masterId, serviceId: serviceId, designNails: designNails }));
    },
    getSlots: function(masterId, date, serviceId, designNails){
      return request('GET', '/api/slots' + qs({ masterId: masterId, serviceId: serviceId, date: date, designNails: designNails }));
    },
    /* data: { serviceId, masterId, date, time, designNails }; цену и длительность считает сервер */
    createAppointment: function(data){
      data = data || {};
      return request('POST', '/api/appointments', {
        serviceId: data.serviceId, masterId: data.masterId, date: data.date, time: data.time, designNails: data.designNails || 0
      });
    },
    /* Записи текущего клиента */
    getMyAppointments: function(){ return request('GET', '/api/me/appointments'); },
    getAppointment: function(id){ return request('GET', '/api/appointments/' + encodeURIComponent(id)); },
    cancelAppointment: function(id){ return request('POST', '/api/appointments/' + encodeURIComponent(id) + '/cancel', {}); },
    /* Даты и слоты для переноса: без учёта самой переносимой записи */
    getRescheduleDates: function(appointmentId){
      return request('GET', '/api/appointments/' + encodeURIComponent(appointmentId) + '/available-dates');
    },
    getRescheduleSlots: function(appointmentId, date){
      return request('GET', '/api/appointments/' + encodeURIComponent(appointmentId) + '/slots' + qs({ date: date }));
    },
    rescheduleAppointment: function(id, data){
      data = data || {};
      return request('POST', '/api/appointments/' + encodeURIComponent(id) + '/reschedule', { date: data.date, time: data.time });
    }
  };

  var admin = {
    /* ===== Администратор: записи ===== */
    getAllAppointments: function(filter){
      filter = filter || {};
      return ok(state.appointments
        .filter(function(a){
          if (filter.date && a.date !== filter.date) return false;
          if (filter.masterId && a.masterId !== Number(filter.masterId)) return false;
          if (filter.status && a.status !== filter.status) return false;
          return true;
        })
        .map(function(a){ return appointmentView(a, false); })
        .sort(sortByTime));
    },
    adminCancelAppointment: function(id){
      var a = byId(state.appointments, id);
      if (!a) return fail('NOT_FOUND', 'Запись не найдена');
      if (a.status !== 'active') return fail('VALIDATION', 'Запись уже отменена');
      if (toEpoch(a.date, a.time) <= Date.now()) return fail('VALIDATION', 'Визит уже начался или прошёл');
      a.status = 'cancelled';
      a.cancelledBy = 'admin';
      save();
      return ok(appointmentView(a, false));
    },
    adminRescheduleAppointment: function(id, data){
      data = data || {};
      var a = byId(state.appointments, id);
      if (!a) return fail('NOT_FOUND', 'Запись не найдена');
      if (a.status !== 'active') return fail('VALIDATION', 'Отменённую запись перенести нельзя');
      if (toEpoch(a.date, a.time) <= Date.now()) return fail('VALIDATION', 'Визит уже начался или прошёл');
      var err = checkNewTime(a, data.date, data.time, true);
      if (err) return err;
      a.date = data.date;
      a.time = data.time;
      save();
      return ok(appointmentView(a, false), 300);
    },

    /* ===== Администратор: услуги ===== */
    adminGetServices: function(){ return ok(state.services); },
    adminCreateService: function(data){
      var err = validateService(data);
      if (err) return fail('VALIDATION', err);
      var s = { id: nextId(state.services), name: data.name.trim(), duration: Number(data.duration), price: Number(data.price), isNail: !!data.isNail, active: true };
      state.services.push(s);
      save();
      return ok(s);
    },
    adminUpdateService: function(id, data){
      var s = byId(state.services, id);
      if (!s) return fail('NOT_FOUND', 'Услуга не найдена');
      var err = validateService(data);
      if (err) return fail('VALIDATION', err);
      s.name = data.name.trim();
      s.duration = Number(data.duration);
      s.price = Number(data.price);
      s.isNail = !!data.isNail;
      save();
      return ok(s);
    },
    setServiceActive: function(id, active){
      var s = byId(state.services, id);
      if (!s) return fail('NOT_FOUND', 'Услуга не найдена');
      s.active = !!active;
      save();
      return ok(s);
    },

    /* ===== Администратор: мастера и графики ===== */
    adminGetMasters: function(){ return ok(state.masters.map(masterView)); },
    adminCreateMaster: function(data){
      var err = validateMaster(data);
      if (err) return fail('VALIDATION', err);
      var m = {
        id: nextId(state.masters), name: data.name.trim(), initials: initials(data.name), role: roleFor(data.serviceIds),
        serviceIds: data.serviceIds.map(Number), doesDesign: !!data.doesDesign, active: true, schedule: data.schedule
      };
      state.masters.push(m);
      save();
      return ok(masterView(m));
    },
    adminUpdateMaster: function(id, data){
      var m = byId(state.masters, id);
      if (!m) return fail('NOT_FOUND', 'Мастер не найден');
      var err = validateMaster(data);
      if (err) return fail('VALIDATION', err);
      m.name = data.name.trim();
      m.initials = initials(data.name);
      m.serviceIds = data.serviceIds.map(Number);
      m.doesDesign = !!data.doesDesign;
      m.schedule = data.schedule;
      save();
      return ok(masterView(m));
    },
    setMasterActive: function(id, active){
      var m = byId(state.masters, id);
      if (!m) return fail('NOT_FOUND', 'Мастер не найден');
      m.active = !!active;
      save();
      return ok(masterView(m));
    },

    /* ===== Администратор: блокировки ===== */
    getBlocks: function(){
      return ok(state.blocks.map(blockView).sort(function(a, b){
        return a.masterId - b.masterId || a.weekday - b.weekday;
      }));
    },
    createBlock: function(data){
      data = data || {};
      if (!byId(state.masters, data.masterId)) return fail('VALIDATION', 'Выберите мастера');
      var weekday = Number(data.weekday);
      if (!(weekday >= 0 && weekday <= 6)) return fail('VALIDATION', 'Выберите день недели');
      if (!data.allDay && (!isTime(data.from) || !isTime(data.to) || toMin(data.from) >= toMin(data.to))) {
        return fail('VALIDATION', 'Укажите время в формате ЧЧ:ММ, начало раньше конца');
      }
      var b = {
        id: nextId(state.blocks), masterId: Number(data.masterId), weekday: weekday,
        from: data.allDay ? null : data.from, to: data.allDay ? null : data.to,
        allDay: !!data.allDay, reason: (data.reason || '').trim() || 'блокировка'
      };
      state.blocks.push(b);
      save();
      return ok(blockView(b));
    },
    deleteBlock: function(id){
      var b = byId(state.blocks, id);
      if (!b) return fail('NOT_FOUND', 'Блокировка не найдена');
      state.blocks.splice(state.blocks.indexOf(b), 1);
      save();
      return ok({ id: b.id });
    }
  };

  /* Функции админки: перед первым вызовом создаётся тестовое состояние */
  Object.keys(admin).forEach(function(name){
    api[name] = function(){
      try { ensureState(); } catch (e) { return fail('INTERNAL', 'Тестовые данные админки недоступны'); }
      return admin[name].apply(null, arguments);
    };
  });
  return api;

  /* ---------- Проверки форм администратора ---------- */
  function validateService(d){
    d = d || {};
    if (!d.name || !String(d.name).trim()) return 'Введите название';
    if (!(Number(d.duration) > 0) || Number(d.duration) % 5 !== 0) return 'Длительность — целое число минут, кратное 5';
    if (!(Number(d.price) >= 0) || String(d.price).trim() === '') return 'Введите цену';
    return null;
  }
  function validateMaster(d){
    d = d || {};
    if (!d.name || !String(d.name).trim()) return 'Введите имя';
    if (!d.serviceIds || !d.serviceIds.length) return 'Выберите хотя бы одну услугу';
    var sched = d.schedule || {};
    for (var day in sched) {
      var h = sched[day];
      if (!isTime(h[0]) || !isTime(h[1]) || toMin(h[0]) >= toMin(h[1])) return 'Проверьте часы работы: формат ЧЧ:ММ, начало раньше конца';
    }
    return null;
  }
  function initials(name){
    return name.trim().split(/\s+/).slice(0, 2).map(function(p){ return p.charAt(0).toUpperCase(); }).join('');
  }
  function roleFor(serviceIds){
    var kinds = serviceIds.map(function(id){ var s = byId(state.services, id); return s && s.isNail; });
    var nail = kinds.indexOf(true) !== -1, other = kinds.indexOf(false) !== -1;
    if (nail && other) return 'Универсальный мастер · ногти и брови';
    return nail ? 'Мастер ногтевого сервиса' : 'Мастер по бровям';
  }
})();
