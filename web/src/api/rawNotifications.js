import { supabase } from '../lib/supabaseClient.js';

// Read-only access to the durable capture log (agents.md §5: raw notifications
// are never deleted and their text is immutable). The Raw notifications page is
// an audit view — it shows every row, not just the failed/needs-review subset
// the Review inbox surfaces.
export async function getRawNotificationsPage({ limit = 50, offset = 0 } = {}) {
  const from = Math.max(0, offset);
  const { data, error, count } = await supabase
    .from('raw_notifications')
    .select('*', { count: 'exact' })
    .order('posted_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], count: count ?? 0 };
}
