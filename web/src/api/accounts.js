// Accounts + transfer API (Phase 3). Accounts, the package->account default
// map, per-transaction assignment, and two-row linked transfers. All owner-
// scoped under RLS — these run as the signed-in user (AGENTS §17 conventions).
import { supabase } from '../lib/supabaseClient.js';

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
    if (error) throw new Error(error.message);
    return account;
  }
  const { data, error } = await supabase.from('accounts').insert(clean).select('*').single();
  if (error) throw new Error(error.message);
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
  // Map rows reference the account too (FK). Clear them first.
  await supabase.from('package_account_map').delete().eq('account_id', id);
  const { error } = await supabase.from('accounts').delete().eq('id', id);
  if (error) throw new Error(error.message);
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
  const { data, error } = await supabase.from('transactions').insert(halves).select('id');
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