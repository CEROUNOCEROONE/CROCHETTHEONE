import React, { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { BRAND_CONFIG } from '@/src/config/brand.ts';
import { OfflineIndicator } from '@/src/pwa/OfflineIndicator.tsx';
import { PWAInstallButton } from '@/src/pwa/PWAInstallButton.tsx';
import {
  getRouteDefinition,
  MODULE_ROUTES,
  NAVIGATION_GROUPS,
  type ModuleRouteId,
} from '@/src/shared/navigation/routes.ts';

interface AppShellProps {
  readonly activeRoute: ModuleRouteId;
  readonly workshopName: string;
  /**
   * Espacio estructural reservado para el futuro Mini-Reproductor del cronómetro (Fase 3).
   * En Fase 1 permanece desacoplado sin lógica funcional de cronómetro.
   */
  readonly timerDockSlot?: React.ReactNode;
  readonly headerActionsSlot?: React.ReactNode;
  readonly children: React.ReactNode;
  onSelectRoute(routeId: ModuleRouteId): void;
}

function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(min-width: 1024px)');
    const handleChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  return isDesktop;
}

export const AppShell: React.FC<AppShellProps> = ({
  activeRoute,
  workshopName,
  timerDockSlot,
  headerActionsSlot,
  children,
  onSelectRoute,
}) => {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const isDesktopViewport = useIsDesktopViewport();
  const currentRoute = getRouteDefinition(activeRoute);
  const mobileBottomRoutes = MODULE_ROUTES.filter((r) => r.showInMobileBottomBar);

  const handleNavigate = (id: ModuleRouteId) => {
    onSelectRoute(id);
    setMobileDrawerOpen(false);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 lg:flex-row">
      {/* Sidebar fijo en escritorio */}
      <aside className="hidden lg:flex lg:h-full lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-5">
          <img
            src="/icon.svg"
            alt={BRAND_CONFIG.appName}
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold text-slate-900">
              {BRAND_CONFIG.appName}
            </p>
            <p className="truncate text-xs text-slate-500">{workshopName}</p>
          </div>
        </div>

        <nav
          aria-label="Navegación principal del taller"
          className="flex-1 overflow-y-auto px-3 py-4 space-y-5"
        >
          {NAVIGATION_GROUPS.map((group) => {
            const routes = MODULE_ROUTES.filter((r) => r.group === group);
            return (
              <div key={group}>
                <p className="px-3 text-xs font-semibold text-slate-400">
                  {group}
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {routes.map((route) => {
                    const Icon = route.icon;
                    const isActive = route.id === activeRoute;
                    return (
                      <button
                        key={route.id}
                        type="button"
                        onClick={() => handleNavigate(route.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex w-full min-h-[40px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-teal-700/10 font-semibold text-teal-800'
                            : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              isActive ? 'text-teal-700' : 'text-slate-400'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{route.label}</span>
                        </span>
                        {!route.isActiveInCurrentPhase && (
                          <span className="shrink-0 text-[11px] font-normal text-slate-400">
                            F{route.phase}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Contenedor reservado en escritorio para widget de cronómetro (montaje único) */}
        {isDesktopViewport && timerDockSlot && (
          <div className="shrink-0 border-t border-slate-200 p-3">{timerDockSlot}</div>
        )}
      </aside>

      {/* Columna principal bloqueada al viewport */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Barra superior fija sin solapamiento */}
        <header className="z-30 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6 lg:h-16">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"
                aria-label="Abrir menú de módulos"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate font-display text-base font-bold text-slate-900 sm:text-lg">
                  {currentRoute.label}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 sm:gap-3">
              <div className="hidden sm:flex items-center">
                <PWAInstallButton compact />
              </div>
              {headerActionsSlot}
            </div>
          </div>
          <OfflineIndicator />
        </header>

        {/* Escenario principal 100% libre para vistas por pantalla */}
        <main className="relative min-h-0 w-full flex-1 overflow-hidden">
          {children}
        </main>
      </div>

      {/* Mini-reproductor móvil sobre barra inferior sin tapar contenido (montaje único) */}
      {!isDesktopViewport && timerDockSlot && (
        <div
          data-slot="timer-dock-mobile"
          className="z-30 shrink-0 border-t border-slate-200/80 bg-slate-50 px-3 py-1.5 lg:hidden"
        >
          {timerDockSlot}
        </div>
      )}

      {/* Barra inferior fija en móvil (Thumb-zone navigation) */}
      <nav
        aria-label="Accesos principales móviles"
        className="z-40 shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe lg:hidden"
      >
        <div className="grid h-16 grid-cols-5 items-center">
          {mobileBottomRoutes.map((route) => {
            const Icon = route.icon;
            const isActive = route.id === activeRoute;
            return (
              <button
                key={route.id}
                type="button"
                onClick={() => handleNavigate(route.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-1 px-1 transition-colors ${
                  isActive
                    ? 'text-teal-700'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${isActive ? 'stroke-[2.25]' : 'stroke-[1.75]'}`}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate text-[11px] font-medium leading-none">
                  {route.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Menú lateral completo para móvil (acceso a todos los módulos del taller) */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menú completo de módulos"
        >
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/icon.svg"
                  alt={BRAND_CONFIG.appName}
                  width={28}
                  height={28}
                  className="h-7 w-7 rounded-md"
                />
                <span className="truncate font-display text-sm font-bold text-slate-900">
                  {BRAND_CONFIG.appName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
              {NAVIGATION_GROUPS.map((group) => {
                const routes = MODULE_ROUTES.filter((r) => r.group === group);
                return (
                  <div key={group}>
                    <p className="px-3 text-xs font-semibold text-slate-400">
                      {group}
                    </p>
                    <div className="mt-1.5 space-y-0.5">
                      {routes.map((route) => {
                        const Icon = route.icon;
                        const isActive = route.id === activeRoute;
                        return (
                          <button
                            key={route.id}
                            type="button"
                            onClick={() => handleNavigate(route.id)}
                            className={`flex w-full min-h-[44px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                              isActive
                                ? 'bg-teal-700/10 font-semibold text-teal-800'
                                : 'font-medium text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                              <span className="truncate">{route.label}</span>
                            </span>
                            {!route.isActiveInCurrentPhase && (
                              <span className="text-[11px] text-slate-400">
                                Fase {route.phase}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
