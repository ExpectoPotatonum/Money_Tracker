// Recurring auto-entry API (Phase 6). The Android RecurringCheckWorker reads
// these rows and materializes each due cycle as a manual is_recurring
// transaction; this module is the management path (create/edit/delete an
// entry). All rows are owner-scoped under RLS via the owner_only policy in
// 202609250001_recurring_entries.sql (GRANT + RLS in the same migration,
// AGENTS §17). A read-only-friendly missing-table degradation mirrors
// listAccounts: a migration not yet applied yields an empty list, not a crash.
import { supabase } from '../lib/supabaseClient.js';

export async function listRecurringEntries(includeInactive = false) {
  let q = supabase
    .from('recurring_entries')
    .select('*')
    .order('next_due_date', { ascending: true });
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return [];
  return data ?? [];
}

// Insert (no id) or update (has id). next_due_date is the first cycle the
// worker materializes — required for every entry.
export async function saveRecurringEntry(entry) {
  const clean = {
    name: String(entry.name ?? '').trim(),
    amount: Number(entry.amount),
    currency: entry.currency,
    direction: entry.direction,
    category_id: entry.category_id || null,
    account_id: entry.account_id || null,
    frequency: entry.frequency,
    interval_step: Number(entry.interval_step ?? 1),
    day_of_month: entry.day_of_month || null,
    merchant_raw: entry.merchant_raw || null,
    notes: entry.notes || null,
    next_due_date: entry.next_due_date,
    active: entry.active !== false,
  };
  if (entry.id) {
    const { data, error } = await supabase
      .from('recurring_entries')
      .update({ ...clean, updated_at: new Date().toISOString() })
      .eq('id', entry.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase.from('recurring_entries').insert(clean).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

// Deleting an entry only unlinks its past materialized rows (recurring_entry_id
// is on delete set null) — transaction history survives.
export async function deleteRecurringEntry(id) {
  const { error } = await supabase.from('recurring_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
