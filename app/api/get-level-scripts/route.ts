import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabaseServer } from '@/lib/supabase-server';

// Helper function to create authenticated Google client
function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google credentials not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost'
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return oauth2Client;
}

// Fisher-Yates shuffle algorithm for consistent shuffling based on seed
function seededShuffle<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let random = seed;
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Simple seeded random number generator
    random = (random * 9301 + 49297) % 233280;
    const j = Math.floor((random / 233280) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Generate seed from username and level for consistent shuffling per user
function generateSeed(username: string, level: number): number {
  let hash = 0;
  const str = `${username}_level_${level}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const level = parseInt(searchParams.get('level') || '1', 10);
    const scriptsPerLevel = 50;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Parse userId to number (it comes as string from query params)
    const userIdNumber = parseInt(userId, 10);
    
    if (isNaN(userIdNumber)) {
      return NextResponse.json(
        { error: 'Invalid userId format' },
        { status: 400 }
      );
    }

    // Get user info
    const { data: user, error: userError } = await supabaseServer
      .from('users')
      .select('id, username, current_level, scripts_completed_in_level, level_script_order')
      .eq('id', userIdNumber)
      .single();

    if (userError) {
      if (userError.code === 'PGRST116') {
        // User not found
        return NextResponse.json(
          { error: `User with ID ${userIdNumber} does not exist` },
          { status: 404 }
        );
      }
      throw userError;
    }

    const sheetsId = process.env.GOOGLE_SHEETS_ID;
    const tabName = process.env.GOOGLE_SHEETS_TAB;

    if (!sheetsId || !tabName) {
      return NextResponse.json(
        { error: 'Google Sheets ID or Tab name not configured' },
        { status: 500 }
      );
    }

    // Calculate script range for this level (1-based indexing)
    // Level 1: scripts 1-50, Level 2: scripts 51-100, etc.
    const startScriptRow = (level - 1) * scriptsPerLevel + 1;
    const endScriptRow = level * scriptsPerLevel;

    console.log(`📊 Getting scripts for Level ${level} (rows ${startScriptRow}-${endScriptRow})`);

    // Check if user already has a shuffled order for this level
    let scriptOrder: number[] | null = null;
    if (user.level_script_order && user.current_level === level) {
      // User already has shuffled order for this level
      scriptOrder = user.level_script_order as number[];
      console.log(`✅ Using existing shuffled order for level ${level}`);
    } else {
      // Fetch all scripts for this level from Google Sheets
      const auth = getGoogleClient();
      const sheets = google.sheets({ version: 'v4', auth });

      const range = `${tabName}!A${startScriptRow}:A${endScriptRow}`;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetsId,
        range: range,
      });

      const values = response.data.values || [];

      if (values.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No scripts found for level ${level}`,
        }, { status: 404 });
      }

      // Extract scripts with their original row indices
      const scripts = values
        .map((row, index) => ({
          originalRowIndex: startScriptRow + index,
          text: row[0] || '',
        }))
        .filter(script => script.text.trim() !== '');

      if (scripts.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No valid scripts found for level ${level}`,
        }, { status: 404 });
      }

      // Create array of original row indices for shuffling
      const originalIndices = scripts.map(s => s.originalRowIndex);

      // Generate user-specific seed for consistent shuffling
      const seed = generateSeed(user.username, level);
      console.log(`🎲 Generating shuffle for user ${user.username}, level ${level}, seed: ${seed}`);

      // Shuffle the indices
      scriptOrder = seededShuffle(originalIndices, seed);

      // Store the shuffled order in database
      await supabaseServer
        .from('users')
        .update({
          level_script_order: scriptOrder,
          current_level: level,
        })
        .eq('id', userId);

      console.log(`✅ Created and stored shuffled order for level ${level}`);
      console.log(`  - Original order: ${originalIndices.slice(0, 5).join(', ')}...`);
      console.log(`  - Shuffled order: ${scriptOrder.slice(0, 5).join(', ')}...`);
    }

    // Get the current script index in the shuffled order
    const currentScriptIndex = user.scripts_completed_in_level || 0;
    
    // Check if level is complete (all scripts in level have been completed)
    if (currentScriptIndex >= scriptOrder.length) {
      return NextResponse.json({
        success: true,
        levelComplete: true,
        scriptText: null,
        message: `Level ${level} is complete!`,
      });
    }
    
    const nextScriptRowIndex = scriptOrder[currentScriptIndex];

    if (!nextScriptRowIndex) {
      return NextResponse.json({
        success: false,
        error: 'No more scripts in this level',
        levelComplete: true,
      });
    }

    // Fetch the specific script text
    const auth = getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const scriptRange = `${tabName}!A${nextScriptRowIndex}:A${nextScriptRowIndex}`;

    const scriptResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: scriptRange,
    });

    const scriptValues = scriptResponse.data.values;
    const scriptText = scriptValues && scriptValues[0] && scriptValues[0][0] ? scriptValues[0][0] : '';

    if (!scriptText) {
      return NextResponse.json({
        success: false,
        error: 'Script text not found',
      }, { status: 404 });
    }

    const totalScriptsInLevel = scriptOrder.length;
    const scriptsRemainingInLevel = totalScriptsInLevel - currentScriptIndex - 1;

    console.log(`✅ Returning script for level ${level}:`);
    console.log(`  - Script ${currentScriptIndex + 1} of ${totalScriptsInLevel} in level`);
    console.log(`  - Original row index: ${nextScriptRowIndex}`);
    console.log(`  - Scripts remaining in level: ${scriptsRemainingInLevel}`);

    return NextResponse.json({
      success: true,
      level: level,
      scriptText: scriptText,
      originalRowIndex: nextScriptRowIndex,
      scriptIndexInLevel: currentScriptIndex,
      totalScriptsInLevel: totalScriptsInLevel,
      scriptsRemainingInLevel: scriptsRemainingInLevel,
      levelComplete: scriptsRemainingInLevel === 0,
    });
  } catch (error: any) {
    console.error('❌ Error getting level scripts:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get level scripts',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

