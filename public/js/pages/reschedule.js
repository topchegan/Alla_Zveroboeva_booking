/* Перенос записи клиентом: /cabinet/reschedule?id=… (не позже чем за 24 ч до визита) */
(function(){
  var id = Number(UI.query('id'));
  var confirmBtn = document.getElementById('rs-confirm');
  var error = document.getElementById('rs-error');
  var appt = null, picker = null, sel = { date: null, time: null };

  function setCurrent(a){
    document.getElementById('rs-service').textContent = a.serviceName + (a.designNails ? ' + дизайн, ' + a.designNails + ' ногт.' : '');
    document.getElementById('rs-master').textContent = a.masterName;
    document.getElementById('rs-current').textContent = UI.fmtDateShort(a.date) + ', ' + a.time + '–' + a.endTime;
    document.getElementById('rs-duration').textContent = UI.fmtDuration(a.duration);
  }
  function blocked(title, text){
    document.getElementById('rs-blocked-title').textContent = title;
    document.getElementById('rs-blocked-text').textContent = text;
    document.getElementById('rs-blocked').hidden = false;
    confirmBtn.hidden = true;
  }
  function updateButton(){
    confirmBtn.classList.toggle('btn--disabled', !(sel.date && sel.time));
  }

  Promise.all([API.getAppointment(id), API.getSalonInfo()]).then(function(r){
    appt = r[0];
    setCurrent(appt);
    if (appt.status !== 'active' || appt.isStarted) {
      blocked('Перенос недоступен', 'Эту запись нельзя перенести: она отменена или уже прошла.');
      return;
    }
    if (!appt.canChange) {
      blocked('Перенос недоступен', 'Перенести запись можно не позже чем за 24 часа до визита. Свяжитесь с администратором: ' + r[1].phone);
      return;
    }
    picker = UI.createTimePicker(document.getElementById('rs-picker'), {
      initialDate: appt.date,
      loadDates: function(){ return API.getRescheduleDates(id); },
      loadSlots: function(date){ return API.getRescheduleSlots(id, date); },
      onChange: function(s){ sel = s; UI.hideError(error); updateButton(); }
    });
    picker.reload();
  }, function(){
    document.querySelector('.summary').hidden = true;
    blocked('Запись не найдена', 'Вернитесь в личный кабинет и выберите запись.');
  });

  confirmBtn.addEventListener('click', function(){
    if (confirmBtn.classList.contains('btn--disabled') || confirmBtn.disabled) return;
    if (sel.date === appt.date && sel.time === appt.time) {
      UI.showError(error, 'Это текущее время записи — выберите другое.');
      return;
    }
    confirmBtn.disabled = true;
    API.rescheduleAppointment(id, { date: sel.date, time: sel.time }).then(function(){
      UI.flash('Запись перенесена');
      location.href = '/cabinet';
    }, function(err){
      confirmBtn.disabled = false;
      UI.showError(error, err.message || 'Не удалось перенести запись');
      if (err.code === 'SLOT_TAKEN') picker.refreshSlots();
    });
  });
})();
