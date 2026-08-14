/**
 * AuthContext - JWT Authentication Management
 * 
 * Provides secure JWT storage using expo-secure-store and
 * authentication state management for the Turtle app.
 */

import React, { createContext, useState, useContext, useEffect, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useServer, setApiAuthToken, serverOrigin } from './ServerContext';
import { clearAllCaches } from '../utils/cacheManager';
import { getAuthIdentity, getAuthTokenGeneration } from '../utils/authIdentity';

const AuthContext = createContext();

// SecureStore keys
const TOKEN_KEY = 'turtle_auth_token';
const TOKEN_EXPIRY_KEY = 'turtle_auth_expiry';

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState(null);
  
  const { getBaseUrl, serverIP } = useServer();
  const authIdentity = useMemo(() => getAuthIdentity(token), [token]);
  const authGeneration = useMemo(() => getAuthTokenGeneration(token), [token]);

  // Pre-flight guard shared by login/requestOtp/verifyOtp: with no server
  // address saved, getBaseUrl() is `http://:3000/api` and every fetch dies
  // with the unhelpful "Network request failed". Catch it before fetching
  // and point the user at the login screen's server editor instead.
  const noServerError = () => {
    const msg = "No server address set — tap 'Set server address' on the login screen.";
    setLoginError(msg);
    return { success: false, error: msg };
  };
  // Friendlier message for an actual failed fetch (wrong IP / different
  // network / server down) — names the address so it's debuggable.
  const unreachableMsg = () =>
    `Couldn't reach the Turtle server${serverIP ? ` at ${serverIP}` : ''} — check the Server address on the login screen and that you're on the same Wi-Fi.`;

  // Load saved token on mount
  useEffect(() => {
    loadSavedToken();
  }, []);

  // Keep the ServerContext api wrapper's Bearer token in sync with auth state,
  // so every api.get/post/put/patch/delete carries Authorization once logged in.
  useEffect(() => {
    setApiAuthToken(token);
  }, [token]);

  /**
   * Load saved token from SecureStore
   */
  const loadSavedToken = async () => {
    try {
      setIsLoading(true);
      const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      const expiry = await SecureStore.getItemAsync(TOKEN_EXPIRY_KEY);
      
      if (savedToken && expiry) {
        // Check if token is expired
        const expiryDate = new Date(expiry);
        const now = new Date();

        // Malformed expiry → don't spuriously log out; let a real 401 handle it
        if (isNaN(expiryDate.getTime()) || expiryDate > now) {
          setToken(savedToken);
          setIsAuthenticated(true);
          console.log('[Auth] Token loaded from secure storage');
        } else {
          // Token expired, clear it
          console.log('[Auth] Stored token expired, clearing');
          await clearToken();
        }
      }
    } catch (error) {
      console.error('[Auth] Error loading token:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Save token to SecureStore
   */
  const saveToken = async (newToken, expiresAt) => {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, newToken);
      await SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, expiresAt);
      setToken(newToken);
      setIsAuthenticated(true);
      console.log('[Auth] Token saved to secure storage');
      return true;
    } catch (error) {
      console.error('[Auth] Error saving token:', error);
      return false;
    }
  };

  /**
   * Clear token from SecureStore
   */
  const clearToken = async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(TOKEN_EXPIRY_KEY);
      setToken(null);
      setIsAuthenticated(false);
      console.log('[Auth] Token cleared from secure storage');
      return true;
    } catch (error) {
      console.error('[Auth] Error clearing token:', error);
      return false;
    }
  };

  /**
   * Login with master password
   * @param {string} password - The master password
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  const login = async (password) => {
    try {
      setLoginError(null);
      setIsLoading(true);
      
      if (!serverIP) {
        setIsLoading(false);
        return noServerError();
      }
      const baseUrl = getBaseUrl();
      const loginUrl = `${baseUrl.replace('/api', '')}/api/auth/login`;
      
      console.log('[Auth] Attempting login...');
      
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        const errorMessage = data.message || 'Login failed';
        console.error('[Auth] Login failed:', errorMessage);
        setLoginError(errorMessage);
        return { success: false, error: errorMessage };
      }
      
      // Save token
      const { token: newToken, expiresAt } = data;
      await saveToken(newToken, expiresAt);
      
      console.log('[Auth] Login successful');
      return { success: true };
      
    } catch (error) {
      console.error('[Auth] Login error:', error.message);
      const errorMessage = 'Network error. Please check your connection.';
      setLoginError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Request an SMS verification code for a phone number (Telnyx OTP).
   * Returns { success, phone?, dev?, devCode?, error? }. `devCode` is only
   * present when the server is in dev mode (no real SMS) — used to prefill the
   * code field for local testing.
   */
  // `serverOverride` lets the login screen send the OTP to a server it JUST
  // confirmed (e.g. the funnel that invited this number) without waiting for the
  // saveIP() state update to propagate through context — avoids a stale closure
  // firing the request at the previous server.
  const requestOtp = async (phone, invite, serverOverride) => {
    try {
      setLoginError(null);
      const effectiveServer = serverOverride || serverIP;
      if (!effectiveServer) return noServerError();
      const origin = serverOrigin(effectiveServer);
      const url = `${origin}/api/auth/otp/request`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `invite` = optional invite code or open-pond name (Discord-style join)
        body: JSON.stringify({ phone, invite: invite || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const msg = data.message || 'Could not send the code';
        setLoginError(msg);
        // `code` = the machine-readable error (e.g. NOT_INVITED) — the login
        // screen branches on it to offer a join request instead of a dead end.
        return { success: false, error: msg, code: data.error };
      }
      return { success: true, phone: data.phone, dev: !!data.dev, devCode: data.devCode };
    } catch (error) {
      console.error('[Auth] requestOtp error:', error.message);
      const msg = unreachableMsg();
      setLoginError(msg);
      return { success: false, error: msg };
    }
  };

  /**
   * Verify an SMS code and, on success, store the issued JWT (which flips
   * isAuthenticated → the app un-gates). Returns { success, error? }.
   */
  const verifyOtp = async (phone, code, invite, serverOverride) => {
    try {
      setLoginError(null);
      const effectiveServer = serverOverride || serverIP;
      if (!effectiveServer) return noServerError();
      setIsLoading(true);
      const origin = serverOrigin(effectiveServer);
      const url = `${origin}/api/auth/otp/verify`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // invite rides along so the server can consume the code's use on join
        body: JSON.stringify({ phone, code, invite: invite || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.token) {
        const msg = data.message || 'Invalid or expired code';
        setLoginError(msg);
        return { success: false, error: msg };
      }
      await saveToken(data.token, data.expiresAt);
      console.log('[Auth] phone OTP login successful');
      return { success: true };
    } catch (error) {
      console.error('[Auth] verifyOtp error:', error.message);
      const msg = unreachableMsg();
      setLoginError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Logout - clear token and auth state
   */
  const logout = async () => {
    await clearToken();
    setLoginError(null);
    // Wipe cached photos/temp files on sign-out — they shouldn't outlive the
    // session (privacy on a shared device + reclaims space). Best-effort.
    clearAllCaches().catch(() => {});
    console.log('[Auth] Logged out');
  };

  /**
   * Get auth headers for API requests
   * @returns {Object} Headers with Authorization
   */
  const getAuthHeaders = () => {
    if (!token) return {};
    return {
      'Authorization': `Bearer ${token}`,
    };
  };

  /**
   * Make authenticated API request
   */
  const authFetch = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      ...getAuthHeaders(),
    };
    
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    // If unauthorized, clear token
    if (response.status === 401) {
      console.warn('[Auth] Received 401, clearing token');
      await logout();
    }
    
    return response;
  };

  const value = {
    token,
    authIdentity,
    authGeneration,
    isAuthenticated,
    isLoading,
    loginError,
    login,
    requestOtp,
    verifyOtp,
    logout,
    getAuthHeaders,
    authFetch,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
