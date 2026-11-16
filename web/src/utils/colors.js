// Colour picker shared by accounts, categories and tags. The UI shows colour
// *names* and swatches — never raw hex codes (owner request, 2026-11-16).
import { t } from '../lib/i18n.js';

export const COLOR_PRESETS = [
  { key: 'purple', value: '#6f42c1' },
  { key: 'blue', value: '#0d6efd' },
  { key: 'green', value: '#198754' },
  { key: 'orange', value: '#fd7e14' },
  { key: 'red', value: '#dc3545' },
  { key: 'cyan', value: '#0dcaf0' },
  { key: 'pink', value: '#d63384' },
  { key: 'gray', value: '#6c757d' },
];

let groupSeq = 0;

function presetFor(value) {
  return COLOR_PRESETS.find((p) => p.value === value) ?? null;
}

export function colorName(value) {
  if (!value) return t('colors.none');
  const preset = presetFor(value);
  return preset ? t(`colors.${preset.key}`) : t('colors.custom');
}

// `#rrggbb` -> `rgba(r,g,b,a)`, used for the tinted category pills (a light wash
// of the category's own colour behind its name). Anything that isn't a plain
// 6-digit hex falls back to the neutral grey so a bad value never breaks render.
export function hexToRgba(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return `rgba(108, 117, 125, ${alpha})`;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

// A row of radio swatches + the selected colour's name. `onChange(value)`
// receives '' for "no colour". Any non-preset existing value is kept as a
// "Custom" swatch so editing an older account never silently loses its colour.
export function colorSwatches({
  value = '',
  allowNone = true,
  onChange = null,
  ariaLabel = null,
} = {}) {
  const group = `color-swatch-${++groupSeq}`;
  const wrap = document.createElement('div');
  wrap.className = 'color-picker';
  wrap.setAttribute('role', 'radiogroup');
  if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);

  const nameLabel = document.createElement('span');
  nameLabel.className = 'color-swatch-name';
  nameLabel.textContent = colorName(value);

  const row = document.createElement('div');
  row.className = 'color-swatches';

  const current = value ?? '';

  const add = (val, label) => {
    const lbl = document.createElement('label');
    lbl.className = 'color-swatch';
    lbl.title = label;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = group;
    input.value = val;
    input.checked = current === val;
    input.setAttribute('aria-label', label);
    const dot = document.createElement('span');
    dot.className = 'color-swatch-dot';
    if (val) dot.style.backgroundColor = val;
    else dot.classList.add('is-none');
    lbl.append(input, dot);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      nameLabel.textContent = label;
      if (onChange) onChange(val);
    });
    row.appendChild(lbl);
  };

  if (allowNone) add('', t('colors.none'));
  for (const p of COLOR_PRESETS) add(p.value, t(`colors.${p.key}`));
  if (current && !presetFor(current)) add(current, t('colors.custom'));

  wrap.append(row, nameLabel);
  return wrap;
}
