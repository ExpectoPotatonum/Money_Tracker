// Category manager (2026-11-16). A modal for maintaining the shared
// `categories` table: two-level (parent → child), with an icon and a colour.
// Reachable from the sidebar on any page. Writes require the GRANT + policy in
// 202611160001_categories_and_debit_card.sql.
//
// Deletes are deliberately guarded server-side (api/categories.js): a category
// still referenced by transactions or by child categories cannot be removed —
// re-categorize/move first. Financial history is never cascaded away.
import { openModal } from './common.js';
import { listCategories, saveCategory, deleteCategory } from '../api/categories.js';
import { colorSwatches } from '../utils/colors.js';
import { t } from '../lib/i18n.js';

export function openCategoryManager({ onChanged = null } = {}) {
  let changed = false;
  const { dialog, body, footer } = openModal({
    title: t('categories.managerTitle'),
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

  render().catch(showLoadError);

  function showLoadError(err) {
    console.error('category manager load failed', err);
    body.replaceChildren();
    const msg = document.createElement('div');
    msg.className = 'alert alert-danger py-2 small';
    msg.textContent = String(err?.message ?? err);
    body.appendChild(msg);
  }

  async function render() {
    let rows;
    try {
      rows = await listCategories();
    } catch (err) {
      showLoadError(err);
      return;
    }
    body.replaceChildren();

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'small text-muted mb-3';
      empty.textContent = t('categories.none');
      body.appendChild(empty);
    } else {
      body.appendChild(categoryTree(rows));
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-primary mt-2';
    addBtn.textContent = t('categories.add');
    addBtn.addEventListener('click', () =>
      openCategoryForm({ all: rows, onSaved: () => ((changed = true), render()) }),
    );
    body.appendChild(addBtn);
  }

  // Parents at the top, children indented underneath. Anything with a missing
  // parent renders as a root so a stray row can still be edited/deleted.
  function categoryTree(rows) {
    const byId = new Map(rows.map((c) => [c.id, c]));
    const children = new Map();
    for (const row of rows) {
      const parent = row.parent_id && byId.has(row.parent_id) ? row.parent_id : null;
      const list = children.get(parent) ?? [];
      list.push(row);
      children.set(parent, list);
    }

    const wrap = document.createElement('div');
    wrap.className = 'mb-2';

    const renderLevel = (parentId, depth) => {
      for (const row of children.get(parentId) ?? []) {
        wrap.appendChild(categoryRow(row, depth, rows));
        renderLevel(row.id, depth + 1);
      }
    };
    renderLevel(null, 0);
    return wrap;
  }

  function categoryRow(row, depth, rows) {
    const el = document.createElement('div');
    el.className = 'd-flex align-items-center gap-2 border rounded px-2 py-1 mb-1';
    el.dataset.categoryId = row.id;
    if (depth > 0) el.style.marginLeft = `${depth * 1.5}rem`;

    const dot = document.createElement('span');
    dot.className = 'category-dot';
    if (row.color) dot.style.backgroundColor = row.color;
    el.appendChild(dot);

    const icon = document.createElement('span');
    icon.textContent = row.icon || '•';
    el.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'fw-semibold';
    name.textContent = row.name;
    el.appendChild(name);

    if (depth === 0 && (rows.some((c) => c.parent_id === row.id))) {
      const parentTag = document.createElement('span');
      parentTag.className = 'badge text-bg-secondary';
      parentTag.textContent = t('categories.parentBadge');
      el.appendChild(parentTag);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-sm btn-link p-0 ms-auto';
    editBtn.textContent = t('categories.edit');
    editBtn.addEventListener('click', () =>
      openCategoryForm({
        category: row,
        all: rows,
        onSaved: () => ((changed = true), render()),
      }),
    );
    el.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-link text-danger p-0 ms-1';
    delBtn.textContent = t('categories.delete');
    delBtn.addEventListener('click', async () => {
      if (!window.confirm(t('categories.deleteConfirm').replace('{name}', row.name))) return;
      try {
        await deleteCategory(row.id);
        changed = true;
        render();
      } catch (err) {
        if (err.code === 'CATEGORY_IN_USE') {
          window.alert(t('categories.inUse').replace('{count}', err.count));
        } else if (err.code === 'CATEGORY_HAS_CHILDREN') {
          window.alert(t('categories.hasChildren').replace('{count}', err.count));
        } else if (err.code === '23505') {
          window.alert(t('categories.duplicateName'));
        } else {
          window.alert(err.message);
        }
      }
    });
    el.appendChild(delBtn);

    return el;
  }
}

// Add/edit form — a second <dialog> stacked over the manager (same pattern as
// the budget manager). `all` powers the parent picker; when editing, the
// category itself and its descendants are excluded to keep the tree acyclic.
function openCategoryForm({ category = null, all = [], onSaved = null } = {}) {
  const isEdit = Boolean(category);
  const { dialog, body, footer } = openModal({
    title: isEdit ? t('categories.editTitle') : t('categories.addTitle'),
  });
  body.className = 'modal-body';

  const field = (labelText, node) => {
    const grp = document.createElement('div');
    grp.className = 'mb-2';
    const label = document.createElement('label');
    label.className = 'form-label small mb-1';
    label.textContent = labelText;
    grp.append(label, node);
    body.appendChild(grp);
  };

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'form-control form-control-sm';
  name.required = true;
  name.maxLength = 80;
  name.value = category?.name ?? '';

  const icon = document.createElement('input');
  icon.type = 'text';
  icon.className = 'form-control form-control-sm';
  icon.maxLength = 40;
  icon.value = category?.icon ?? '';

  let chosenColor = category?.color ?? '';
  const color = colorSwatches({
    value: chosenColor,
    onChange: (v) => {
      chosenColor = v;
    },
    ariaLabel: t('categories.field.color'),
  });

  const parent = document.createElement('select');
  parent.className = 'form-select form-select-sm';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = t('categories.noParent');
  parent.appendChild(none);

  const excluded = new Set();
  if (category) {
    excluded.add(category.id);
    // Collect descendants so a category cannot become its own ancestor.
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of all) {
        if (row.parent_id && excluded.has(row.parent_id) && !excluded.has(row.id)) {
          excluded.add(row.id);
          grew = true;
        }
      }
    }
  }
  for (const row of all) {
    if (excluded.has(row.id)) continue;
    const opt = document.createElement('option');
    opt.value = row.id;
    opt.textContent = row.name;
    opt.selected = row.id === (category?.parent_id ?? '');
    parent.appendChild(opt);
  }

  field(t('categories.field.name'), name);
  field(t('categories.field.parent'), parent);
  field(t('categories.field.icon'), icon);
  field(t('categories.field.color'), color);

  const errMsg = document.createElement('div');
  errMsg.className = 'small text-danger d-none';
  body.appendChild(errMsg);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = t('categories.save');
  save.addEventListener('click', async () => {
    if (!name.value.trim()) {
      name.focus();
      return;
    }
    save.disabled = true;
    errMsg.classList.add('d-none');
    try {
      const saved = await saveCategory({
        id: category?.id ?? null,
        name: name.value.trim(),
        parent_id: parent.value || null,
        icon: icon.value.trim() || null,
        color: chosenColor || null,
      });
      dialog.close();
      if (onSaved) onSaved(saved);
    } catch (err) {
      save.disabled = false;
      errMsg.textContent =
        err.code === '23505' ? t('categories.duplicateName') : err.message;
      errMsg.classList.remove('d-none');
      name.focus();
    }
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-outline-secondary';
  cancel.textContent = t('nl.cancel');
  cancel.addEventListener('click', () => dialog.close());

  footer.append(save, cancel);
}
