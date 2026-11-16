// Raw notifications (2026-11-16). A read-only audit view over the durable
// capture log — every row, not just the failed/needs_review subset the Review
// inbox surfaces. Per AGENTS §16 raw rows are never deleted and their text is
// never mutated after insert, so there is deliberately no edit/delete here.
import { getRawNotificationsPage } from '../api/rawNotifications.js';
import { formatDateTime } from '../utils/format.js';
import { badge, emptyState } from '../components/common.js';
import { t } from '../lib/i18n.js';

const PAGE_SIZE = 50;

const STATUS_BADGES = {
  success: 'bg-success',
  failed: 'bg-danger',
  needs_review: 'bg-warning text-dark',
  ignored: 'bg-secondary',
  pending: 'bg-info text-dark',
};

const REDACTION_COLORS = {
  otp: 'bg-danger',
  balance: 'bg-warning text-dark',
  account: 'bg-secondary',
};

export async function renderRawNotifications(root, offset = 0) {
  root.replaceChildren();

  const header = document.createElement('div');
  header.className = 'd-flex justify-content-between align-items-center mb-3';
  const h = document.createElement('h1');
  h.className = 'h3 mb-0';
  h.textContent = t('nav.raw');
  header.appendChild(h);
  root.appendChild(header);

  const hint = document.createElement('p');
  hint.className = 'small text-muted';
  hint.textContent = t('raw.hint');
  root.appendChild(hint);

  const safeOffset = Math.max(0, offset);
  let rows;
  let count;
  try {
    ({ rows, count } = await getRawNotificationsPage({ limit: PAGE_SIZE, offset: safeOffset }));
  } catch (err) {
    const msg = document.createElement('div');
    msg.className = 'alert alert-danger py-2 small';
    msg.textContent = String(err?.message ?? err);
    root.appendChild(msg);
    return;
  }

  if (rows.length === 0) {
    root.appendChild(emptyState(t('raw.empty')));
    if (safeOffset > 0) root.appendChild(pager(safeOffset, count, root, false));
    return;
  }

  const table = document.createElement('table');
  table.className = 'table table-sm table-striped align-middle';
  table.id = 'raw-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const key of ['posted', 'app', 'status', 'title', 'text', 'redactions', 'note']) {
    const th = document.createElement('th');
    th.textContent = t(`raw.col.${key}`);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;

    const posted = document.createElement('td');
    posted.className = 'text-nowrap';
    posted.textContent = formatDateTime(row.posted_at);
    tr.appendChild(posted);

    const app = document.createElement('td');
    app.textContent = row.app_label ?? row.package_name;
    if (row.package_name && row.package_name !== app.textContent) {
      app.title = row.package_name;
    }
    tr.appendChild(app);

    const status = document.createElement('td');
    status.appendChild(
      badge(row.parse_status, STATUS_BADGES[row.parse_status] ?? 'bg-secondary'),
    );
    tr.appendChild(status);

    const title = document.createElement('td');
    title.textContent = row.title ?? '—';
    tr.appendChild(title);

    const text = document.createElement('td');
    text.className = 'small text-break';
    text.textContent = row.big_text ?? row.text_body ?? row.sub_text ?? '—';
    tr.appendChild(text);

    const redactions = document.createElement('td');
    if (Array.isArray(row.redactions_applied) && row.redactions_applied.length > 0) {
      for (const r of row.redactions_applied) {
        redactions.appendChild(badge(r, REDACTION_COLORS[r] ?? 'bg-secondary'));
      }
    } else {
      redactions.textContent = '—';
    }
    tr.appendChild(redactions);

    const note = document.createElement('td');
    note.className = 'small text-muted';
    note.textContent = row.parse_error ?? '';
    tr.appendChild(note);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);
  root.appendChild(pager(safeOffset, count, root, true));
}

// Prev / page / Next. `hasNext` is computed from the server count so the last
// page never offers an empty step.
function pager(offset, count, root, hasNext) {
  const wrap = document.createElement('div');
  wrap.className = 'd-flex align-items-center gap-2';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'btn btn-sm btn-outline-secondary';
  prev.id = 'raw-prev-btn';
  prev.textContent = t('raw.prev');
  prev.disabled = offset <= 0;
  prev.addEventListener('click', () => renderRawNotifications(root, Math.max(0, offset - PAGE_SIZE)));
  wrap.appendChild(prev);

  const info = document.createElement('span');
  info.className = 'small text-muted';
  const from = count === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, count);
  info.textContent = t('raw.pageInfo')
    .replace('{from}', from)
    .replace('{to}', to)
    .replace('{total}', count);
  wrap.appendChild(info);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-sm btn-outline-secondary';
  next.id = 'raw-next-btn';
  next.textContent = t('raw.next');
  next.disabled = !hasNext || offset + PAGE_SIZE >= count;
  next.addEventListener('click', () => renderRawNotifications(root, offset + PAGE_SIZE));
  wrap.appendChild(next);

  return wrap;
}
