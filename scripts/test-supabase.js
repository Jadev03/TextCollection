// Test Supabase connection on startup
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('\n❌ Missing Supabase environment variables');
  console.error('   Please check your .env.local file\n');
  process.exit(1);
}

async function testConnection() {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Test connection
    const { error } = await supabase.auth.getSession();
    
    // Even if there's no session, if we can call the API, connection works
    const isConnected = !error || error.message === 'Invalid Refresh Token: Refresh Token Not Found';
    
    if (isConnected) {
      console.log('\n✅ ============================================');
      console.log('✅ Supabase Setup Successful!');
      console.log('✅ ============================================');
      console.log('  📍 Supabase URL:', supabaseUrl);
      console.log('  🔑 Anon Key:', supabaseAnonKey.substring(0, 20) + '...');
      console.log('  ✅ Connection Status: Connected');
      console.log('  ✅ Client Initialized: Success');
      console.log('✅ ============================================\n');
      process.exit(0);
    } else {
      throw new Error(error?.message || 'Connection test failed');
    }
  } catch (error) {
    console.error('\n❌ ============================================');
    console.error('❌ Supabase Setup Error');
    console.error('❌ ============================================');
    console.error('  Error:', error.message);
    console.error('❌ ============================================\n');
    process.exit(1);
  }
}

testConnection();

