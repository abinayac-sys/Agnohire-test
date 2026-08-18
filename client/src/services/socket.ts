import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api.js';

let socket: Socket | null = null;

/** Lazily create the shared Socket.IO connection, authenticated with the JWT. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      autoConnect: false,
      withCredentials: true,
      auth: (cb) => cb({ token: getAccessToken() ?? undefined }),
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket(): void {
  socket?.disconnect();
}
