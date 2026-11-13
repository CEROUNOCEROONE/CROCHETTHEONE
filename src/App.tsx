import { useState } from 'react';
import { DataProvider, useWorkshopData } from '@/src/data/DataContext.tsx';
import { DashboardView } from '@/src/modules/dashboard/DashboardView.tsx';
import { ProjectsView } from '@/src/modules/projects/ProjectsView.tsx';
import { WorkshopSettingsView } from '@/src/modules/settings/WorkshopSettingsView.tsx';
import { AppShell } from '@/src/shared/components/AppShell.tsx';
import { PlannedModuleView } from '@/src/shared/components/PlannedModuleView.tsx';
import {
  getRouteDefinition,
  type ModuleRouteId,
} from '@/src/shared/navigation/routes.ts';

function AppWorkspace() {
  const [activeRoute, setActiveRoute] = useState<ModuleRouteId>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { settings } = useWorkshopData();

  const handleOpenProjectFromDashboard = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveRoute('projects');
  };

  const renderContent = () => {
    if (activeRoute === 'dashboard') {
      return (
        <DashboardView
          onNavigate={setActiveRoute}
          onOpenProject={handleOpenProjectFromDashboard}
        />
      );
    }
    if (activeRoute === 'projects') {
      return (
        <ProjectsView
          initialSelectedProjectId={selectedProjectId}
          onClearInitialSelection={() => setSelectedProjectId(null)}
        />
      );
    }
    if (activeRoute === 'settings') {
      return <WorkshopSettingsView />;
    }
    const planned = getRouteDefinition(activeRoute);
    return <PlannedModuleView route={planned} onNavigate={setActiveRoute} />;
  };

  return (
    <AppShell
      activeRoute={activeRoute}
      workshopName={settings.workshopName}
      onSelectRoute={setActiveRoute}
    >
      {renderContent()}
    </AppShell>
  );
}

export default function App() {
  return (
    <DataProvider>
      <AppWorkspace />
    </DataProvider>
  );
}
