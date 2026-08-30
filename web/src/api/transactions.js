import { supabase } from '../lib/supabaseClient.js';

export async function getTransactions({ withinDays = 30, limit = 100, status = null } = {}) {
  let query = supabase
    .from('transactions')
    .select(
      'id, amount, currency, direction, merchant_display, merchant_raw, category_id, transaction_date, source_app_label, status, notes',
    )
    .order('transaction_date', { ascending: false })
    .limit(limit);

  if (withinDays) {
    const since = new Date(Date.now() - withinDays * 86_400_000).toISOString();
    query = query.gte('transaction_date', since);
  }
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCategories() {
  const { data, error } = await supabase.from('categories').select('id, name');
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

// Manual edit/delete (agents.md: parsing gets things wrong, e.g. an e-wallet
// and its underlying bank card both notifying the same transfer; the owner
// corrects by hand). The authenticated role has UPDATE/DELETE on transactions
// under the owner_only RLS policy (202608180001_grant_privileges.sql).
export async function updateTransaction(id, patch) {
  const { error } = await supabase.from('transactions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
