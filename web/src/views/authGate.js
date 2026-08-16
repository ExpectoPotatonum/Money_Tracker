import { signIn, signUp } from '../api/auth.js';

export function renderAuthGate(root) {
  root.replaceChildren();

  const card = document.createElement('div');
  card.id = 'auth-gate';
  card.className = 'card mx-auto mt-5 shadow-sm';
  card.style.maxWidth = '400px';

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('h1');
  title.className = 'h4 mb-1';
  title.textContent = 'Expense Tracker';
  body.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-muted small mb-3';
  subtitle.textContent = 'Sign in to see your spending.';
  body.appendChild(subtitle);

  const form = document.createElement('form');
  form.id = 'auth-form';
  form.noValidate = true;

  const emailGroup = document.createElement('div');
  emailGroup.className = 'mb-3';
  const emailLabel = document.createElement('label');
  emailLabel.className = 'form-label';
  emailLabel.setAttribute('for', 'auth-email');
  emailLabel.textContent = 'Email';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.id = 'auth-email';
  emailInput.className = 'form-control';
  emailInput.autocomplete = 'email';
  emailInput.required = true;
  emailGroup.append(emailLabel, emailInput);

  const passwordGroup = document.createElement('div');
  passwordGroup.className = 'mb-3';
  const passwordLabel = document.createElement('label');
  passwordLabel.className = 'form-label';
  passwordLabel.setAttribute('for', 'auth-password');
  passwordLabel.textContent = 'Password';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.id = 'auth-password';
  passwordInput.className = 'form-control';
  passwordInput.autocomplete = 'current-password';
  passwordInput.required = true;
  passwordGroup.append(passwordLabel, passwordInput);

  const errorDiv = document.createElement('div');
  errorDiv.className = 'alert alert-danger py-2 small d-none';
  errorDiv.setAttribute('role', 'alert');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.id = 'auth-submit';
  submit.className = 'btn btn-primary w-100';
  submit.textContent = 'Sign in';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'auth-mode-toggle';
  toggle.className = 'btn btn-link w-100 mt-2 small';
  toggle.textContent = 'No account yet? Create one';

  form.append(emailGroup, passwordGroup, errorDiv, submit, toggle);
  body.appendChild(form);
  card.appendChild(body);

  let mode = 'signin';

  toggle.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    submit.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    toggle.textContent =
      mode === 'signin' ? 'No account yet? Create one' : 'Already have an account? Sign in';
    errorDiv.classList.add('d-none');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorDiv.classList.add('d-none');
    submit.disabled = true;
    try {
      if (mode === 'signin') {
        await signIn(emailInput.value.trim(), passwordInput.value);
      } else {
        const result = await signUp(emailInput.value.trim(), passwordInput.value);
        if (result?.session === null) {
          errorDiv.textContent = 'Account created — check your email for a confirmation link.';
          errorDiv.className = 'alert alert-info py-2 small';
        }
      }
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.className = 'alert alert-danger py-2 small';
    } finally {
      submit.disabled = false;
    }
  });

  root.appendChild(card);
}
