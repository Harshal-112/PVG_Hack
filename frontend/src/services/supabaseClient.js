import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://ttetxhpiaaxsgeytqacx.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0ZXR4aHBpYWF4c2dleXRxYWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjM1MzUsImV4cCI6MjEwNzEzOTUzNX0.H1VKThEy_9-6c9PljiEamAmBY2iv82ABevsVQDKNsVs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
