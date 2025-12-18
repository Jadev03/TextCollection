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
  const [currentLevel, setCurrentLevel] = useState<number>(1);
  const [totalLevels, setTotalLevels] = useState<number>(0);
  const [scriptsCompletedInLevel, setScriptsCompletedInLevel] = useState<number>(0);
  const [currentText, setCurrentText] = useState<string>('');
  const [currentRowIndex, setCurrentRowIndex] = useState<number>(1);
  const [isLoadingSheet, setIsLoadingSheet] = useState<boolean>(false);
  const [hasMoreRows, setHasMoreRows] = useState<boolean>(true);
  const [levelComplete, setLevelComplete] = useState<boolean>(false);
  const [scriptsBatch, setScriptsBatch] = useState<Array<{ originalRowIndex: number; text: string; indexInBatch: number; scriptIndexInLevel: number }>>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number>(0);
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

  // Fetch batch of scripts for current level (with user-specific shuffle)
  const fetchLevelScriptBatch = async (level: number, userIdToUse?: number) => {
    try {
      setIsLoadingSheet(true);
      setError(null);
      
      // Use provided userId or fall back to state
      const effectiveUserId = userIdToUse || userId;
      
      if (!effectiveUserId) {
        throw new Error('User ID not available');
      }

      console.log(`📊 Fetching batch of scripts for Level ${level}...`);
      console.log(`  - Using User ID: ${effectiveUserId}`);
      
      const response = await fetch(`/api/get-level-scripts?userId=${effectiveUserId}&level=${level}&batchSize=5`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch level scripts');
      }

      if (!data.scripts || data.scripts.length === 0) {
        // Check if this is because level is complete or no more scripts exist
        if (data.levelComplete) {
          // Level is complete, move to next level
          setLevelComplete(true);
          setCurrentText(`🎉 Level ${level} Complete! Moving to Level ${level + 1}...`);
          console.log(`✅ Level ${level} completed!`);
          
          // Small delay then fetch next level
          await new Promise(resolve => setTimeout(resolve, 2000));
          const nextLevel = level + 1;
          setCurrentLevel(nextLevel);
          setScriptsCompletedInLevel(0);
          setLevelComplete(false);
          setHasMoreRows(true);
          setCurrentBatchIndex(0);
          // Use the already-resolved user id to avoid any state timing issues
          await fetchLevelScriptBatch(nextLevel, effectiveUserId);
        } else {
          // No more scripts available at all
          setHasMoreRows(false);
          setCurrentText('No more scripts available. All done! 🎉');
          console.log('✅ No more scripts available');
        }
      } else {
        // Store the batch and show first script
        setScriptsBatch(data.scripts);
        setCurrentBatchIndex(0);
        setCurrentText(data.scripts[0].text);
        setCurrentRowIndex(data.scripts[0].originalRowIndex);
        setScriptsCompletedInLevel(data.scripts[0].scriptIndexInLevel);
        setHasMoreRows(data.hasMoreInLevel || data.scripts.length > 1);
        setLevelComplete(data.levelComplete);
        
        console.log(`✅ Loaded batch of ${data.scripts.length} scripts for Level ${level}:`);
        console.log(`  - Scripts ${data.batchStartIndex + 1} to ${data.batchEndIndex + 1} of ${data.totalScriptsInLevel}`);
        console.log(`  - Scripts remaining in level: ${data.scriptsRemainingInLevel}`);
        console.log(`  - Has more in level: ${data.hasMoreInLevel}`);
      }
    } catch (error: any) {
      console.error('❌ Error fetching level script batch:', error);
      setError(error.message || 'Failed to fetch scripts');
      setCurrentText('');
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Move to next script in current batch or fetch next batch
  const moveToNextScript = async () => {
    const nextBatchIndex = currentBatchIndex + 1;
    
    // Check if we have more scripts in current batch
    if (nextBatchIndex < scriptsBatch.length) {
      // Use next script from current batch
      setCurrentBatchIndex(nextBatchIndex);
      setCurrentText(scriptsBatch[nextBatchIndex].text);
      setCurrentRowIndex(scriptsBatch[nextBatchIndex].originalRowIndex);
      setScriptsCompletedInLevel(scriptsBatch[nextBatchIndex].scriptIndexInLevel);
      console.log(`✅ Moving to next script in batch: ${nextBatchIndex + 1}/${scriptsBatch.length}`);
    } else if (hasMoreRows && userId) {
      // Current batch exhausted, fetch next batch
      console.log(`📦 Current batch exhausted, fetching next batch...`);
      await fetchLevelScriptBatch(currentLevel, userId);
    } else {
      // No more scripts
      console.log(`❌ No more scripts available`);
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

  // Fetch total levels from Google Sheets
  const fetchTotalLevels = async () => {
    try {
      const response = await fetch('/api/get-total-scripts');
      const data = await response.json();

      if (response.ok && data.success) {
        setTotalLevels(data.totalLevels || 0);
        console.log(`📊 Total levels loaded: ${data.totalLevels} (${data.totalScripts} total scripts)`);
      } else {
        console.warn('⚠️ Failed to fetch total levels:', data.error);
      }
    } catch (error: any) {
      console.warn('⚠️ Error fetching total levels:', error);
    }
  };

  // Handle username submission
  const handleUsernameSubmit = async (enteredUsername: string) => {
    setIsLoadingUser(true);
    setError(null);

    try {
      // Convert username to lowercase for case-insensitive handling
      const normalizedUsername = enteredUsername.trim().toLowerCase();
      const currentSessionId = sessionId || crypto.randomUUID();
      console.log(`👤 Getting user progress for: ${normalizedUsername} (Session: ${currentSessionId})`);
      
      // Fetch total levels in parallel
      await fetchTotalLevels();
      
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
      // Keep modal open to show loading, close it after everything loads

      // Start periodic session validation
      startSessionValidation(data.userId, data.sessionId || currentSessionId);

      // Set level and progress
      const userLevel = data.currentLevel || 1;
      const scriptsCompleted = data.scriptsCompletedInLevel || 0;
      const receivedUserId = data.userId;
      
      setCurrentLevel(userLevel);
      setScriptsCompletedInLevel(scriptsCompleted);
      setUserId(receivedUserId); // Set userId state
      
      console.log(`✅ User loaded: ${enteredUsername}`);
      console.log(`  - User ID: ${receivedUserId}`);
      console.log(`  - Session ID: ${data.sessionId}`);
      console.log(`  - Current Level: ${userLevel}`);
      console.log(`  - Scripts completed in level: ${scriptsCompleted}/50`);
      console.log(`  - Is new user: ${data.isNewUser}`);

      // Fetch batch of scripts for current level (with user-specific shuffle)
      // Pass userId directly to avoid timing issues with state updates
      await fetchLevelScriptBatch(userLevel, receivedUserId);
      
      // Close modal after everything is loaded
      setShowUsernameModal(false);
    } catch (error: any) {
      console.error('❌ Error loading user:', error);
      setError(error.message || 'Failed to load user progress');
      // Don't close modal on error so user can try again
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
      formData.append('originalRowIndex', currentRowIndex.toString()); // Original row index from Google Sheets
      formData.append('scriptText', currentText); // Text from Google Sheets
      formData.append('userIdentifier', username || 'default_user'); // Username
      formData.append('userId', userId?.toString() || ''); // User ID for progress tracking
      formData.append('level', currentLevel.toString()); // Current level
      
      console.log('  - File extension:', fileExtension);
      console.log('  - Level:', currentLevel);
      console.log('  - Script in level:', scriptsCompletedInLevel + 1);
      console.log('  - Original row index:', currentRowIndex);
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

      // Track progress response so we can navigate deterministically (avoid stale React state reads)
      let progressIndicatesLevelComplete = false;
      let progressNextLevel: number | null = null;

      // Update user progress in Supabase (level-based)
      if (userId) {
        try {
          console.log(`💾 Updating user progress: Level ${currentLevel}, Script Row ${currentRowIndex}, Session: ${sessionId}`);
          const progressResponse = await fetch('/api/user-progress', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: userId,
              originalRowIndex: currentRowIndex,
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
              const updatedLevel: number = progressData.currentLevel ?? currentLevel;
              const updatedScriptsCompleted: number =
                typeof progressData.scriptsCompletedInLevel === 'number'
                  ? progressData.scriptsCompletedInLevel
                  : 0;

              setCurrentLevel(updatedLevel);
              setScriptsCompletedInLevel(updatedScriptsCompleted);
              
              // Check if level is complete
              if (progressData.levelComplete) {
                console.log(`🎉 Level ${currentLevel} completed! Moving to level ${updatedLevel}`);
                setLevelComplete(true);
                progressIndicatesLevelComplete = true;
                progressNextLevel = updatedLevel;
              }
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

      // If the progress update says the level is complete, immediately load the next level.
      // This avoids relying on `levelComplete`/`currentLevel` React state updates happening
      // before we decide what to fetch next (which can cause the wrong level to be fetched).
      if (progressIndicatesLevelComplete && userId) {
        const finishedLevel = currentLevel;
        const nextLevel = progressNextLevel ?? finishedLevel + 1;

        console.log(`\n🎉 Level ${finishedLevel} complete! Auto-loading Level ${nextLevel}...\n`);
        setCurrentText(`🎉 Level ${finishedLevel} Complete! Moving to Level ${nextLevel}...`);

        // Small delay to show success/transition message before loading next level
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Reset recording state
        setHasRecorded(false);
        setRecordedAudio(null);
        setUploadSuccess(false);
        audioBlobRef.current = null;
        if (recordedAudio) {
          URL.revokeObjectURL(recordedAudio);
        }

        // Reset batch state and load next level scripts
        setScriptsBatch([]);
        setCurrentBatchIndex(0);
        setHasMoreRows(true);
        setScriptsCompletedInLevel(0);
        await fetchLevelScriptBatch(nextLevel, userId);
        return;
      }

      // After successful upload, fetch next script in level
      if (hasMoreRows && !levelComplete) {
        console.log(`\n📥 Upload complete! Loading next script in level ${currentLevel}...\n`);
        
        // Small delay to show success message before loading next script
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
      } else if (levelComplete) {
        // Level complete, will be handled by fetchLevelScriptBatch
        console.log(`🎉 Level ${currentLevel} complete!`);
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
        isLoading={isLoadingUser}
      />
      
      {/* Full Page Loading Overlay - Shows after username is submitted */}
      {isLoadingUser && !showUsernameModal && (
        <div className="fixed inset-0 bg-white dark:bg-gray-900 z-50 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 border-4 border-blue-200 dark:border-blue-800 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
                Loading Your Progress...
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Please wait while we fetch your scripts
              </p>
            </div>
          </div>
        </div>
      )}

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
            <div className="mt-4 flex items-center justify-center gap-6">
              {/* Circular Progress Bar for Levels */}
              {totalLevels > 0 && (
                <div className="flex flex-col items-center">
                  <div className="relative w-20 h-20">
                    <svg className="transform -rotate-90 w-20 h-20">
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        className="text-gray-200 dark:text-gray-700"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={`${2 * Math.PI * 36}`}
                        strokeDashoffset={`${2 * Math.PI * 36 * (1 - (currentLevel - 1) / totalLevels)}`}
                        strokeLinecap="round"
                        className="text-green-600 dark:text-green-500 transition-all duration-500"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {currentLevel - 1}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          / {totalLevels}
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Levels</p>
                </div>
              )}
              
              {/* Linear Progress Bar for Current Level */}
              <div className="flex-1 max-w-md">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Level {currentLevel} Progress
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {scriptsCompletedInLevel + 1} / 50
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 h-3 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${((scriptsCompletedInLevel + 1) / 50) * 100}%` }}
                  >
                    {((scriptsCompletedInLevel + 1) / 50) * 100 > 10 && (
                      <span className="text-xs font-medium text-white">
                        {Math.round(((scriptsCompletedInLevel + 1) / 50) * 100)}%
                      </span>
                    )}
                  </div>
                </div>
                {levelComplete && (
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-1 text-center">
                    🎉 Level {currentLevel} Complete!
                  </p>
                )}
              </div>
            </div>
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
                    <p className="text-blue-800 dark:text-blue-200">Uploading ...</p>
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
                    // Allow uploading even if this is the last script (hasMoreRows can be false on the final script).
                    disabled={!isSessionValid || isUploading || uploadSuccess || !currentText}
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

