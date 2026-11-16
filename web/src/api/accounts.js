// Accounts + transfer API (Phase 3). Accounts, the package->account default
// map, per-transaction assignment, and two-row linked transfers. All owner-
// scoped under RLS — these run as the signed-in user (AGENTS §17 conventions).
import { supabase } from '../lib/supabaseClient.js';

// Preserve Postgres' error code so callers can turn 23505 (unique violation)
// into a friendly "that name already exists" message.
function asError(error) {
  const e = new Error(error.message);
  if (error.code) e.code = error.code;
  return e;
}

// Read-only-friendly: a missing table (migration not applied yet) degrades to
// an empty list rather than breaking the dashboard render (like currencies).
export async function listAccounts() {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) return [];
  return data ?? [];
}

// Insert (no id) or update (has id). Name is the unique-per-user key.
export async function saveAccount(account) {
  const clean = {
    name: String(account.name ?? '').trim(),
    type: account.type,
    currency: account.currency,
    icon: account.icon || null,
    color: account.color || null,
    opening_balance: Number(account.opening_balance ?? 0),
    opening_balance_date: account.opening_balance_date || null,
    is_hidden: Boolean(account.is_hidden),
    sort_order: Number(account.sort_order ?? 0),
  };
  if (account.id) {
    const { error } = await supabase.from('accounts').update(clean).eq('id', account.id);
    if (error) throw asError(error);
    return account;
  }
  const { data, error } = await supabase.from('accounts').insert(clean).select('*').single();
  if (error) throw asError(error);
  return data;
}

// Refuse to delete an account that still owns transactions (blocked in the
// manager with an in-use hint; the owner must reassign or pick another value).
export async function deleteAccount(id) {
  const { count, error: countErr } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', id);
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) > 0) {
    throw new Error(`still ${count} transaction(s) on this account`);
  }
  // Map rows reference the account too (FK). Clear them first. Newer projects
  // also have source_account_map (202611160002); a missing table is ignored so
  // this keeps working before that migration is applied.
  await supabase.from('package_account_map').delete().eq('account_id', id);
  await supabase.from('source_account_map').delete().eq('account_id', id);
  const { error } = await supabase.from('accounts').delete().eq('id', id);
  if (error) throw asError(error);
}

// Patch the account on a single transaction (the "-- Pick…" read-only flow and
// the NL/voice manual insert path share this).
export async function assignAccount(txId, accountId) {
  const { error } = await supabase
    .from('transactions')
    .update({ account_id: accountId || null })
    .eq('id', txId);
  if (error) throw new Error(error.message);
}

// "Assign all from <package> → <account>": record the default in
// package_account_map (so future captures land there) and backfill every
// existing row from that package that has no account. Transfer halves are
// never touched (they carry no source_package='manual' rows' shape — guarded
// below by transfer_group_id IS NULL).
export async function assignPackageRows(packageName, accountId) {
  const { error: mapErr } = await supabase
    .from('package_account_map')
    .upsert(
      { package_name: packageName, account_id: accountId },
      { onConflict: 'user_id,package_name' },
    );
  if (mapErr) throw new Error(mapErr.message);

  const { error } = await supabase
    .from('transactions')
    .update({ account_id: accountId })
    .eq('source_package', packageName)
    .is('account_id', null)
    .is('transfer_group_id', null);
  if (error) throw new Error(error.message);
}

// "Assign all from <label> → <account>": the label-level sibling of
// assignPackageRows (owner decision 2026-11-16). Records the default in
// source_account_map — which parse_raw_notification resolves BEFORE the package
// map — and backfills every existing row carrying that Sent-from label that has
// no account yet. Never touches transfer halves or rows already assigned.
export async function assignSourceRows(sourceAppLabel, accountId) {
  const label = String(sourceAppLabel ?? '').trim();
  if (!label) throw new Error('source label is required');

  const { error: mapErr } = await supabase
    .from('source_account_map')
    .upsert(
      { source_app_label: label, account_id: accountId },
      { onConflict: 'user_id,source_app_label' },
    );
  if (mapErr) throw new Error(mapErr.message);

  const { error } = await supabase
    .from('transactions')
    .update({ account_id: accountId })
    .eq('source_app_label', label)
    .is('account_id', null)
    .is('transfer_group_id', null);
  if (error) throw new Error(error.message);
}

// One transfer = two ordinary single-account rows sharing a client-generated
// transfer_group_id (see 202609190003). The source half is a debit in the
// source account's ledger; the destination half is a credit in the destination
// account's ledger — each carries its own amount + currency, so the two books
// agree by construction even when the currencies differ.
export async function insertTransfer({
  sourceAccountId,
  destAccountId,
  sourceAmount,
  sourceCurrency,
  destAmount,
  destCurrency,
  date,
  notes = null,
}) {
  const group = crypto.randomUUID();
  const dateIso = new Date(date).toISOString();
  // Both halves are real movements — never 0 (mirrors the DB CHECK
  // transactions_amount_positive, migration 202611140001).
  if (!(Number(sourceAmount) > 0) || !(Number(destAmount) > 0)) {
    throw new Error('transfer amounts must be greater than zero');
  }
  const base = {
    transfer_group_id: group,
    transaction_date: dateIso,
    notification_posted_at: dateIso,
    merchant_raw: null,
    category_id: null,
    source_package: 'manual',
    confidence: 'low',
    status: 'confirmed',
    notes: notes?.trim() || null,
  };
  const halves = [
    {
      ...base,
      account_id: sourceAccountId,
      direction: 'debit',
      amount: Number(sourceAmount),
      currency: sourceCurrency,
      source_app_label: null,
    },
    {
      ...base,
      account_id: destAccountId,
      direction: 'credit',
      amount: Number(destAmount),
      currency: destCurrency,
      source_app_label: null,
    },
  ];
  const { data, error } = await supabase.from('transactions').insert(halves).select('*');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Delete both halves of a transfer in one request (app-enforced pairing).
export async function deleteTransfer(groupId) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('transfer_group_id', groupId);
  if (error) throw new Error(error.message);
}