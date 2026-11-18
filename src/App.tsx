import { Suspense, lazy, useEffect, useState } from 'react';
import { BRAND_CONFIG } from '@/src/config/brand.ts';
import { DataProvider, useWorkshopData } from '@/src/data/DataContext.tsx';
import { DashboardView } from '@/src/modules/dashboard/DashboardView.tsx';
import { FloatingTimerDock } from '@/src/modules/timer/FloatingTimerDock.tsx';
import { AppShell } from '@/src/shared/components/AppShell.tsx';
import { HeaderStatusBar } from '@/src/shared/components/HeaderStatusBar.tsx';
import {
  getRouteDefinition,
  type ModuleRouteId,
} from '@/src/shared/navigation/routes.ts';

const ProjectsView = lazy(() =>
  import('@/src/modules/projects/ProjectsView.tsx').then((m) => ({
    default: m.ProjectsView,
  })),
);
const TimerView = lazy(() =>
  import('@/src/modules/timer/TimerView.tsx').then((m) => ({
    default: m.TimerView,
  })),
);
const InventoryView = lazy(() =>
  import('@/src/modules/inventory/InventoryView.tsx').then((m) => ({
    default: m.InventoryView,
  })),
);
const ShoppingAndNotesView = lazy(() =>
  import('@/src/modules/shopping/ShoppingAndNotesView.tsx').then((m) => ({
    default: m.ShoppingAndNotesView,
  })),
);
const QuotingView = lazy(() =>
  import('@/src/modules/quoting/QuotingView.tsx').then((m) => ({
    default: m.QuotingView,
  })),
);
const ClientsAndPaymentsView = lazy(() =>
  import('@/src/modules/clients/ClientsAndPaymentsView.tsx').then((m) => ({
    default: m.ClientsAndPaymentsView,
  })),
);
const PlannerView = lazy(() =>
  import('@/src/modules/planner/PlannerView.tsx').then((m) => ({
    default: m.PlannerView,
  })),
);
const WorkshopSettingsView = lazy(() =>
  import('@/src/modules/settings/WorkshopSettingsView.tsx').then((m) => ({
    default: m.WorkshopSettingsView,
  })),
);
const PlannedModuleView = lazy(() =>
  import('@/src/shared/components/PlannedModuleView.tsx').then((m) => ({
    default: m.PlannedModuleView,
  })),
);

function ModuleLoadingFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando módulo"
      className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6"
    >
      <div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
      <div className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />
      <span className="sr-only">Cargando módulo...</span>
    </div>
  );
}

function upsertHeadMeta(
  selector: string,
  createElement: () => HTMLElement,
  update: (el: HTMLElement) => void,
) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = createElement();
    document.head.appendChild(el);
  }
  update(el);
}

function AppWorkspace() {
  const [activeRoute, setActiveRoute] = useState<ModuleRouteId>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [quotingProjectTargetId, setQuotingProjectTargetId] = useState<string | null>(
    null,
  );
  const [clientsTarget, setClientsTarget] = useState<{
    projectId?: string;
    clientId?: string;
  } | null>(null);
  const [timerTarget, setTimerTarget] = useState<{
    projectId: string;
    componentId: string;
  } | null>(null);
  const { settings, activeTimerSession } = useWorkshopData();

  useEffect(() => {
    const route = getRouteDefinition(activeRoute);
    document.title =
      activeRoute === 'dashboard'
        ? `${BRAND_CONFIG.appName} – Gestión de Taller, Costos y Proyectos`
        : `${route.label} | ${BRAND_CONFIG.appName}`;

    const canonicalUrl = window.location.origin + window.location.pathname;
    upsertHeadMeta(
      'link[rel="canonical"]',
      () => {
        const link = document.createElement('link');
        link.rel = 'canonical';
        return link;
      },
      (el) => {
        (el as HTMLLinkElement).href = canonicalUrl;
      },
    );
    upsertHeadMeta(
      'meta[property="og:url"]',
      () => {
        const meta = document.createElement('meta');
        meta.setAttribute('property', 'og:url');
        return meta;
      },
      (el) => {
        el.setAttribute('content', canonicalUrl);
      },
    );
  }, [activeRoute]);

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

  const handleOpenProjectPayments = (projectId: string) => {
    setClientsTarget({ projectId });
    setActiveRoute('clients');
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
          onOpenProjectPayments={handleOpenProjectPayments}
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
          onOpenProjectPayments={handleOpenProjectPayments}
        />
      );
    }
    if (activeRoute === 'clients') {
      return (
        <ClientsAndPaymentsView
          initialProjectId={clientsTarget?.projectId ?? null}
          initialClientId={clientsTarget?.clientId ?? null}
          onClearInitialTarget={() => setClientsTarget(null)}
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
          onNavigateToClients={() => setActiveRoute('clients')}
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
      <Suspense fallback={<ModuleLoadingFallback />}>{renderContent()}</Suspense>
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
