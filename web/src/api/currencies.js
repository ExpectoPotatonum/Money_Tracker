import { supabase } from '../lib/supabaseClient.js';

// Reference table (migration 202608300003_seed_currencies.sql). Reading this at
// runtime means adding a currency is an INSERT in the DB, not an app release.
// Degrades to the built-in fallback list if the table isn't there yet (e.g.
// before the migration runs) so a missing table never breaks the dashboard.
export async function getCurrencies() {
  const { data, error } = await supabase
    .from('currencies')
    .select('code, symbol')
    .order('position', { ascending: true });
  if (error) return [];
  return data ?? [];
}
