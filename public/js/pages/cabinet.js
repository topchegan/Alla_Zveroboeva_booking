/* Личный кабинет: записи клиента, отмена (≥ 24 ч до визита), ссылка на перенос */
(function(){
  var esc = UI.esc, I = UI.ICONS;
  var list = document.getElementById('cab-list');
  var tabs = document.getElementById('cab-tabs');
  var cancelError = document.getElementById('cancel-error');
  var tab = 'upcoming', items = [], cancelId = null, phone = '';

  function badge(a){
    if (a.status === 'cancelled') return '<span class="badge badge--cancelled">Отменена</span>';
    if (a.isPast) return '<span class="badge badge--info">Завершена</span>';
    return '<span class="badge badge--ok">Подтверждена</span>';
  }
  function note(text){
    return '<p class="booking-card__note">' + I.info + esc(text) + '</p>';
  }
  function card(a){
    var active = a.status === 'active' && !a.isPast;
    var actions = '', notes = '';
    if (active && a.canChange) {
      actions =
        '<a class="btn btn--secondary btn--sm" href="/cabinet/reschedule?id=' + a.id + '">Перенести</a>' +
        '<button class="btn btn--text" type="button" data-cancel="' + a.id + '">Отменить</button>';
    } else if (active) {
      actions =
        '<button class="btn btn--secondary btn--sm" type="button" disabled>Перенести</button>' +
        '<button class="btn btn--text" type="button" disabled style="background:none">Отменить</button>';
      notes = note('Отмена и перенос возможны не позже чем за 24 часа. Свяжитесь с администратором: ' + phone);
    }
    if (a.status === 'cancelled') notes = note(a.cancelledBy === 'admin' ? 'Отменена администратором' : 'Вы отменили эту запись');
    return '<div class="booking-card">' +
      '<div class="booking-card__top"><div>' +
        '<div class="booking-card__service">' + esc(a.serviceName) + '</div>' +
        '<div class="booking-card__meta">' +
          (a.designNails ? '<span class="booking-card__row">+ дизайн ногтей, ' + a.designNails + ' ногт.</span>' : '') +
          '<span class="booking-card__row">' + I.person + esc(a.masterName) + '</span>' +
          '<span class="booking-card__row">' + I.calendar + esc(UI.fmtDateHuman(a.date) + ', ' + a.time + '–' + a.endTime) + '</span>' +
        '</div>' +
      '</div>' + badge(a) + '</div>' +
      '<div class="booking-card__foot"><span class="price">' + UI.fmtPrice(a.price) + '</span>' +
        (actions ? '<div class="booking-card__actions">' + actions + '</div>' : '') +
      '</div>' + notes +
    '</div>';
  }
  function render(){
    var shown = items.filter(function(a){ return tab === 'past' ? a.isPast : !a.isPast; });
    if (tab === 'past') shown.reverse();
    if (!shown.length) {
      list.innerHTML = '<div class="state-box">' +
        '<span class="state-box__icon">' + I.calendar + '</span>' +
        '<p class="state-box__title">' + (tab === 'past' ? 'Прошедших визитов пока нет' : 'Предстоящих записей нет') + '</p>' +
        (tab === 'past' ? '' : '<a class="btn btn--primary" href="/booking" style="margin-top:var(--sp-2)">Записаться</a>') +
      '</div>';
      return;
    }
    list.innerHTML = shown.map(card).join('');
  }
  function load(){
    return API.getMyAppointments().then(function(data){ items = data; render(); });
  }

  tabs.addEventListener('click', function(e){
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.getAttribute('data-tab');
    tabs.querySelectorAll('button').forEach(function(x){ x.classList.toggle('is-current', x === b); });
    render();
  });

  list.addEventListener('click', function(e){
    var b = e.target.closest('[data-cancel]');
    if (!b) return;
    cancelId = Number(b.getAttribute('data-cancel'));
    var a = items.filter(function(x){ return x.id === cancelId; })[0];
    document.getElementById('modal-cancel-text').textContent =
      a.serviceName + ', ' + UI.fmtDateLong(a.date).toLowerCase() + ', ' + a.time + '–' + a.endTime +
      ', мастер ' + a.masterName + '. Место освободится для других гостей.';
    UI.hideError(cancelError);
    UI.openModal('modal-cancel');
  });
  document.getElementById('cab-cancel-yes').addEventListener('click', function(){
    var btn = this;
    btn.disabled = true;
    API.cancelAppointment(cancelId).then(function(){
      btn.disabled = false;
      UI.closeModal('modal-cancel');
      UI.toast('Запись отменена');
      load();
    }, function(err){
      btn.disabled = false;
      UI.showError(cancelError, err.message || 'Не удалось отменить запись');
      load();
    });
  });

  Promise.all([API.getCurrentUser(), API.getSalonInfo()]).then(function(r){
    if (r[0]) document.getElementById('cab-sub').textContent = UI.firstName(r[0].name) + ', здесь все ваши визиты — предстоящие и прошедшие.';
    phone = r[1].phone;
    load();
  });
})();
