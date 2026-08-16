import { supabase } from '../lib/supabaseClient.js';

export async function getOpenAlerts() {
  const { data, error } = await supabase
    .from('dashboard_alerts')
    .select('id, alert_type, severity, message, context, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function dismissAlert(id) {
  const { error } = await supabase
    .from('dashboard_alerts')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
