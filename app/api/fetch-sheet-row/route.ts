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
    const { searchParams } = new URL(request.url);
    const rowIndex = parseInt(searchParams.get('row') || '1', 10); // Default to row 1 (index 1-based)

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

    // Fetch only the first column (column A) for the specific row
    // Range format: 'SheetName!A1' for row 1 (1-based index)
    // rowIndex=1 means first row (A1)
    // rowIndex=2 means second row (A2), etc.
    const range = `${tabName}!A${rowIndex}:A${rowIndex}`;

    console.log(`📊 Fetching Google Sheets row ${rowIndex} from column A`);
    console.log(`  - Sheet ID: ${sheetsId}`);
    console.log(`  - Tab: ${tabName}`);
    console.log(`  - Range: ${range}`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: range,
    });

    const values = response.data.values;

    if (!values || values.length === 0 || !values[0] || values[0].length === 0) {
      // No more rows available
      return NextResponse.json({
        success: true,
        hasMore: false,
        text: null,
        rowIndex: rowIndex,
        message: 'No more rows available',
      });
    }

    // Get the first column value (first element of first row)
    const text = values[0][0] || '';

    console.log(`✅ Fetched row ${rowIndex}:`, text.substring(0, 50) + (text.length > 50 ? '...' : ''));

    return NextResponse.json({
      success: true,
      hasMore: true,
      text: text,
      rowIndex: rowIndex,
    });
  } catch (error: any) {
    console.error('❌ Error fetching Google Sheets row:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch Google Sheets data',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

