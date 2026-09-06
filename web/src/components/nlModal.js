import { openModal } from './common.js';
import { parseTransactionText } from '../utils/ai.js';
import { insertTransaction } from '../api/transactions.js';
import { toDateTimeLocal, fromDateTimeLocal, currencyOptions } from '../utils/format.js';
import { llmConfigured } from '../utils/llm.js';
import { openSettings } from './settingsDialog.js';
import { t } from '../lib/i18n.js';

const DIRECTIONS = ['debit', 'credit'];

// Phase B — NL bookkeeping. Freeform sentence -> AI-parsed preview -> insert a
// manual transaction (source_package 'manual', no raw_notifications link —
// needs the 202609060003 migration). Manual rows carry confidence 'low' (no
// notification cross-check) and are ready for normal edit-mode correction.
export function openNlModal({ categoryNames, onSaved = null }) {
  const { dialog, body, footer } = openModal({ title: t('nl.title') });

  const text = document.createElement('textarea');
  text.className = 'form-control';
  text.rows = 3;
  text.placeholder = t('nl.placeholder');
  text.required = true;
  body.appendChild(text);

  const status = document.createElement('div');
  status.className = 'small text-muted mt-2';
  body.appendChild(status);

  const parseBtn = document.createElement('button');
  parseBtn.type = 'button';
  parseBtn.className = 'btn btn-primary';
  parseBtn.id = 'nl-parse-btn';
  parseBtn.textContent = t('nl.parse');

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-outline-secondary';
  cancel.textContent = t('nl.cancel');
  cancel.addEventListener('click', () => dialog.close());

  footer.appendChild(parseBtn);
  footer.appendChild(cancel);

  parseBtn.addEventListener('click', async () => {
    if (!text.value.trim()) return;
    if (!llmConfigured()) {
      status.textContent = t('settings.ai.keyMissing');
      status.classList.add('text-danger');
      status.classList.remove('text-muted');
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn btn-link btn-sm p-0 ms-2';
      go.textContent = t('nav.settings');
      go.addEventListener('click', () => openSettings());
      status.appendChild(go);
      return;
    }
    parseBtn.disabled = true;
    status.textContent = t('nl.parsing');
    status.classList.remove('text-danger');

    const draft = await parseTransactionText(text.value.trim(), categoryNames);
    if (!draft) {
      parseBtn.disabled = false;
      status.textContent = t('nl.failed');
      status.classList.add('text-danger');
      return;
    }
    status.classList.remove('text-danger');
    showPreview(draft);
  });

  function showPreview(draft) {
    parseBtn.style.display = 'none';
    body.replaceChildren();
    body.classList.add('pt-2');

    const note = document.createElement('div');
    note.className = 'small text-muted mb-3';
    note.textContent = t('nl.preview');
    body.appendChild(note);

    const fields = document.createElement('div');
    fields.className = 'row g-2';

    const amount = field('number', t('nl.field.amount'), String(draft.amount));
    amount.input.step = '0.01';
    amount.input.min = '0';
    fields.appendChild(amount.wrap('col-4'));

    const currency = selectField(t('nl.field.currency'), currencyOptions(), draft.currency);
    fields.appendChild(currency.wrap('col-4'));

    const direction = selectField(t('nl.field.direction'), DIRECTIONS, draft.direction, {
      debit: t('nl.direction.debit'),
      credit: t('nl.direction.credit'),
    });
    fields.appendChild(direction.wrap('col-4'));

    const merchant = field('text', t('nl.field.merchant'), draft.merchant_raw ?? '');
    fields.appendChild(merchant.wrap('col-12'));

    const category = selectField(
      t('nl.field.category'),
      [...categoryNames.values()],
      categoryLabel(draft.category_id),
      undefined,
      true,
    );
    fields.appendChild(category.wrap('col-12'));

    const date = field(
      'datetime-local',
      t('nl.field.date'),
      toDateTimeLocal(draft.transaction_date),
    );
    fields.appendChild(date.wrap('col-6'));

    const notes = field('text', t('nl.field.notes'), draft.notes ?? '');
    fields.appendChild(notes.wrap('col-6'));

    body.appendChild(fields);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-primary';
    save.id = 'nl-save-btn';
    save.textContent = t('nl.save');
    save.addEventListener('click', async () => {
      const row = {
        amount: Number(amount.input.value),
        currency: currency.input.value,
        direction: direction.input.value,
        merchant_raw: merchant.input.value.trim() || null,
        category_id: categoryIdFromLabel(category.input.value),
        transaction_date: fromDateTimeLocal(date.input.value),
        notes: notes.input.value.trim() || null,
        source_package: 'manual',
        source_app_label: 'Manual',
        confidence: 'low',
        status: 'confirmed',
        notification_posted_at: fromDateTimeLocal(date.input.value),
      };
      save.disabled = true;
      try {
        await insertTransaction(row);
        status.className = 'small text-success mt-2';
        status.textContent = t('nl.saved');
        body.appendChild(status);
        if (onSaved) onSaved();
        setTimeout(() => dialog.close(), 700);
      } catch (err) {
        save.disabled = false;
        status.className = 'small text-danger mt-2';
        status.textContent = `${t('nl.saveFailed')} ${err.message}`;
        body.appendChild(status);
      }
    });
    footer.replaceChildren(save, cancel);
  }

  function categoryLabel(id) {
    if (!id) return '';
    return categoryNames.get(id) ?? '';
  }
  function categoryIdFromLabel(label) {
    if (!label) return null;
    for (const [id, name] of categoryNames) {
      if (name === label) return id;
    }
    return null;
  }
}

// Small form-field helpers (labels rendered via textContent — user data never
// goes through innerHTML, matching the rest of the app).
function field(type, label, value) {
  const wrapEl = document.createElement('div');
  const l = document.createElement('label');
  l.className = 'form-label small mb-1';
  l.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.className = 'form-control form-control-sm';
  input.value = value;
  return { wrap: (col) => ((wrapEl.className = col), wrapEl.append(l, input), wrapEl), input };
}

function selectField(label, options, selected, labels = {}, allowEmpty = false) {
  const wrapEl = document.createElement('div');
  const l = document.createElement('label');
  l.className = 'form-label small mb-1';
  l.textContent = label;
  const select = document.createElement('select');
  select.className = 'form-select form-select-sm';
  if (allowEmpty) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    select.appendChild(empty);
  }
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = labels[opt] ?? opt;
    el.selected = opt === selected;
    select.appendChild(el);
  }
  select.value = selected;
  return {
    wrap: (col) => ((wrapEl.className = col), wrapEl.append(l, select), wrapEl),
    input: select,
  };
}
