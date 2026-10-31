(() => {
  const form = document.querySelector('[data-signup-form]');
  if (!form) return;
  const credentials = form.querySelector('[data-signup-step="credentials"]');
  const preferences = form.querySelector('[data-signup-step="preferences"]');
  const next = form.querySelector('[data-signup-next]');
  const back = document.querySelector('[data-signup-back]');
  const home = document.querySelector('[data-signup-home]');
  const title = document.getElementById('auth-title');
  const intro = document.querySelector('[data-signup-intro]');
  const progress = document.querySelector('[data-signup-progress]');
  const summary = form.querySelector('[data-signup-error]');
  let busy = false;

  function showStep(second) {
    credentials.hidden = second;
    preferences.hidden = !second;
    back.hidden = !second;
    home.hidden = second;
    title.textContent = second ? 'Любимые теги' : 'Создать аккаунт';
    intro.textContent = second ? 'Настройте подборку мероприятий под себя.' : 'Начните с почты и пароля.';
    progress.textContent = second ? 'Шаг 2 из 2' : 'Шаг 1 из 2';
    title.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function fieldError(name, messages) {
    const input = form.elements.namedItem(name);
    const error = document.getElementById(`id_${name}_error`);
    if (!input || !error) return;
    error.textContent = messages.join(' ');
    error.hidden = !messages.length;
    const descriptions = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    if (messages.length) {
      input.setAttribute('aria-invalid', 'true');
      descriptions.add(error.id);
    } else {
      input.removeAttribute('aria-invalid');
      descriptions.delete(error.id);
    }
    if (descriptions.size) input.setAttribute('aria-describedby', [...descriptions].join(' '));
    else input.removeAttribute('aria-describedby');
  }

  back.addEventListener('click', () => showStep(false));
  for (const name of ['email', 'password1']) {
    form.elements.namedItem(name).addEventListener('input', () => fieldError(name, []));
  }

  form.addEventListener('submit', async event => {
    if (busy) { event.preventDefault(); return; }
    if (!preferences.hidden) {
      const selected = new FormData(form).getAll('interests').join(', ');
      const error = document.getElementById('id_interests_error');
      if (selected.length > 300) {
        event.preventDefault();
        error.textContent = 'Выберите меньше тегов — оставьте самые важные для вас.';
        error.hidden = false;
        preferences.querySelector('input[name="interests"]:checked')?.focus();
      }
      return;
    }
    event.preventDefault();
    summary.hidden = true;
    for (const name of ['email', 'password1']) {
      const input = form.elements.namedItem(name);
      fieldError(name, []);
      if (!input.reportValidity()) return;
    }
    const data = new FormData();
    for (const name of ['csrfmiddlewaretoken', 'email', 'password1']) data.set(name, form.elements.namedItem(name).value);
    data.set('intent', 'credentials');
    busy = true;
    next.disabled = true;
    next.setAttribute('aria-busy', 'true');
    next.firstChild.textContent = 'Проверяем…';
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (response.ok && result.valid) {
        showStep(true);
      } else if (response.status === 400 && result.errors) {
        for (const [name, errors] of Object.entries(result.errors)) fieldError(name, errors.map(error => error.message));
        form.querySelector('[aria-invalid="true"]')?.focus();
      } else throw new Error('Unexpected response');
    } catch {
      summary.textContent = 'Не удалось проверить данные. Попробуйте ещё раз.';
      summary.hidden = false;
    } finally {
      busy = false;
      next.disabled = false;
      next.removeAttribute('aria-busy');
      next.firstChild.textContent = 'Продолжить';
    }
  });
})();
