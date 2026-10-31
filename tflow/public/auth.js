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
  const role = form.elements.namedItem('role');
  const roleChoices = [...form.querySelectorAll('[data-role-choice]')];
  const participantCopy = form.querySelector('.participant-copy');
  const organizerCopy = form.querySelector('.organizer-copy');
  const credentialsIntro = intro.textContent;
  let busy = false;

  function showRole() {
    for (const choice of roleChoices) {
      const selected = (choice.dataset.roleChoice === 'organizer') === role.checked;
      choice.setAttribute('aria-pressed', String(selected));
    }
    participantCopy.hidden = role.checked;
    organizerCopy.hidden = !role.checked;
  }

  if (roleChoices.length) {
    for (const choice of roleChoices) {
      choice.disabled = false;
      choice.addEventListener('click', () => {
        const organizer = choice.dataset.roleChoice === 'organizer';
        if (role.checked === organizer) return;
        role.checked = organizer;
        role.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    role.addEventListener('change', showRole);
    showRole();
  }

  function showStep(second) {
    credentials.hidden = second;
    preferences.hidden = !second;
    back.hidden = !second;
    home.hidden = second;
    title.textContent = second ? 'Любимые теги' : 'Создать аккаунт';
    intro.textContent = second ? 'Настройте подборку мероприятий под себя.' : credentialsIntro;
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
    if (!preferences.hidden) return;
    event.preventDefault();
    summary.hidden = true;
    for (const name of ['email', 'password1']) {
      const input = form.elements.namedItem(name);
      fieldError(name, []);
      if (!input.reportValidity()) return;
    }
    const data = new FormData();
    for (const name of ['csrfmiddlewaretoken', 'email', 'password1', 'next']) data.set(name, form.elements.namedItem(name).value);
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
