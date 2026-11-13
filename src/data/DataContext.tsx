import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  Client,
  Project,
  ProjectComponent,
  SchemaMeta,
  WorkshopSettings,
} from '@/src/domain/models/index.ts';
import type {
  CreateComponentInput,
  CreateProjectInput,
  UpdateComponentInput,
  UpdateProjectInput,
} from '@/src/domain/services/projectService.ts';
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
  readonly projects: Project[];
  readonly components: ProjectComponent[];
  readonly clients: Client[];
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
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(projectId: string, updates: UpdateProjectInput): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  createComponent(input: CreateComponentInput): Promise<ProjectComponent>;
  updateComponent(
    componentId: string,
    updates: UpdateComponentInput,
  ): Promise<ProjectComponent>;
  reorderComponent(
    componentId: string,
    direction: 'up' | 'down',
  ): Promise<void>;
  deleteComponent(componentId: string): Promise<void>;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [components, setComponents] = useState<ProjectComponent[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
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
      setProjects(snapshot.projects);
      setComponents(snapshot.components);
      setClients(snapshot.clients);
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

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      const created = await localWorkshopEngine.createProject(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateProject = useCallback(
    async (projectId: string, updates: UpdateProjectInput) => {
      const updated = await localWorkshopEngine.updateProject(projectId, updates);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      await localWorkshopEngine.deleteProjectCascade(projectId);
      await refresh();
    },
    [refresh],
  );

  const createComponent = useCallback(
    async (input: CreateComponentInput) => {
      const created = await localWorkshopEngine.createComponent(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateComponent = useCallback(
    async (componentId: string, updates: UpdateComponentInput) => {
      const updated = await localWorkshopEngine.updateComponent(
        componentId,
        updates,
      );
      await refresh();
      return updated;
    },
    [refresh],
  );

  const reorderComponent = useCallback(
    async (componentId: string, direction: 'up' | 'down') => {
      await localWorkshopEngine.reorderComponent(componentId, direction);
      await refresh();
    },
    [refresh],
  );

  const deleteComponent = useCallback(
    async (componentId: string) => {
      await localWorkshopEngine.deleteComponent(componentId);
      await refresh();
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
      projects,
      components,
      clients,
      stats,
      schemaMeta,
      refresh,
      updateSettings,
      createProject,
      updateProject,
      deleteProject,
      createComponent,
      updateComponent,
      reorderComponent,
      deleteComponent,
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
      projects,
      components,
      clients,
      stats,
      schemaMeta,
      refresh,
      updateSettings,
      createProject,
      updateProject,
      deleteProject,
      createComponent,
      updateComponent,
      reorderComponent,
      deleteComponent,
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
