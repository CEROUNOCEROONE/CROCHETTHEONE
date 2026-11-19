import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BRAND_CONFIG } from '@/src/config/brand.ts';
import { DataProvider, useWorkshopData } from '@/src/data/DataContext.tsx';
import { DashboardView } from '@/src/modules/dashboard/DashboardView.tsx';
import { NotificationOrchestrator } from '@/src/modules/notifications/NotificationOrchestrator.tsx';
import type { SettingsStepId } from '@/src/modules/settings/WorkshopSettingsView.tsx';
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

const VALID_ROUTE_SET = new Set<ModuleRouteId>([
  'dashboard',
  'projects',
  'timer',
  'inventory',
  'shopping',
  'quoting',
  'clients',
  'planner',
  'settings',
]);

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
  const [timerFinishConfirmSessionId, setTimerFinishConfirmSessionId] = useState<
    string | null
  >(null);
  const [settingsSection, setSettingsSection] = useState<SettingsStepId | null>(
    null,
  );
  const { settings, activeTimerSession } = useWorkshopData();

  // Resolver deep-links al abrir desde notificaciones Android/PWA
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search) return;
    const params = new URLSearchParams(window.location.search);
    const routeParam = params.get('route');
    const projectId = params.get('projectId');
    const componentId = params.get('componentId');
    const action = params.get('action');
    const sessionId = params.get('sessionId');
    const section = params.get('section');

    if (routeParam && VALID_ROUTE_SET.has(routeParam as ModuleRouteId)) {
      const targetRoute = routeParam as ModuleRouteId;
      setActiveRoute(targetRoute);
      if (targetRoute === 'projects' && projectId) {
        setSelectedProjectId(projectId);
      }
      if (targetRoute === 'timer') {
        if (projectId && componentId) {
          setTimerTarget({ projectId, componentId });
        }
        if (action === 'confirm-finish' && sessionId) {
          setTimerFinishConfirmSessionId(sessionId);
        }
      }
      if (targetRoute === 'settings' && section === 'notifications') {
        setSettingsSection('notifications');
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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

  const handleOpenProjectFromDashboard = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveRoute('projects');
  }, []);

  const handleStartTimerForComponent = useCallback(
    (projectId: string, componentId: string) => {
      setTimerTarget({ projectId, componentId });
      setActiveRoute('timer');
    },
    [],
  );

  const handleQuoteProject = useCallback((projectId: string) => {
    setQuotingProjectTargetId(projectId);
    setActiveRoute('quoting');
  }, []);

  const handleOpenProjectPayments = useCallback((projectId: string) => {
    setClientsTarget({ projectId });
    setActiveRoute('clients');
  }, []);

  const handleNotificationNavigation = useCallback(
    (params: {
      route: ModuleRouteId;
      projectId?: string | null;
      componentId?: string | null;
      confirmFinishSessionId?: string | null;
    }) => {
      setActiveRoute(params.route);
      if (params.route === 'projects' && params.projectId) {
        setSelectedProjectId(params.projectId);
      }
      if (params.route === 'timer') {
        if (params.projectId && params.componentId) {
          setTimerTarget({
            projectId: params.projectId,
            componentId: params.componentId,
          });
        }
        if (params.confirmFinishSessionId) {
          setTimerFinishConfirmSessionId(params.confirmFinishSessionId);
        }
      }
    },
    [],
  );

  const handleOpenTimerFromDock = useCallback(
    (target?: { projectId?: string; componentId?: string }) => {
      if (target?.projectId && target?.componentId) {
        setTimerTarget({
          projectId: target.projectId,
          componentId: target.componentId,
        });
      }
      setActiveRoute('timer');
    },
    [],
  );

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
          initialFinishConfirmSessionId={timerFinishConfirmSessionId}
          onClearInitialTarget={() => setTimerTarget(null)}
          onClearFinishConfirm={() => setTimerFinishConfirmSessionId(null)}
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
      return (
        <WorkshopSettingsView
          initialSection={settingsSection}
          onClearInitialSection={() => setSettingsSection(null)}
        />
      );
    }
    const planned = getRouteDefinition(activeRoute);
    return <PlannedModuleView route={planned} onNavigate={setActiveRoute} />;
  };

  return (
    <>
      <NotificationOrchestrator onNavigateRoute={handleNotificationNavigation} />
      <AppShell
        activeRoute={activeRoute}
        workshopName={settings.workshopName}
        onSelectRoute={setActiveRoute}
        headerActionsSlot={
          <HeaderStatusBar
            onNavigate={setActiveRoute}
            onOpenProject={handleOpenProjectFromDashboard}
            onOpenTimer={() => setActiveRoute('timer')}
            onOpenNotificationSettings={() => {
              setSettingsSection('notifications');
              setActiveRoute('settings');
            }}
          />
        }
        timerDockSlot={
          activeTimerSession && activeRoute !== 'timer' ? (
            <FloatingTimerDock
              onOpenTimerView={handleOpenTimerFromDock}
              onOpenProject={handleOpenProjectFromDashboard}
            />
          ) : undefined
        }
      >
        <Suspense fallback={<ModuleLoadingFallback />}>{renderContent()}</Suspense>
      </AppShell>
    </>
  );
}

export default function App() {
  return (
    <DataProvider>
      <AppWorkspace />
    </DataProvider>
  );
}
