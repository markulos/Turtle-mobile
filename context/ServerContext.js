import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ServerContext = createContext();

export const ServerProvider = ({ children }) => {
  const [serverIP, setServerIP] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSavedIP();
  }, []);

  const getBaseUrl = () => `http://${serverIP}:3000/api`;

  const apiGet = async (endpoint) => {
    const response = await fetch(`${getBaseUrl()}${endpoint}`);
    if (!response.ok) throw new Error('API Error');
    return response.json();
  };

  const apiPost = async (endpoint, data) => {
    const response = await fetch(`${getBaseUrl()}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('API Error');
    return response.json();
  };

  const apiDelete = async (endpoint) => {
    const response = await fetch(`${getBaseUrl()}${endpoint}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('API Error');
    return response.json();
  };

  const api = {
    get: apiGet,
    post: apiPost,
    delete: apiDelete,
  };

  const loadSavedIP = async () => {
    try {
      const savedIP = await AsyncStorage.getItem('serverIP');
      if (savedIP) {
        setServerIP(savedIP);
        checkConnection(savedIP);
      }
    } catch (error) {
      console.error('Error loading IP:', error);
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
      
      const response = await fetch(`http://${ip}:3000/api/health`, {
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

  return (
    <ServerContext.Provider value={{ 
      serverIP, 
      isConnected, 
      loading, 
      saveIP, 
      checkConnection,
      getBaseUrl,
      api
    }}>
      {children}
    </ServerContext.Provider>
  );
};

export const useServer = () => useContext(ServerContext);