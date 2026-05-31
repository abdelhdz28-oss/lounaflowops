import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';

type UserRole = 'admin' | 'editor' | 'viewer';

interface User {
  id: string;
  username: string;
  role: UserRole;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  loading: boolean;
  socket: Socket | null;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  canEdit: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('lounaflow_token');
  });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);

  const connectSocket = useCallback((jwtToken: string) => {
    const newSocket = io(API_URL, {
      auth: { token: jwtToken },
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('✅ Socket connecté');
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Socket déconnecté');
    });

    newSocket.on('connect_error', (error) => {
      console.error('❌ Erreur socket:', error.message);
    });

    setSocket(newSocket);
    return newSocket;
  }, []);

  const verifyToken = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        connectSocket(token);
      } else {
        localStorage.removeItem('lounaflow_token');
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error('Token verification failed:', error);
    } finally {
      setLoading(false);
    }
  }, [token, connectSocket]);

  useEffect(() => {
    verifyToken();
  }, [verifyToken]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        const data = await response.json();
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('lounaflow_token', data.token);
        connectSocket(data.token);
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error || 'Échec de la connexion' };
      }
    } catch (error) {
      return { success: false, error: 'Erreur réseau' };
    }
  };

  const logout = () => {
    localStorage.removeItem('lounaflow_token');
    setToken(null);
    setUser(null);
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
  };

  const canEdit = user?.role === 'editor' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      isAuthenticated: !!user,
      user,
      token,
      loading,
      socket,
      login,
      logout,
      canEdit,
      isAdmin
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
