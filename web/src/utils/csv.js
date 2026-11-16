// CSV export shared by the sidebar export dialog. Pure formatting lives here so
// the column contract is in one place; the dialog owns the query + scope.
export function buildTransactionsCsv({
  rows,
  myrTotals = new Map(),
  categoryNames = new Map(),
  accountNames = new Map(),
  transferPairs = new Map(),
}) {
  const header = [
    'Date',
    'Receiver',
    'Category',
    'Amount',
    'Currency',
    'MYR',
    'Direction',
    'Sent from',
    'Account',
    'Recurring',
    'Tags',
    'Notes',
  ];
  const body = rows.map((t) => {
    const myr = myrTotals.get(t.id);
    const isTransfer = Boolean(t.transfer_group_id);
    const pair = transferPairs.get(t.transfer_group_id) ?? {};
    const account = isTransfer
      ? `${accountNames.get(pair.source) ?? '?'} → ${accountNames.get(pair.dest) ?? '?'}`
      : (accountNames.get(t.account_id) ?? '');
    return [
      t.transaction_date,
      t.merchant_raw ?? '',
      (t.category_id && categoryNames.get(t.category_id)) || '',
      t.amount,
      t.currency,
      myr !== null && myr !== undefined ? myr : '',
      isTransfer ? 'Transfer' : t.direction,
      t.source_app_label ?? '',
      account,
      t.is_recurring ? 'yes' : '',
      (t.tags ?? []).map((tag) => tag.name).join('; '),
      t.notes ?? '',
    ];
  });
  return [header, ...body].map((r) => r.map(escapeCsv).join(',')).join('\n');
}

export function downloadCsvFile(csv, filename) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
