/* Личный кабинет: уведомления от администратора, записи клиента, отмена (≥ 24 ч до визита), ссылка на перенос */
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
  function adminNote(text){
    return '<p class="booking-card__note booking-card__note--admin">' + I.info + esc(text) + '</p>';
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
    if (a.status === 'active' && a.rescheduledBy === 'admin') notes = adminNote('Время изменено администратором') + notes;
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

  /* Уведомления: непрочитанные выделены «Новое» и после показа отмечаются прочитанными.
     Счётчик в шапке показывает, сколько было новых при открытии кабинета; на следующей странице — 0 */
  var NOTIFS_SHOWN = 3;
  var notifsBox = document.getElementById('cab-notifs');
  var notifsList = document.getElementById('cab-notifs-list');
  var notifsMore = document.getElementById('cab-notifs-more');
  var notifs = [], notifsAll = false;

  function fmtCreated(iso){
    var d = new Date(iso);
    var msk = new Date(d.getTime() + 180 * 60000); // время по Москве
    var date = msk.getUTCFullYear() + '-' + UI.pad(msk.getUTCMonth() + 1) + '-' + UI.pad(msk.getUTCDate());
    return UI.fmtDateHuman(date) + ', ' + UI.pad(msk.getUTCHours()) + ':' + UI.pad(msk.getUTCMinutes());
  }
  function notifItem(n){
    return '<div class="notif' + (n.isRead ? '' : ' notif--new') + '">' +
      '<span class="notif__icon">' + (n.kind === 'cancelled' ? I.info : I.calendar) + '</span>' +
      '<div class="notif__body">' +
        '<p class="notif__text">' + esc(n.text) + '</p>' +
        '<p class="notif__meta">' + (n.isRead ? '' : '<span class="notif__new">Новое</span>') + esc(fmtCreated(n.createdAt)) + '</p>' +
      '</div>' +
    '</div>';
  }
  function renderNotifs(){
    notifsBox.hidden = !notifs.length;
    var shown = notifsAll ? notifs : notifs.slice(0, Math.max(NOTIFS_SHOWN, notifs.filter(function(n){ return !n.isRead; }).length));
    notifsList.innerHTML = shown.map(notifItem).join('');
    notifsMore.hidden = shown.length >= notifs.length;
    notifsMore.textContent = 'Показать все (' + notifs.length + ')';
  }
  function loadNotifs(){
    return API.getNotifications().then(function(data){
      notifs = data;
      var unread = notifs.filter(function(n){ return !n.isRead; }).map(function(n){ return n.id; });
      UI.setNotifCount(unread.length);
      renderNotifs();
      if (unread.length) API.markNotificationsRead(unread).catch(function(){});
    }, function(){ UI.setNotifCount(0); });
  }
  notifsMore.addEventListener('click', function(){ notifsAll = true; renderNotifs(); });

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
    if (r[0] && r[0].role === 'client') loadNotifs();
  });
})();
