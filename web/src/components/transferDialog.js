// Transfer dialog (Phase 3, §4.8.5). Moves money between two of the owner's
// accounts — the only source of transfers (notifications are single-sided).
// Creates ONE transfer = TWO ordinary transaction rows sharing a
// client-generated transfer_group_id (202609190003):
//   source half:  debit  in the source account      (amount = source amount)
//   dest half:    credit in the destination account (amount = arriving amount)
// Same currency by default; a "different currency" toggle unlocks the
// destination's amount + currency for cross-currency transfers.
import { openModal } from './common.js';
import { insertTransfer } from '../api/accounts.js';
import { toDateTimeLocal, fromDateTimeLocal, currencyOptions } from '../utils/format.js';
import { t } from '../lib/i18n.js';

export function openTransferDialog({ accounts = [], onSaved = null } = {}) {
  const { dialog, body, footer } = openModal({ title: t('transfer.title') });

  if (accounts.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'alert alert-info small mb-0';
    msg.textContent = t('transfer.noAccounts');
    body.appendChild(msg);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-outline-secondary';
    close.textContent = t('nl.cancel');
    close.addEventListener('click', () => dialog.close());
    footer.appendChild(close);
    return;
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));

  // --- From / To ---
  const from = accountSelect(t('transfer.from'), accounts, 0);
  const to = accountSelect(t('transfer.to'), accounts, Math.min(1, accounts.length - 1));
  const pairRow = document.createElement('div');
  pairRow.className = 'row g-2';
  pairRow.appendChild(from.wrap('col-6'));
  pairRow.appendChild(to.wrap('col-6'));
  body.appendChild(pairRow);

  // --- Amount (source side, locked to the source account's currency) ---
  const amount = field('number', t('transfer.amount'), '');
  amount.input.step = '0.01';
  amount.input.min = '0';
  const amountRow = document.createElement('div');
  amountRow.className = 'row g-2';
  amountRow.appendChild(amount.wrap('col-6'));
  const srcCurLabel = document.createElement('div');
  srcCurLabel.className = 'col-6 d-flex align-items-end';
  const srcCur = document.createElement('div');
  srcCur.className = 'form-control form-control-sm text-muted';
  const srcCurrency = () => byId.get(from.input.value)?.currency ?? 'MYR';
  srcCur.textContent = srcCurrency();
  from.input.addEventListener('change', () => {
    srcCur.textContent = srcCurrency();
    if (!diff.checked) updateDestDefault();
  });
  srcCurLabel.appendChild(srcCur);
  amountRow.appendChild(srcCurLabel);
  body.appendChild(amountRow);

  // --- "Different currency" toggle: destination amount + currency ---
  const diffWrap = document.createElement('div');
  diffWrap.className = 'form-check form-switch mt-2';
  const diff = document.createElement('input');
  diff.type = 'checkbox';
  diff.className = 'form-check-input';
  diff.id = 'transfer-diff-currency';
  const diffLabel = document.createElement('label');
  diffLabel.htmlFor = 'transfer-diff-currency';
  diffLabel.className = 'form-check-label small';
  diffLabel.textContent = t('transfer.different');
  diffWrap.append(diff, diffLabel);
  body.appendChild(diffWrap);

  const destRow = document.createElement('div');
  destRow.className = 'row g-2 d-none';
  const destAmount = field('number', t('transfer.destAmount'), '');
  destAmount.input.step = '0.01';
  destAmount.input.min = '0';
  destRow.appendChild(destAmount.wrap('col-6'));
  const destCurSel = document.createElement('select');
  destCurSel.className = 'form-select form-select-sm';
  for (const code of currencyOptions()) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    destCurSel.appendChild(opt);
  }
  const destCurWrap = document.createElement('div');
  destCurWrap.className = 'col-6';
  const destCurLabel = document.createElement('label');
  destCurLabel.className = 'form-label small mb-1';
  destCurLabel.textContent = t('transfer.destCurrency');
  destCurWrap.append(destCurLabel, destCurSel);
  destRow.appendChild(destCurWrap);
  body.appendChild(destRow);

  const updateDestDefault = () => {
    destAmount.input.value = amount.input.value;
    destCurSel.value = byId.get(to.input.value)?.currency ?? 'MYR';
    updateRate();
  };
  diff.addEventListener('change', () => {
    destRow.classList.toggle('d-none', !diff.checked);
    if (diff.checked) updateDestDefault();
  });
  amount.input.addEventListener('input', () => {
    if (!diff.checked) destAmount.input.value = amount.input.value;
    updateRate();
  });
  to.input.addEventListener('change', () => {
    if (!diff.checked) destCurSel.value = byId.get(to.input.value)?.currency ?? 'MYR';
    updateRate();
  });

  // --- Rate readout (only when currencies actually differ) ---
  const rate = document.createElement('div');
  rate.className = 'small text-muted mt-2';
  rate.textContent = '';
  body.appendChild(rate);

  function updateRate() {
    const src = srcCurrency();
    const dst = destCurSel.value;
    const amt = Number(destAmount.input.value);
    const srcAmt = Number(amount.input.value);
    if (!diff.checked || src === dst || !amt || !srcAmt) {
      rate.textContent = '';
      return;
    }
    const r = amt / srcAmt;
    rate.textContent = t('transfer.rate')
      .replace('{src}', src)
      .replace('{rate}', r.toFixed(4))
      .replace('{dst}', dst);
  }
  destAmount.input.addEventListener('input', updateRate);
  destCurSel.addEventListener('change', updateRate);

  // --- Date + notes ---
  const date = field('datetime-local', t('transfer.date'), toDateTimeLocal(new Date().toISOString()));
  const notes = field('text', t('transfer.notes'), '');
  const metaRow = document.createElement('div');
  metaRow.className = 'row g-2 mt-1';
  metaRow.appendChild(date.wrap('col-6'));
  metaRow.appendChild(notes.wrap('col-6'));
  body.appendChild(metaRow);

  const status = document.createElement('div');
  status.className = 'small text-danger mt-2';
  body.appendChild(status);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.id = 'transfer-save-btn';
  save.textContent = t('nl.save');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-outline-secondary';
  cancel.textContent = t('nl.cancel');
  cancel.addEventListener('click', () => dialog.close());
  footer.append(save, cancel);

  save.addEventListener('click', async () => {
    const source = byId.get(from.input.value);
    const dest = byId.get(to.input.value);
    if (!source || !dest) return;
    if (source.id === dest.id) {
      status.textContent = t('transfer.sameAccount');
      return;
    }
    const sourceAmount = Number(amount.input.value);
    if (!sourceAmount || sourceAmount <= 0) {
      amount.input.focus();
      return;
    }
    let destAmount = sourceAmount;
    let destCurrency = dest.currency;
    if (diff.checked) {
      destAmount = Number(destAmount.input.value);
      destCurrency = destCurSel.value;
      if (!destAmount || destAmount <= 0) {
        destAmount.input.focus();
        return;
      }
    }
    const dateIso = fromDateTimeLocal(date.input.value) ?? new Date().toISOString();

    save.disabled = true;
    try {
      await insertTransfer({
        sourceAccountId: source.id,
        destAccountId: dest.id,
        sourceAmount,
        sourceCurrency: srcCurrency(),
        destAmount,
        destCurrency,
        date: dateIso,
        notes: notes.input.value.trim() || null,
      });
      status.className = 'small text-success mt-2';
      status.textContent = t('transfer.saved');
      if (onSaved) onSaved();
      setTimeout(() => dialog.close(), 700);
    } catch (err) {
      save.disabled = false;
      status.className = 'small text-danger mt-2';
      status.textContent = `${t('transfer.saveFailed')} ${err.message}`;
    }
  });

  // --- local form helpers ---
  function accountSelect(label, list, initialIndex) {
    const wrapEl = document.createElement('div');
    const l = document.createElement('label');
    l.className = 'form-label small mb-1';
    l.textContent = label;
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    for (const acct of list) {
      const opt = document.createElement('option');
      opt.value = acct.id;
      opt.textContent = acct.name;
      select.appendChild(opt);
    }
    select.value = list[initialIndex]?.id ?? '';
    return {
      wrap: (col) => ((wrapEl.className = col), wrapEl.append(l, select), wrapEl),
      input: select,
    };
  }

  function field(type, label, value) {
    const wrapEl = document.createElement('div');
    const l = document.createElement('label');
    l.className = 'form-label small mb-1';
    l.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.className = 'form-control form-control-sm';
    input.value = value;
    return {
      wrap: (col) => ((wrapEl.className = col), wrapEl.append(l, input), wrapEl),
      input,
    };
  }
}