/**
 * AuthContext - JWT Authentication Management
 * 
 * Provides secure JWT storage using expo-secure-store and
 * authentication state management for the Turtle app.
 */

import React, { createContext, useState, useContext, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useServer } from './ServerContext';

const AuthContext = createContext();

// SecureStore keys
const TOKEN_KEY = 'turtle_auth_token';
const TOKEN_EXPIRY_KEY = 'turtle_auth_expiry';

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState(null);
  
  const { getBaseUrl } = useServer();

  // Load saved token on mount
  useEffect(() => {
    loadSavedToken();
  }, []);

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
        
        if (expiryDate > now) {
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
   * Logout - clear token and auth state
   */
  const logout = async () => {
    await clearToken();
    setLoginError(null);
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
    isAuthenticated,
    isLoading,
    loginError,
    login,
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
