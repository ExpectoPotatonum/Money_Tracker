import {
  formatMoney,
  formatDateTime,
  toDateTimeLocal,
  fromDateTimeLocal,
  currencyOptions,
} from '../utils/format.js';
import { confirmDelete } from './common.js';

const DIRECTIONS = ['debit', 'credit'];
const NOTES_MAX = 255;

/**
 * Renders the transactions table. In edit mode every data cell becomes an
 * editable control; changes are reported via `onDirty(id, patch)` and saved
 * by the view when edit mode is toggled off (no per-row Save buttons). Delete
 * is the only per-row action. Cell values are rendered via textContent
 * (untrusted-notification-input convention) — only the form controls the user
 * interacts with use inputs.
 */
export function transactionTable({
  transactions,
  categoryNames,
  myrTotals = new Map(),
  editMode = false,
  onDirty = null,
  onDelete = null,
  onToggleRecurring = null,
}) {
  const table = document.createElement('table');
  table.className = 'table table-sm table-striped align-middle';

  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>Date</th>
    <th>Receiver</th>
    <th>Category</th>
    <th class="text-end">Amount</th>
    <th class="text-end">MYR</th>
    <th>Sent from</th>
    <th>Notes</th>
    <th></th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  // Rebuild the per-row editable state from the transaction, so a re-render
  // (e.g. after a sibling save) reflects fresh data.
  function draftFor(t) {
    return {
      transaction_date: t.transaction_date,
      amount: String(t.amount),
      currency: t.currency,
      direction: t.direction,
      merchant_raw: t.merchant_raw ?? '',
      category_id: t.category_id ?? '',
      notes: t.notes ?? '',
    };
  }

  for (const t of transactions) {
    const tr = document.createElement('tr');

    if (!editMode) {
      // --- Read-only row (today's appearance + a Notes column) ---
      tr.appendChild(dateCell(t));
      tr.appendChild(merchantCell(t));
      tr.appendChild(categoryCell(t, categoryNames));
      tr.appendChild(amountCell(t));
      tr.appendChild(myrCell(t, myrTotals));
      tr.appendChild(sourceCell(t));
      tr.appendChild(notesCell(t));
      tr.appendChild(actionCell());
    } else {
      // --- Editable row ---
      const draft = draftFor(t);
      // Every edit recomputes the diff vs. the original and reports it; the
      // view accumulates these and PATCHes them all when edit mode closes.
      const report = () => {
        if (onDirty) onDirty(t.id, normalizeDraft(draft, t));
      };

      tr.appendChild(dateInputCell(draft, report));
      tr.appendChild(merchantEditCell(draft, report));
      tr.appendChild(categoryEditCell(draft, categoryNames, report));
      tr.appendChild(amountEditCell(draft, report));
      tr.appendChild(myrCell(t, myrTotals)); // MYR recomputed on refresh, not editable
      tr.appendChild(sourceCell(t));
      tr.appendChild(notesEditCell(draft, report));
      tr.appendChild(
        actionCell({
          onDelete: () => onDelete(t.id),
          isRecurring: t.is_recurring,
          onToggleRecurring: onToggleRecurring
            ? () => onToggleRecurring(t.id, !t.is_recurring)
            : null,
        }),
      );
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return table;

  // ---- read-only cell builders ----
  function dateCell(t) {
    const td = document.createElement('td');
    td.className = 'text-nowrap';
    td.textContent = formatDateTime(t.transaction_date);
    return td;
  }

  function merchantCell(t) {
    const td = document.createElement('td');
    const name = t.merchant_display ?? t.merchant_raw ?? 'Unknown';
    td.textContent = name;
    if (t.merchant_raw && t.merchant_display && t.merchant_raw !== t.merchant_display) {
      td.title = `matched from: ${t.merchant_raw}`;
    }
    return td;
  }

  function categoryCell(t, cats) {
    const td = document.createElement('td');
    td.textContent = (t.category_id && cats.get(t.category_id)) || '—';
    return td;
  }

  function amountCell(t) {
    const td = document.createElement('td');
    td.className = 'text-end';
    td.textContent = formatMoney(t.amount, t.currency);
    return td;
  }

  function myrCell(t, myr) {
    const td = document.createElement('td');
    td.className = 'text-end';
    const val = myr.get(t.id);
    td.textContent = val !== null && val !== undefined ? formatMoney(val, 'MYR') : '—';
    return td;
  }

  function sourceCell(t) {
    const td = document.createElement('td');
    td.className = 'text-muted small';
    td.textContent = t.source_app_label ?? t.source_package;
    return td;
  }

  function notesCell(t) {
    const td = document.createElement('td');
    td.className = 'small text-break';
    td.textContent = t.notes || '';
    return td;
  }

  // ---- edit-mode cell builders ----
  function dateInputCell(draft, report) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'form-control form-control-sm';
    input.value = toDateTimeLocal(draft.transaction_date);
    input.addEventListener('input', () => {
      draft.transaction_date = fromDateTimeLocal(input.value);
      report();
    });
    td.appendChild(input);
    return td;
  }

  function merchantEditCell(draft, report) {
    const td = document.createElement('td');
    const raw = document.createElement('input');
    raw.type = 'text';
    raw.className = 'form-control form-control-sm';
    raw.placeholder = 'Receiver (raw text)';
    raw.value = draft.merchant_raw;
    raw.addEventListener('input', () => {
      draft.merchant_raw = raw.value;
      report();
    });
    td.appendChild(raw);
    return td;
  }

  function categoryEditCell(draft, cats, report) {
    const td = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    select.appendChild(empty);
    for (const [id, name] of cats) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      opt.selected = id === draft.category_id;
      select.appendChild(opt);
    }
    select.value = draft.category_id;
    select.addEventListener('change', () => {
      draft.category_id = select.value;
      report();
    });
    td.appendChild(select);
    return td;
  }

  function amountEditCell(draft, report) {
    const td = document.createElement('td');
    td.className = 'text-end';
    const wrap = document.createElement('div');
    wrap.className = 'd-flex gap-1 justify-content-end';
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.step = '0.01';
    amount.min = '0';
    amount.className = 'form-control form-control-sm text-end';
    amount.value = draft.amount;
    amount.addEventListener('input', () => {
      draft.amount = amount.value;
      report();
    });
    const currency = document.createElement('select');
    currency.className = 'form-select form-select-sm w-auto';
    for (const c of currencyOptions()) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      opt.selected = c === draft.currency;
      currency.appendChild(opt);
    }
    currency.value = draft.currency;
    currency.addEventListener('change', () => {
      draft.currency = currency.value;
      report();
    });
    const direction = document.createElement('select');
    direction.className = 'form-select form-select-sm w-auto';
    for (const d of DIRECTIONS) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      opt.selected = d === draft.direction;
      direction.appendChild(opt);
    }
    direction.value = draft.direction;
    direction.addEventListener('change', () => {
      draft.direction = direction.value;
      report();
    });
    wrap.append(amount, currency, direction);
    td.appendChild(wrap);
    return td;
  }

  function notesEditCell(draft, report) {
    const td = document.createElement('td');
    const input = document.createElement('textarea');
    input.className = 'form-control form-control-sm';
    input.rows = 2;
    input.maxLength = NOTES_MAX;
    input.value = draft.notes;
    input.placeholder = 'Add a comment…';
    input.addEventListener('input', () => {
      // maxLength already hard-stops typing; the slice is the same guard for
      // anything pasting in more than the field allows at once.
      draft.notes = input.value.slice(0, NOTES_MAX);
      report();
    });
    td.appendChild(input);
    return td;
  }

  function actionCell({ onDelete, isRecurring, onToggleRecurring } = {}) {
    const td = document.createElement('td');
    td.className = 'text-end text-nowrap';
    if (onToggleRecurring) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-link p-0 border-0';
      btn.setAttribute('aria-label', 'Toggle recurring');
      btn.title = isRecurring ? 'Marked as recurring — click to remove' : 'Mark as recurring';
      btn.textContent = '🔁';
      btn.style.opacity = isRecurring ? '1' : '0.3';
      btn.style.fontSize = '16px';
      btn.addEventListener('click', () => onToggleRecurring());
      td.appendChild(btn);
    }
    if (onDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-sm btn-link p-0 border-0';
      del.setAttribute('aria-label', 'Delete');
      del.title = 'Delete';
      const img = document.createElement('img');
      img.src = '/red-cross-mark.png';
      img.alt = '';
      img.className = 'd-block';
      img.style.width = '22px';
      img.style.height = '22px';
      del.appendChild(img);
      del.addEventListener('click', () => {
        if (confirmDelete()) onDelete();
      });
      td.appendChild(del);
    }
    return td;
  }
}

// Build the patch from the draft, coercing types to what the schema expects.
// Returns null if nothing actually changed (so the row skips the no-op PATCH).
function normalizeDraft(draft, original) {
  const patch = {};

  if (draft.transaction_date !== original.transaction_date) {
    patch.transaction_date = draft.transaction_date;
  }
  if (Number(draft.amount) !== Number(original.amount)) {
    patch.amount = Number(draft.amount);
  }
  if (draft.currency !== original.currency) patch.currency = draft.currency;
  if (draft.direction !== original.direction) patch.direction = draft.direction;
  if ((draft.merchant_raw || null) !== (original.merchant_raw ?? null)) {
    patch.merchant_raw = draft.merchant_raw || null;
  }
  if ((draft.category_id || null) !== (original.category_id ?? null)) {
    patch.category_id = draft.category_id || null;
  }
  const notes = (draft.notes ?? '').slice(0, 255) || null;
  if (notes !== (original.notes ?? null)) {
    patch.notes = notes;
  }

  return Object.keys(patch).length ? patch : null;
}
