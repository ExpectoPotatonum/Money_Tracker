import 'bootstrap/dist/css/bootstrap.min.css';
import { getSession, onAuthStateChange, signOut, updatePassword } from './api/auth.js';
import { renderAuthGate } from './views/authGate.js';
import { renderDashboard } from './views/dashboard.js';
import { renderReviewInbox } from './views/reviewInbox.js';
import { installLogger, logApiError } from './lib/logger.js';
import { openSettings } from './components/settingsDialog.js';
import { t } from './lib/i18n.js';

const app = document.getElementById('app');

installLogger();

function currentView() {
  return window.location.hash === '#/review' ? 'review' : 'dashboard';
}

function renderNav() {
  const nav = document.createElement('nav');
  nav.className = 'navbar navbar-expand navbar-light bg-light rounded mb-4 px-3';

  const brand = document.createElement('span');
  brand.className = 'navbar-brand mb-0 h1';
  brand.textContent = t('app.title');
  nav.appendChild(brand);

  const links = document.createElement('div');
  links.className = 'd-flex align-items-center gap-2 ms-auto';

  const dashboardLink = document.createElement('a');
  dashboardLink.href = '#/';
  dashboardLink.className = `nav-link ${currentView() === 'dashboard' ? 'active' : ''}`;
  dashboardLink.textContent = t('nav.dashboard');

  const reviewLink = document.createElement('a');
  reviewLink.href = '#/review';
  reviewLink.className = `nav-link ${currentView() === 'review' ? 'active' : ''}`;
  reviewLink.textContent = t('nav.review');

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.id = 'nav-settings-btn';
  settingsBtn.className = 'btn btn-outline-secondary btn-sm';
  settingsBtn.textContent = t('nav.settings');
  settingsBtn.addEventListener('click', () => openSettings());

  const signOutBtn = document.createElement('button');
  signOutBtn.type = 'button';
  signOutBtn.className = 'btn btn-outline-secondary btn-sm';
  signOutBtn.textContent = t('nav.signOut');
  signOutBtn.addEventListener('click', () => signOut().catch(() => {}));

  links.append(dashboardLink, reviewLink, settingsBtn, signOutBtn);
  nav.appendChild(links);
  return nav;
}

async function render() {
  const { data } = await getSession();
  if (!data.session) {
    renderAuthGate(app);
    return;
  }

  const viewRoot = document.createElement('div');
  viewRoot.className = 'mt-3';
  app.replaceChildren(renderNav(), viewRoot);

  try {
    if (currentView() === 'review') {
      await renderReviewInbox(viewRoot);
    } else {
      await renderDashboard(viewRoot);
    }
  } catch (err) {
    logApiError('render', err);
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.setAttribute('role', 'alert');
    alert.textContent = `Failed to load: ${err.message}`;
    viewRoot.appendChild(alert);
  }
}

// Landing from the "reset password" email: Supabase gives us a recovery
// session and a PASSWORD_RECOVERY event. Render a set-new-password form
// instead of the dashboard, then bounce back to the sign-in gate.
function renderRecoverView() {
  app.replaceChildren();
  const card = document.createElement('div');
  card.id = 'recover-view';
  card.className = 'card mx-auto mt-5 shadow-sm';
  card.style.maxWidth = '400px';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'card-body';

  const form = document.createElement('form');
  form.noValidate = true;

  const field = (id, label, type) => {
    const group = document.createElement('div');
    group.className = 'mb-3';
    const l = document.createElement('label');
    l.className = 'form-label';
    l.setAttribute('for', id);
    l.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.className = 'form-control';
    input.required = true;
    group.append(l, input);
    form.appendChild(group);
    return input;
  };

  const pw = field('recover-password', t('auth.newPassword'), 'password');
  const pw2 = field('recover-password-2', t('auth.newPassword'), 'password');

  const msg = document.createElement('div');
  msg.className = 'alert alert-info py-2 small d-none';
  msg.setAttribute('role', 'status');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary w-100';
  submit.textContent = t('auth.updatePassword');

  form.append(msg, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.classList.add('d-none');
    if (pw.value.length < 8) {
      msg.textContent = t('auth.passwordTooShort');
      msg.className = 'alert alert-danger py-2 small';
      return;
    }
    if (pw.value !== pw2.value) {
      msg.textContent = t('auth.passwordMismatch');
      msg.className = 'alert alert-danger py-2 small';
      return;
    }
    submit.disabled = true;
    try {
      await updatePassword(pw.value);
      msg.textContent = t('auth.passwordUpdated');
      msg.className = 'alert alert-success py-2 small';
      await signOut().catch(() => {});
      setTimeout(() => renderAuthGate(app), 800);
    } catch (err) {
      submit.disabled = false;
      msg.textContent = err.message;
      msg.className = 'alert alert-danger py-2 small';
    }
  });

  bodyEl.appendChild(form);
  card.appendChild(bodyEl);
  app.appendChild(card);
}

onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) {
    renderRecoverView();
  } else if (session) {
    render();
  } else {
    renderAuthGate(app);
  }
});
window.addEventListener('hashchange', render);

render();
