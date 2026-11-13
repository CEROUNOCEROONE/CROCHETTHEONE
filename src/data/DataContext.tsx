import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { SchemaMeta, WorkshopSettings } from '@/src/domain/models/index.ts';
import {
  computeWorkshopStats,
  type WorkshopDashboardStats,
} from '@/src/domain/services/workshopStats.ts';
import type {
  BackupEnvelope,
  BackupImportOutcome,
  BackupImportStrategy,
  BackupInspectionResult,
  DemoPurgeOutcome,
  WorkshopDataEngine,
} from '@/src/data/ports/DataStorePort.ts';
import { localWorkshopEngine } from './local/LocalRepository.ts';
import { createDefaultWorkshopSettings } from './local/indexedDbClient.ts';

interface DataContextValue {
  readonly engine: WorkshopDataEngine;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly settings: WorkshopSettings;
  readonly stats: WorkshopDashboardStats;
  readonly schemaMeta: SchemaMeta | null;
  refresh(): Promise<void>;
  updateSettings(
    partial: Partial<
      Pick<
        WorkshopSettings,
        | 'workshopName'
        | 'ownerDisplayName'
        | 'hourlyRateCOP'
        | 'dailyGoalMinutes'
        | 'weeklyGoalMinutes'
        | 'defaultMarkupPercent'
      >
    >,
  ): Promise<WorkshopSettings>;
  loadDemoData(): Promise<{ insertedCount: number }>;
  purgeDemoData(): Promise<DemoPurgeOutcome>;
  exportBackup(includeDemo: boolean): Promise<BackupEnvelope>;
  inspectBackup(rawJson: string): Promise<BackupInspectionResult>;
  importBackup(
    inspection: BackupInspectionResult,
    strategy: BackupImportStrategy,
  ): Promise<BackupImportOutcome>;
}

const DataContext = createContext<DataContextValue | null>(null);

const EMPTY_SETTINGS = createDefaultWorkshopSettings();
const EMPTY_STATS = computeWorkshopStats({
  settings: EMPTY_SETTINGS,
  projects: [],
  components: [],
  materials: [],
  variants: [],
  reservations: [],
  movements: [],
  clients: [],
  paymentPlans: [],
  installments: [],
});

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<WorkshopSettings>(EMPTY_SETTINGS);
  const [stats, setStats] = useState<WorkshopDashboardStats>(EMPTY_STATS);
  const [schemaMeta, setSchemaMeta] = useState<SchemaMeta | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [snapshot, meta] = await Promise.all([
        localWorkshopEngine.loadWorkshopSnapshot(),
        localWorkshopEngine.getSchemaMeta(),
      ]);
      setSettings(snapshot.settings);
      setStats(computeWorkshopStats(snapshot));
      setSchemaMeta(meta);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Error al leer la base de datos local.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSettings = useCallback(
    async (
      partial: Partial<
        Pick<
          WorkshopSettings,
          | 'workshopName'
          | 'ownerDisplayName'
          | 'hourlyRateCOP'
          | 'dailyGoalMinutes'
          | 'weeklyGoalMinutes'
          | 'defaultMarkupPercent'
        >
      >,
    ) => {
      const updated = await localWorkshopEngine.saveWorkshopSettings(partial);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const loadDemoData = useCallback(async () => {
    const res = await localWorkshopEngine.loadDemoData();
    await refresh();
    return res;
  }, [refresh]);

  const purgeDemoData = useCallback(async () => {
    const res = await localWorkshopEngine.purgeDemoData();
    await refresh();
    return res;
  }, [refresh]);

  const exportBackup = useCallback(
    async (includeDemo: boolean) => {
      const envelope = await localWorkshopEngine.exportBackup({ includeDemo });
      await refresh();
      return envelope;
    },
    [refresh],
  );

  const inspectBackup = useCallback(async (rawJson: string) => {
    return localWorkshopEngine.inspectBackup(rawJson);
  }, []);

  const importBackup = useCallback(
    async (inspection: BackupInspectionResult, strategy: BackupImportStrategy) => {
      const outcome = await localWorkshopEngine.importBackup(inspection, strategy);
      await refresh();
      return outcome;
    },
    [refresh],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      engine: localWorkshopEngine,
      isLoading,
      error,
      settings,
      stats,
      schemaMeta,
      refresh,
      updateSettings,
      loadDemoData,
      purgeDemoData,
      exportBackup,
      inspectBackup,
      importBackup,
    }),
    [
      isLoading,
      error,
      settings,
      stats,
      schemaMeta,
      refresh,
      updateSettings,
      loadDemoData,
      purgeDemoData,
      exportBackup,
      inspectBackup,
      importBackup,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export function useWorkshopData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useWorkshopData debe usarse dentro de DataProvider.');
  }
  return ctx;
}
