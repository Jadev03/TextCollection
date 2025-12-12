import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// Get or create user and return their last script
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      );
    }

    console.log(`👤 Getting user progress for: ${username}`);

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabaseServer
      .from('users')
      .select('id, username, last_script_id')
      .eq('username', username)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine for new users
      throw fetchError;
    }

    if (existingUser) {
      // User exists - return their last script
      const lastScriptId = existingUser.last_script_id || 0;
      const nextScriptId = lastScriptId + 1;
      
      console.log(`✅ User found: ${username}`);
      console.log(`  - Last script ID: ${lastScriptId}`);
      console.log(`  - Next script ID: ${nextScriptId}`);

      return NextResponse.json({
        success: true,
        userId: existingUser.id,
        username: existingUser.username,
        lastScriptId: lastScriptId,
        nextScriptId: nextScriptId,
        isNewUser: false,
      });
    } else {
      // User doesn't exist - create new user
      console.log(`🆕 Creating new user: ${username}`);
      
      const { data: newUser, error: createError } = await supabaseServer
        .from('users')
        .insert({
          username: username,
          last_script_id: 0, // Start from script 1 (0 means haven't completed any)
          created_at: new Date().toISOString(),
        })
        .select('id, username, last_script_id')
        .single();

      if (createError) {
        throw createError;
      }

      console.log(`✅ New user created: ${username}`);
      console.log(`  - User ID: ${newUser.id}`);
      console.log(`  - Starting from script 1`);

      return NextResponse.json({
        success: true,
        userId: newUser.id,
        username: newUser.username,
        lastScriptId: 0,
        nextScriptId: 1,
        isNewUser: true,
      });
    }
  } catch (error: any) {
    console.error('❌ Error getting user progress:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get user progress',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// Update user's last script after successful upload
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, scriptId } = body;

    if (!userId || !scriptId) {
      return NextResponse.json(
        { error: 'userId and scriptId are required' },
        { status: 400 }
      );
    }

    console.log(`💾 Updating user progress: User ${userId}, Script ${scriptId}`);

    const { data, error } = await supabaseServer
      .from('users')
      .update({
        last_script_id: scriptId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log(`✅ User progress updated successfully`);

    return NextResponse.json({
      success: true,
      userId: data.id,
      lastScriptId: data.last_script_id,
    });
  } catch (error: any) {
    console.error('❌ Error updating user progress:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update user progress',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

