import { supabase } from '../lib/supabaseClient.js';

export async function getTransactions({ withinDays = 30, limit = 100, status = null } = {}) {
  let query = supabase
    .from('transactions')
    .select(
      'id, amount, currency, direction, merchant_display, merchant_raw, category_id, transaction_date, source_app_label, status',
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
