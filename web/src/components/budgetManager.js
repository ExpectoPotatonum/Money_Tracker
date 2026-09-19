// Budget manager (Phase 4, §4.9.5). A modal for maintaining the `budgets`
// table: either the overall budget (category_id NULL) or a per-category
// budget, monthly and MYR-only in v1 (decisions 2/3). Spend-vs-budget bars
// live on the dashboard; this modal only edits the targets.

import { listBudgets, saveBudget, deleteBudget } from '../api/budgets.js';
import { getCategoryTree } from '../api/transactions.js';
import { openModal } from './common.js';
import { formatMoney } from '../utils/format.js';
import { t } from '../lib/i18n.js';

export async function openBudgetManager({ onChanged = null } = {}) {
  const { dialog, body, footer } = openModal({
    title: t('budgets.managerTitle'),
    onClose: () => {
      if (onChanged) onChanged();
    },
  });
  body.className = 'modal-body';

  // Latest category tree, hoisted out of reload() so the add form (which the
  // manager renders before any reload completes) gets the real list.
  let latestCategories = [];

  const reload = async () => {
    const [budgets, categories] = await Promise.all([listBudgets(), getCategoryTree()]);
    latestCategories = categories;
    body.replaceChildren();
    if (budgets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = t('budgets.none');
      body.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'list-group';
      for (const b of budgets) {
        const row = document.createElement('div');
        row.className = 'list-group-item d-flex justify-content-between align-items-center';

        const name = document.createElement('div');
        const label = document.createElement('div');
        label.textContent = b.category ? `${b.category.icon ?? ''} ${b.category.name}`.trim() : t('budgets.overall');
        const meta = document.createElement('small');
        meta.className = 'text-muted';
        meta.textContent = `${formatMoney(b.amount, b.currency)} · ${b.period}`;
        name.append(label, meta);

        const actions = document.createElement('div');
        actions.className = 'btn-group btn-group-sm';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn btn-outline-secondary';
        edit.textContent = t('budgets.edit');
        edit.addEventListener('click', () => openBudgetForm({ budget: b, categories, onSaved: reload }));
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-outline-danger';
        del.textContent = t('budgets.delete');
        del.addEventListener('click', async () => {
          if (!window.confirm(t('budgets.deleteConfirm'))) return;
          try {
            await deleteBudget(b.id);
            await reload();
          } catch (err) {
            window.alert(err.message);
          }
        });
        actions.append(edit, del);

        row.append(name, actions);
        list.appendChild(row);
      }
      body.appendChild(list);
    }
  };

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-sm btn-outline-primary';
  add.textContent = t('budgets.add');
  add.addEventListener('click', () =>
    openBudgetForm({ budget: null, categories: latestCategories, onSaved: reload }),
  );
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-sm btn-secondary';
  close.textContent = t('settings.close');
  close.addEventListener('click', () => dialog.close());
  footer.append(close, add);

  await reload();
}

// Second <dialog> stacked over the manager (same pattern as accountManager.js
// Add/edit form). Fields: kind (overall / per-category), category, amount.
function openBudgetForm({ budget = null, categories = [], onSaved = null } = {}) {
  const isEdit = Boolean(budget);
  const { dialog, body, footer } = openModal({ title: isEdit ? t('budgets.edit') : t('budgets.add') });
  body.className = 'modal-body';

  const field = (labelText) => {
    const g = document.createElement('div');
    g.className = 'mb-3';
    const l = document.createElement('label');
    l.className = 'form-label';
    l.textContent = labelText;
    const el = document.createElement('div');
    g.append(l, el);
    body.appendChild(g);
    return el;
  };

  // kind radio: overall vs category
  const kindWrap = field(t('budgets.field.type'));
  const overallRadio = radio('kind-overall', 'kind', 'overall', t('budgets.type.overall'), !budget || !budget.category_id);
  const categoryRadio = radio('kind-category', 'kind', 'category', t('budgets.type.category'), Boolean(budget && budget.category_id));
  kindWrap.append(overallRadio, categoryRadio);

  // category select (hidden when overall)
  const catWrap = field(t('budgets.field.category'));
  const catSelect = document.createElement('select');
  catSelect.className = 'form-select';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = t('col.pick');
  catSelect.appendChild(placeholder);
  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.icon ?? ''} ${c.name}`.trim();
    catSelect.appendChild(opt);
  }
  catSelect.value = budget?.category_id ?? '';
  catWrap.appendChild(catSelect);
  catWrap.classList.toggle('d-none', overallRadio.checked);

  // amount
  const amountWrap = field(t('budgets.field.amount'));
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.min = '0';
  amount.step = '0.01';
  amount.className = 'form-control';
  amount.value = budget?.amount ?? '';
  amountWrap.appendChild(amount);

  const hint = document.createElement('small');
  hint.className = 'text-muted d-block';
  hint.textContent = t('budgets.currencyHint');
  amountWrap.appendChild(hint);

  const syncKind = () => {
    catWrap.classList.toggle('d-none', overallRadio.checked);
  };
  overallRadio.addEventListener('change', syncKind);
  categoryRadio.addEventListener('change', syncKind);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = t('budgets.save');
  save.addEventListener('click', async () => {
    const categoryId = overallRadio.checked ? null : catSelect.value;
    const amt = Number(amount.value || 0);
    if (!overallRadio.checked && !categoryId) {
      window.alert(t('budgets.needCategory'));
      return;
    }
    if (amt < 0) {
      window.alert(t('budgets.needAmount'));
      return;
    }
    save.disabled = true;
    try {
      await saveBudget({ id: budget?.id ?? null, categoryId, amount: amt });
      if (onSaved) await onSaved();
      dialog.close();
    } catch (err) {
      save.disabled = false;
      window.alert(err.message);
    }
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-sm btn-secondary';
  cancel.textContent = t('nl.cancel');
  cancel.addEventListener('click', () => dialog.close());
  footer.append(cancel, save);
}

function radio(id, name, value, labelText, checked) {
  const lab = document.createElement('label');
  lab.className = 'form-check form-check-inline';
  const input = document.createElement('input');
  input.type = 'radio';
  input.id = id;
  input.name = name;
  input.value = value;
  input.className = 'form-check-input';
  input.checked = checked;
  const span = document.createElement('span');
  span.className = 'form-check-label';
  span.textContent = labelText;
  lab.append(input, span);
  return lab;
}