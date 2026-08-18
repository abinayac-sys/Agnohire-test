import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Monitor, Maximize } from 'lucide-react';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useLocalParticipant,
  useConnectionState,
  RoomAudioRenderer,
  useRoomContext
} from '@livekit/components-react';
import { Track, ConnectionState, RoomEvent } from 'livekit-client';
import '@livekit/components-styles';
import type { WebRTCCallState } from '../../hooks/useWebRTC.js';

interface Props {
  callState: WebRTCCallState;
  onAnswer: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
}

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// Extracted inner content to use LiveKit hooks
const LiveKitCallContent: React.FC<{ callState: WebRTCCallState; isFullscreen: boolean }> = ({ callState, isFullscreen }) => {
  const roomState = useConnectionState();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  const { localParticipant } = useLocalParticipant();
  const remoteTracks = tracks.filter(t => t.participant.identity !== localParticipant.identity);

  // Find remote tracks separately
  const remoteCameraTrack = remoteTracks.find(t => t.source === Track.Source.Camera);
  const remoteScreenTrack = remoteTracks.find(t => t.source === Track.Source.ScreenShare);

  // Prioritize screenshare for main view
  const mainRemoteTrack = remoteScreenTrack || remoteCameraTrack;

  // Find local tracks
  const localCameraTrack = tracks.find(t => t.participant.identity === localParticipant.identity && t.source === Track.Source.Camera);

  const room = useRoomContext();
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(!room.canPlaybackAudio);

  useEffect(() => {
    const onAudioPlaybackChanged = () => {
      setNeedsAudioUnlock(!room.canPlaybackAudio);
    };
    room.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
    };
  }, [room]);

  useEffect(() => {
    console.log(`[WebRTC] [Trace] LiveKit Connection State changed to: ${roomState}`);
  }, [roomState]);

  // <LiveKitRoom>'s own audio/video props only publish once, in response to
  // the room's SignalConnected event — they do NOT react to prop changes
  // afterwards. That made toggleMic/toggleCamera update the UI icon without
  // ever actually muting/enabling the real track once a call was connected.
  // Skip the very first run on each track so we don't double-publish on top
  // of that initial connect-time publish.
  const isFirstMicRun = useRef(true);
  useEffect(() => {
    if (isFirstMicRun.current) { isFirstMicRun.current = false; return; }
    localParticipant.setMicrophoneEnabled(!callState.isMicMuted).catch((err) => {
      console.error('[WebRTC] [Trace] Failed to toggle microphone', err);
    });
  }, [callState.isMicMuted, localParticipant]);

  const isFirstCameraRun = useRef(true);
  useEffect(() => {
    if (isFirstCameraRun.current) { isFirstCameraRun.current = false; return; }
    localParticipant.setCameraEnabled(!callState.isCameraOff).catch((err) => {
      console.error('[WebRTC] [Trace] Failed to toggle camera', err);
    });
  }, [callState.isCameraOff, localParticipant]);

  const isFirstScreenShareRun = useRef(true);
  useEffect(() => {
    if (isFirstScreenShareRun.current) { isFirstScreenShareRun.current = false; return; }
    localParticipant.setScreenShareEnabled(callState.isScreenSharing).catch((err) => {
      console.error('[WebRTC] [Trace] Failed to toggle screen share', err);
    });
  }, [callState.isScreenSharing, localParticipant]);

  return (
    <>
      {needsAudioUnlock && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-slate-900/95 border border-slate-700 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
          <p className="text-white font-medium text-lg">Click to enable audio</p>
          <button
            onClick={() => room.startAudio()}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-bold transition-all shadow-lg"
          >
            Enable Audio
          </button>
        </div>
      )}

      {mainRemoteTrack ? (
        <VideoTrack
          trackRef={mainRemoteTrack as any}
          className="w-full h-full object-contain rounded-xl"
        />
      ) : roomState !== ConnectionState.Connected ? (
        <div className="flex flex-col items-center justify-center text-slate-500 gap-6 w-full h-full">
          <div className="w-32 h-32 rounded-full bg-slate-800/50 animate-pulse flex items-center justify-center text-5xl font-bold text-slate-300 relative">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 animate-ping"></div>
            {callState.peerName?.charAt(0) || 'U'}
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-slate-300">
              Connecting to call...
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-slate-500 gap-6 w-full h-full">
          <div className="w-32 h-32 rounded-full bg-slate-800/50 animate-pulse flex items-center justify-center text-5xl font-bold text-slate-300 relative">
            <div className="absolute inset-0 rounded-full border-4 border-blue-500/30 animate-ping"></div>
            {callState.peerName?.charAt(0) || 'U'}
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-slate-300">
              Waiting for video stream...
            </p>
          </div>
        </div>
      )}

      {/* Remote PIP Video (if remote user is screensharing AND has camera on) */}
      {remoteScreenTrack && remoteCameraTrack && (
        <div className={`absolute bottom-6 left-6 ${isFullscreen ? 'w-64 h-48' : 'w-48 h-36'} bg-slate-900 rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl transition-all duration-300 z-10`}>
          <VideoTrack
            trackRef={remoteCameraTrack as any}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Local PIP Video */}
      {!callState.isCameraOff && localCameraTrack && (
        <div className={`absolute bottom-6 right-6 ${isFullscreen ? 'w-64 h-48' : 'w-48 h-36'} bg-slate-900 rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl transition-all duration-300 z-10`}>
          <VideoTrack
            trackRef={localCameraTrack as any}
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
          {callState.isMicMuted && (
            <div className="absolute bottom-2 right-2 bg-rose-600/90 p-1.5 rounded-md backdrop-blur-sm">
              <MicOff className="w-3 h-3 text-white" />
            </div>
          )}
        </div>
      )}
    </>
  );
};

export const WebRTCCallModal: React.FC<Props> = ({
  callState,
  onAnswer,
  onReject,
  onEnd,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [livekitError, setLivekitError] = useState<string | null>(null);
  const [lkConnectionState, setLkConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);

  const roomOptions = useMemo(() => ({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
      screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 60 },
    }
  }), []);

  const videoOptions = useMemo(() => {
    return callState.isCameraOff ? false : { resolution: { width: 1920, height: 1080, frameRate: 30 } };
  }, [callState.isCameraOff]);

  // Timer logic
  useEffect(() => {
    if (callState.livekitToken) {
      const interval = setInterval(() => setDuration(d => d + 1), 1000);
      return () => clearInterval(interval);
    } else {
      setDuration(0);
      setLkConnectionState(ConnectionState.Disconnected);
    }
  }, [callState.livekitToken]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (!callState.isInCall) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-2 sm:p-4">
      <div
        ref={containerRef}
        className={`bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col transition-all duration-300 max-h-full ${
          isFullscreen ? 'w-screen h-screen rounded-none border-none' : 'w-full max-w-5xl h-full sm:h-[85vh] rounded-2xl'
        }`}
      >
        {/* Header */}
        <div className="p-4 bg-slate-950/60 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-600/20 text-blue-400 font-bold flex items-center justify-center border border-blue-500/30 text-lg">
              {callState.peerName?.charAt(0) || 'U'}
            </div>
            <div>
              <h3 className="font-semibold text-white text-lg">{callState.peerName || 'Team Member'}</h3>
              <div className="flex items-center gap-2">
                <p className="text-sm text-slate-400 capitalize">
                  {callState.isIncoming && !callState.livekitToken
                    ? 'Incoming call...'
                    : callState.livekitToken ? 'Connected' : 'Ringing...'}
                </p>
                {callState.livekitToken && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                    <span className="text-sm font-mono text-emerald-400">{formatDuration(duration)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {callState.status === 'CONNECTING' && (!callState.livekitToken || lkConnectionState !== ConnectionState.Connected) ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <div className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"></div>
                <span className="text-xs font-medium uppercase tracking-wider">Connecting</span>
              </div>
            ) : callState.livekitToken && lkConnectionState === ConnectionState.Connected ? (
              <span className="px-3 py-1.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                Encrypted LiveKit
              </span>
            ) : null}

            {!callState.isIncoming && (
              <button onClick={toggleFullscreen} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                <Maximize className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Video Grid */}
        <div className="relative flex-1 bg-slate-950 flex items-center justify-center overflow-hidden p-2">
          {callState.livekitToken && callState.livekitUrl ? (
            <LiveKitRoom
              token={callState.livekitToken}
              serverUrl={callState.livekitUrl}
              connect={true}
              options={roomOptions}
              video={videoOptions}
              audio={!callState.isMicMuted}
              screen={callState.isScreenSharing}
              className="w-full h-full flex"
              onConnected={() => setLkConnectionState(ConnectionState.Connected)}
              onDisconnected={() => {
                console.warn('[WebRTC] [Trace] LiveKitRoom disconnected.');
                // Note: React 18 StrictMode unmounts/remounts LiveKitRoom, triggering disconnect.
                // Do not forcefully call onEnd() here, as it kills the call for both users instantly.
                setLkConnectionState(ConnectionState.Disconnected);
              }}
              onError={(err) => {
                if (err.message && err.message.toLowerCase().includes('abort')) {
                  console.warn('[WebRTC] [Trace] Ignoring abort error from LiveKitRoom (likely StrictMode unmount)');
                  return;
                }
                console.error('[WebRTC] [Trace] LiveKitRoom error:', err);
                setLivekitError(err.message || 'Failed to connect to media server');
              }}
            >
              {livekitError ? (
                <div className="flex flex-col items-center justify-center text-rose-500 gap-4 w-full h-full bg-slate-900 z-50">
                  <PhoneOff className="w-16 h-16 opacity-80" />
                  <p className="text-xl font-semibold">Connection Error</p>
                  <p className="text-slate-400 text-sm max-w-md text-center">{livekitError}</p>
                </div>
              ) : (
                <>
                  <RoomAudioRenderer />
                  <LiveKitCallContent callState={callState} isFullscreen={isFullscreen} />
                </>
              )}
            </LiveKitRoom>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-500 gap-6 w-full h-full">
              <div className="w-32 h-32 rounded-full bg-slate-800/50 animate-pulse flex items-center justify-center text-5xl font-bold text-slate-300 relative">
                <div className="absolute inset-0 rounded-full border-4 border-blue-500/30 animate-ping"></div>
                {callState.peerName?.charAt(0) || 'U'}
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-slate-300">
                  {callState.isIncoming ? 'Incoming call...' : callState.roomId && callState.peerId ? 'Ringing...' : 'Connecting...'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Call Controls */}
        <div className="p-6 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-center gap-6 shrink-0">
          {callState.isIncoming && !callState.livekitToken ? (
            <>
              <button
                onClick={onAnswer}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-full flex items-center gap-3 shadow-lg shadow-emerald-900/20 transition-all hover:scale-105"
              >
                <Phone className="w-5 h-5" /> Accept
              </button>
              <button
                onClick={onReject}
                className="px-8 py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-full flex items-center gap-3 shadow-lg shadow-rose-900/20 transition-all hover:scale-105"
              >
                <PhoneOff className="w-5 h-5" /> Decline
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onToggleMic}
                className={`p-4 rounded-full transition-all border ${
                  callState.isMicMuted
                    ? 'bg-rose-600/20 border-rose-500/30 text-rose-400 hover:bg-rose-600/30'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white shadow-lg'
                }`}
                title={callState.isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
              >
                {callState.isMicMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>

              <button
                onClick={onToggleCamera}
                className={`p-4 rounded-full transition-all border ${
                  callState.isCameraOff
                    ? 'bg-rose-600/20 border-rose-500/30 text-rose-400 hover:bg-rose-600/30'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white shadow-lg'
                }`}
                title={callState.isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
              >
                {callState.isCameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
              </button>

              <button
                onClick={onToggleScreenShare}
                className={`p-4 rounded-full transition-all border ${
                  callState.isScreenSharing
                    ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/20'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white shadow-lg'
                }`}
                title="Share Screen"
              >
                <Monitor className="w-6 h-6" />
              </button>
              <div className="w-px h-10 bg-slate-800 mx-2"></div>

              <button
                onClick={onEnd}
                className="px-8 py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-full flex items-center gap-3 shadow-lg shadow-rose-900/20 transition-all hover:scale-105"
              >
                <PhoneOff className="w-6 h-6" /> End Call
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
