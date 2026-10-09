/* Админ-панель: мастера — специализация, услуги мастера, дизайн ногтей, график по дням недели, отключение */
(function(){
  var esc = UI.esc;
  var list = document.getElementById('masters-list');
  var form = document.getElementById('master-form');
  var error = document.getElementById('mm-error');
  var servicesBox = document.getElementById('mm-services');
  var schedBox = document.getElementById('mm-sched');
  var DAYS = [2, 3, 4, 5, 6]; // салон работает вт–сб
  var warning = document.getElementById('mst-warning');
  var CHECK = '<span class="check__box"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></span>';
  var items = [], services = [], editId = null;

  function row(m){
    var skills = m.serviceNames.slice();
    if (m.doesDesign) skills.push('дизайн ногтей');
    return '<div class="admin-row' + (m.active ? '' : ' is-off') + '">' +
      '<div class="admin-row__main">' +
        '<div class="admin-row__title">' + esc(m.name) + '</div>' +
        '<div class="admin-row__meta">' + esc(m.specialization) + '</div>' +
        '<div class="admin-row__meta">' + esc(skills.join(', ')) + '</div>' +
        '<div class="admin-row__meta">' + esc(m.scheduleText) + '</div>' +
      '</div>' +
      '<div class="admin-row__side">' +
        '<span class="badge ' + (m.active ? 'badge--ok">Активна' : 'badge--cancelled">Отключена') + '</span>' +
        '<label class="switch" title="Доступна при записи"><input type="checkbox" data-switch="' + m.id + '"' + (m.active ? ' checked' : '') + ' aria-label="Доступна при записи"><span class="switch__track"></span></label>' +
        '<button class="btn btn--secondary btn--sm" type="button" data-edit="' + m.id + '">Редактировать</button>' +
      '</div>' +
    '</div>';
  }
  function load(){
    return Promise.all([API.adminGetMasters(), API.adminGetServices()]).then(function(r){
      items = r[0]; services = r[1];
      list.innerHTML = items.map(row).join('');
    }, function(err){
      list.innerHTML = '';
      UI.showError(warning, err.message || 'Не удалось загрузить мастеров');
    });
  }

  function openForm(m){
    editId = m ? m.id : null;
    document.getElementById('mm-title').textContent = m ? 'Редактировать мастера' : 'Добавить мастера';
    document.getElementById('mm-name').value = m ? m.name : '';
    document.getElementById('mm-spec').value = m ? m.specialization : '';
    servicesBox.innerHTML = services.map(function(s){
      var on = m && m.serviceIds.indexOf(s.id) !== -1;
      return '<label class="check"><input type="checkbox" data-service="' + s.id + '"' + (on ? ' checked' : '') + '>' + CHECK +
        '<span>' + esc(s.name) + (s.active ? '' : ' (отключена)') + '</span></label>';
    }).join('') +
      '<label class="check"><input type="checkbox" id="mm-design"' + (m && m.doesDesign ? ' checked' : '') + '>' + CHECK +
      '<span>Дизайн ногтей (доп. опция)</span></label>';
    schedBox.innerHTML = DAYS.map(function(d){
      var h = m && m.schedule[d];
      return '<div class="sched__row' + (h ? '' : ' is-off') + '" data-day="' + d + '">' +
        '<label class="check"><input type="checkbox" data-sched-day' + (h ? ' checked' : '') + '>' + CHECK + '<span>' + UI.WD_SHORT[d] + '</span></label>' +
        '<div class="sched__times">' +
          '<input class="field__input" type="text" inputmode="numeric" value="' + (h ? h[0] : '10:00') + '"' + (h ? '' : ' disabled') + ' aria-label="Начало"> – ' +
          '<input class="field__input" type="text" inputmode="numeric" value="' + (h ? h[1] : '18:00') + '"' + (h ? '' : ' disabled') + ' aria-label="Конец">' +
        '</div>' +
      '</div>';
    }).join('');
    UI.hideError(error);
    UI.openModal('modal-master');
  }
  schedBox.addEventListener('change', function(e){
    var cb = e.target.closest('[data-sched-day]');
    if (!cb) return;
    var r = cb.closest('.sched__row');
    r.classList.toggle('is-off', !cb.checked);
    r.querySelectorAll('.sched__times input').forEach(function(i){ i.disabled = !cb.checked; });
  });

  document.getElementById('master-add').addEventListener('click', function(){ openForm(null); });
  list.addEventListener('click', function(e){
    var b = e.target.closest('[data-edit]');
    if (!b) return;
    var id = Number(b.getAttribute('data-edit'));
    openForm(items.filter(function(m){ return m.id === id; })[0]);
  });
  list.addEventListener('change', function(e){
    var sw = e.target.closest('[data-switch]');
    if (!sw) return;
    UI.hideError(warning);
    API.setMasterActive(Number(sw.getAttribute('data-switch')), sw.checked).then(function(r){
      UI.toast(r.master.active ? 'Мастер включён' : 'Мастер отключён');
      // Записи не отменяются автоматически — показываем, сколько их осталось
      if (r.warning) UI.showError(warning, r.master.name + ': ' + r.warning);
      load();
    }, function(err){
      UI.showError(warning, err.message || 'Не удалось изменить мастера');
      load();
    });
  });
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var schedule = {};
    schedBox.querySelectorAll('.sched__row').forEach(function(r){
      if (!r.querySelector('[data-sched-day]').checked) return;
      var t = r.querySelectorAll('.sched__times input');
      schedule[r.getAttribute('data-day')] = [t[0].value.trim(), t[1].value.trim()];
    });
    var data = {
      name: document.getElementById('mm-name').value,
      specialization: document.getElementById('mm-spec').value,
      serviceIds: Array.prototype.map.call(servicesBox.querySelectorAll('[data-service]:checked'), function(c){ return Number(c.getAttribute('data-service')); }),
      doesDesign: document.getElementById('mm-design').checked,
      schedule: schedule
    };
    var req = editId ? API.adminUpdateMaster(editId, data) : API.adminCreateMaster(data);
    req.then(function(){
      UI.closeModal('modal-master');
      UI.toast('Мастер сохранён');
      load();
    }, function(err){
      UI.showError(error, err.message || 'Не удалось сохранить мастера');
    });
  });

  load();
})();
