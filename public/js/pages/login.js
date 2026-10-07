/* Вход по email и паролю. После входа — возврат на исходную страницу (?next=…) */
(function(){
  var form = document.getElementById('login-form');
  var error = document.getElementById('login-error');
  var next = UI.safeNext();

  // Ссылка на регистрацию сохраняет адрес возврата
  if (next) {
    var reg = document.querySelector('a[href="/register"]');
    if (reg) reg.href = '/register?next=' + encodeURIComponent(next);
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    UI.hideError(error);
    var email = document.getElementById('login-email').value.trim();
    var pass = document.getElementById('login-pass').value;
    if (!email || !pass) { UI.showError(error, 'Введите email и пароль'); return; }
    var btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    API.login(email, pass).then(function(user){
      location.href = next || (user.role === 'admin' ? '/admin' : '/booking');
    }, function(err){
      btn.disabled = false;
      UI.showError(error, err.message || 'Неверный email или пароль');
    });
  });
})();
