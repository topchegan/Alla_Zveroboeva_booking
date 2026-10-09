/* ============================================================
   API — единственная точка доступа к данным для всех страниц.
   Все функции — запросы к серверному API; права проверяет сервер
   (функции администратора — /api/admin/*, только для роли admin).

   Ошибка — отклонённый Promise с объектом { code, message }:
     VALIDATION          — неверные данные;
     NOT_FOUND           — объект не найден (или чужая запись);
     SLOT_TAKEN          — выбранное время уже занято;
     TOO_LATE            — до визита меньше 24 часов (для клиента) или визит уже начался;
     ALREADY_CANCELLED   — запись уже отменена;
     UNAUTHORIZED        — нужно войти;
     FORBIDDEN           — действие недоступно для этой роли;
     EMAIL_TAKEN         — email уже зарегистрирован;
     INVALID_CREDENTIALS — неверный email или пароль;
     TOO_MANY_ATTEMPTS   — слишком много неудачных попыток входа;
     NETWORK, INTERNAL   — нет связи с сервером / ошибка сервера.
   ============================================================ */
window.API = (function(){
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

  function id(x){ return encodeURIComponent(x); }

  /* ===== Администратор (/api/admin/*) ===== */
  var admin = {
    /* Записи всех клиентов; filter: { date, masterId, status, order: 'asc' | 'desc' } */
    getAllAppointments: function(filter){
      filter = filter || {};
      return request('GET', '/api/admin/appointments' + qs({ date: filter.date, masterId: filter.masterId, status: filter.status, order: filter.order }));
    },
    adminCancelAppointment: function(appointmentId){
      return request('POST', '/api/admin/appointments/' + id(appointmentId) + '/cancel', {});
    },
    adminGetRescheduleDates: function(appointmentId){
      return request('GET', '/api/admin/appointments/' + id(appointmentId) + '/available-dates');
    },
    adminGetRescheduleSlots: function(appointmentId, date){
      return request('GET', '/api/admin/appointments/' + id(appointmentId) + '/slots' + qs({ date: date }));
    },
    /* data: { date, time } */
    adminRescheduleAppointment: function(appointmentId, data){
      data = data || {};
      return request('POST', '/api/admin/appointments/' + id(appointmentId) + '/reschedule', { date: data.date, time: data.time });
    },

    /* Услуги, включая отключённые; data: { name, duration, price, isNail } */
    adminGetServices: function(){ return request('GET', '/api/admin/services'); },
    adminCreateService: function(data){ return request('POST', '/api/admin/services', serviceBody(data)); },
    adminUpdateService: function(serviceId, data){ return request('PUT', '/api/admin/services/' + id(serviceId), serviceBody(data)); },
    /* → { service, futureCount, warning } */
    setServiceActive: function(serviceId, active){
      return request('POST', '/api/admin/services/' + id(serviceId) + '/active', { active: !!active });
    },
    /* data: { pricePerTwoNails, extraMin24, extraMin610 } */
    adminUpdateDesignOption: function(data){
      data = data || {};
      return request('PUT', '/api/admin/design-option', {
        pricePerTwoNails: num(data.pricePerTwoNails), extraMin24: num(data.extraMin24), extraMin610: num(data.extraMin610)
      });
    },

    /* Мастера, включая отключённых; data: { name, specialization, serviceIds, doesDesign, schedule: { weekday: [start, end] } } */
    adminGetMasters: function(){ return request('GET', '/api/admin/masters'); },
    adminCreateMaster: function(data){ return request('POST', '/api/admin/masters', masterBody(data)); },
    adminUpdateMaster: function(masterId, data){ return request('PUT', '/api/admin/masters/' + id(masterId), masterBody(data)); },
    /* → { master, futureCount, warning } */
    setMasterActive: function(masterId, active){
      return request('POST', '/api/admin/masters/' + id(masterId) + '/active', { active: !!active });
    },

    /* Блокировки; data: { masterId, weekday, from, to, allDay, reason } → { block, conflicts, warning } */
    getBlocks: function(){ return request('GET', '/api/admin/blocks'); },
    createBlock: function(data){
      data = data || {};
      return request('POST', '/api/admin/blocks', {
        masterId: num(data.masterId), weekday: num(data.weekday), allDay: !!data.allDay,
        from: data.allDay ? null : data.from, to: data.allDay ? null : data.to, reason: data.reason || ''
      });
    },
    deleteBlock: function(blockId){ return request('DELETE', '/api/admin/blocks/' + id(blockId), {}); }
  };
  for (var name in admin) api[name] = admin[name];
  return api;

  /* Числа из полей формы: пустое поле остаётся пустым — сервер ответит понятной ошибкой */
  function num(v){
    if (typeof v === 'number') return v;
    var t = String(v == null ? '' : v).trim();
    return /^\d+$/.test(t) ? Number(t) : t;
  }
  function serviceBody(d){
    d = d || {};
    return { name: d.name, duration: num(d.duration), price: num(d.price), isNail: !!d.isNail };
  }
  function masterBody(d){
    d = d || {};
    return {
      name: d.name, specialization: d.specialization, serviceIds: d.serviceIds || [],
      doesDesign: !!d.doesDesign, schedule: d.schedule || {}
    };
  }
})();
