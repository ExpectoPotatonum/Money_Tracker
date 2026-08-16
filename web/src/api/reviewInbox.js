import { supabase } from '../lib/supabaseClient.js';

// The safety valve of the whole design (agents.md §9) — everything that
// failed a strict parse or only matched the loose fallback lands here.
export async function getReviewInbox({ status = null, packageName = null, limit = 200 } = {}) {
  let query = supabase
    .from('raw_notifications')
    .select(
      'id, client_uuid, package_name, app_label, title, text_body, big_text, sub_text, ' +
        'posted_at, redactions_applied, parse_status, parse_error',
    )
    .in('parse_status', ['failed', 'needs_review'])
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('parse_status', status);
  if (packageName) query = query.eq('package_name', packageName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getReviewPackages() {
  const { data, error } = await supabase.from('raw_notifications').select('package_name');
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.package_name))];
}
