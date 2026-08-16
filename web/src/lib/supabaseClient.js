import { createClient } from '@supabase/supabase-js';

// Single client instance (ARCHITECTURE.md §5) — every /api query goes through
// this. The anon key is public; RLS is the security boundary (agents.md §12).
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(url, anonKey);
