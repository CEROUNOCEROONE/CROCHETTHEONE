import React from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { SnapDeck, SnapSlide } from '@/src/shared/components/SnapDeck.tsx';
import type { ModuleRouteDefinition, ModuleRouteId } from '@/src/shared/navigation/routes.ts';

interface PlannedModuleViewProps {
  readonly route: ModuleRouteDefinition;
  onNavigate(routeId: ModuleRouteId): void;
}

export const PlannedModuleView: React.FC<PlannedModuleViewProps> = ({
  route,
  onNavigate,
}) => {
  const Icon = route.icon;

  return (
    <SnapDeck ariaLabel={route.label}>
      <SnapSlide id={`${route.id}-overview`} label={route.label}>
        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-teal-700">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-medium text-teal-700">
                  Fase {route.phase} · Módulo planificado en arquitectura
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-slate-900">
                  {route.label}
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">
                  {route.description}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-slate-900">
              Capacidades contempladas para este módulo
            </h3>
            <ul className="mt-3 space-y-2.5">
              {route.plannedCapabilities.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-sm text-slate-600"
                >
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-teal-700"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Volver al Panel Principal</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span>Ir a Taller y Respaldos</span>
            </button>
          </div>
        </div>
      </SnapSlide>
    </SnapDeck>
  );
};
