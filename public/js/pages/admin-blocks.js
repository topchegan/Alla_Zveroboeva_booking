/* Админ-панель: еженедельные блокировки времени мастеров */
(function(){
  var esc = UI.esc;
  var list = document.getElementById('bl-list');
  var form = document.getElementById('bl-form');
  var error = document.getElementById('bl-error');
  var allDay = document.getElementById('bl-allday');
  var warning = document.getElementById('bl-warning');

  // Предупреждение: блокировка сохранена, но на это время уже есть записи — их список
  function showConflicts(r){
    var text = warning.querySelector('[data-error-text]');
    text.innerHTML = esc(r.warning) + '<ul>' + r.conflicts.map(function(a){
      return '<li>' + esc(UI.fmtDateShort(a.date) + ' · ' + a.time + '–' + a.endTime + ' · ' + a.clientName + ' (' + a.clientEmail + ') · ' + a.serviceName) + '</li>';
    }).join('') + '</ul>' + '<a href="/admin?masterId=' + r.block.masterId + '">Открыть записи</a>';
    warning.classList.add('is-visible');
  }

  function row(b){
    var time = b.allDay ? 'весь день' : b.from + '–' + b.to;
    var reason = b.reason ? ' · ' + esc(b.reason) : '';
    return '<div class="admin-row">' +
      '<div class="admin-row__main">' +
        '<div class="admin-row__title">' + esc(b.masterName) + '</div>' +
        '<div class="admin-row__meta">' + UI.WD_SHORT[b.weekday] + ' · ' + time + reason + '</div>' +
      '</div>' +
      '<div class="admin-row__side"><button class="btn btn--text" type="button" data-del="' + b.id + '">Удалить</button></div>' +
    '</div>';
  }
  function load(){
    return API.getBlocks().then(function(data){
      list.innerHTML = data.length ? data.map(row).join('')
        : '<div class="state-box" style="padding:var(--sp-6)"><p class="state-box__title" style="font-size:1.15rem">Блокировок нет</p></div>';
    }, function(err){
      list.innerHTML = '';
      UI.showError(warning, err.message || 'Не удалось загрузить блокировки');
    });
  }

  allDay.addEventListener('change', function(){
    document.getElementById('bl-from').disabled = allDay.checked;
    document.getElementById('bl-to').disabled = allDay.checked;
  });
  list.addEventListener('click', function(e){
    var b = e.target.closest('[data-del]');
    if (!b) return;
    UI.hideError(warning);
    API.deleteBlock(Number(b.getAttribute('data-del'))).then(function(){
      UI.toast('Блокировка удалена');
      load();
    }, function(err){
      UI.showError(warning, err.message || 'Не удалось удалить блокировку');
      load();
    });
  });
  form.addEventListener('submit', function(e){
    e.preventDefault();
    UI.hideError(error);
    UI.hideError(warning);
    API.createBlock({
      masterId: document.getElementById('bl-master').value,
      weekday: document.getElementById('bl-day').value,
      from: document.getElementById('bl-from').value.trim(),
      to: document.getElementById('bl-to').value.trim(),
      allDay: allDay.checked,
      reason: document.getElementById('bl-reason').value
    }).then(function(r){
      UI.toast('Блокировка добавлена');
      if (r.conflicts.length) showConflicts(r);
      load();
    }, function(err){
      UI.showError(error, err.message || 'Не удалось добавить блокировку');
    });
  });

  API.adminGetMasters().then(function(masters){
    document.getElementById('bl-master').innerHTML = masters.map(function(m){
      return '<option value="' + m.id + '">' + esc(m.name) + (m.active ? '' : ' (отключён)') + '</option>';
    }).join('');
  });
  load();
})();
