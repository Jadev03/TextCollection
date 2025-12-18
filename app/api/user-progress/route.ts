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
      .select('id, username, last_script_id, current_level, scripts_completed_in_level, session_id, last_activity, version')
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
        .select('id, username, last_script_id, current_level, scripts_completed_in_level, version')
        .single();

      if (updateError) {
        throw updateError;
      }

      const currentLevel = updatedUser.current_level || 1;
      const scriptsCompletedInLevel = updatedUser.scripts_completed_in_level || 0;
      
      console.log(`✅ User found: ${username}`);
      console.log(`  - Current Level: ${currentLevel}`);
      console.log(`  - Scripts completed in level: ${scriptsCompletedInLevel}/50`);
      console.log(`  - New session activated: ${sessionId}`);
      if (existingUser.session_id && existingUser.session_id !== sessionId) {
        console.log(`  - Previous session invalidated: ${existingUser.session_id}`);
      }

      return NextResponse.json({
        success: true,
        userId: updatedUser.id,
        username: updatedUser.username,
        currentLevel: currentLevel,
        scriptsCompletedInLevel: scriptsCompletedInLevel,
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
          last_script_id: 0, // Keep for backward compatibility
          current_level: 1, // Start at level 1
          scripts_completed_in_level: 0, // No scripts completed in level yet
          session_id: sessionId,
          last_activity: new Date().toISOString(),
          version: 0,
          created_at: new Date().toISOString(),
        })
        .select('id, username, current_level, scripts_completed_in_level, version')
        .single();

      if (createError) {
        throw createError;
      }

      console.log(`✅ New user created: ${username}`);
      console.log(`  - User ID: ${newUser.id}`);
      console.log(`  - Starting at Level 1`);

      return NextResponse.json({
        success: true,
        userId: newUser.id,
        username: newUser.username,
        currentLevel: 1,
        scriptsCompletedInLevel: 0,
        version: newUser.version,
        sessionId: sessionId,
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

// Update user's progress after successful upload (level-based)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, originalRowIndex, sessionId, expectedVersion } = body;

    if (!userId || originalRowIndex === undefined) {
      return NextResponse.json(
        { error: 'userId and originalRowIndex are required' },
        { status: 400 }
      );
    }

    console.log(`💾 Updating user progress: User ${userId}, Script Row ${originalRowIndex}, Session: ${sessionId}`);

    // Get current user state
    const { data: currentUser, error: fetchError } = await supabaseServer
      .from('users')
      .select('id, last_script_id, current_level, scripts_completed_in_level, session_id, version, level_script_order')
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

    const currentLevel = currentUser.current_level || 1;
    const scriptsCompletedInLevel = currentUser.scripts_completed_in_level || 0;
    const newScriptsCompleted = scriptsCompletedInLevel + 1;
    // Prefer the actual number of scripts in this level (based on the stored shuffled order),
    // so empty rows in Google Sheets don't trap the user forever.
    // Fallback to 50 for safety/legacy users.
    const scriptsPerLevel =
      Array.isArray(currentUser.level_script_order) && currentUser.level_script_order.length > 0
        ? currentUser.level_script_order.length
        : 50;

    // Check if level is complete (completed all 50 scripts)
    const levelComplete = newScriptsCompleted >= scriptsPerLevel;
    const nextLevel = levelComplete ? currentLevel + 1 : currentLevel;
    const nextScriptsCompleted = levelComplete ? 0 : newScriptsCompleted;

    console.log(`📊 Level progress update:`);
    console.log(`  - Current level: ${currentLevel}`);
    console.log(`  - Scripts completed in level: ${scriptsCompletedInLevel} → ${newScriptsCompleted}`);
    console.log(`  - Scripts required for this level: ${scriptsPerLevel}`);
    console.log(`  - Level complete: ${levelComplete}`);
    if (levelComplete) {
      console.log(`  - Moving to level ${nextLevel}`);
    }

    // Atomic update with version increment
    const { data, error } = await supabaseServer
      .from('users')
      .update({
        last_script_id: originalRowIndex, // Keep for backward compatibility
        current_level: nextLevel,
        scripts_completed_in_level: nextScriptsCompleted,
        level_script_order: levelComplete ? null : currentUser.level_script_order, // Clear order when level complete
        session_id: sessionId || currentUser.session_id,
        last_activity: new Date().toISOString(),
        version: (currentUser.version || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .eq('scripts_completed_in_level', scriptsCompletedInLevel) // Only update if no one else updated
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Check if update actually happened (race condition detection)
    if (!data || data.scripts_completed_in_level !== nextScriptsCompleted) {
      console.warn(`⚠️ Race condition detected: Update may have been overwritten`);
      // Fetch latest state
      const { data: latestUser } = await supabaseServer
        .from('users')
        .select('id, current_level, scripts_completed_in_level')
        .eq('id', userId)
        .single();

      return NextResponse.json({
        success: true,
        userId: latestUser?.id,
        currentLevel: latestUser?.current_level,
        scriptsCompletedInLevel: latestUser?.scripts_completed_in_level,
        conflict: true,
        message: 'Progress was updated by another session. Please refresh.',
      });
    }

    console.log(`✅ User progress updated successfully`);
    console.log(`  - Level: ${data.current_level}`);
    console.log(`  - Scripts completed in level: ${data.scripts_completed_in_level}/50`);

    return NextResponse.json({
      success: true,
      userId: data.id,
      currentLevel: data.current_level,
      scriptsCompletedInLevel: data.scripts_completed_in_level,
      levelComplete: levelComplete,
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

