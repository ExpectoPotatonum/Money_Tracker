// Tag manager (Phase 1). A modal for maintaining the two-level hierarchy:
// tag groups (top) and tags inside them (with optional color labels). The
// transaction table's tag picker consumes the tag list passed in by the
// dashboard; onChanged fires when the modal closes after a change so the
// dashboard re-fetches and the picker sees fresh groups/tags.
import { openModal } from './common.js';
import {
  getTagGroups,
  createTagGroup,
  renameTagGroup,
  deleteTagGroup,
  createTag,
  deleteTag,
} from '../api/tags.js';
import { t } from '../lib/i18n.js';

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

export function openTagManager({ onChanged = null } = {}) {
  let changed = false;
  const { dialog, body, footer } = openModal({ title: t('tags.managerTitle'), onClose: () => {
    if (changed && onChanged) onChanged();
  } });
  body.className = 'modal-body';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-outline-secondary';
  close.textContent = t('settings.close');
  close.addEventListener('click', () => dialog.close());
  footer.appendChild(close);

  render().catch((err) => {
    console.error('tag manager load failed', err);
    body.replaceChildren();
    const msg = document.createElement('div');
    msg.className = 'alert alert-danger py-2 small';
    msg.textContent = String(err?.message ?? err);
    body.appendChild(msg);
  });

  async function render() {
    const groups = await getTagGroups();
    body.replaceChildren();
    body.appendChild(groupList(groups));
    body.appendChild(addGroupForm());
  }

  // Deletes/renames/builds clear the `changed` flag (a no-op change shouldn't
  // force a dashboard refresh), but any successful mutation sets it.
  function markChanged() {
    changed = true;
  }

  function groupList(groups) {
    const list = document.createElement('div');
    list.className = 'mb-3';

    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-muted small';
      empty.textContent = t('tags.noGroups');
      list.appendChild(empty);
      return list;
    }

    for (const group of groups) {
      const card = document.createElement('div');
      card.className = 'border rounded p-2 mb-2';

      const head = document.createElement('div');
      head.className = 'd-flex justify-content-between align-items-center';
      const name = document.createElement('strong');
      name.textContent = group.name;
      const groupActions = document.createElement('div');
      groupActions.className = 'd-flex gap-1';
      const rename = smallBtn(t('tags.rename'), async () => {
        const next = window.prompt(t('tags.renameGroupPrompt'), group.name);
        if (next && next.trim() && next.trim() !== group.name) {
          await renameTagGroup(group.id, next.trim());
          markChanged();
          render();
        }
      });
      const del = smallBtn(t('tags.delete'), async () => {
        if (window.confirm(t('tags.deleteGroupConfirm'))) {
          await deleteTagGroup(group.id);
          markChanged();
          render();
        }
      });
      groupActions.append(rename, del);
      head.append(name, groupActions);
      card.appendChild(head);

      const tagWrap = document.createElement('div');
      tagWrap.className = 'ms-3 mt-1 d-flex flex-wrap gap-1 align-items-center';
      const tagItems = group.tags ?? [];
      if (tagItems.length > 0) {
        for (const tag of tagItems) {
          tagWrap.appendChild(tagChip(tag));
        }
      } else {
        const none = document.createElement('span');
        none.className = 'text-muted small';
        none.textContent = t('tags.noTagsInGroup');
        tagWrap.appendChild(none);
      }
      card.appendChild(tagWrap);
      card.appendChild(addTagForm(group.id));
      list.appendChild(card);
    }
    return list;
  }

  function addGroupForm() {
    const form = document.createElement('form');
    form.className = 'd-flex gap-2';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control form-control-sm';
    input.placeholder = t('tags.newGroupPlaceholder');
    input.maxLength = 50;
    const btn = smallBtn(t('tags.addGroup'), async () => {
      if (!input.value.trim()) return;
      await createTagGroup(input.value.trim());
      markChanged();
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btn.click();
      }
    });
    form.append(input, btn);
    return form;
  }

  function addTagForm(groupId) {
    const form = document.createElement('form');
    form.className = 'd-flex gap-1 mt-1';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control form-control-sm';
    input.placeholder = t('tags.newTagPlaceholder');
    input.maxLength = 50;
    const color = document.createElement('select');
    color.className = 'form-select form-select-sm w-auto';
    color.setAttribute('aria-label', t('tags.color'));
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('tags.noColor');
    color.appendChild(none);
    for (const c of COLOR_PRESETS) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.style.backgroundColor = c;
      opt.textContent = c;
      color.appendChild(opt);
    }
    const add = smallBtn('+', async () => {
      if (!input.value.trim()) return;
      await createTag({ name: input.value.trim(), groupId, color: color.value || null });
      markChanged();
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add.click();
      }
    });
    form.append(input, color, add);
    return form;
  }

  function tagChip(tag) {
    const chip = document.createElement('span');
    chip.className = 'badge text-bg-light border d-inline-flex align-items-center gap-1';
    if (tag.color) chip.style.backgroundColor = tag.color;
    const label = document.createElement('span');
    label.textContent = tag.name;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'btn-close';
    x.style.fontSize = '0.6rem';
    x.setAttribute('aria-label', t('tags.delete'));
    x.addEventListener('click', async () => {
      if (window.confirm(`${t('tags.deleteTagConfirm')} "${tag.name}"?`)) {
        await deleteTag(tag.id);
        markChanged();
        render();
      }
    });
    chip.append(label, x);
    return chip;
  }

  function smallBtn(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-outline-secondary';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}