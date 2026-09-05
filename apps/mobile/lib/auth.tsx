import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';
import type { UserInfo } from './types';

const TOKEN_KEY = 'fp_token';
const USER_KEY = 'fp_user';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  token: string | null;
  user: UserInfo | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    fullName: string;
    organizationName: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Updates the profile on the server and refreshes the stored session. */
  updateProfile: (payload: { fullName?: string; signature?: string | null }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);

  // Restore the persisted session on startup.
  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser) as UserInfo);
          setStatus('signedIn');
          return;
        }
      } catch {
        // Corrupt session: fall through to signedOut.
      }
      setStatus('signedOut');
    })();
  }, []);

  const persistSession = useCallback(async (nextToken: string, nextUser: UserInfo) => {
    setToken(nextToken);
    setUser(nextUser);
    setStatus('signedIn');
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, nextToken),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser)),
    ]);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      await persistSession(res.accessToken, res.user);
    },
    [persistSession],
  );

  const signUp = useCallback(
    async (input: {
      email: string;
      password: string;
      fullName: string;
      organizationName: string;
    }) => {
      const res = await api.register(input);
      await persistSession(res.accessToken, res.user);
    },
    [persistSession],
  );

  const signOut = useCallback(async () => {
    setToken(null);
    setUser(null);
    setStatus('signedOut');
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  }, []);

  const updateProfile = useCallback(
    async (payload: { fullName?: string; signature?: string | null }) => {
      if (!token) {
        return;
      }
      const updated = await api.updateProfile(token, payload);
      setUser(updated);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated));
    },
    [token],
  );

  const value = useMemo(
    () => ({ status, token, user, signIn, signUp, signOut, updateProfile }),
    [status, token, user, signIn, signUp, signOut, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/** Reads the human-readable message of an error thrown by the API layer. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Ocurrió un error inesperado';
}
