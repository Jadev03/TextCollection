import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

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

export async function GET(request: NextRequest) {
  try {
    const sheetsId = process.env.GOOGLE_SHEETS_ID;
    const tabName = process.env.GOOGLE_SHEETS_TAB;

    if (!sheetsId || !tabName) {
      return NextResponse.json(
        { error: 'Google Sheets ID or Tab name not configured' },
        { status: 500 }
      );
    }

    const auth = getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch a large range to count total rows (we'll use a reasonable max range)
    // Google Sheets API can handle up to certain limits, so we'll fetch in chunks if needed
    // For now, let's fetch a large range (A1:A10000) which should cover most cases
    const maxRange = 10000;
    const range = `${tabName}!A1:A${maxRange}`;

    console.log(`📊 Fetching total script count from Google Sheets...`);
    console.log(`  - Sheet ID: ${sheetsId}`);
    console.log(`  - Tab: ${tabName}`);
    console.log(`  - Range: ${range}`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: range,
    });

    const values = response.data.values;

    if (!values || values.length === 0) {
      return NextResponse.json({
        success: true,
        totalScripts: 0,
        totalLevels: 0,
      });
    }

    // Count non-empty rows in the first column
    const totalScripts = values.filter(row => row && row[0] && row[0].trim() !== '').length;
    const scriptsPerLevel = 50;
    const totalLevels = Math.ceil(totalScripts / scriptsPerLevel);

    console.log(`✅ Total scripts found: ${totalScripts}`);
    console.log(`  - Total levels: ${totalLevels} (${scriptsPerLevel} scripts per level)`);

    return NextResponse.json({
      success: true,
      totalScripts: totalScripts,
      totalLevels: totalLevels,
      scriptsPerLevel: scriptsPerLevel,
    });
  } catch (error: any) {
    console.error('❌ Error fetching total scripts:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch total scripts',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

