/* Успешная запись: сводка по записи из адреса /booking/success?id=… */
(function(){
  var esc = UI.esc;
  UI.renderSteps(document.getElementById('bk-steps'), 5);

  var id = UI.query('id');
  API.getAppointment(id).then(function(a){
    document.getElementById('bk-success-sum').innerHTML =
      '<b>' + esc(a.serviceName + (a.designNails ? ' + дизайн, ' + a.designNails + ' ногт.' : '')) + '</b><br>' +
      esc(UI.fmtDateLong(a.date) + ' · ' + a.time + '–' + a.endTime) + ' · мастер <b>' + esc(a.masterName) + '</b><br>' +
      'Длительность ' + UI.fmtDuration(a.duration) + ' · <b>' + UI.fmtPrice(a.price) + '</b>, оплата в салоне';
  }, function(){
    document.getElementById('success-card').hidden = true;
    document.getElementById('success-missing').hidden = false;
  });
})();
