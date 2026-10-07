/* Запись: Услуга → Мастер → Время → Подтверждение на одной странице.
   Текущий шаг хранится в адресе (#service, #master, #time, #confirm),
   поэтому кнопка «Назад» в браузере возвращает на предыдущий шаг. */
(function(){
  var esc = UI.esc;
  var STEPS = ['service', 'master', 'time', 'confirm'];
  var HREFS = STEPS.map(function(s){ return '#' + s; });

  var bk = { service: null, nails: null, master: null, date: null, time: null };
  var services = [], design = null, masters = [], designMasters = [];
  var timeKey = null, picker = null, step = 1;

  var el = {
    steps: document.getElementById('bk-steps'),
    services: document.getElementById('bk-services'),
    design: document.getElementById('bk-design'),
    nails: document.getElementById('bk-nails'),
    masters: document.getElementById('bk-masters'),
    masterSub: document.getElementById('bk-master-sub'),
    timeSub: document.getElementById('bk-time-sub'),
    bar: document.getElementById('bk-bar'),
    barName: document.getElementById('bk-bar-name'),
    barMeta: document.getElementById('bk-bar-meta'),
    barPrice: document.getElementById('bk-bar-price'),
    next: document.getElementById('bk-next'),
    confirmError: document.getElementById('confirm-error'),
    submit: document.getElementById('cf-submit')
  };

  /* ---------- Расчёт итога ---------- */
  function designMinutes(){
    if (!bk.nails) return 0;
    var r = design.extraMinutes;
    for (var i = 0; i < r.length; i++) if (bk.nails <= r[i].maxNails) return r[i].minutes;
    return r[r.length - 1].minutes;
  }
  function designPrice(){ return bk.nails ? (bk.nails / 2) * design.pricePerTwoNails : 0; }
  function totalMinutes(){ return bk.service.duration + designMinutes(); }
  function totalPrice(){ return bk.service.price + designPrice(); }
  function serviceLine(){ return bk.service.name + (bk.nails ? ' + дизайн, ' + bk.nails + ' ногт.' : ''); }

  /* ---------- Навигация по шагам ---------- */
  function maxStep(){
    if (bk.service && bk.master && bk.date && bk.time) return 4;
    if (bk.service && bk.master) return 3;
    if (bk.service) return 2;
    return 1;
  }
  function stepFromHash(){
    var i = STEPS.indexOf(location.hash.slice(1));
    return i === -1 ? 1 : i + 1;
  }
  function go(n){
    if (location.hash === HREFS[n - 1]) show(n); else location.hash = HREFS[n - 1];
  }
  function show(n){
    n = Math.min(n, maxStep());
    if (HREFS[n - 1] !== location.hash) history.replaceState(null, '', HREFS[n - 1]);
    step = n;
    document.querySelectorAll('[data-step]').forEach(function(s){ s.hidden = Number(s.getAttribute('data-step')) !== n; });
    UI.renderSteps(el.steps, n, HREFS);
    el.bar.hidden = n === 4;
    if (n === 2) renderMasters();
    if (n === 3) renderTime();
    if (n === 4) renderConfirm();
    updateBar();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function(){ show(stepFromHash()); });

  function updateBar(){
    el.barName.textContent = bk.service ? serviceLine() : 'Услуга не выбрана';
    var meta = bk.service ? UI.fmtDuration(totalMinutes()) : '—';
    if (bk.master && step >= 2) meta += ' · ' + bk.master.name;
    if (bk.date && bk.time) meta += ' · ' + UI.fmtDateShort(bk.date) + ', ' + bk.time;
    el.barMeta.textContent = meta;
    el.barPrice.textContent = bk.service ? UI.fmtPrice(totalPrice()) : '—';
    var canNext = (step === 1 && bk.service) || (step === 2 && bk.master) || (step === 3 && bk.time);
    el.next.classList.toggle('btn--disabled', !canNext);
    el.next.setAttribute('aria-disabled', canNext ? 'false' : 'true');
  }
  el.next.addEventListener('click', function(){
    if (el.next.classList.contains('btn--disabled')) return;
    go(step + 1);
  });

  /* ---------- Шаг 1: услуга и дизайн ---------- */
  function renderServices(){
    el.services.innerHTML = services.map(function(s){
      return '<button class="service-card' + (bk.service && bk.service.id === s.id ? ' is-selected' : '') + '" type="button" data-service="' + s.id + '">' +
        '<span class="service-card__body">' +
          '<span class="service-card__name">' + esc(s.name) + '</span>' +
          '<span class="service-card__meta" style="display:block">' + UI.fmtDuration(s.duration) + '</span>' +
        '</span>' +
        '<span class="service-card__side"><span class="price">' + UI.fmtPrice(s.price) + '</span><span class="radio-dot"></span></span>' +
      '</button>';
    }).join('');
  }
  function renderDesign(){
    var show = bk.service && bk.service.isNail && designMasters.length > 0;
    el.design.hidden = !show;
    if (!show) { bk.nails = null; return; }
    document.getElementById('bk-design-price').textContent = UI.fmtPrice(design.pricePerTwoNails);
    document.getElementById('bk-design-who').textContent =
      (designMasters.length === 1 ? 'Выполняет мастер ' : 'Выполняют мастера: ') +
      designMasters.map(function(m){ return m.name; }).join(', ') +
      ' · ' + UI.fmtPrice(design.pricePerTwoNails) + ' за каждые 2 ногтя';
    var r = design.extraMinutes;
    document.getElementById('bk-design-rules').textContent =
      '2–' + r[0].maxNails + ' ногтя — +' + r[0].minutes + ' мин · ' + (r[0].maxNails + 2) + '–' + r[1].maxNails + ' ногтей — +' + r[1].minutes + ' мин к основной услуге';
    el.nails.innerHTML = design.nails.map(function(n){
      return '<button class="chip' + (bk.nails === n ? ' is-selected' : '') + '" type="button" data-n="' + n + '">' + n + '</button>';
    }).join('') + '<span class="caption" style="align-self:center; margin-left:4px">ногтей</span>';
    el.design.classList.toggle('is-selected', !!bk.nails);
  }
  function resetAfterService(){ bk.master = null; bk.date = null; bk.time = null; }

  el.services.addEventListener('click', function(e){
    var card = e.target.closest('[data-service]');
    if (!card) return;
    var id = Number(card.getAttribute('data-service'));
    bk.service = services.filter(function(s){ return s.id === id; })[0];
    if (!bk.service.isNail) bk.nails = null;
    resetAfterService();
    renderServices();
    API.getMasters({ serviceId: id, withDesign: true }).then(function(list){
      designMasters = list;
      renderDesign();
      updateBar();
    });
    updateBar();
  });
  el.nails.addEventListener('click', function(e){
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var n = Number(chip.getAttribute('data-n'));
    bk.nails = bk.nails === n ? null : n; // повторный клик — убрать опцию
    resetAfterService();
    renderDesign();
    updateBar();
  });

  /* ---------- Шаг 2: мастер ---------- */
  function renderMasters(){
    el.masterSub.textContent = bk.nails
      ? 'Опция «Дизайн ногтей» выполняется не всеми мастерами — показаны только подходящие.'
      : 'Показаны только мастера, которые выполняют выбранную услугу.';
    el.masters.innerHTML = '<div class="spinner"></div>';
    API.getMasters({ serviceId: bk.service.id, withDesign: !!bk.nails }).then(function(list){
      masters = list;
      if (!list.length) {
        el.masters.innerHTML = '<div class="state-box"><p class="state-box__title">Нет доступных мастеров</p><p class="small muted">Выберите другую услугу</p></div>';
        return;
      }
      if (list.length === 1 && !bk.master) bk.master = list[0];
      el.masters.innerHTML = list.map(function(m){
        return '<button type="button" class="master-card' + (bk.master && bk.master.id === m.id ? ' is-selected' : '') + '" data-master="' + m.id + '">' +
          '<span class="avatar">' + esc(m.initials) + '</span>' +
          '<span class="master-card__body">' +
            '<span class="master-card__name" style="display:block">' + esc(m.name) + '</span>' +
            '<span class="master-card__role" style="display:block">' + esc(m.role) + '</span>' +
            '<span class="master-card__sched" style="display:block">' + esc(m.scheduleText) + '</span>' +
          '</span>' +
          '<span class="radio-dot"></span>' +
        '</button>';
      }).join('');
      updateBar();
    });
  }
  el.masters.addEventListener('click', function(e){
    var card = e.target.closest('[data-master]');
    if (!card) return;
    var id = Number(card.getAttribute('data-master'));
    bk.master = masters.filter(function(m){ return m.id === id; })[0];
    bk.date = null; bk.time = null;
    el.masters.querySelectorAll('.master-card').forEach(function(c){ c.classList.toggle('is-selected', c === card); });
    updateBar();
  });

  /* ---------- Шаг 3: дата и время ---------- */
  function renderTime(){
    el.timeSub.textContent = 'Мастер: ' + bk.master.name + '. Лента на 30 дней вперёд — активны только рабочие дни мастера.';
    var key = [bk.service.id, bk.master.id, bk.nails || 0].join('-');
    if (!picker) {
      picker = UI.createTimePicker(document.getElementById('bk-time'), {
        loadDates: function(){ return API.getAvailableDates(bk.master.id, bk.service.id, bk.nails); },
        loadSlots: function(date){ return API.getSlots(bk.master.id, date, bk.service.id, bk.nails); },
        onChange: function(sel){ bk.date = sel.date; bk.time = sel.time; updateBar(); }
      });
    }
    if (key !== timeKey) { timeKey = key; picker.reload(); }
  }

  /* ---------- Шаг 4: подтверждение ---------- */
  function renderConfirm(){
    UI.hideError(el.confirmError);
    document.getElementById('cf-service').textContent = bk.service.name;
    var optRow = document.getElementById('cf-option-row');
    optRow.hidden = !bk.nails;
    if (bk.nails) {
      document.getElementById('cf-option').textContent =
        'Дизайн ногтей · ' + bk.nails + ' ногт. · ' + UI.fmtPrice(designPrice()) + ' · +' + designMinutes() + ' мин';
    }
    document.getElementById('cf-master').textContent = bk.master.name;
    document.getElementById('cf-when').textContent = UI.fmtDateLong(bk.date) + ' · ' + bk.time;
    document.getElementById('cf-duration').textContent = UI.fmtDuration(totalMinutes());
    document.getElementById('cf-total').textContent = UI.fmtPrice(totalPrice());
  }
  el.submit.addEventListener('click', function(){
    if (el.submit.disabled) return;
    el.submit.disabled = true;
    UI.hideError(el.confirmError);
    API.createAppointment({
      serviceId: bk.service.id, masterId: bk.master.id, date: bk.date, time: bk.time, designNails: bk.nails
    }).then(function(a){
      location.href = '/booking/success?id=' + a.id;
    }, function(err){
      el.submit.disabled = false;
      UI.showError(el.confirmError, err.message || 'Не удалось создать запись');
      if (err.code === 'SLOT_TAKEN' && picker) picker.refreshSlots();
    });
  });

  /* ---------- Старт ---------- */
  Promise.all([API.getServices(), API.getDesignOption()]).then(function(r){
    services = r[0];
    design = r[1];
    renderServices();
    show(stepFromHash());
  });
})();
