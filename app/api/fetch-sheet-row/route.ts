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
    const startRow = parseInt(searchParams.get('startRow') || '1', 10); // Starting row (1-based)
    const limit = parseInt(searchParams.get('limit') || '10', 10); // Number of rows to fetch (default 10)

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

    // Fetch multiple rows from the first column (column A)
    // Range format: 'SheetName!A1:A10' for rows 1-10
    const endRow = startRow + limit - 1;
    const range = `${tabName}!A${startRow}:A${endRow}`;

    console.log(`📊 Fetching Google Sheets rows ${startRow}-${endRow} from column A (pagination)`);
    console.log(`  - Sheet ID: ${sheetsId}`);
    console.log(`  - Tab: ${tabName}`);
    console.log(`  - Range: ${range}`);
    console.log(`  - Limit: ${limit} rows`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: range,
    });

    const values = response.data.values;

    if (!values || values.length === 0) {
      // No more rows available
      return NextResponse.json({
        success: true,
        hasMore: false,
        scripts: [],
        startRow: startRow,
        endRow: startRow - 1,
        message: 'No more rows available',
      });
    }

    // Extract scripts from the first column, filter out empty rows
    const scripts = values
      .map((row, index) => ({
        rowIndex: startRow + index,
        text: row[0] || '',
      }))
      .filter(script => script.text.trim() !== ''); // Remove empty rows

    // Check if there are more scripts
    // If we got exactly the limit number of rows, there might be more
    // If we got fewer, we've reached the end
    const actualRowsReturned = values.length;
    const hasMore = actualRowsReturned === limit; // If we got exactly the limit, there might be more

    // Calculate next start row - use the actual row count, not filtered script count
    // This ensures we don't skip rows even if some are empty
    const nextStartRow = hasMore ? startRow + actualRowsReturned : null;

    console.log(`✅ Fetched ${scripts.length} scripts (rows ${startRow}-${startRow + actualRowsReturned - 1})`);
    console.log(`  - Actual rows returned: ${actualRowsReturned}`);
    console.log(`  - Has more: ${hasMore}`);
    if (scripts.length > 0) {
      console.log(`  - First script: ${scripts[0].text.substring(0, 50)}${scripts[0].text.length > 50 ? '...' : ''}`);
      console.log(`  - Last script: ${scripts[scripts.length - 1].text.substring(0, 50)}${scripts[scripts.length - 1].text.length > 50 ? '...' : ''}`);
    }

    return NextResponse.json({
      success: true,
      hasMore: hasMore,
      scripts: scripts,
      startRow: startRow,
      endRow: startRow + actualRowsReturned - 1,
      nextStartRow: nextStartRow,
    });
  } catch (error: any) {
    console.error('❌ Error fetching Google Sheets rows:', error);
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

