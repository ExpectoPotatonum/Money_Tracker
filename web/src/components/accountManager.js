// Account manager (Phase 3, §4.8.5). A modal for maintaining accounts and the
// "Unassigned" flow: transactions whose rows carry no account, with one-click
// "create account for this app" and "assign all from this app" actions.
//
// Balance shown per account is an estimate computed from the loaded-window
// transactions passed by the dashboard (opening balance + Σ credits − debits
// over rows that reference the account). Real, full-history balances are a
// Phase 4 read; this just makes the manager useful in the meantime.
import { openModal } from './common.js';
import {
  listAccounts,
  saveAccount,
  deleteAccount,
  assignPackageRows,
} from '../api/accounts.js';
import { currencyOptions } from '../utils/format.js';
import { t } from '../lib/i18n.js';

const ACCOUNT_TYPES = [
  'cash',
  'checking',
  'savings',
  'credit',
  'ewallet',
  'virtual',
  'investment',
];

const COLOR_PRESETS = [
  '#6f42c1', // purple
  '#0d6efd', // blue
  '#198754', // green
  '#fd7e14', // orange
  '#dc3545', // red
  '#0dcaf0', // cyan
  '#d63384', // pink
  '#6c757d', // gray
];

// First-run defaults (owner decision #6): created web-side so user_id is set
// under RLS. Names/types are ordinary editable accounts afterwards.
const SUGGESTED = [
  { name: 'Cash', type: 'cash' },
  { name: 'TnG eWallet', type: 'ewallet' },
  { name: 'Samsung Wallet', type: 'credit' },
  { name: 'HLB Connect', type: 'checking' },
  { name: 'Wise', type: 'ewallet' },
];

export function openAccountManager({ transactions = [], onChanged = null } = {}) {
  let changed = false;
  const { dialog, body, footer } = openModal({
    title: t('accounts.managerTitle'),
    onClose: () => {
      if (changed && onChanged) onChanged();
    },
  });
  body.className = 'modal-body';
  body.style.maxHeight = '70vh';
  body.style.overflowY = 'auto';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-outline-secondary';
  close.textContent = t('settings.close');
  close.addEventListener('click', () => dialog.close());
  footer.appendChild(close);

  render().catch((err) => {
    console.error('account manager load failed', err);
    body.replaceChildren();
    const msg = document.createElement('div');
    msg.className = 'alert alert-danger py-2 small';
    msg.textContent = String(err?.message ?? err);
    body.appendChild(msg);
  });

  async function render() {
    const accounts = await listAccounts();
    body.replaceChildren();

    if (accounts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'small text-muted mb-3';
      empty.textContent = t('accounts.none');
      body.appendChild(empty);
    }

    // --- account list ---
    for (const account of accounts) {
      body.appendChild(accountRow(account, transactions));
    }

    // --- create actions ---
    const actions = document.createElement('div');
    actions.className = 'd-flex flex-wrap gap-2 mt-3';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-primary';
    addBtn.textContent = t('accounts.add');
    addBtn.addEventListener('click', () =>
      openAccountForm({ onSaved: () => ((changed = true), render()) }),
    );
    actions.appendChild(addBtn);

    const suggestedBtn = document.createElement('button');
    suggestedBtn.type = 'button';
    suggestedBtn.className = 'btn btn-sm btn-outline-secondary';
    suggestedBtn.textContent = t('accounts.suggested');
    suggestedBtn.addEventListener('click', () =>
      addSuggested().then(() => ((changed = true), render())),
    );
    actions.appendChild(suggestedBtn);

    body.appendChild(actions);

    // --- unassigned flow ---
    body.appendChild(unassignedSection(transactions, accounts));
  }

  // One account = name/type/currency/opening + estimated current balance, with
  // Edit (open the form) and Delete (guarded: refuses while in use).
  function accountRow(account, txns) {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center gap-2 border rounded px-2 py-1 mb-1';

    const icon = document.createElement('span');
    icon.textContent = account.icon || '💳';
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'fw-semibold';
    name.textContent = account.name;
    row.appendChild(name);

    const type = document.createElement('span');
    type.className = 'badge text-bg-secondary';
    type.textContent = t(`accounts.type.${account.type}`) || account.type;
    row.appendChild(type);

    const meta = document.createElement('span');
    meta.className = 'small text-muted ms-auto';
    const est = estBalance(account, txns);
    meta.textContent = `${t('accounts.balanceNow')} ${formatAmount(est, account.currency)}`;
    row.appendChild(meta);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-sm btn-link p-0 ms-1';
    editBtn.textContent = t('accounts.edit');
    editBtn.addEventListener('click', () =>
      openAccountForm({ account, onSaved: () => ((changed = true), render()) }),
    );
    row.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-link text-danger p-0 ms-1';
    delBtn.textContent = t('accounts.delete');
    delBtn.addEventListener('click', async () => {
      if (!window.confirm(t('accounts.deleteConfirm'))) return;
      try {
        await deleteAccount(account.id);
        changed = true;
        render();
      } catch (err) {
        window.alert(`${t('accounts.deleteConfirm')} ${err.message}`);
      }
    });
    row.appendChild(delBtn);

    return row;
  }

  // Transactions from parsed notifications with no account, grouped by
  // package. Each group gets "assign all → account" (also records the default
  // map row so future captures land there) and "create account for this app".
  function unassignedSection(txns, accounts) {
    const groups = new Map(); // package -> { count, label }
    for (const tx of txns) {
      if (tx.account_id || tx.transfer_group_id) continue;
      if (tx.source_package === 'manual') continue; // handled in edit mode
      const g = groups.get(tx.source_package) ?? {
        count: 0,
        label: tx.source_app_label || tx.source_package,
      };
      g.count += 1;
      groups.set(tx.source_package, g);
    }

    const section = document.createElement('div');
    section.className = 'mt-4';

    if (groups.size === 0) return section;

    const head = document.createElement('h6');
    head.className = 'small fw-bold text-uppercase text-muted';
    head.textContent = t('accounts.unassigned');
    section.appendChild(head);

    const hint = document.createElement('div');
    hint.className = 'small text-muted mb-2';
    hint.textContent = t('accounts.unassignedHint');
    section.appendChild(hint);

    if (accounts.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'small';
      msg.textContent = t('accounts.none');
      section.appendChild(msg);
      return section;
    }

    for (const [pkg, g] of groups) {
      const row = document.createElement('div');
      row.className = 'd-flex align-items-center gap-2 small mb-1';
      row.dataset.pkg = pkg;

      const label = document.createElement('span');
      label.textContent = `${g.label} (${g.count})`;
      label.title = pkg;
      row.appendChild(label);

      const select = document.createElement('select');
      select.className = 'form-select form-select-sm w-auto';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = t('accounts.pickTarget');
      select.appendChild(placeholder);
      for (const acct of accounts) {
        const opt = document.createElement('option');
        opt.value = acct.id;
        opt.textContent = acct.name;
        select.appendChild(opt);
      }
      row.appendChild(select);

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn btn-sm btn-outline-secondary';
      go.textContent = t('accounts.assignAll').replace('{pkg}', g.label);
      go.addEventListener('click', async () => {
        if (!select.value) {
          select.focus();
          return;
        }
        go.disabled = true;
        try {
          await assignPackageRows(pkg, select.value);
          changed = true;
          render();
        } catch (err) {
          go.disabled = false;
          window.alert(err.message);
        }
      });
      row.appendChild(go);

      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'btn btn-sm btn-link p-0 ms-1';
      create.textContent = t('accounts.createFor').replace('{app}', g.label);
      create.addEventListener('click', () =>
        openAccountForm({
          prefill: { name: g.label, currency: 'MYR' },
          onSaved: async (account) => {
            try {
              await assignPackageRows(pkg, account.id);
              changed = true;
              render();
            } catch (err) {
              window.alert(err.message);
            }
          },
        }),
      );
      row.appendChild(create);

      section.appendChild(row);
    }

    return section;
  }

  // "Add suggested accounts": Cash + the apps the tracker actually captures.
  // Idempotent — a name collision (unique user_id+name) just skips that one.
  async function addSuggested() {
    for (const s of SUGGESTED) {
      try {
        await saveAccount({ ...s, currency: 'MYR', opening_balance: 0 });
      } catch {
        /* already exists — skip */
      }
    }
  }

  function estBalance(account, txns) {
    let sum = Number(account.opening_balance ?? 0);
    for (const tx of txns) {
      if (tx.account_id !== account.id) continue;
      sum += tx.direction === 'credit' ? Number(tx.amount) : -Number(tx.amount);
    }
    return sum;
  }
}

function formatAmount(value, currency) {
  const symbol = currency ? `${currency} ` : '';
  return `${symbol}${Number(value).toFixed(2)}`;
}

// Add/edit account form (second <dialog> stacked over the manager).
function openAccountForm({ account = null, prefill = {}, onSaved = null } = {}) {
  const isEdit = Boolean(account);
  const { dialog, body, footer } = openModal({ title: isEdit ? t('accounts.edit') : t('accounts.add') });
  body.className = 'modal-body';

  const fields = {};

  const field = (key, label, input) => {
    const grp = document.createElement('div');
    grp.className = 'mb-2';
    const l = document.createElement('label');
    l.className = 'form-label small mb-1';
    l.textContent = label;
    input.className =
      input.tagName === 'SELECT'
        ? 'form-select form-select-sm'
        : 'form-control form-control-sm';
    grp.append(l, input);
    body.appendChild(grp);
    fields[key] = input;
  };

  const name = document.createElement('input');
  name.type = 'text';
  name.required = true;
  name.value = (account?.name ?? prefill.name ?? '');

  const typeSel = document.createElement('select');
  for (const type of ACCOUNT_TYPES) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = t(`accounts.type.${type}`) || type;
    opt.selected = type === (account?.type ?? 'cash');
    typeSel.appendChild(opt);
  }
  typeSel.value = account?.type ?? 'cash';

  const currencySel = document.createElement('select');
  for (const code of currencyOptions()) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    opt.selected = code === (account?.currency ?? prefill.currency ?? 'MYR');
    currencySel.appendChild(opt);
  }
  currencySel.value = account?.currency ?? prefill.currency ?? 'MYR';

  const icon = document.createElement('input');
  icon.type = 'text';
  icon.maxLength = 4;
  icon.value = account?.icon ?? '';

  const colorSel = document.createElement('select');
  const noneColor = document.createElement('option');
  noneColor.value = '';
  noneColor.textContent = t('tags.noColor');
  colorSel.appendChild(noneColor);
  for (const c of COLOR_PRESETS) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    opt.selected = c === account?.color;
    colorSel.appendChild(opt);
  }
  colorSel.value = account?.color ?? '';

  const opening = document.createElement('input');
  opening.type = 'number';
  opening.step = '0.01';
  opening.value = account?.opening_balance ?? 0;

  const openingDate = document.createElement('input');
  openingDate.type = 'date';
  openingDate.value = account?.opening_balance_date ?? '';

  const hidden = document.createElement('input');
  hidden.type = 'checkbox';
  hidden.className = 'form-check-input';
  hidden.checked = Boolean(account?.is_hidden);

  const order = document.createElement('input');
  order.type = 'number';
  order.value = account?.sort_order ?? 0;

  field('name', t('accounts.field.name'), name);
  field('type', t('accounts.field.type'), typeSel);
  field('currency', t('accounts.field.currency'), currencySel);
  field('icon', t('accounts.field.icon'), icon);
  field('color', t('accounts.field.color'), colorSel);
  field('openingBalance', t('accounts.field.openingBalance'), opening);
  field('openingDate', t('accounts.field.openingDate'), openingDate);

  const hiddenRow = document.createElement('div');
  hiddenRow.className = 'form-check mb-2';
  const hiddenLabel = document.createElement('label');
  hiddenLabel.className = 'form-check-label small';
  hiddenLabel.textContent = t('accounts.field.hidden');
  hiddenLabel.htmlFor = 'account-hidden';
  hidden.id = 'account-hidden';
  hiddenRow.append(hidden, hiddenLabel);
  body.appendChild(hiddenRow);

  field('sortOrder', t('accounts.field.sortOrder'), order);

  const errMsg = document.createElement('div');
  errMsg.className = 'small text-danger d-none';
  body.appendChild(errMsg);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = t('accounts.save');
  save.addEventListener('click', async () => {
    if (!name.value.trim()) {
      name.focus();
      return;
    }
    save.disabled = true;
    errMsg.classList.add('d-none');
    try {
      const saved = await saveAccount({
        id: account?.id ?? null,
        name: name.value.trim(),
        type: typeSel.value,
        currency: currencySel.value,
        icon: icon.value.trim() || null,
        color: colorSel.value || null,
        opening_balance: Number(opening.value || 0),
        opening_balance_date: openingDate.value || null,
        is_hidden: hidden.checked,
        sort_order: Number(order.value || 0),
      });
      dialog.close();
      if (onSaved) onSaved(saved);
    } catch (err) {
      save.disabled = false;
      errMsg.textContent = err.message;
      errMsg.classList.remove('d-none');
    }
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-outline-secondary';
  cancel.textContent = t('nl.cancel');
  cancel.addEventListener('click', () => dialog.close());

  footer.append(save, cancel);
}