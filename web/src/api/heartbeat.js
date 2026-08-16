import { supabase } from '../lib/supabaseClient.js';

export async function getLatestHeartbeat() {
  const { data, error } = await supabase
    .from('device_heartbeat')
    .select(
      'device_id, last_seen_at, listener_connected, notification_access_granted, battery_unrestricted, app_version',
    )
    .order('last_seen_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}
