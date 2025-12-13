'use client';

import { useState, useRef, useEffect } from 'react';
import UsernameModal from './UsernameModal';

interface AudioCollectorProps {}

export default function AudioCollector({}: AudioCollectorProps) {
  const [showUsernameModal, setShowUsernameModal] = useState<boolean>(true);
  const [username, setUsername] = useState<string>('');
  const [userId, setUserId] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [userVersion, setUserVersion] = useState<number>(0);
  const [isSessionValid, setIsSessionValid] = useState<boolean>(true);
  const [isLoadingUser, setIsLoadingUser] = useState<boolean>(false);
  const sessionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [scriptsBatch, setScriptsBatch] = useState<Array<{ rowIndex: number; text: string }>>([]);
  const [currentScriptIndex, setCurrentScriptIndex] = useState<number>(0);
  const [currentText, setCurrentText] = useState<string>('');
  const [currentRowIndex, setCurrentRowIndex] = useState<number>(1);
  const [isLoadingSheet, setIsLoadingSheet] = useState<boolean>(false);
  const [hasMoreRows, setHasMoreRows] = useState<boolean>(true);
  const [nextStartRow, setNextStartRow] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const mimeTypeRef = useRef<string>('audio/webm');

  // Fetch batch of scripts from Google Sheets (pagination)
  const fetchScriptsBatch = async (startRow: number, limit: number = 10) => {
    try {
      setIsLoadingSheet(true);
      setError(null);
      
      console.log(`📊 Fetching scripts batch starting from row ${startRow} (limit: ${limit})...`);
      
      const response = await fetch(`/api/fetch-sheet-row?startRow=${startRow}&limit=${limit}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch scripts from Google Sheets');
      }

      if (!data.scripts || data.scripts.length === 0) {
        // No scripts returned at all
        setHasMoreRows(false);
        setScriptsBatch([]);
        setNextStartRow(null);
        setCurrentText('No more scripts available. All done! 🎉');
        console.log('✅ No more scripts available (empty response)');
      } else {
        setScriptsBatch(data.scripts);
        setNextStartRow(data.nextStartRow);
        // hasMoreRows should be true if there's a nextStartRow (meaning more data exists)
        // OR if we have scripts in the current batch that we haven't shown yet
        setHasMoreRows(data.nextStartRow !== null || data.scripts.length > 1);
        setCurrentScriptIndex(0); // Start from first script in batch
        
        // Set current script
        if (data.scripts.length > 0) {
          setCurrentText(data.scripts[0].text);
          setCurrentRowIndex(data.scripts[0].rowIndex);
        }
        
        console.log(`✅ Loaded ${data.scripts.length} scripts (rows ${data.startRow}-${data.endRow})`);
        console.log(`  - Has more (API): ${data.hasMore}`);
        console.log(`  - Next batch starts at row: ${data.nextStartRow || 'N/A'}`);
        console.log(`  - Setting hasMoreRows to: ${data.nextStartRow !== null || data.scripts.length > 1}`);
        console.log(`  - Scripts in batch: ${data.scripts.map((s: { rowIndex: number; text: string }) => s.rowIndex).join(', ')}`);
      }
    } catch (error: any) {
      console.error('❌ Error fetching scripts batch:', error);
      setError(error.message || 'Failed to fetch data from Google Sheets');
      setCurrentText('');
      setScriptsBatch([]);
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Move to next script in current batch or fetch next batch
  const moveToNextScript = async () => {
    const nextIndex = currentScriptIndex + 1;
    
    console.log(`📄 Attempting to move to next script:`);
    console.log(`  - Current index: ${currentScriptIndex}`);
    console.log(`  - Next index: ${nextIndex}`);
    console.log(`  - Batch size: ${scriptsBatch.length}`);
    console.log(`  - Has more rows: ${hasMoreRows}`);
    console.log(`  - Next start row: ${nextStartRow}`);
    
    // Check if we have more scripts in current batch
    if (nextIndex < scriptsBatch.length) {
      // Use next script from current batch
      setCurrentScriptIndex(nextIndex);
      setCurrentText(scriptsBatch[nextIndex].text);
      setCurrentRowIndex(scriptsBatch[nextIndex].rowIndex);
      console.log(`✅ Moving to next script in batch: ${nextIndex + 1}/${scriptsBatch.length}`);
    } else if (hasMoreRows && nextStartRow) {
      // Current batch exhausted, fetch next batch
      console.log(`📦 Current batch exhausted, fetching next batch from row ${nextStartRow}`);
      await fetchScriptsBatch(nextStartRow);
    } else {
      // No more scripts
      console.log(`❌ No more scripts available`);
      console.log(`  - hasMoreRows: ${hasMoreRows}`);
      console.log(`  - nextStartRow: ${nextStartRow}`);
      setHasMoreRows(false);
      setCurrentText('No more scripts available. All done! 🎉');
    }
  };

  // Generate unique session ID on component mount
  useEffect(() => {
    const generateSessionId = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      // Fallback for browsers without crypto.randomUUID
      return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    };
    
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    console.log(`🆔 New session created: ${newSessionId}`);
  }, []);

  // Handle username submission
  const handleUsernameSubmit = async (enteredUsername: string) => {
    setIsLoadingUser(true);
    setError(null);

    try {
      // Convert username to lowercase for case-insensitive handling
      const normalizedUsername = enteredUsername.trim().toLowerCase();
      const currentSessionId = sessionId || crypto.randomUUID();
      console.log(`👤 Getting user progress for: ${normalizedUsername} (Session: ${currentSessionId})`);
      
      const response = await fetch(`/api/user-progress?username=${encodeURIComponent(normalizedUsername)}&sessionId=${currentSessionId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get user progress');
      }

      // Store normalized (lowercase) username for consistency
      setUsername(normalizedUsername);
      setUserId(data.userId);
      setSessionId(data.sessionId || currentSessionId);
      setUserVersion(data.version || 0);
      setIsSessionValid(true);
      setShowUsernameModal(false);

      // Start periodic session validation
      startSessionValidation(data.userId, data.sessionId || currentSessionId);

      // Start from the next script after their last completed one
      const startScriptId = data.nextScriptId;
      setCurrentRowIndex(startScriptId);
      
      console.log(`✅ User loaded: ${enteredUsername}`);
      console.log(`  - User ID: ${data.userId}`);
      console.log(`  - Session ID: ${data.sessionId}`);
      console.log(`  - Last completed script: ${data.lastScriptId}`);
      console.log(`  - Starting from script: ${startScriptId}`);
      console.log(`  - Is new user: ${data.isNewUser}`);

      // Fetch first batch of scripts starting from user's next script
      await fetchScriptsBatch(startScriptId, 10);
    } catch (error: any) {
      console.error('❌ Error loading user:', error);
      setError(error.message || 'Failed to load user progress');
    } finally {
      setIsLoadingUser(false);
    }
  };

  // Session validation function
  const checkSessionValidity = async (userId: number, currentSessionId: string) => {
    try {
      const response = await fetch(`/api/check-session?userId=${userId}&sessionId=${currentSessionId}`);
      const data = await response.json();

      if (data.success && !data.isActive) {
        // Session was invalidated by another device/tab
        setIsSessionValid(false);
        setError('This session has been replaced by another device/tab. Please refresh the page to continue.');
        console.warn('⚠️ Session invalidated by another device/tab');
        
        // Stop session checking
        if (sessionCheckIntervalRef.current) {
          clearInterval(sessionCheckIntervalRef.current);
          sessionCheckIntervalRef.current = null;
        }
      }
    } catch (error) {
      console.error('Error checking session:', error);
    }
  };

  // Start periodic session validation
  const startSessionValidation = (userId: number, currentSessionId: string) => {
    // Clear any existing interval
    if (sessionCheckIntervalRef.current) {
      clearInterval(sessionCheckIntervalRef.current);
    }

    // Check session every 5 seconds
    sessionCheckIntervalRef.current = setInterval(() => {
      if (userId && currentSessionId) {
        checkSessionValidity(userId, currentSessionId);
      }
    }, 5000);
  };

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (sessionCheckIntervalRef.current) {
        clearInterval(sessionCheckIntervalRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Request audio with 16kHz sample rate and enhanced noise cancellation
      const audioConstraints: MediaTrackConstraints & Record<string, any> = {
        sampleRate: 16000,
        channelCount: 1, // Mono
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Additional Google-specific constraints for better noise cancellation (Chrome/Edge)
        googEchoCancellation: true,
        googNoiseSuppression: true,
        googAutoGainControl: true,
        googHighpassFilter: true,
        googTypingNoiseDetection: true,
      };

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: audioConstraints 
      });
      streamRef.current = stream;
      
      // Create AudioContext to ensure 16kHz sample rate
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create noise reduction filter (high-pass filter to remove low-frequency noise)
      const highPassFilter = audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 80; // Remove frequencies below 80Hz (background rumble)
      highPassFilter.Q.value = 1;
      
      // Create low-pass filter to remove high-frequency noise
      const lowPassFilter = audioContext.createBiquadFilter();
      lowPassFilter.type = 'lowpass';
      lowPassFilter.frequency.value = 8000; // Keep frequencies up to 8kHz (good for speech)
      lowPassFilter.Q.value = 1;
      
      // Create dynamics compressor for noise reduction and leveling
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24; // Threshold in dB
      compressor.knee.value = 30; // Knee in dB
      compressor.ratio.value = 12; // Compression ratio
      compressor.attack.value = 0.003; // Attack time in seconds
      compressor.release.value = 0.25; // Release time in seconds
      
      // Create gain node for final volume control
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.0;
      
      // Connect audio nodes: source -> highpass -> lowpass -> compressor -> gain -> destination
      source.connect(highPassFilter);
      highPassFilter.connect(lowPassFilter);
      lowPassFilter.connect(compressor);
      compressor.connect(gainNode);
      
      const destination = audioContext.createMediaStreamDestination();
      gainNode.connect(destination);
      
      // Use the destination stream for recording (with noise cancellation applied)
      const recordingStream = destination.stream;
      
      // Configure MediaRecorder with appropriate mimeType
      // Try to preserve the format - prefer webm, then ogg, then browser default
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/ogg;codecs=opus';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ''; // Use browser default
          }
        }
      }
      
      const mediaRecorder = new MediaRecorder(recordingStream, {
        mimeType: mimeType || undefined,
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      // Store the ACTUAL mimeType that MediaRecorder is using (preserve exact format)
      // This ensures we use the exact same format for upload
      mimeTypeRef.current = mediaRecorder.mimeType || mimeType || 'audio/webm';
      
      // Log the audio format being used for recording
      console.log('🎤 Recording started with format:');
      console.log('  - Requested mimeType:', mimeType || 'browser default');
      console.log('  - Actual MediaRecorder mimeType:', mediaRecorder.mimeType);
      console.log('  - Stored mimeType:', mimeTypeRef.current);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Get the final mimeType from MediaRecorder to ensure exact format match
        const finalMimeType = mediaRecorder.mimeType || mimeTypeRef.current;
        mimeTypeRef.current = finalMimeType;
        
        // Create blob with the exact mimeType to preserve format
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: finalMimeType
        });
        // Store blob in ref for upload (preserves original format)
        audioBlobRef.current = audioBlob;
        const audioUrl = URL.createObjectURL(audioBlob);
        setRecordedAudio(audioUrl);
        setHasRecorded(true);
        setIsRecording(false);
        setRecordingTime(0);
        setIsLoading(false);
        
        // Log the recorded audio format
        console.log('✅ Recording stopped - Audio format:');
        console.log('  - Final mimeType:', finalMimeType);
        console.log('  - Blob type:', audioBlob.type);
        console.log('  - Blob size:', (audioBlob.size / 1024).toFixed(2), 'KB');
        console.log('  - Audio URL created for playback');
        
        // Cleanup AudioContext
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setHasRecorded(false);
      setRecordedAudio(null);
      setRecordingTime(0);
      setIsLoading(false);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setError('Please allow microphone access to record audio.');
      setIsLoading(false);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    }
  };

  const playRecording = () => {
    if (recordedAudio && audioRef.current) {
      // Log the audio format being played
      console.log('▶️ Playing audio:');
      console.log('  - Audio source URL:', recordedAudio);
      console.log('  - Audio format (mimeType):', mimeTypeRef.current);
      if (audioBlobRef.current) {
        console.log('  - Blob type:', audioBlobRef.current.type);
        console.log('  - Blob size:', (audioBlobRef.current.size / 1024).toFixed(2), 'KB');
      }
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const pauseRecording = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  const handleAudioLoadedMetadata = () => {
    if (audioRef.current) {
      console.log('🎵 Audio player loaded metadata:');
      console.log('  - Audio source:', audioRef.current.src);
      console.log('  - Audio format (from blob):', mimeTypeRef.current);
      if (audioBlobRef.current) {
        console.log('  - Blob type:', audioBlobRef.current.type);
      }
      console.log('  - Audio duration:', audioRef.current.duration.toFixed(2), 'seconds');
      console.log('  - Audio ready for playback');
    }
  };

  const handleReRecord = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setRecordedAudio(null);
    setHasRecorded(false);
    setUploadSuccess(false);
    setUploadError(null);
    audioBlobRef.current = null;
    if (recordedAudio) {
      URL.revokeObjectURL(recordedAudio);
    }
  };

  const handleOK = async () => {
    if (!isSessionValid) {
      setError('Session has been replaced. Please refresh the page.');
      return;
    }

    if (!audioBlobRef.current) {
      setError('No audio recorded. Please record again.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    setError(null);

    try {
      // Log the audio format being uploaded
      console.log('📤 Uploading audio to Google Drive:');
      console.log('  - Audio format (mimeType):', mimeTypeRef.current);
      if (audioBlobRef.current) {
        console.log('  - Blob type:', audioBlobRef.current.type);
        console.log('  - Blob size:', (audioBlobRef.current.size / 1024).toFixed(2), 'KB');
      }
      
      // Create FormData to send the audio file
      const formData = new FormData();
      // Determine file extension based on mimeType
      let fileExtension = 'webm';
      if (mimeTypeRef.current.includes('webm')) {
        fileExtension = 'webm';
      } else if (mimeTypeRef.current.includes('ogg')) {
        fileExtension = 'ogg';
      }
      formData.append('audio', audioBlobRef.current, `recording.${fileExtension}`);
      formData.append('mimeType', mimeTypeRef.current);
      formData.append('scriptId', currentRowIndex.toString()); // Row index from Google Sheets
      formData.append('scriptText', currentText); // Text from Google Sheets
      formData.append('userIdentifier', username || 'default_user'); // Username
      formData.append('userId', userId?.toString() || ''); // User ID for progress tracking
      
      console.log('  - File extension:', fileExtension);
      console.log('  - Script ID (row index):', currentRowIndex);
      console.log('  - Script text:', currentText.substring(0, 50) + (currentText.length > 50 ? '...' : ''));
      console.log('  - Uploading with preserved format...');

      // Upload to Google Drive
      const response = await fetch('/api/upload-audio', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload audio');
      }

      setUploadSuccess(true);
      setUploadError(null);
      
      // Log successful upload with format info
      console.log('✅ Audio uploaded successfully to Google Drive:');
      console.log('  - File ID:', data.fileId);
      console.log('  - File name:', data.fileName);
      console.log('  - Uploaded format:', mimeTypeRef.current);
      if (data.webViewLink) {
        console.log('  - View link:', data.webViewLink);
      }
      if (data.supabaseRecordId) {
        console.log('  - Supabase record ID:', data.supabaseRecordId);
        console.log('  - ✅ Saved to Supabase recordings table');
      }

      // Update user progress in Supabase
      if (userId) {
        try {
          console.log(`💾 Updating user progress: Script ${currentRowIndex}, Session: ${sessionId}`);
          const progressResponse = await fetch('/api/user-progress', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: userId,
              scriptId: currentRowIndex,
              sessionId: sessionId,
              expectedVersion: userVersion,
            }),
          });

          const progressData = await progressResponse.json();

          if (progressResponse.ok) {
            if (progressData.error === 'SESSION_INVALIDATED') {
              // Session was invalidated during upload
              setIsSessionValid(false);
              setError('This session has been replaced by another device/tab. Please refresh the page.');
              console.warn('⚠️ Session invalidated during upload');
              
              // Stop session checking
              if (sessionCheckIntervalRef.current) {
                clearInterval(sessionCheckIntervalRef.current);
                sessionCheckIntervalRef.current = null;
              }
            } else if (progressData.conflict) {
              console.warn('⚠️ Progress conflict detected - another session may have updated');
              setError('Progress was updated by another session. Please refresh the page.');
            } else {
              console.log('✅ User progress updated successfully');
              setUserVersion(progressData.version || userVersion + 1);
            }
          } else {
            if (progressData.error === 'SESSION_INVALIDATED') {
              setIsSessionValid(false);
              setError('This session has been replaced by another device/tab. Please refresh the page.');
            } else {
              console.warn('⚠️ Failed to update user progress (non-critical)');
            }
          }
        } catch (progressError) {
          console.warn('⚠️ Error updating user progress (non-critical):', progressError);
        }
      }

      // After successful upload, fetch next row
      if (hasMoreRows) {
        const nextRowIndex = currentRowIndex + 1;
        console.log(`\n📥 Upload complete! Loading next row (${nextRowIndex})...\n`);
        
        // Small delay to show success message before loading next row
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Reset recording state
        setHasRecorded(false);
        setRecordedAudio(null);
        setUploadSuccess(false);
        audioBlobRef.current = null;
        if (recordedAudio) {
          URL.revokeObjectURL(recordedAudio);
        }
        
        // Move to next script (from batch or fetch next batch)
        await moveToNextScript();
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      setUploadError(error.message || 'Failed to upload audio to Google Drive');
      setUploadSuccess(false);
    } finally {
      setIsUploading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* Username Modal */}
      <UsernameModal
        isOpen={showUsernameModal}
        onSubmit={handleUsernameSubmit}
      />

      <div className="w-full max-w-4xl mx-auto p-6 space-y-8">
        {/* Session Invalidated Warning */}
        {!isSessionValid && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <div className="text-xl">🔒</div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-800 dark:text-red-200 mb-1">
                  Session Replaced
                </h3>
                <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                  This session has been replaced by another device/tab. Please refresh the page to continue with the latest session.
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Refresh Page
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100 mb-2">
            🎤 Audio Collector
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {username ? `Welcome, ${username}! Read the text below and record your audio` : 'Read the text below and record your audio'}
          </p>
          {username && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Script {currentRowIndex} of {currentRowIndex}+
            </p>
          )}
        </div>

      {/* Text Display Card */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 rounded-2xl p-8 shadow-lg border border-blue-100 dark:border-gray-700">
        <div className="flex items-start gap-3 mb-4">
          <div className="text-2xl">📝</div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
            Text to Read
          </h2>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-inner border border-gray-200 dark:border-gray-700">
          {isLoadingSheet ? (
            <div className="flex items-center justify-center gap-3 py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading text from Google Sheets...</p>
            </div>
          ) : (
            <>
              <p className="text-lg leading-relaxed text-gray-800 dark:text-gray-200 font-medium">
                {currentText || 'No text available'}
              </p>
              {hasMoreRows && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                  Row {currentRowIndex} of {currentRowIndex}+
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <div className="text-xl">⚠️</div>
          <p className="text-red-800 dark:text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-auto text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Recording Section */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col items-center space-y-6">
          {/* Recording Button */}
          {!hasRecorded ? (
            <div className="flex flex-col items-center space-y-4">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={!isSessionValid || isLoading}
                  aria-label="Start recording"
                  className="group relative flex items-center justify-center w-24 h-24 bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  <div className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-75"></div>
                  <svg
                    className="w-12 h-12 text-white relative z-10"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              ) : (
                <div className="flex flex-col items-center space-y-4">
                  <button
                    type="button"
                    onClick={stopRecording}
                    aria-label="Stop recording"
                    className="group relative flex items-center justify-center w-24 h-24 bg-gradient-to-br from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 active:scale-95"
                  >
                    <div className="absolute inset-0 rounded-full bg-red-500 animate-pulse opacity-75"></div>
                    <div className="w-8 h-8 bg-white rounded relative z-10" aria-hidden="true"></div>
                  </button>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {formatTime(recordingTime)}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Recording...
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Noise Cancellation Active
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <p className="text-gray-600 dark:text-gray-400 text-center">
                {isRecording
                  ? 'Click the stop button to finish recording'
                  : 'Click the microphone to start recording'}
              </p>
            </div>
          ) : (
            /* Playback Section */
            <div className="w-full space-y-6">
              <div className="flex flex-col items-center space-y-4">
                <div className="text-center">
                  <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
                    ✓ Recording Complete!
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Listen to your recording to verify
                  </p>
                </div>

                {/* Audio Player */}
                <div className="w-full max-w-md bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                  <audio
                    ref={audioRef}
                    src={recordedAudio || undefined}
                    onEnded={handleAudioEnded}
                    onLoadedMetadata={handleAudioLoadedMetadata}
                    className="w-full"
                    controls
                  />
                </div>

                {/* Upload Status */}
                {isUploading && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    <p className="text-blue-800 dark:text-blue-200">Uploading to Google Drive...</p>
                  </div>
                )}

                {uploadError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
                    <div className="text-xl">⚠️</div>
                    <p className="text-red-800 dark:text-red-200">{uploadError}</p>
                    <button
                      type="button"
                      onClick={() => setUploadError(null)}
                      className="ml-auto text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-4 justify-center">
                  <button
                    type="button"
                    onClick={handleReRecord}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-105 active:scale-95 font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Re-record
                  </button>
                  <button
                    type="button"
                    onClick={handleOK}
                    disabled={!isSessionValid || isUploading || uploadSuccess || !hasMoreRows}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-105 active:scale-95 font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {isUploading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        Uploading...
                      </>
                    ) : uploadSuccess ? (
                      <>
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Uploaded!
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        OK - Looks Good!
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <div className="text-xl">💡</div>
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">
              Instructions
            </h3>
            <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1 list-disc list-inside">
              <li>Click the microphone button to start recording</li>
              <li>Read the text clearly and at a comfortable pace</li>
              <li>Click stop when you're done reading</li>
              <li>Listen to your recording to verify it's correct</li>
              <li>If satisfied, click "OK - Looks Good!"</li>
              <li>If not satisfied, click "Re-record" to try again</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

