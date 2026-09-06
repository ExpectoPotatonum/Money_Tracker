import { getReviewInbox, updateRawNotification } from '../api/reviewInbox.js';
import { getCategories, insertTransaction } from '../api/transactions.js';
import { formatMoney, formatDateTime } from '../utils/format.js';
import { parseNotificationTransaction } from '../utils/ai.js';
import { llmConfigured } from '../utils/llm.js';
import { badge, emptyState, openModal } from '../components/common.js';
import { t } from '../lib/i18n.js';
import { openSettings } from '../components/settingsDialog.js';

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
  h.textContent = t('nav.review');
  header.appendChild(h);

  const filters = document.createElement('div');
  filters.className = 'btn-group btn-group-sm';
  for (const value of [null, 'failed', 'needs_review']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${filterStatus === value ? 'btn-primary' : 'btn-outline-secondary'}`;
    btn.textContent = t(
      value === null
        ? 'inbox.filters.all'
        : value === 'failed'
          ? 'inbox.filters.failed'
          : 'inbox.filters.needsReview',
    );
    btn.addEventListener('click', () => renderReviewInbox(root, value));
    filters.appendChild(btn);
  }
  header.appendChild(filters);
  root.appendChild(header);

  const [rows, categoryNames] = await Promise.all([
    getReviewInbox({ status: filterStatus }),
    getCategories(),
  ]);

  if (rows.length === 0) {
    root.appendChild(emptyState(t('inbox.empty')));
    return;
  }

  const table = document.createElement('table');
  table.className = 'table table-sm table-striped align-middle';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>${t('inbox.col.posted')}</th>
    <th>${t('inbox.col.app')}</th>
    <th>${t('inbox.col.status')}</th>
    <th>${t('inbox.col.title')}</th>
    <th>${t('inbox.col.text')}</th>
    <th>${t('inbox.col.redactions')}</th>
    <th>${t('inbox.col.note')}</th>
    <th></th>
  </tr>`;
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

    tr.appendChild(askAiCell(row, categoryNames, root, filterStatus));

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);
}

// Phase C — escalate a row the regex parsers missed to the LLM. The outcome
// (insert a transaction + mark the raw row parsed) is previewed before apply,
// so a wrong read can be cancelled just by leaving the row alone.
function askAiCell(row, categoryNames, root, filterStatus) {
  const td = document.createElement('td');
  td.className = 'text-end text-nowrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm btn-outline-secondary';
  btn.id = `ask-ai-${row.id}`;
  btn.textContent = t('inbox.askAi');
  btn.addEventListener('click', async () => {
    if (!llmConfigured()) {
      openSettings();
      return;
    }
    btn.disabled = true;
    btn.textContent = '…';

    const draft = await parseNotificationTransaction(row, categoryNames);
    if (!draft) {
      btn.disabled = false;
      btn.textContent = t('inbox.askAi');
      // Show the 'no usable transaction' verdict, then make the button retryable.
      const verdict = document.createElement('span');
      verdict.className = 'small text-muted d-block';
      verdict.textContent = t('inbox.aiSkipped');
      td.replaceChildren(verdict, btn);
      return;
    }

    const { dialog, body, footer } = openModal({ title: t('inbox.aiTitle') });
    const summary = document.createElement('p');
    summary.className = 'mb-1';
    const direction =
      draft.direction === 'debit' ? t('nl.direction.debit') : t('nl.direction.credit');
    const categoryName = draft.category_id ? categoryNames.get(draft.category_id) : '—';
    summary.textContent =
      `${formatMoney(draft.amount, draft.currency)} · ${direction} · ` +
      `${draft.merchant_raw ?? '—'} · ${categoryName}`;
    body.appendChild(summary);
    const derived = document.createElement('div');
    derived.className = 'small text-muted';
    derived.textContent = `${row.app_label ?? row.package_name} · ${formatDateTime(draft.transaction_date)}`;
    body.appendChild(derived);

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn-primary';
    apply.id = 'ai-apply-btn';
    apply.textContent = t('inbox.aiApply');
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const txn = await insertTransaction({
          raw_notification_id: row.id,
          source_package: row.package_name,
          source_app_label: row.app_label,
          confidence: 'low',
          status: 'confirmed',
          notification_posted_at: row.posted_at,
          ...draft,
        });
        await updateRawNotification(row.id, {
          parse_status: 'success',
          parse_error: 'ai',
          linked_transaction_id: txn.id,
        });
        dialog.close();
        renderReviewInbox(root, filterStatus);
      } catch (err) {
        apply.disabled = false;
        const errNote = document.createElement('div');
        errNote.className = 'small text-danger mt-2';
        errNote.textContent = `${t('inbox.aiApplyFailed')} ${err.message}`;
        body.appendChild(errNote);
      }
    });
    footer.appendChild(apply);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-outline-secondary';
    cancel.textContent = t('nl.cancel');
    cancel.addEventListener('click', () => dialog.close());
    footer.appendChild(cancel);
  });

  td.appendChild(btn);
  return td;
}
