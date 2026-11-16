import { useState } from 'react';
import { DataProvider, useWorkshopData } from '@/src/data/DataContext.tsx';
import { DashboardView } from '@/src/modules/dashboard/DashboardView.tsx';
import { InventoryView } from '@/src/modules/inventory/InventoryView.tsx';
import { PlannerView } from '@/src/modules/planner/PlannerView.tsx';
import { ProjectsView } from '@/src/modules/projects/ProjectsView.tsx';
import { QuotingView } from '@/src/modules/quoting/QuotingView.tsx';
import { ShoppingAndNotesView } from '@/src/modules/shopping/ShoppingAndNotesView.tsx';
import { FloatingTimerDock } from '@/src/modules/timer/FloatingTimerDock.tsx';
import { TimerView } from '@/src/modules/timer/TimerView.tsx';
import { WorkshopSettingsView } from '@/src/modules/settings/WorkshopSettingsView.tsx';
import { AppShell } from '@/src/shared/components/AppShell.tsx';
import { HeaderStatusBar } from '@/src/shared/components/HeaderStatusBar.tsx';
import { PlannedModuleView } from '@/src/shared/components/PlannedModuleView.tsx';
import {
  getRouteDefinition,
  type ModuleRouteId,
} from '@/src/shared/navigation/routes.ts';

function AppWorkspace() {
  const [activeRoute, setActiveRoute] = useState<ModuleRouteId>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [quotingProjectTargetId, setQuotingProjectTargetId] = useState<string | null>(
    null,
  );
  const [timerTarget, setTimerTarget] = useState<{
    projectId: string;
    componentId: string;
  } | null>(null);
  const { settings, activeTimerSession } = useWorkshopData();

  const handleOpenProjectFromDashboard = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveRoute('projects');
  };

  const handleStartTimerForComponent = (
    projectId: string,
    componentId: string,
  ) => {
    setTimerTarget({ projectId, componentId });
    setActiveRoute('timer');
  };

  const handleQuoteProject = (projectId: string) => {
    setQuotingProjectTargetId(projectId);
    setActiveRoute('quoting');
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
          onStartTimerForComponent={handleStartTimerForComponent}
          onNavigateToInventory={() => setActiveRoute('inventory')}
          onQuoteProject={handleQuoteProject}
        />
      );
    }
    if (activeRoute === 'timer') {
      return (
        <TimerView
          initialProjectId={timerTarget?.projectId ?? null}
          initialComponentId={timerTarget?.componentId ?? null}
          onClearInitialTarget={() => setTimerTarget(null)}
          onNavigateToProjects={() => setActiveRoute('projects')}
        />
      );
    }
    if (activeRoute === 'inventory') {
      return <InventoryView />;
    }
    if (activeRoute === 'shopping') {
      return (
        <ShoppingAndNotesView
          onNavigateToInventory={() => setActiveRoute('inventory')}
          onOpenProject={handleOpenProjectFromDashboard}
        />
      );
    }
    if (activeRoute === 'quoting') {
      return (
        <QuotingView
          initialProjectId={quotingProjectTargetId}
          onClearInitialProject={() => setQuotingProjectTargetId(null)}
          onNavigateToSettings={() => setActiveRoute('settings')}
          onOpenProject={handleOpenProjectFromDashboard}
        />
      );
    }
    if (activeRoute === 'planner') {
      return (
        <PlannerView
          onOpenProject={handleOpenProjectFromDashboard}
          onStartTimerForComponent={handleStartTimerForComponent}
          onNavigateToShopping={() => setActiveRoute('shopping')}
          onNavigateToInventory={() => setActiveRoute('inventory')}
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
      headerActionsSlot={
        <HeaderStatusBar
          onNavigate={setActiveRoute}
          onOpenProject={handleOpenProjectFromDashboard}
        />
      }
      timerDockSlot={
        activeTimerSession ? (
          <FloatingTimerDock onOpenTimerView={() => setActiveRoute('timer')} />
        ) : undefined
      }
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
