/* ============================================================
   UI — общие части интерфейса: шапки, вкладки админки, тост,
   модальные окна, форматирование, выбор даты и времени.
   Данные берёт только через window.API.
   ============================================================ */
window.UI = (function(){

  var WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  var MN_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var MN_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  var ICONS = {
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 3"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>'
  };

  /* ---------- Форматирование ---------- */
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPrice(n){ return Number(n).toLocaleString('ru-RU') + ' ₽'; }
  function fmtDuration(m){
    var h = Math.floor(m / 60), mm = m % 60;
    if (h && mm) return h + ' ч ' + mm + ' мин';
    if (h) return h + ' ч';
    return mm + ' мин';
  }
  function parts(date){
    var p = date.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return { wd: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
  }
  /* «Среда, 8 октября» */
  function fmtDateLong(date){ var p = parts(date); return WD_FULL[p.wd] + ', ' + p.day + ' ' + MN_GEN[p.month]; }
  /* «ср, 8 окт» */
  function fmtDateShort(date){ var p = parts(date); return WD_SHORT[p.wd] + ', ' + p.day + ' ' + MN_SHORT[p.month]; }
  /* Дата записи для карточек: «сегодня» / «завтра» / «ср, 8 окт» */
  function fmtDateHuman(date){
    var today = todayMsk();
    if (date === today) return 'сегодня';
    if (date === addDays(today, 1)) return 'завтра';
    return fmtDateShort(date);
  }
  function todayMsk(){
    var d = new Date(Date.now() + 180 * 60000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function addDays(date, n){
    var p = date.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function firstName(name){ return String(name || '').split(/\s+/)[0]; }
  function initials(name){
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(function(p){ return p.charAt(0).toUpperCase(); }).join('');
  }
  function query(name){ return new URLSearchParams(location.search).get(name); }

  /* ---------- Шапки ---------- */
  var LOGO =
    '<a class="logo" href="/">' +
      '<span class="logo__mark">АЗ</span>' +
      '<span class="logo__text">Алла Зверобоева<small>студия маникюра и бровей</small></span>' +
    '</a>';

  function renderHeader(){
    var host = document.getElementById('site-header');
    if (!host) return;
    var kind = document.body.getAttribute('data-header');
    if (kind === 'guest') {
      host.outerHTML =
        '<header class="home-header"><div class="home-header__in">' + LOGO +
          '<nav class="home-header__nav">' +
            '<a class="site-header__link site-header__link--hide-m" href="/#services">Услуги</a>' +
            '<a class="site-header__link site-header__link--hide-m" href="/#masters">Мастера</a>' +
            '<a class="site-header__link" href="/login">Войти</a>' +
            '<a class="btn btn--primary btn--sm" href="/login">Записаться</a>' +
          '</nav>' +
        '</div></header>';
      return;
    }
    var links = kind === 'admin'
      ? '<a class="site-header__link site-header__link--admin site-header__link--hide-m" href="/admin">Админ-панель</a>'
      : '<a class="site-header__link site-header__link--hide-m" href="/cabinet">Мои записи</a>';
    host.outerHTML =
      '<header class="booking-head"><div class="booking-head__in">' + LOGO +
        '<div class="site-header__nav">' + links +
          '<a class="site-header__link site-header__link--hide-m" href="/" data-logout>Выйти</a>' +
          '<span class="user-chip" id="user-chip" hidden></span>' +
        '</div>' +
      '</div></header>';
    API.getCurrentUser().then(function(user){
      var chip = document.getElementById('user-chip');
      if (!chip || !user) return;
      chip.innerHTML = '<span class="avatar">' + esc(initials(user.name)) + '</span>' + esc(firstName(user.name));
      chip.hidden = false;
    });
  }

  /* Вкладки админ-панели */
  function renderAdminTabs(){
    var host = document.querySelector('[data-admin-tabs]');
    if (!host) return;
    var current = host.getAttribute('data-admin-tabs');
    var tabs = [['/admin', 'Записи'], ['/admin/services', 'Услуги'], ['/admin/masters', 'Мастера'], ['/admin/blocks', 'Блокировки']];
    host.innerHTML = tabs.map(function(t){
      return '<a href="' + t[0] + '"' + (t[0] === current ? ' class="is-current"' : '') + '>' + t[1] + '</a>';
    }).join('');
  }

  /* ---------- Тост ---------- */
  var toastTimer = null;
  function toast(text){
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.innerHTML = '<span class="toast__dot"></span><span></span>';
      document.body.appendChild(el);
    }
    el.querySelector('span:last-child').textContent = text;
    // перезапуск анимации появления
    requestAnimationFrame(function(){ el.classList.add('is-visible'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.classList.remove('is-visible'); }, 2600);
  }
  /* Тост, который покажется на следующей странице (после перехода) */
  function flash(text){
    try { sessionStorage.setItem('az-flash', text); } catch (e) { /* без хранилища тост просто не покажется */ }
  }
  function showFlash(){
    try {
      var text = sessionStorage.getItem('az-flash');
      if (text) { sessionStorage.removeItem('az-flash'); setTimeout(function(){ toast(text); }, 250); }
    } catch (e) { /* нет хранилища */ }
  }

  /* ---------- Модальные окна ---------- */
  var lastFocus = null;
  function openModal(id){
    var o = document.getElementById(id);
    if (!o) return;
    lastFocus = document.activeElement;
    o.classList.add('is-open');
    var focusable = o.querySelector('input:not([disabled]), select, button');
    if (focusable) setTimeout(function(){ focusable.focus(); }, 30);
  }
  function closeModal(id){
    var list = id ? [document.getElementById(id)] : document.querySelectorAll('.modal-overlay.is-open');
    Array.prototype.forEach.call(list, function(o){ if (o) o.classList.remove('is-open'); });
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener('click', function(e){
    if (e.target.closest('[data-close]')) { closeModal(e.target.closest('.modal-overlay').id); return; }
    if (e.target.classList && e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeModal(); });

  /* Ошибка формы в блоке .alert */
  function showError(el, text){
    if (!el) return;
    el.querySelector('[data-error-text]').textContent = text;
    el.classList.add('is-visible');
  }
  function hideError(el){ if (el) el.classList.remove('is-visible'); }

  /* ---------- Выбор даты и времени ----------
     Лента дат на 30 дней + слоты выбранного дня.
     opts.loadDates()       → Promise<[{ date, weekday, working, hasSlots }]>
     opts.loadSlots(date)   → Promise<['10:00', …]>
     opts.onChange({ date, time }) — вызывается при выборе даты и слота
     opts.initialDate       — какую дату выбрать сразу (если доступна) */
  function createTimePicker(root, opts){
    root.innerHTML =
      '<div class="date-strip" data-tp-dates></div>' +
      '<p class="tz-note">' + ICONS.clock + 'Время московское</p>' +
      '<div style="margin-top:var(--sp-5)">' +
        '<p class="small muted" data-tp-hint>Выберите день в ленте выше.</p>' +
        '<div data-tp-loading hidden>' +
          '<div style="display:flex; align-items:center; gap:var(--sp-3); margin-bottom:var(--sp-3)">' +
            '<span class="spinner"></span><span class="small muted">Загружаем свободное время…</span>' +
          '</div>' +
          '<div class="slots">' + new Array(7).join('<span class="slot slot--skeleton"></span>') + '</div>' +
        '</div>' +
        '<div class="slots" data-tp-slots hidden></div>' +
        '<div class="state-box" data-tp-empty hidden style="padding:var(--sp-5)">' +
          '<p class="state-box__title" style="font-size:1.15rem">На эту дату свободного времени нет</p>' +
          '<p class="small muted">Выберите другой день</p>' +
        '</div>' +
      '</div>';
    var datesBox = root.querySelector('[data-tp-dates]');
    var hint = root.querySelector('[data-tp-hint]');
    var loading = root.querySelector('[data-tp-loading]');
    var slotsBox = root.querySelector('[data-tp-slots]');
    var empty = root.querySelector('[data-tp-empty]');
    var sel = { date: null, time: null };
    var reqNo = 0;

    function changed(){ if (opts.onChange) opts.onChange({ date: sel.date, time: sel.time }); }

    function renderDates(dates){
      datesBox.innerHTML = dates.map(function(d){
        var p = parts(d.date);
        return '<button type="button" class="date-cell" data-date="' + d.date + '"' + (d.working ? '' : ' disabled') + '>' +
          '<span class="date-cell__wd">' + WD_SHORT[p.wd] + '</span>' +
          '<span class="date-cell__d">' + p.day + '</span>' +
          '<span class="date-cell__m">' + MN_SHORT[p.month] + '</span>' +
        '</button>';
      }).join('');
      var pick = null;
      if (opts.initialDate) pick = dates.filter(function(d){ return d.date === opts.initialDate && d.working; })[0];
      if (!pick) pick = dates.filter(function(d){ return d.hasSlots; })[0];
      if (pick) selectDate(pick.date);
    }
    function selectDate(date){
      sel.date = date;
      sel.time = null;
      Array.prototype.forEach.call(datesBox.querySelectorAll('.date-cell'), function(c){
        c.classList.toggle('is-selected', c.getAttribute('data-date') === date);
      });
      var cell = datesBox.querySelector('.is-selected');
      if (cell && cell.scrollIntoView) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      changed();
      loadSlots();
    }
    function loadSlots(){
      var my = ++reqNo;
      hint.hidden = true; slotsBox.hidden = true; empty.hidden = true; loading.hidden = false;
      opts.loadSlots(sel.date).then(function(list){
        if (my !== reqNo) return;
        loading.hidden = true;
        if (!list.length) { empty.hidden = false; return; }
        slotsBox.innerHTML = list.map(function(t){
          return '<button type="button" class="slot' + (t === sel.time ? ' is-selected' : '') + '">' + t + '</button>';
        }).join('');
        slotsBox.hidden = false;
      }, function(err){
        if (my !== reqNo) return;
        loading.hidden = true;
        hint.textContent = err && err.message ? err.message : 'Не удалось загрузить время';
        hint.hidden = false;
      });
    }
    datesBox.addEventListener('click', function(e){
      var c = e.target.closest('.date-cell');
      if (!c || c.disabled) return;
      selectDate(c.getAttribute('data-date'));
    });
    slotsBox.addEventListener('click', function(e){
      var s = e.target.closest('.slot');
      if (!s) return;
      Array.prototype.forEach.call(slotsBox.querySelectorAll('.slot'), function(x){ x.classList.remove('is-selected'); });
      s.classList.add('is-selected');
      sel.time = s.textContent;
      changed();
    });

    function reload(){
      sel = { date: null, time: null };
      datesBox.innerHTML = '';
      hint.textContent = 'Выберите день в ленте выше.';
      hint.hidden = false; slotsBox.hidden = true; empty.hidden = true; loading.hidden = true;
      changed();
      return opts.loadDates().then(renderDates);
    }
    return {
      reload: reload,
      refreshSlots: function(){ sel.time = null; changed(); if (sel.date) loadSlots(); },
      get: function(){ return { date: sel.date, time: sel.time }; }
    };
  }

  /* ---------- Индикатор шагов записи ----------
     current — номер текущего шага (5 — все шаги пройдены);
     hrefs — ссылки на пройденные шаги (если не заданы, пройденные шаги не кликабельны) */
  var STEP_LABELS = ['Услуга', 'Мастер', 'Время', 'Подтверждение'];
  function renderSteps(host, current, hrefs){
    host.innerHTML = STEP_LABELS.map(function(label, i){
      var n = i + 1;
      if (n < current) {
        var tag = hrefs ? 'a' : 'div';
        return '<' + tag + (hrefs ? ' href="' + hrefs[i] + '"' : '') + ' class="step is-done">' +
          '<span class="step__dot">✓</span><span class="step__label">' + label + '</span></' + tag + '>';
      }
      return '<div class="step' + (n === current ? ' is-current' : '') + '">' +
        '<span class="step__dot">' + n + '</span><span class="step__label">' + label + '</span></div>';
    }).join('');
  }

  /* ---------- Запуск на каждой странице ---------- */
  function init(){
    renderHeader();
    renderAdminTabs();
    showFlash();
    document.addEventListener('click', function(e){
      if (e.target.closest('[data-logout]')) { API.logout(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return {
    ICONS: ICONS,
    WD_SHORT: WD_SHORT,
    WD_FULL: WD_FULL,
    esc: esc,
    fmtPrice: fmtPrice,
    fmtDuration: fmtDuration,
    fmtDateLong: fmtDateLong,
    fmtDateShort: fmtDateShort,
    fmtDateHuman: fmtDateHuman,
    firstName: firstName,
    initials: initials,
    query: query,
    toast: toast,
    flash: flash,
    openModal: openModal,
    closeModal: closeModal,
    showError: showError,
    hideError: hideError,
    renderSteps: renderSteps,
    createTimePicker: createTimePicker
  };
})();
