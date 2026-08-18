import { create } from 'zustand';
import toast from 'react-hot-toast';
import type { AuthUser, PermissionKey, RoleKey } from '@agnohire/shared';
import { ROLES } from '@agnohire/shared';
import * as authService from '../services/auth.service.js';
import { setAccessToken, onRefreshFailure } from '../services/api.js';
import { disconnectSocket } from '../services/socket.js';

interface AuthState {
  user: AuthUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  setUser: (user: AuthUser | null) => void;
  /** Restore a session on app load via the refresh cookie. */
  bootstrap: () => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<AuthUser>;
  /** Clears `mustChangePassword` on success — see ForceChangePasswordModal. */
  changePassword: (input: { currentPassword: string; newPassword: string; confirmPassword: string }) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (...keys: PermissionKey[]) => boolean;
  hasRole: (...roles: RoleKey[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'idle',

  setUser: (user) =>
    set({ user, status: user ? 'authenticated' : 'unauthenticated' }),

  bootstrap: async () => {
    set({ status: 'loading' });
    const user = await authService.refreshSession();
    set({ user, status: user ? 'authenticated' : 'unauthenticated' });
  },

  loginWithPassword: async (email, password) => {
    const user = await authService.devLogin(email, password);
    set({ user, status: 'authenticated' });
    return user;
  },

  changePassword: async (input) => {
    const user = await authService.changePassword(input);
    set({ user });
  },

  logout: async () => {
    await authService.logout();
    setAccessToken(null);
    // Tear down the realtime channel so a logged-out tab stops receiving
    // server-pushed notifications/pipeline/theme events on its old session.
    disconnectSocket();
    
    // Reset global theme keys to Arctic, light mode, Poppins font and 15px font size on logout
    try {
      localStorage.setItem('agnohire.themePalette', 'Arctic');
      localStorage.setItem('agnohire.themeMode', 'light');
      localStorage.setItem('agnohire.themeFont', 'Poppins');
      localStorage.setItem('agnohire.themeFontSize', '15px');
    } catch {
      // ignore
    }
    
    const { useThemeStore } = await import('./themeStore.js');
    useThemeStore.getState().setColorMode('light');
    useThemeStore.getState().setFont('Poppins');
    useThemeStore.getState().setFontSize('15px');
    const available = useThemeStore.getState().available;
    const arcticPreset = available.find((t) => t.name === 'Arctic');
    if (arcticPreset) {
      useThemeStore.getState().applyTheme(arcticPreset.tokens, 'Arctic');
    }

    set({ user: null, status: 'unauthenticated' });
  },

  hasPermission: (...keys) => {
    const { user } = get();
    if (!user) return false;
    if (user.role === ROLES.SUPERADMIN) return true;
    return keys.every((k) => user.permissions.includes(k));
  },

  hasRole: (...roles) => {
    const { user } = get();
    if (!user) return false;
    if (user.role === ROLES.SUPERADMIN) return true;
    return roles.includes(user.role);
  },
}));

// A background token refresh (triggered by a 401 on some unrelated request)
// came back invalid/expired — drop the session so ProtectedRoute redirects
// to /login on its next render, instead of the app quietly re-401ing on
// every subsequent request until the user manually reloads.
onRefreshFailure(() => {
  if (useAuthStore.getState().status !== 'authenticated') return;
  disconnectSocket();
  useAuthStore.setState({ user: null, status: 'unauthenticated' });
  toast.error('Your session has expired. Please sign in again.');
});
