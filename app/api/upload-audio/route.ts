import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';

export async function POST(request: NextRequest) {
  try {
    // Get the audio file from the request
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const mimeType = formData.get('mimeType') as string;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // Get environment variables
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!clientId || !clientSecret || !refreshToken || !folderId) {
      return NextResponse.json(
        { error: 'Google Drive credentials not configured' },
        { status: 500 }
      );
    }

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost' // Redirect URI (not used for refresh token flow)
    );

    // Set the refresh token
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    // Get access token
    const { token } = await oauth2Client.getAccessToken();
    if (!token) {
      return NextResponse.json(
        { error: 'Failed to get access token' },
        { status: 500 }
      );
    }

    // Create Drive API client
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Convert File to Buffer, then to Stream (required by googleapis)
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Create a readable stream from the buffer
    const stream = Readable.from(buffer);

    // Use the provided mimeType to preserve original audio format
    const finalMimeType = mimeType || audioFile.type || 'audio/webm';

    // Determine file extension based on mimeType to match the format
    let fileExtension = 'webm';
    if (finalMimeType.includes('webm')) {
      fileExtension = 'webm';
    } else if (finalMimeType.includes('ogg')) {
      fileExtension = 'ogg';
    } else if (finalMimeType.includes('mp4') || finalMimeType.includes('m4a')) {
      fileExtension = 'm4a';
    } else if (finalMimeType.includes('wav')) {
      fileExtension = 'wav';
    } else if (finalMimeType.includes('mp3')) {
      fileExtension = 'mp3';
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `audio-recording-${timestamp}.${fileExtension}`;

    // Upload file to Google Drive - preserve original audio format exactly
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: finalMimeType, // Preserve exact original format
        body: stream,
      },
      fields: 'id, name, webViewLink, size',
    });

    return NextResponse.json({
      success: true,
      fileId: response.data.id,
      fileName: response.data.name,
      webViewLink: response.data.webViewLink,
      size: response.data.size,
    });
  } catch (error: any) {
    console.error('Error uploading to Google Drive:', error);
    return NextResponse.json(
      {
        error: 'Failed to upload audio to Google Drive',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

