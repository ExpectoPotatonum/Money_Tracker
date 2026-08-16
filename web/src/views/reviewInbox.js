import { getReviewInbox } from '../api/reviewInbox.js';
import { formatDateTime } from '../utils/format.js';
import { badge, emptyState } from '../components/common.js';

const STATUS_BADGES = { failed: 'bg-danger', needs_review: 'bg-warning text-dark' };

const REDACTION_COLORS = {
  otp: 'bg-danger',
  balance: 'bg-warning text-dark',
  account: 'bg-secondary',
};

export async function renderReviewInbox(root, filterStatus = null) {
  root.replaceChildren();

  const header = document.createElement('div');
  header.className = 'd-flex justify-content-between align-items-center mb-3';
  const h = document.createElement('h1');
  h.className = 'h3 mb-0';
  h.textContent = 'Review inbox';
  header.appendChild(h);

  const filters = document.createElement('div');
  filters.className = 'btn-group btn-group-sm';
  for (const [value, label] of [
    [null, 'All'],
    ['failed', 'Failed'],
    ['needs_review', 'Needs review'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${filterStatus === value ? 'btn-primary' : 'btn-outline-secondary'}`;
    btn.textContent = label;
    btn.addEventListener('click', () => renderReviewInbox(root, value));
    filters.appendChild(btn);
  }
  header.appendChild(filters);
  root.appendChild(header);

  const rows = await getReviewInbox({ status: filterStatus });

  if (rows.length === 0) {
    root.appendChild(emptyState('Nothing here — every captured notification parsed cleanly.'));
    return;
  }

  const table = document.createElement('table');
  table.className = 'table table-sm table-striped align-middle';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>Posted</th>
    <th>App</th>
    <th>Status</th>
    <th>Title</th>
    <th>Text</th>
    <th>Redactions</th>
    <th>Note</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');

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

    const statusTd = document.createElement('td');
    statusTd.appendChild(
      badge(row.parse_status, STATUS_BADGES[row.parse_status] ?? 'bg-secondary'),
    );
    tr.appendChild(statusTd);

    const titleTd = document.createElement('td');
    titleTd.textContent = row.title ?? '—';
    tr.appendChild(titleTd);

    const textTd = document.createElement('td');
    textTd.className = 'small text-break';
    textTd.textContent = row.big_text ?? row.text_body ?? row.sub_text ?? '—';
    tr.appendChild(textTd);

    const redactionsTd = document.createElement('td');
    if (Array.isArray(row.redactions_applied) && row.redactions_applied.length > 0) {
      for (const r of row.redactions_applied) {
        redactionsTd.appendChild(badge(r, REDACTION_COLORS[r] ?? 'bg-secondary'));
      }
    } else {
      redactionsTd.textContent = '—';
    }
    tr.appendChild(redactionsTd);

    const noteTd = document.createElement('td');
    noteTd.className = 'small text-muted';
    noteTd.textContent = row.parse_error ?? '';
    tr.appendChild(noteTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);
}
