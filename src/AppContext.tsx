import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Batch, Delivery, FluxConfig, Product } from './types';
import { FLUX_DEFAULTS, PRODUCT_CATALOG } from './constants';
import { useAuth } from './AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

interface AppState {
  batches: Batch[];
  deliveries: Delivery[];
  fluxConfig: Record<string, FluxConfig>;
  catalog: Product[];
  loading: boolean;
  refreshData: () => Promise<void>;
  updateBatch: (id: string, data: Partial<Batch>) => Promise<boolean>;
  createBatch: (data: Batch) => Promise<boolean>;
  deleteBatch: (id: string) => Promise<boolean>;
  createDelivery: (data: Omit<Delivery, 'id'>) => Promise<boolean>;
  updateDelivery: (id: string, data: Partial<Delivery>) => Promise<boolean>;
  deleteDelivery: (id: string) => Promise<boolean>;
  updateSettings: (config: Record<string, FluxConfig>) => Promise<void>;
  resetData: (password: string) => Promise<boolean>;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { token, socket, isAuthenticated } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [fluxConfig, setFluxConfig] = useState<Record<string, FluxConfig>>(FLUX_DEFAULTS);
  const [catalog] = useState<Product[]>(PRODUCT_CATALOG);
  const [loading, setLoading] = useState(true);

  const fetchWithAuth = useCallback((endpoint: string, options: RequestInit = {}) => {
    return fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }, [token]);

  const loadData = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [batchesRes, deliveriesRes, configRes] = await Promise.all([
        fetchWithAuth('/api/batches'),
        fetchWithAuth('/api/deliveries'),
        fetchWithAuth('/api/settings/fluxConfig')
      ]);

      if (batchesRes.ok) {
        const data = await batchesRes.json();
        setBatches(data);
      }

      if (deliveriesRes.ok) {
        const data = await deliveriesRes.json();
        setDeliveries(data);
      }

      if (configRes.ok) {
        const data = await configRes.json();
        setFluxConfig(data);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, token, fetchWithAuth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!socket) return;

    const handlers = [
      { event: 'batch:created', handler: loadData },
      { event: 'batch:updated', handler: loadData },
      { event: 'batch:deleted', handler: loadData },
      { event: 'delivery:created', handler: loadData },
      { event: 'delivery:updated', handler: loadData },
      { event: 'delivery:deleted', handler: loadData },
      { event: 'settings:updated', handler: loadData },
      { event: 'data:reset', handler: loadData },
    ];

    handlers.forEach(({ event, handler }) => {
      socket.on(event, handler);
    });

    return () => {
      handlers.forEach(({ event, handler }) => {
        socket.off(event, handler);
      });
    };
  }, [socket, loadData]);

  const refreshData = async () => {
    await loadData();
  };

  const updateBatch = async (id: string, data: Partial<Batch>): Promise<boolean> => {
    try {
      const response = await fetchWithAuth(`/api/batches/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update batch', error);
      return false;
    }
  };

  const createBatch = async (data: Batch): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/batches', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to create batch', error);
      return false;
    }
  };

  const deleteBatch = async (id: string): Promise<boolean> => {
    try {
      const response = await fetchWithAuth(`/api/batches/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete batch', error);
      return false;
    }
  };

  const createDelivery = async (data: Omit<Delivery, 'id'>): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/deliveries', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to create delivery', error);
      return false;
    }
  };

  const updateDelivery = async (id: string, data: Partial<Delivery>): Promise<boolean> => {
    try {
      const response = await fetchWithAuth(`/api/deliveries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update delivery', error);
      return false;
    }
  };

  const deleteDelivery = async (id: string): Promise<boolean> => {
    try {
      const response = await fetchWithAuth(`/api/deliveries/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete delivery', error);
      return false;
    }
  };

  const updateSettings = async (config: Record<string, FluxConfig>) => {
    try {
      const response = await fetchWithAuth('/api/settings/fluxConfig', {
        method: 'PUT',
        body: JSON.stringify(config)
      });

      if (response.ok) {
        setFluxConfig(config);
      }
    } catch (error) {
      console.error('Failed to update settings', error);
    }
  };

  const resetData = async (password: string): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/reset', {
        method: 'POST',
        body: JSON.stringify({ password })
      });

      if (response.ok) {
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to reset data', error);
      return false;
    }
  };

  return (
    <AppContext.Provider value={{
      batches, deliveries, fluxConfig, catalog, loading,
      refreshData, updateBatch, createBatch, deleteBatch,
      createDelivery, updateDelivery, deleteDelivery,
      updateSettings, resetData
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
