import { supabase } from '../lib/supabaseClient.js';
import { categoryNameMap, sortCategoryRows } from '../utils/categories.js';

// The row shape everything downstream expects (dashboard, CSV, reports).
// Kept in one place so the nested M2M embed stays consistent.
const TXN_SELECT =
  'id, amount, currency, direction, merchant_display, merchant_raw, category_id, transaction_date, source_package, source_app_label, status, notes, is_recurring, account_id, transfer_group_id, transaction_tags ( tag_id, tags ( id, name, color ) )';

export async function getTransactions({
  withinDays = 30,
  limit = 100,
  status = null,
  since = null,
} = {}) {
  let query = supabase
    .from('transactions')
    .select(TXN_SELECT)
    .order('transaction_date', { ascending: false })
    .limit(limit);

  if (since) {
    query = query.gte('transaction_date', since);
  } else if (withinDays) {
    const d = new Date(Date.now() - withinDays * 86_400_000).toISOString();
    query = query.gte('transaction_date', d);
  }
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeTx);
}

// Full history for the Reports view (Phase 4, §4.9). Supabase caps a single
// REST response at 1000 rows, so page through with range() until a short page
// comes back. Ascending order keeps the running-balance math natural.
export async function getAllTransactions() {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      .select(TXN_SELECT)
      .order('transaction_date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = Array.isArray(data) ? data.map(normalizeTx) : [];
    out.push(...page);
    if (page.length < PAGE) break;
    if (from > 50_000) break; // sanity guard: never loop forever on bad data
  }
  return out;
}

// Flatten the M2M embed (transaction_tags -> tags) into a plain `tags` array on
// each row: [{ id, name, color }]. Keeps component code free of the join shape.
export function normalizeTx(t) {
  const { transaction_tags: links, ...rest } = t;
  const tags = (links ?? [])
    .map((l) => l.tags)
    .filter(Boolean)
    .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
  return { ...rest, tags };
}

// Category dropdowns are alphabetical with the catch-all "Other" pinned last
// (utils/categories.js) — a plain Map preserves that insertion order.
export async function getCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return categoryNameMap(Array.isArray(data) ? data : []);
}

// Full category rows (two-tier: parent_id) for reports roll-ups and budget
// spend matching (§4.9.4 decision 3 — parent budgets count child spend).
export async function getCategoryTree() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, parent_id, icon, color')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return sortCategoryRows(Array.isArray(data) ? data : []);
}

// Manual edit/delete (agents.md: parsing gets things wrong, e.g. an e-wallet
// and its underlying bank card both notifying the same transfer; the owner
// corrects by hand). The authenticated role has UPDATE/DELETE on transactions
// under the owner_only RLS policy (202608180001_grant_privileges.sql).
export async function updateTransaction(id, patch) {
  assertPositiveAmount(patch);
  const { error } = await supabase.from('transactions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

// An amount is always strictly positive (DB CHECK transactions_amount_positive,
// migration 202611140001). This is the client-side mirror of it: edit mode used
// to PATCH `amount: 0` whenever a row's number field was left empty, because an
// empty <input type="number"> reads as '' and Number('') === 0 — a real
// transaction silently became a RM 0.00 row. Failing here surfaces the problem
// in the dashboard's "Save failed" alert instead.
function assertPositiveAmount(row) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'amount')) return;
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be greater than zero');
  }
}

// Manual quick-add / AI-escalation rows (Phase B/C). Requires the
// 202609060003 migration: raw_notification_id nullable for source_package =
// 'manual' rows; other sources must carry a raw_notification_id (schema
// check). The authenticated role has INSERT under the owner_only RLS policy.
export async function insertTransaction(row) {
  assertPositiveAmount(row);
  const { data, error } = await supabase
    .from('transactions')
    .insert(row)
    .select(TXN_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return normalizeTx(data);
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
