/* Регистрация. Этап 1: проверка полей на странице, без сохранения на сервере */
(function(){
  var form = document.getElementById('register-form');
  var error = document.getElementById('register-error');

  form.addEventListener('submit', function(e){
    e.preventDefault();
    UI.hideError(error);
    var name = document.getElementById('reg-name').value.trim();
    var email = document.getElementById('reg-email').value.trim();
    var pass = document.getElementById('reg-pass').value;
    var pass2 = document.getElementById('reg-pass2').value;
    if (!name || !email || !pass || !pass2) { UI.showError(error, 'Заполните все поля'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { UI.showError(error, 'Проверьте email'); return; }
    if (pass !== pass2) { UI.showError(error, 'Пароли не совпадают'); return; }
    API.register({ name: name, email: email, password: pass }).then(function(){
      location.href = '/booking';
    }, function(err){
      UI.showError(error, err.message || 'Не удалось зарегистрироваться');
    });
  });
})();
