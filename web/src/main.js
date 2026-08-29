import 'bootstrap/dist/css/bootstrap.min.css';
import { getSession, onAuthStateChange, signOut } from './api/auth.js';
import { renderAuthGate } from './views/authGate.js';
import { renderDashboard } from './views/dashboard.js';
import { renderReviewInbox } from './views/reviewInbox.js';
import { installLogger, logApiError } from './lib/logger.js';

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
  brand.textContent = 'Expense Tracker';
  nav.appendChild(brand);

  const links = document.createElement('div');
  links.className = 'd-flex align-items-center gap-2 ms-auto';

  const dashboardLink = document.createElement('a');
  dashboardLink.href = '#/';
  dashboardLink.className = `nav-link ${currentView() === 'dashboard' ? 'active' : ''}`;
  dashboardLink.textContent = 'Dashboard';

  const reviewLink = document.createElement('a');
  reviewLink.href = '#/review';
  reviewLink.className = `nav-link ${currentView() === 'review' ? 'active' : ''}`;
  reviewLink.textContent = 'Review inbox';

  const signOutBtn = document.createElement('button');
  signOutBtn.type = 'button';
  signOutBtn.className = 'btn btn-outline-secondary btn-sm';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', () => signOut().catch(() => {}));

  links.append(dashboardLink, reviewLink, signOutBtn);
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

onAuthStateChange((_event, session) => {
  if (session) render();
  else renderAuthGate(app);
});
window.addEventListener('hashchange', render);

render();
