import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Batch, Delivery, FluxConfig, Product, SampleConfig, ProductCatalogEntry } from './types';
import { FLUX_DEFAULTS, PRODUCT_CATALOG, DEFAULT_SAMPLE_CONFIG, DEFAULT_SAMPLE_PARTNERS, DEFAULT_PRODUCT_CATALOG } from './constants';
import { useAuth } from './AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

interface AppState {
  batches: Batch[];
  deliveries: Delivery[];
  fluxConfig: Record<string, FluxConfig>;
  sampleConfig: SampleConfig;
  catalog: Product[];
  productCatalog: ProductCatalogEntry[];
  clients: string[];
  samplePartners: string[];
  statuses: string[];
  loading: boolean;
  refreshData: () => Promise<void>;
  updateBatch: (id: string, data: Partial<Batch>) => Promise<boolean>;
  createBatch: (data: Batch) => Promise<boolean>;
  deleteBatch: (id: string) => Promise<boolean>;
  createDelivery: (data: Omit<Delivery, 'id'>) => Promise<boolean>;
  updateDelivery: (id: string, data: Partial<Delivery>) => Promise<boolean>;
  deleteDelivery: (id: string) => Promise<boolean>;
  updateSettings: (config: Record<string, FluxConfig>) => Promise<boolean>;
  updateSampleConfig: (config: SampleConfig) => Promise<boolean>;
  updateClients: (clients: string[]) => Promise<boolean>;
  updateSamplePartners: (partners: string[]) => Promise<boolean>;
  updateProductCatalog: (catalog: ProductCatalogEntry[]) => Promise<boolean>;
  updateStatuses: (statuses: string[]) => Promise<boolean>;
  resetData: (password: string) => Promise<boolean>;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { token, socket, isAuthenticated } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [fluxConfig, setFluxConfig] = useState<Record<string, FluxConfig>>(FLUX_DEFAULTS);
  const [sampleConfig, setSampleConfig] = useState<SampleConfig>(DEFAULT_SAMPLE_CONFIG);
  const [catalog] = useState<Product[]>(PRODUCT_CATALOG);
  const [productCatalog, setProductCatalog] = useState<ProductCatalogEntry[]>(DEFAULT_PRODUCT_CATALOG);
  const [clients, setClients] = useState<string[]>([]);
  const [samplePartners, setSamplePartners] = useState<string[]>(DEFAULT_SAMPLE_PARTNERS);
  const [statuses, setStatuses] = useState<string[]>([]);
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

      const [batchesRes, deliveriesRes, configRes, clientsRes, statusesRes, sampleConfigRes, samplePartnersRes, productCatalogRes] = await Promise.all([
        fetchWithAuth('/api/batches'),
        fetchWithAuth('/api/deliveries'),
        fetchWithAuth('/api/settings/fluxConfig'),
        fetchWithAuth('/api/settings/clients'),
        fetchWithAuth('/api/settings/statuses'),
        fetchWithAuth('/api/settings/sampleConfig'),
        fetchWithAuth('/api/settings/samplePartners'),
        fetchWithAuth('/api/settings/productCatalog')
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

      if (clientsRes.ok) {
        const data = await clientsRes.json();
        setClients(data);
      }

      if (statusesRes.ok) {
        const data = await statusesRes.json();
        setStatuses(data);
      }

      if (sampleConfigRes.ok) {
        const data = await sampleConfigRes.json();
        setSampleConfig(data);
      }

      if (samplePartnersRes.ok) {
        const data = await samplePartnersRes.json();
        setSamplePartners(data);
      }

      if (productCatalogRes.ok) {
        const data = await productCatalogRes.json();
        setProductCatalog(data);
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

  const updateSettings = async (config: Record<string, FluxConfig>): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/settings/fluxConfig', {
        method: 'PUT',
        body: JSON.stringify(config)
      });

      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update settings', error);
      return false;
    }
  };

  const updateSampleConfig = async (config: SampleConfig): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/settings/sampleConfig', {
        method: 'PUT',
        body: JSON.stringify(config)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update sampleConfig', error);
      return false;
    }
  };

  const updateClients = async (newClients: string[]): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/settings/clients', {
        method: 'PUT',
        body: JSON.stringify(newClients)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update clients', error);
      return false;
    }
  };

  const updateSamplePartners = async (partners: string[]): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/settings/samplePartners', {
        method: 'PUT',
        body: JSON.stringify(partners)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update samplePartners', error);
      return false;
    }
  };

  const updateProductCatalog = async (newCatalog: ProductCatalogEntry[]): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/settings/productCatalog', {
        method: 'PUT',
        body: JSON.stringify(newCatalog)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update productCatalog', error);
      return false;
    }
  };

  const updateStatuses = async (newStatuses: string[]): Promise<boolean> => {
    try {
      const response = await fetchWithAuth('/api/settings/statuses', {
        method: 'PUT',
        body: JSON.stringify(newStatuses)
      });
      if (response.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update statuses', error);
      return false;
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
      batches, deliveries, fluxConfig, sampleConfig, catalog, productCatalog, clients, samplePartners, statuses, loading,
      refreshData, updateBatch, createBatch, deleteBatch,
      createDelivery, updateDelivery, deleteDelivery,
      updateSettings, updateSampleConfig, updateClients, updateSamplePartners, updateProductCatalog, updateStatuses, resetData
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
