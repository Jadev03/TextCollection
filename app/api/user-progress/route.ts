import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// Get or create user and return their last script
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const usernameParam = searchParams.get('username');
    const sessionId = searchParams.get('sessionId') || `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    if (!usernameParam) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      );
    }

    // Normalize username to lowercase for case-insensitive handling
    const username = usernameParam.trim().toLowerCase();

    console.log(`👤 Getting user progress for: ${username} (Session: ${sessionId})`);

    // Check if user exists (case-insensitive search)
    const { data: existingUser, error: fetchError } = await supabaseServer
      .from('users')
      .select('id, username, last_script_id, session_id, last_activity, version')
      .eq('username', username)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine for new users
      throw fetchError;
    }

    if (existingUser) {
      // User exists - automatically make this the active session (latest session wins)
      // Previous sessions will be invalidated
      const { data: updatedUser, error: updateError } = await supabaseServer
        .from('users')
        .update({
          session_id: sessionId,
          last_activity: new Date().toISOString(),
        })
        .eq('id', existingUser.id)
        .select('id, username, last_script_id, version')
        .single();

      if (updateError) {
        throw updateError;
      }

      const lastScriptId = updatedUser.last_script_id || 0;
      const nextScriptId = lastScriptId + 1;
      
      console.log(`✅ User found: ${username}`);
      console.log(`  - Last script ID: ${lastScriptId}`);
      console.log(`  - Next script ID: ${nextScriptId}`);
      console.log(`  - New session activated: ${sessionId}`);
      if (existingUser.session_id && existingUser.session_id !== sessionId) {
        console.log(`  - Previous session invalidated: ${existingUser.session_id}`);
      }

      return NextResponse.json({
        success: true,
        userId: updatedUser.id,
        username: updatedUser.username,
        lastScriptId: lastScriptId,
        nextScriptId: nextScriptId,
        version: updatedUser.version,
        sessionId: sessionId,
        isNewUser: false,
      });
    } else {
      // User doesn't exist - create new user
      console.log(`🆕 Creating new user: ${username}`);
      
      const { data: newUser, error: createError } = await supabaseServer
        .from('users')
        .insert({
          username: username, // Store in lowercase
          last_script_id: 0, // Start from script 1 (0 means haven't completed any)
          session_id: sessionId,
          last_activity: new Date().toISOString(),
          version: 0,
          created_at: new Date().toISOString(),
        })
        .select('id, username, last_script_id, version')
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
        version: newUser.version,
        sessionId: sessionId,
        hasConcurrentSession: false,
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
    const { userId, scriptId, sessionId, expectedVersion } = body;

    if (!userId || scriptId === undefined) {
      return NextResponse.json(
        { error: 'userId and scriptId are required' },
        { status: 400 }
      );
    }

    console.log(`💾 Updating user progress: User ${userId}, Script ${scriptId}, Session: ${sessionId}`);

    // Get current user state
    const { data: currentUser, error: fetchError } = await supabaseServer
      .from('users')
      .select('id, last_script_id, session_id, version')
      .eq('id', userId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    // Check if this is still the active session (session was invalidated by another device/tab)
    if (sessionId && currentUser.session_id !== sessionId) {
      console.warn(`⚠️ Session invalidated: This session is no longer active`);
      return NextResponse.json({
        success: false,
        error: 'SESSION_INVALIDATED',
        message: 'This session has been replaced by another device/tab. Please refresh the page.',
        currentSessionId: currentUser.session_id,
      }, { status: 409 }); // 409 Conflict
    }

    // Use atomic update with optimistic locking
    // Only update if scriptId is greater than current (prevent going backwards)
    // And optionally check version for additional safety
    const shouldUpdate = scriptId > (currentUser.last_script_id || 0);
    
    if (!shouldUpdate) {
      console.warn(`⚠️ Script ID ${scriptId} is not greater than current ${currentUser.last_script_id}, skipping update`);
      return NextResponse.json({
        success: true,
        userId: currentUser.id,
        lastScriptId: currentUser.last_script_id,
        skipped: true,
        message: 'Script ID is not greater than current progress',
      });
    }

    // Atomic update with version increment
    const { data, error } = await supabaseServer
      .from('users')
      .update({
        last_script_id: scriptId,
        session_id: sessionId || currentUser.session_id,
        last_activity: new Date().toISOString(),
        version: (currentUser.version || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .gte('last_script_id', currentUser.last_script_id) // Only update if no one else updated
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Check if update actually happened (race condition detection)
    if (!data || data.last_script_id !== scriptId) {
      console.warn(`⚠️ Race condition detected: Update may have been overwritten`);
      // Fetch latest state
      const { data: latestUser } = await supabaseServer
        .from('users')
        .select('id, last_script_id')
        .eq('id', userId)
        .single();

      return NextResponse.json({
        success: true,
        userId: latestUser?.id,
        lastScriptId: latestUser?.last_script_id,
        conflict: true,
        message: 'Progress was updated by another session. Please refresh.',
      });
    }

    console.log(`✅ User progress updated successfully to script ${scriptId}`);

    return NextResponse.json({
      success: true,
      userId: data.id,
      lastScriptId: data.last_script_id,
      version: data.version,
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

