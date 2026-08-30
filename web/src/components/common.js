// Small DOM-building helpers. Notification text is untrusted input (it's been
// through the §8 redaction pass, but that's no excuse) — these builders only
// ever set textContent, never innerHTML, on anything that carries user data.

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
  return window.confirm('Delete this transaction? This cannot be undone.');
}
