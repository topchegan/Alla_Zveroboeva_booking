/* Регистрация клиента. Те же проверки делает сервер; после регистрации пользователь сразу вошёл */
(function(){
  var form = document.getElementById('register-form');
  var error = document.getElementById('register-error');
  var next = UI.safeNext();
  var MIN_PASSWORD = 8;

  if (next) {
    var login = document.querySelector('a[href="/login"]');
    if (login) login.href = '/login?next=' + encodeURIComponent(next);
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    UI.hideError(error);
    var name = document.getElementById('reg-name').value.trim();
    var email = document.getElementById('reg-email').value.trim();
    var pass = document.getElementById('reg-pass').value;
    var pass2 = document.getElementById('reg-pass2').value;
    if (!name || !email || !pass || !pass2) { UI.showError(error, 'Заполните все поля'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { UI.showError(error, 'Проверьте email'); return; }
    if (pass.length < MIN_PASSWORD) { UI.showError(error, 'Пароль должен быть не короче ' + MIN_PASSWORD + ' символов'); return; }
    if (pass !== pass2) { UI.showError(error, 'Пароли не совпадают'); return; }
    var btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    API.register({ name: name, email: email, password: pass, passwordConfirm: pass2 }).then(function(){
      location.href = next || '/booking';
    }, function(err){
      btn.disabled = false;
      UI.showError(error, err.message || 'Не удалось зарегистрироваться');
    });
  });
})();
