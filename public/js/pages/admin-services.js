/* Админ-панель: услуги — добавление, редактирование, отключение */
(function(){
  var esc = UI.esc;
  var list = document.getElementById('services-list');
  var form = document.getElementById('service-form');
  var error = document.getElementById('ms-error');
  var items = [], editId = null;

  function row(s){
    return '<div class="admin-row' + (s.active ? '' : ' is-off') + '">' +
      '<div class="admin-row__main">' +
        '<div class="admin-row__title">' + esc(s.name) + '</div>' +
        '<div class="admin-row__meta">' + s.duration + ' мин · ' + UI.fmtPrice(s.price) + (s.isNail ? ' · ногтевая' : '') + '</div>' +
      '</div>' +
      '<div class="admin-row__side">' +
        '<span class="badge ' + (s.active ? 'badge--ok">Активна' : 'badge--cancelled">Отключена') + '</span>' +
        '<label class="switch" title="Доступна при записи"><input type="checkbox" data-switch="' + s.id + '"' + (s.active ? ' checked' : '') + ' aria-label="Доступна при записи"><span class="switch__track"></span></label>' +
        '<button class="btn btn--secondary btn--sm" type="button" data-edit="' + s.id + '">Редактировать</button>' +
      '</div>' +
    '</div>';
  }
  function load(){
    return API.adminGetServices().then(function(data){ items = data; list.innerHTML = data.map(row).join(''); });
  }
  function openForm(s){
    editId = s ? s.id : null;
    document.getElementById('ms-title').textContent = s ? 'Редактировать услугу' : 'Добавить услугу';
    document.getElementById('ms-name').value = s ? s.name : '';
    document.getElementById('ms-min').value = s ? s.duration : '';
    document.getElementById('ms-price').value = s ? s.price : '';
    document.getElementById('ms-nail').checked = s ? s.isNail : false;
    UI.hideError(error);
    UI.openModal('modal-service');
  }

  document.getElementById('service-add').addEventListener('click', function(){ openForm(null); });
  list.addEventListener('click', function(e){
    var b = e.target.closest('[data-edit]');
    if (!b) return;
    var id = Number(b.getAttribute('data-edit'));
    openForm(items.filter(function(s){ return s.id === id; })[0]);
  });
  list.addEventListener('change', function(e){
    var sw = e.target.closest('[data-switch]');
    if (!sw) return;
    API.setServiceActive(Number(sw.getAttribute('data-switch')), sw.checked).then(function(s){
      UI.toast(s.active ? 'Услуга включена' : 'Услуга отключена');
      load();
    });
  });
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var data = {
      name: document.getElementById('ms-name').value,
      duration: document.getElementById('ms-min').value,
      price: document.getElementById('ms-price').value,
      isNail: document.getElementById('ms-nail').checked
    };
    var req = editId ? API.adminUpdateService(editId, data) : API.adminCreateService(data);
    req.then(function(){
      UI.closeModal('modal-service');
      UI.toast('Услуга сохранена');
      load();
    }, function(err){
      UI.showError(error, err.message || 'Не удалось сохранить услугу');
    });
  });

  load();
})();
