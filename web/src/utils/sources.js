import { t } from '../lib/i18n.js';

// Payment-method picker for the "Sent from" field (source_app_label). Manual and
// NL-added rows default to DEFAULT_SOURCE; anything else — a notification's real
// app label, or any custom method — lands on the "Custom…" option backed by a
// text input, so the owner can type any source without touching the DB.
export const DEFAULT_SOURCE = 'Cash';
export const SOURCE_PRESETS = ['Cash', 'Bank', 'e-Wallet', 'Manual', 'Card'];

// Renders a select (presets + "Custom…") with an inline text input revealed
// when the value isn't one of the presets. onChange(value) fires on every user
// edit with the chosen label (null when cleared, allowEmpty mode only).
export function buildSourceEditor(initial, { allowEmpty = false, onChange } = {}) {
  const value = initial ?? '';

  const wrap = document.createElement('div');
  wrap.className = 'd-flex gap-1 align-items-center';

  const select = document.createElement('select');
  select.className = 'form-select form-select-sm source-picker';
  if (allowEmpty) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    select.appendChild(empty);
  }
  for (const preset of SOURCE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset;
    opt.textContent = preset;
    select.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = t('source.custom');
  select.appendChild(customOpt);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control form-control-sm source-picker-custom';
  input.placeholder = t('source.customPlaceholder');
  input.style.maxWidth = '150px';
  input.hidden = true;

  const customized = Boolean(value) && !SOURCE_PRESETS.includes(value);
  select.value = customized ? '__custom__' : value || (allowEmpty ? '' : DEFAULT_SOURCE);
  if (customized) {
    input.value = value;
    input.hidden = false;
  }

  function emit() {
    onChange(select.value === '__custom__' ? input.value.trim() : select.value || null);
  }
  select.addEventListener('change', () => {
    const isCustom = select.value === '__custom__';
    input.hidden = !isCustom;
    if (isCustom) input.focus();
    emit();
  });
  input.addEventListener('input', emit);

  wrap.append(select, input);
  return wrap;
}