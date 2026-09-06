// Small DOM-building helpers. Notification text is untrusted input (it's been
// through the §8 redaction pass, but that's no excuse) — these builders only
// ever set textContent, never innerHTML, on anything that carries user data.
import { t } from '../lib/i18n.js';

export function alertBanner({ type = 'warning', message, onDismiss = null } = {}) {
  const div = document.createElement('div');
  div.className = `alert alert-${type} alert-dismissible fade show`;
  div.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = message;
  div.appendChild(text);
  if (onDismiss) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-close';
    btn.setAttribute('aria-label', 'Close');
    btn.addEventListener('click', onDismiss);
    div.appendChild(btn);
  }
  return div;
}

export function emptyState(message) {
  const div = document.createElement('div');
  div.className = 'text-center text-muted py-5';
  div.textContent = message;
  return div;
}

export function badge(text, className = 'bg-secondary') {
  const span = document.createElement('span');
  span.className = `badge ${className}`;
  span.textContent = text;
  return span;
}

/** Browser-level delete confirmation. Returns true when the user confirms. */
export function confirmDelete() {
  return window.confirm(t('common.confirmDelete'));
}

/**
 * Native <dialog>-based modal (Bootstrap's JS bundle isn't loaded — only its
 * CSS — so we drive the platform dialog). Returns the dialog element; call
 * `dialog.close()` to dismiss. Closing on backdrop click or Escape is built in.
 */
export function openModal({ title, onClose = null } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal d-block position-fixed top-50 start-50 translate-middle';
  dialog.style.marginTop = '0';
  dialog.style.maxWidth = 'min(560px, 92vw)';

  const box = document.createElement('div');
  box.className = 'modal-dialog modal-dialog-centered';

  const content = document.createElement('div');
  content.className = 'modal-content';

  const head = document.createElement('div');
  head.className = 'modal-header';
  const h = document.createElement('h5');
  h.className = 'modal-title';
  h.textContent = title ?? '';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => dialog.close());
  head.append(h, closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  content.append(head, body, footer);
  box.appendChild(content);
  dialog.appendChild(box);

  dialog.addEventListener('close', () => {
    if (onClose) onClose();
    dialog.remove();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  return { dialog, body, footer };
}
