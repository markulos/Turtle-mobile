import React, { createContext, useState, useContext, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ServerContext = createContext();

// TEMP single-server phase: the project is one self-hosted pond reachable over
// Tailscale. Default every fresh install straight to it so an invitee never
// types an IP — they just sign in. Overridable via the login screen's Advanced
// field, and replaced by real multi-server discovery once other P2P ponds exist.
const DEFAULT_SERVER_HOST = '100.105.43.69';

// Normalize whatever the user saved into a server ORIGIN. Accepted forms:
//   '100.105.43.69'             → http://100.105.43.69:3000   (bare host — classic)
//   '192.168.2.93:3000'         → http://192.168.2.93:3000    (host:port)
//   'https://pc.tail123.ts.net' → https://pc.tail123.ts.net   (tunnel-style URL —
//                                  its scheme + port ARE the address; nothing appended)
// Every base-URL builder (the api wrapper, the health check, the three
// socket.io hooks, the login screen's invite preview) goes through this.
// The old code glued `http://` + ip + `:3000` in seven separate places,
// which made URL-shaped servers (Tailscale Funnel / ngrok-style tunnels)
// impossible to enter at all.
export const serverOrigin = (raw) => {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return s.includes(':') ? `http://${s}` : `http://${s}:3000`;
};

// Module-level JWT holder. The api wrapper attaches this as a Bearer token on
// every request. AuthContext sits BELOW ServerProvider in the tree (it calls
// useServer()), so ServerContext can't read it directly — instead AuthContext
// calls setApiAuthToken() whenever the token changes. Sending the header is
// harmless while the server's auth gate runs in warn-mode; it's REQUIRED once
// the server flips to AUTH_ENFORCE=1.
let _apiAuthToken = null;
export const setApiAuthToken = (t) => { _apiAuthToken = t || null; };
const authHeader = () => (_apiAuthToken ? { Authorization: `Bearer ${_apiAuthToken}` } : {});

// ── Global fetch auth interceptor ────────────────────────────────────────
// Many call sites fetch the server DIRECTLY instead of through `api.*` — the
// password-vault hooks, the gallery's self-heal probes (duration / tag sync),
// web's media-data hook. Those bypass authHeader() and would 401 the moment
// the server flips to AUTH_ENFORCE=1. Rather than thread the token through
// every one, patch fetch ONCE: any request whose URL targets OUR server
// origin gets the Bearer token attached (unless it already carries one).
//
// Safety properties that make this non-invasive:
//   • Scoped strictly to our own origin — the token can never leak to a
//     third-party URL the app might fetch.
//   • expo-image / <Image> loads are NATIVE, not JS fetch, so this never
//     touches them: capability-URL media stays exactly as it is.
//   • No-ops until a token exists (pre-login health checks are public).
//   • Skips when Authorization is already set, so api.* calls aren't doubled.
let _serverApiOrigin = '';
let _fetchPatched = false;
const installFetchAuthInterceptor = () => {
  if (_fetchPatched || typeof global === 'undefined' || !global.fetch) return;
  _fetchPatched = true;
  const orig = global.fetch;
  global.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (_apiAuthToken && _serverApiOrigin && url.indexOf(_serverApiOrigin) === 0) {
        const headers = new Headers(
          (init && init.headers) ||
          (typeof input !== 'string' && input && input.headers) ||
          undefined,
        );
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${_apiAuthToken}`);
          init = { ...(init || {}), headers };
        }
      }
    } catch (e) { /* never let the interceptor break a request */ }
    return orig(input, init);
  };
};
installFetchAuthInterceptor();

export const ServerProvider = ({ children }) => {
  const [serverIP, setServerIP] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSavedIP();
  }, []);

  // Keep the interceptor's origin matcher current as the saved server changes.
  useEffect(() => {
    _serverApiOrigin = serverIP ? serverOrigin(serverIP) : '';
  }, [serverIP]);

  const getBaseUrl = () => `${serverOrigin(serverIP)}/api`;

  const apiGet = async (endpoint) => {
    const response = await fetch(`${getBaseUrl()}${endpoint}`, { headers: { ...authHeader() } });
    if (!response.ok) throw new Error('API Error');
    return response.json();
  };

  const apiPost = async (endpoint, data, customHeaders = {}) => {
    const url = `${getBaseUrl()}${endpoint}`;
    if (__DEV__) console.log(`[API POST] ${url}`, data);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
        ...customHeaders
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[API ERROR] ${response.status}: ${errorText}`);
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    return response.json();
  };

  const apiDelete = async (endpoint) => {
    const response = await fetch(`${getBaseUrl()}${endpoint}`, {
      method: 'DELETE',
      headers: { ...authHeader() },
    });
    if (!response.ok) throw new Error('API Error');
    return response.json();
  };

  const apiPut = async (endpoint, data) => {
    const url = `${getBaseUrl()}${endpoint}`;
    if (__DEV__) console.log(`[API PUT] ${url}`, data);
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[API ERROR] ${response.status}: ${errorText}`);
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    return response.json();
  };

  // PATCH — used by /turtle/notes/:id and /api/settings to update
  // partial state without replacing the whole record. Same shape as
  // apiPut; broken out as a sibling so call sites read intuitively.
  const apiPatch = async (endpoint, data) => {
    const url = `${getBaseUrl()}${endpoint}`;
    if (__DEV__) console.log(`[API PATCH] ${url}`, data);
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[API ERROR] ${response.status}: ${errorText}`);
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    return response.json();
  };

  const api = {
    get: apiGet,
    post: apiPost,
    put: apiPut,
    patch: apiPatch,
    delete: apiDelete,
  };

  const loadSavedIP = async () => {
    try {
      const savedIP = await AsyncStorage.getItem('serverIP');
      // Fall back to the one Tailscale pond when nothing's saved — auto-route.
      const ip = savedIP || DEFAULT_SERVER_HOST;
      setServerIP(ip);
      checkConnection(ip);
    } catch (error) {
      console.error('Error loading IP:', error);
      setServerIP(DEFAULT_SERVER_HOST);
      checkConnection(DEFAULT_SERVER_HOST);
    }
  };

  const saveIP = async (ip) => {
    try {
      await AsyncStorage.setItem('serverIP', ip);
      setServerIP(ip);
      return checkConnection(ip);
    } catch (error) {
      console.error('Error saving IP:', error);
      return false;
    }
  };

  const checkConnection = async (ip) => {
    setLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${serverOrigin(ip)}/api/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const connected = response.ok;
      setIsConnected(connected);
      return connected;
    } catch (error) {
      setIsConnected(false);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Memoize so consumers don't re-render on every provider render. The helper
  // functions (saveIP/checkConnection/getBaseUrl/api) only close over serverIP
  // plus stable setState setters, so serverIP/isConnected/loading are the only
  // deps that change what this value represents.
  const value = useMemo(
    () => ({ serverIP, isConnected, loading, saveIP, checkConnection, getBaseUrl, api }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverIP, isConnected, loading],
  );

  return (
    <ServerContext.Provider value={value}>
      {children}
    </ServerContext.Provider>
  );
};

export const useServer = () => useContext(ServerContext);