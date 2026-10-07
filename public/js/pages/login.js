/* Вход. Этап 1: настоящей авторизации нет — проверяем заполнение и переходим к записи */
(function(){
  var form = document.getElementById('login-form');
  var error = document.getElementById('login-error');

  form.addEventListener('submit', function(e){
    e.preventDefault();
    UI.hideError(error);
    var email = document.getElementById('login-email').value.trim();
    var pass = document.getElementById('login-pass').value;
    if (!email || !pass) { UI.showError(error, 'Введите email и пароль'); return; }
    API.login(email, pass).then(function(){
      location.href = '/booking';
    }, function(err){
      UI.showError(error, err.message || 'Неверный email или пароль');
    });
  });
})();
