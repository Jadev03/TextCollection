import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Log initialization (only in development)
if (process.env.NODE_ENV === 'development') {
  console.log('\n🔵 Supabase Client Initialized');
  console.log('  📍 URL:', supabaseUrl);
  console.log('  ✅ Ready to use\n');
}

