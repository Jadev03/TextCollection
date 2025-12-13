import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// Check if session is still valid
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const sessionId = searchParams.get('sessionId');

    if (!userId || !sessionId) {
      return NextResponse.json(
        { error: 'userId and sessionId are required' },
        { status: 400 }
      );
    }

    // Get current user state
    const { data: user, error } = await supabaseServer
      .from('users')
      .select('id, session_id, last_activity')
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    // Check if session is still active
    const isActive = user.session_id === sessionId;
    
    // Update last_activity if session is active (keep session alive)
    if (isActive) {
      await supabaseServer
        .from('users')
        .update({
          last_activity: new Date().toISOString(),
        })
        .eq('id', userId)
        .eq('session_id', sessionId);
    }

    return NextResponse.json({
      success: true,
      isActive: isActive,
      currentSessionId: user.session_id,
    });
  } catch (error: any) {
    console.error('❌ Error checking session:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check session',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

