import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables');
    }

    // Test connection by checking auth service
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    // Even if there's no session, if we can call the API, connection works
    const isConnected = !sessionError || sessionError.message === 'Invalid Refresh Token: Refresh Token Not Found';
    
    if (isConnected) {
      console.log('\n✅ ============================================');
      console.log('✅ Supabase Setup Successful!');
      console.log('✅ ============================================');
      console.log('  📍 Supabase URL:', supabaseUrl);
      console.log('  🔑 Anon Key:', supabaseAnonKey.substring(0, 20) + '...');
      console.log('  ✅ Connection Status: Connected');
      console.log('  ✅ Client Initialized: Success');
      console.log('✅ ============================================\n');
      
      return NextResponse.json({
        success: true,
        message: 'Supabase connection successful!',
        supabaseUrl: supabaseUrl,
        connected: true,
      });
    } else {
      throw new Error(sessionError?.message || 'Connection test failed');
    }
  } catch (error: any) {
    console.error('\n❌ ============================================');
    console.error('❌ Supabase Setup Error');
    console.error('❌ ============================================');
    console.error('  Error:', error.message);
    console.error('❌ ============================================\n');
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to connect to Supabase',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

