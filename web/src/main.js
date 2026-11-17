import 'bootstrap/dist/css/bootstrap.min.css';
import './style.css';
import { getSession, onAuthStateChange, signOut, updatePassword } from './api/auth.js';
import { renderAuthGate } from './views/authGate.js';
import { renderDashboard } from './views/dashboard.js';
import { renderReports } from './views/reports.js';
import { renderReviewInbox } from './views/reviewInbox.js';
import { renderRawNotifications } from './views/rawNotifications.js';
import { installLogger, logApiError } from './lib/logger.js';
import { openSettings } from './components/settingsDialog.js';
import { openTagManager } from './components/tagManager.js';
import { openAccountManager } from './components/accountManager.js';
import { openCategoryManager } from './components/categoryManager.js';
import { openBudgetManager } from './components/budgetManager.js';
import { openExportDialog } from './components/exportDialog.js';
import { icon } from './utils/icons.js';
import { t } from './lib/i18n.js';
import { applyTheme, cycleTheme } from './lib/theme.js';

const app = document.getElementById('app');

// The rail is collapsed by default. Hovering it expands it (push layout); the
// hamburger *pins* it expanded, persisted across reloads/routes. CSS does the
// layout (labels hide, icons remain) — this only flips the shell's class.
const SIDEBAR_PIN_KEY = 'mt_sidebar_pinned';

installLogger();

// Dark mode: apply the persisted preference (default: follow the system) and
// keep tracking it live so an OS-level flip re-themes the app in-place.
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

function currentView() {
  const h = window.location.hash;
  if (h === '#/review') return 'review';
  if (h === '#/reports') return 'reports';
  if (h === '#/raw') return 'raw';
  return 'dashboard';
}

// Managers live in the sidebar now; when one reports a change the dashboard
// (if mounted) soft-refreshes in place instead of remounting the view.
function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent('mt:data-changed'));
}

// Whether the rail is pinned expanded. Default false → collapsed on load.
function sidebarPinned() {
  try {
    return localStorage.getItem(SIDEBAR_PIN_KEY) === '1';
  } catch {
    return false;
  }
}

function setSidebarPinned(pinned) {
  try {
    localStorage.setItem(SIDEBAR_PIN_KEY, pinned ? '1' : '0');
  } catch {
    // localStorage unavailable — the pin still works for this page.
  }
}

function renderSidebar() {
  const nav = document.createElement('nav');
  nav.className = 'app-sidebar';

  // Brand block — BeeCount-style: app title, no logo. The empty slot mirrors a
  // nav icon so the title aligns with the nav labels and reserves the column
  // the fixed hamburger occupies (it sits in the top-left of the rail).
  const brand = document.createElement('a');
  brand.className = 'sidebar-brand';
  brand.href = '#/';
  const brandSlot = document.createElement('span');
  brandSlot.className = 'sidebar-brand-slot';
  brandSlot.setAttribute('aria-hidden', 'true');
  const brandTitle = document.createElement('span');
  brandTitle.className = 'sidebar-brand-title sidebar-label';
  brandTitle.textContent = t('app.title');
  brand.append(brandSlot, brandTitle);
  nav.appendChild(brand);

  // Primary links. Keep the .nav-link class so the e2e `nav .nav-link.active`
  // assertion (reports.spec) keeps matching — the sidebar IS the nav element.
  const links = document.createElement('div');
  links.className = 'sidebar-links';

  const navItem = (href, label, view, iconName) => {
    const a = document.createElement('a');
    a.href = href;
    a.className = `nav-link ${currentView() === view ? 'active' : ''}`;
    // data-tip drives the collapsed-rail tooltip; aria-label keeps the
    // accessible name once the text label is display:none.
    a.dataset.tip = label;
    a.setAttribute('aria-label', label);
    a.appendChild(icon(iconName, { size: 18 }));
    const span = document.createElement('span');
    span.className = 'sidebar-label';
    span.textContent = label;
    a.appendChild(span);
    return a;
  };

  links.append(
    navItem('#/', t('nav.dashboard'), 'dashboard', 'dashboard'),
    navItem('#/review', t('nav.review'), 'review', 'review'),
    navItem('#/reports', t('nav.reports'), 'reports', 'reports'),
    navItem('#/raw', t('nav.raw'), 'raw', 'raw'),
  );
  nav.appendChild(links);

  // Dashboard tools — moved out of the dashboard header. Each opens the same
  // modal it always did; `onChanged` triggers a soft refresh of the mounted
  // dashboard rather than a full view remount (SPA-like, preserves scroll).
  const sub = document.createElement('div');
  sub.className = 'sidebar-sub';

  const subItem = (id, iconName, label, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'sidebar-btn sidebar-sub-btn';
    btn.dataset.tip = label;
    btn.setAttribute('aria-label', label);
    btn.appendChild(icon(iconName, { size: 16 }));
    const span = document.createElement('span');
    span.className = 'sidebar-label';
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', onClick);
    return btn;
  };

  sub.append(
    subItem('tags-manage-btn', 'tags', t('tags.manage'), () =>
      openTagManager({ onChanged: notifyDataChanged }),
    ),
    subItem('accounts-manage-btn', 'accounts', t('accounts.manage'), () =>
      openAccountManager({ onChanged: notifyDataChanged }),
    ),
    subItem('categories-manage-btn', 'categories', t('categories.manage'), () =>
      openCategoryManager({ onChanged: notifyDataChanged }),
    ),
    subItem('budgets-manage-btn', 'budgets', t('budgets.manage'), () =>
      openBudgetManager({ onChanged: notifyDataChanged }),
    ),
    subItem('csv-export-btn', 'export', t('nav.export'), () => openExportDialog()),
  );
  nav.appendChild(sub);

  // Footer: theme, settings, sign out. Ids move with them so the e2e clicks
  // (#nav-theme-btn, #nav-settings-btn) keep working from the new location.
  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';

  // Theme toggle: shows the RESOLVED icon (what's actually active, not the
  // stored preference) and cycles system -> dark -> light on click.
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.id = 'nav-theme-btn';
  themeBtn.className = 'sidebar-btn';
  themeBtn.dataset.tip = t('nav.theme');
  themeBtn.setAttribute('aria-label', t('nav.theme'));
  const themeGlyph = document.createElement('span');
  themeGlyph.className = 'sidebar-glyph';
  const themeLabel = document.createElement('span');
  themeLabel.className = 'sidebar-label';
  themeLabel.textContent = t('nav.theme');
  // Monochrome line icon (Sun/Moon), matching Settings / Sign out — the old
  // bright-yellow ☀️/🌙 emoji stood out against the uniform sidebar glyphs.
  const syncThemeIcon = () => {
    const dark = document.documentElement.dataset.bsTheme === 'dark';
    themeGlyph.replaceChildren(icon(dark ? 'moon' : 'sun', { size: 18 }));
  };
  themeBtn.addEventListener('click', () => {
    cycleTheme();
    syncThemeIcon();
  });
  syncThemeIcon();
  themeBtn.append(themeGlyph, themeLabel);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.id = 'nav-settings-btn';
  settingsBtn.className = 'sidebar-btn';
  settingsBtn.dataset.tip = t('nav.settings');
  settingsBtn.setAttribute('aria-label', t('nav.settings'));
  settingsBtn.appendChild(icon('settings', { size: 18 }));
  const settingsLabel = document.createElement('span');
  settingsLabel.className = 'sidebar-label';
  settingsLabel.textContent = t('nav.settings');
  settingsBtn.appendChild(settingsLabel);
  settingsBtn.addEventListener('click', () => openSettings());

  const signOutBtn = document.createElement('button');
  signOutBtn.type = 'button';
  signOutBtn.className = 'sidebar-btn';
  signOutBtn.dataset.tip = t('nav.signOut');
  signOutBtn.setAttribute('aria-label', t('nav.signOut'));
  // An icon, not just a label: the collapsed rail hides every .sidebar-label,
  // so a label-only Sign out vanished entirely when collapsed.
  signOutBtn.appendChild(icon('signOut', { size: 18 }));
  const signOutLabel = document.createElement('span');
  signOutLabel.className = 'sidebar-label';
  signOutLabel.textContent = t('nav.signOut');
  signOutBtn.appendChild(signOutLabel);
  signOutBtn.addEventListener('click', () => signOut().catch(() => {}));

  footer.append(themeBtn, settingsBtn, signOutBtn);
  nav.appendChild(footer);
  return nav;
}

// Hamburger, fixed to the top-left of the whole page (the rail itself sits
// below it). Clicking it PINS the rail expanded (click again to unpin, back to
// hover-only); it never moves when the rail collapses. The icon never changes.
function sidebarToggle(isPinned, onToggle) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'sidebar-collapse-btn';
  btn.className = 'sidebar-toggle';
  const sync = () => {
    const pinned = isPinned();
    const label = t(pinned ? 'nav.collapse' : 'nav.expand');
    btn.setAttribute('aria-expanded', String(pinned));
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  btn.appendChild(icon('menu', { size: 20 }));
  btn.addEventListener('click', () => {
    onToggle(!isPinned());
    sync();
  });
  sync();
  return btn;
}

async function render() {
  const { data } = await getSession();
  if (!data.session) {
    renderAuthGate(app);
    return;
  }

  const viewRoot = document.createElement('div');
  viewRoot.className = 'app-view';
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  const sidebarEl = renderSidebar();

  // Collapsed by default; hovering (or keyboard focus) expands it, and the
  // hamburger pins it expanded. `hovered` is transient, `pinned` persists.
  let pinned = sidebarPinned();
  let hovered = false;
  const applySidebarState = () => shell.classList.toggle('sidebar-collapsed', !(pinned || hovered));
  applySidebarState();
  sidebarEl.addEventListener('mouseenter', () => {
    hovered = true;
    applySidebarState();
  });
  sidebarEl.addEventListener('mouseleave', () => {
    hovered = false;
    applySidebarState();
  });
  sidebarEl.addEventListener('focusin', () => {
    hovered = true;
    applySidebarState();
  });
  sidebarEl.addEventListener('focusout', (e) => {
    if (!sidebarEl.contains(e.relatedTarget)) {
      hovered = false;
      applySidebarState();
    }
  });

  // The hamburger is fixed to the top-left of the page (so it never moves when
  // the rail collapses) but lives INSIDE the rail: a fixed child stays put while
  // the rail animates, and hovering the hamburger then counts as hovering the
  // rail, so the rail expands from the icon too.
  const toggle = sidebarToggle(
    () => pinned,
    (next) => {
      pinned = next;
      setSidebarPinned(next);
      applySidebarState();
    },
  );
  sidebarEl.append(toggle);
  shell.append(sidebarEl, viewRoot);
  app.replaceChildren(shell);

  try {
    const view = currentView();
    if (view === 'review') {
      await renderReviewInbox(viewRoot);
    } else if (view === 'reports') {
      await renderReports(viewRoot);
    } else if (view === 'raw') {
      await renderRawNotifications(viewRoot);
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
