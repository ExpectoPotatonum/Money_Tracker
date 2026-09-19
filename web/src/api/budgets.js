import { supabase } from '../lib/supabaseClient.js';

// Budgets (Phase 4, §4.9). The dashboard computes spend-vs-budget client-side
// (free tier, no cron): the API is plain CRUD. category_id NULL = the overall
// budget; otherwise a per-category budget (parent budgets roll child spend up
// in the dashboard, §4.9.4 decision 3).

export async function listBudgets() {
  const { data, error } = await supabase
    .from('budgets')
    .select(
      'id, category_id, period, amount, currency, categories ( id, name, icon, color, parent_id )',
    )
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id,
    category_id: b.category_id,
    period: b.period,
    amount: Number(b.amount),
    currency: b.currency,
    category: b.categories ?? null,
  }));
}

export async function saveBudget({ id = null, categoryId = null, amount }) {
  const row = {
    category_id: categoryId,
    period: 'monthly',
    amount,
    currency: 'MYR',
  };
  let result;
  if (id) {
    result = await supabase.from('budgets').update(row).eq('id', id);
  } else {
    // Suppress the partial-unique-index conflict into a friendly error below.
    result = await supabase.from('budgets').insert(row);
  }
  if (result.error) {
    if (result.error.code === '23505') {
      throw new Error(
        'A budget already exists for that category (or the overall budget is already set).',
      );
    }
    throw new Error(result.error.message);
  }
}

export async function deleteBudget(id) {
  const { error } = await supabase.from('budgets').delete().eq('id', id);
  if (error) throw new Error(error.message);
}