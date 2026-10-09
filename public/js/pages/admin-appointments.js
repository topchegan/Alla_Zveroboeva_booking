/* Админ-панель: все записи, фильтры, отмена и перенос без ограничения 24 ч */
(function(){
  var esc = UI.esc;
  var list = document.getElementById('aa-list');
  var empty = document.getElementById('aa-empty');
  var loadError = document.getElementById('aa-load-error');
  var f = {
    date: document.getElementById('af-date'), master: document.getElementById('af-master'),
    status: document.getElementById('af-status'), order: document.getElementById('af-order')
  };
  var items = [], current = null, picker = null, moveSel = { date: null, time: null };
  var moveBtn = document.getElementById('am-confirm');

  function badge(a){
    if (a.status === 'cancelled') return '<span class="badge badge--cancelled">Отменена</span>';
    if (a.isPast) return '<span class="badge badge--info">Завершена</span>';
    return '<span class="badge badge--ok">Подтверждена</span>';
  }
  function what(a){
    return a.serviceName + (a.designNails ? ' + дизайн, ' + a.designNails + ' ногт.' : '') + ' · ' + a.masterName;
  }
  function when(a){ return UI.fmtDateShort(a.date) + ' · ' + a.time + '–' + a.endTime; }

  function row(a){
    var off = !a.canChange ? ' disabled' : '';
    return '<div class="admin-row">' +
      '<div class="admin-row__main">' +
        '<div class="admin-row__title">' + esc(a.clientName) + '</div>' +
        '<div class="admin-row__meta">' + esc(a.clientEmail) + '</div>' +
        '<div class="admin-row__meta">' + esc(what(a)) + '</div>' +
        '<div class="admin-row__meta">' + esc(when(a)) + ' · ' + UI.fmtPrice(a.price) + '</div>' +
        (a.status === 'cancelled' ? '<div class="admin-row__meta">' + (a.cancelledBy === 'admin' ? 'Отменена администратором' : 'Отменена клиентом') + '</div>' : '') +
      '</div>' +
      '<div class="admin-row__side">' + badge(a) +
        '<button class="btn btn--secondary btn--sm" type="button" data-amove="' + a.id + '"' + off + '>Перенести</button>' +
        '<button class="btn btn--text" type="button" data-acancel="' + a.id + '"' + off + (off ? ' style="background:none"' : '') + '>Отменить</button>' +
      '</div>' +
    '</div>';
  }
  function load(){
    UI.hideError(loadError);
    return API.getAllAppointments({ date: f.date.value, masterId: f.master.value, status: f.status.value, order: f.order.value }).then(function(data){
      items = data;
      list.innerHTML = data.map(row).join('');
      empty.hidden = data.length > 0;
    }, function(err){
      list.innerHTML = '';
      UI.showError(loadError, err.message || 'Не удалось загрузить записи');
    });
  }
  function find(id){ return items.filter(function(a){ return a.id === id; })[0]; }

  [f.date, f.master, f.status, f.order].forEach(function(x){ x.addEventListener('change', load); });

  /* ---------- Отмена ---------- */
  var cancelError = document.getElementById('aa-cancel-error');
  list.addEventListener('click', function(e){
    var b = e.target.closest('[data-acancel]');
    if (!b) return;
    current = find(Number(b.getAttribute('data-acancel')));
    document.getElementById('aa-cancel-text').textContent =
      current.clientName + ' — ' + what(current) + ', ' + when(current) + '. Место освободится для других гостей.';
    UI.hideError(cancelError);
    UI.openModal('modal-admin-cancel');
  });
  document.getElementById('aa-cancel-yes').addEventListener('click', function(){
    var btn = this;
    btn.disabled = true;
    API.adminCancelAppointment(current.id).then(function(){
      btn.disabled = false;
      UI.closeModal('modal-admin-cancel');
      UI.toast('Запись отменена');
      load();
    }, function(err){
      btn.disabled = false;
      UI.showError(cancelError, err.message || 'Не удалось отменить запись');
      load();
    });
  });

  /* ---------- Перенос ---------- */
  var moveError = document.getElementById('am-error');
  list.addEventListener('click', function(e){
    var b = e.target.closest('[data-amove]');
    if (!b) return;
    current = find(Number(b.getAttribute('data-amove')));
    document.getElementById('am-sub').textContent = current.clientName + ' · ' + what(current) + ' · сейчас: ' + when(current);
    UI.hideError(moveError);
    if (!picker) {
      picker = UI.createTimePicker(document.getElementById('am-picker'), {
        loadDates: function(){ return API.adminGetRescheduleDates(current.id); },
        loadSlots: function(date){ return API.adminGetRescheduleSlots(current.id, date); },
        onChange: function(s){ moveSel = s; moveBtn.classList.toggle('btn--disabled', !(s.date && s.time)); }
      });
    }
    picker.reload();
    UI.openModal('modal-admin-move');
  });
  moveBtn.addEventListener('click', function(){
    if (moveBtn.classList.contains('btn--disabled') || moveBtn.disabled) return;
    if (moveSel.date === current.date && moveSel.time === current.time) {
      UI.showError(moveError, 'Это текущее время записи — выберите другое.');
      return;
    }
    moveBtn.disabled = true;
    API.adminRescheduleAppointment(current.id, moveSel).then(function(){
      moveBtn.disabled = false;
      UI.closeModal('modal-admin-move');
      UI.toast('Запись перенесена');
      load();
    }, function(err){
      moveBtn.disabled = false;
      UI.showError(moveError, err.message || 'Не удалось перенести запись');
      if (err.code === 'SLOT_TAKEN') picker.refreshSlots();
      else load();
    });
  });

  API.adminGetMasters().then(function(masters){
    f.master.innerHTML += masters.map(function(m){
      return '<option value="' + m.id + '">' + esc(m.name) + (m.active ? '' : ' (отключён)') + '</option>';
    }).join('');
    if (UI.query('masterId')) f.master.value = UI.query('masterId'); // переход из предупреждения о блокировке
  }, function(){ /* без списка мастеров фильтр просто пустой */ }).then(load);
})();
