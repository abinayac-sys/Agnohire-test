import { useState, useRef, useEffect, useCallback } from 'react';
import { connectSocket } from '../services/socket.js';
import { api } from '../services/api.js';

export interface WebRTCCallState {
  status: 'IDLE' | 'CALLING' | 'INCOMING' | 'CONNECTING' | 'CONNECTED';
  isInCall: boolean;
  isIncoming: boolean;
  roomId?: string;
  peerId?: string;
  peerName?: string;
  callType: 'AUDIO' | 'VIDEO' | 'SCREEN';
  livekitToken?: string;
  livekitUrl?: string;
  isMicMuted: boolean; // We might not need this here since LiveKit manages it, but keeping for initial state
  isCameraOff: boolean;
  isScreenSharing: boolean;
}

export function useWebRTC(currentUserId?: string) {
  const [callState, setCallState] = useState<WebRTCCallState>({
    status: 'IDLE',
    isInCall: false,
    isIncoming: false,
    callType: 'AUDIO',
    isMicMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
  });

  const callStateRef = useRef(callState);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const endCall = useCallback(() => {
    console.log('[WebRTC] [Trace] endCall invoked, cleaning up state and notifying remote peer');

    const prev = callStateRef.current;
    if (prev.roomId) {
      connectSocket().emit('call-ended', { roomId: prev.roomId, targetUserId: prev.peerId });
    } else if (prev.peerId) {
      connectSocket().emit('call-ended', { targetUserId: prev.peerId });
    }

    setCallState({
      status: 'IDLE',
      isInCall: false,
      isIncoming: false,
      callType: 'AUDIO',
      isMicMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
      roomId: undefined,
      peerId: undefined,
      peerName: undefined,
      livekitToken: undefined,
      livekitUrl: undefined
    });
  }, []);

  const fetchLiveKitToken = async (roomId: string) => {
    console.log(`[WebRTC] [Trace] fetchLiveKitToken called for roomId: ${roomId}`);
    try {
      const res = await api.get(`/communication/livekit/token?roomId=${roomId}`);
      if (res.data?.success) {
        console.log(`[WebRTC] [Trace] Successfully fetched LiveKit token for roomId: ${roomId}`);
        return res.data.data;
      }
      console.warn(`[WebRTC] [Trace] Token API returned failure for roomId: ${roomId}`, res.data);
      return null;
    } catch (err) {
      console.error('[WebRTC] [Trace] Failed to fetch LiveKit token:', err);
      return null;
    }
  };

  const startCall = async (targetUserId: string, targetName: string, type: 'AUDIO' | 'VIDEO' | 'SCREEN' = 'AUDIO') => {
    if (!currentUserId) return;

    const roomId = `room_${currentUserId}_${targetUserId}_${Date.now()}`;
    console.log(`[WebRTC] [Trace] startCall triggered to ${targetUserId} with type ${type}. Room ID: ${roomId}`);

    setCallState({
      status: 'CALLING',
      isInCall: true,
      isIncoming: false,
      peerId: targetUserId,
      peerName: targetName,
      roomId: roomId,
      callType: type,
      isMicMuted: false,
      isCameraOff: type !== 'VIDEO',
      isScreenSharing: type === 'SCREEN'
    });

    console.log(`[WebRTC] [Trace] Emitting 'call-request' via socket to targetUserId: ${targetUserId} from currentUserId: ${currentUserId}`);
    connectSocket().emit('call-request', {
      targetUserId,
      type,
      roomId
    });
  };

  const answerCall = async () => {
    const currentState = callStateRef.current;
    if (!currentState.peerId || !currentState.roomId) {
       console.warn('[WebRTC] [Trace] Cannot answer call: missing peer or room');
       return;
    }

    console.log(`[WebRTC] [Trace] Answering call for roomId: ${currentState.roomId}`);

    // Immediately clear incoming state so UI updates to Connecting
    setCallState(s => ({ ...s, status: 'CONNECTING', isIncoming: false }));

    // Tell caller we accepted
    connectSocket().emit('call-accepted', { callerId: currentState.peerId, roomId: currentState.roomId });

    // Fetch token and join LiveKit room
    const tokenData = await fetchLiveKitToken(currentState.roomId);
    if (tokenData) {
      let finalUrl = tokenData.url;
      // If server returned localhost but we are on LAN, rewrite the URL
      if (finalUrl.includes('localhost') && window.location.hostname !== 'localhost') {
        finalUrl = finalUrl.replace('localhost', window.location.hostname);
      }

      console.log(`[WebRTC] [Trace] LiveKit token retrieved, updating state to connect to ${finalUrl}`);
      setCallState(s => ({
        ...s,
        livekitToken: tokenData.token,
        livekitUrl: finalUrl
      }));
    } else {
      console.warn(`[WebRTC] [Trace] Token retrieval failed, aborting answer and ending call`);
      endCall();
    }
  };

  const rejectCall = useCallback(() => {
    const currentState = callStateRef.current;
    if (currentState.peerId) {
      connectSocket().emit('call-rejected', { callerId: currentState.peerId });
    }
    endCall();
  }, [endCall]);

  const toggleMic = useCallback(() => {
    setCallState(s => ({ ...s, isMicMuted: !s.isMicMuted }));
  }, []);

  const toggleCamera = useCallback(() => {
    setCallState(s => ({ ...s, isCameraOff: !s.isCameraOff }));
  }, []);

  const toggleScreenShare = useCallback(() => {
    setCallState(s => ({ ...s, isScreenSharing: !s.isScreenSharing }));
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    const socket = connectSocket();

    const handleCallRequest = (data: { callerId: string; type: 'AUDIO' | 'VIDEO' | 'SCREEN'; roomId: string }) => {
      console.log(`[WebRTC] [Trace] Incoming 'call-request' received via socket! callerId: ${data.callerId}, type: ${data.type}, roomId: ${data.roomId}`);

      // Trigger Browser Notification
      if ('Notification' in window) {
        const title = data.type === 'VIDEO' ? 'Incoming Video Call' : 'Incoming Audio Call';
        const options = {
          body: `You are receiving an incoming call. Click here to answer.`,
          requireInteraction: true,
          silent: false,
        };

        if (Notification.permission === 'granted') {
          const notification = new Notification(title, options);
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              const notification = new Notification(title, options);
              notification.onclick = () => {
                window.focus();
                notification.close();
              };
            }
          });
        }
      }

      setCallState({
        status: 'INCOMING',
        isInCall: true,
        isIncoming: true,
        peerId: data.callerId,
        peerName: 'Team Member', // Ideally passed from backend or looked up
        roomId: data.roomId,
        callType: data.type,
        isMicMuted: false,
        isCameraOff: data.type !== 'VIDEO',
        isScreenSharing: false // screen sharing is not automatically on for the receiver
      });
    };

    const handleCallAccepted = async (data: { responderId: string; roomId: string }) => {
      console.log(`[WebRTC] [Trace] 'call-accepted' received by remote user for roomId: ${data.roomId}`);
      const currentState = callStateRef.current;
      if (currentState.roomId === data.roomId) {
        // Update local UI to connecting instantly
        setCallState(s => ({ ...s, status: 'CONNECTING' }));

        // Fetch token and join
        const tokenData = await fetchLiveKitToken(data.roomId);
        if (tokenData) {
          let finalUrl = tokenData.url;
          if (finalUrl.includes('localhost') && window.location.hostname !== 'localhost') {
            finalUrl = finalUrl.replace('localhost', window.location.hostname);
          }
          console.log(`[WebRTC] [Trace] Got token after call accepted. Joining LiveKit at ${finalUrl}`);

          setCallState(s => ({
            ...s,
            livekitToken: tokenData.token,
            livekitUrl: finalUrl
          }));
        } else {
          console.warn(`[WebRTC] [Trace] Token retrieval failed on accepted call, ending call`);
          endCall();
        }
      } else {
        console.warn(`[WebRTC] [Trace] Ignoring 'call-accepted' because current roomId (${currentState.roomId}) does not match incoming (${data.roomId})`);
      }
    };

    const handleCallRejected = () => {
      console.log('[WebRTC] [Trace] Call rejected by remote user');
      endCall();
    };

    const handleCallEnded = () => {
      console.log('[WebRTC] [Trace] Remote user ended call');
      endCall();
    };

    // Unbind before binding to prevent duplicate listeners during hot-reloads
    socket.off('call-request', handleCallRequest);
    socket.off('call-accepted', handleCallAccepted);
    socket.off('call-rejected', handleCallRejected);
    socket.off('call-ended', handleCallEnded);

    socket.on('call-request', handleCallRequest);
    socket.on('call-accepted', handleCallAccepted);
    socket.on('call-rejected', handleCallRejected);
    socket.on('call-ended', handleCallEnded);

    return () => {
      socket.off('call-request', handleCallRequest);
      socket.off('call-accepted', handleCallAccepted);
      socket.off('call-rejected', handleCallRejected);
      socket.off('call-ended', handleCallEnded);
    };
  }, [currentUserId, endCall]);

  return {
    callState,
    startCall,
    answerCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleCamera,
    toggleScreenShare
  };
}
