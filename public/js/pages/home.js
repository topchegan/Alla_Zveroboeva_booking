/* Главная: услуги, мастера, режим работы и контакты — из API */
(function(){
  var esc = UI.esc;

  function serviceRow(name, meta, price){
    return '<div class="svc-row">' +
      '<div><div class="svc-row__name">' + name + '</div><div class="svc-row__meta">' + esc(meta) + '</div></div>' +
      '<span class="svc-row__leader"></span>' +
      '<span class="price">' + price + '</span>' +
    '</div>';
  }

  Promise.all([API.getServices(), API.getDesignOption()]).then(function(r){
    var services = r[0], design = r[1];
    var nail = services.filter(function(s){ return s.isNail; });
    var other = services.filter(function(s){ return !s.isNail; });
    var row = function(s){ return serviceRow(esc(s.name), UI.fmtDuration(s.duration), UI.fmtPrice(s.price)); };
    var designMeta = '+' + design.extraMinutes[0].minutes + '–' + design.extraMinutes[design.extraMinutes.length - 1].minutes +
      ' мин · выбор ' + design.nails.join('/') + ' ногтей';
    document.getElementById('home-services').innerHTML =
      '<div>' + nail.map(row).join('') + '</div>' +
      '<div>' +
        serviceRow(esc(design.name) + ' <span class="svc-row__tag">доп. опция</span>', designMeta, '<small>от</small> ' + UI.fmtPrice(design.pricePerTwoNails)) +
        other.map(row).join('') +
      '</div>';
  });

  API.getMasters().then(function(masters){
    document.getElementById('home-masters').innerHTML = masters.map(function(m){
      return '<div class="master-tile">' +
        '<span class="avatar avatar--lg">' + esc(m.initials) + '</span>' +
        '<div><div class="master-tile__name">' + esc(m.name) + '</div><div class="master-tile__role">' + esc(m.role) + '</div></div>' +
        '<p class="master-tile__sched">' + UI.ICONS.clock + esc(m.scheduleText) + '</p>' +
      '</div>';
    }).join('');
  });

  API.getSalonInfo().then(function(s){
    document.getElementById('home-hours').innerHTML = s.hours.map(function(h){
      return '<div class="hours-row"><b>' + esc(h.days) + '</b>' +
        (h.time ? '<span>' + esc(h.time) + '</span>' : '<span class="day-off">выходной</span>') + '</div>';
    }).join('');
    document.querySelectorAll('[data-salon-hours]').forEach(function(el){ el.textContent = s.hoursShort; });
    document.querySelector('[data-salon-note]').textContent = 'Только по предварительной записи · ' + s.hoursShort;
    var phone = document.querySelector('[data-salon-phone]');
    phone.textContent = s.phone; phone.href = s.phoneHref;
    var email = document.querySelector('[data-salon-email]');
    email.textContent = s.email; email.href = 'mailto:' + s.email;
    document.querySelector('[data-salon-address]').textContent = s.address;
  });
})();
