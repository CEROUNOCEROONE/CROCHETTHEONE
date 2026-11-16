import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calendar,
  Check,
  ExternalLink,
  RefreshCw,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import { formatDateCO } from '@/src/domain/services/formatters.ts';
import {
  addDaysToDateKey,
  REMINDER_TYPE_META,
  resolveSmartRemindersAndAlerts,
  toLocalDateKey,
  type SmartAlertItem,
} from '@/src/domain/services/planningService.ts';
import type { ModuleRouteId } from '@/src/shared/navigation/routes.ts';

interface HeaderStatusBarProps {
  onNavigate(route: ModuleRouteId): void;
  onOpenProject(projectId: string): void;
}

const SEEN_ALERTS_STORAGE_KEY = 'crochet_seen_alert_ids_v1';

function loadSeenAlertIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(SEEN_ALERTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenAlertIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      SEEN_ALERTS_STORAGE_KEY,
      JSON.stringify(Array.from(ids)),
    );
  } catch {
    // Ignorar fallo de cuota en sessionStorage
  }
}

function formatTimeHM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const HeaderStatusBar: React.FC<HeaderStatusBarProps> = ({
  onNavigate,
  onOpenProject,
}) => {
  const {
    isLoading,
    lastSaved,
    settings,
    reminders,
    projects,
    pendingMaterials,
    materials,
    variants,
    paymentPlans,
    installments,
    clients,
    createReminder,
    updateReminder,
  } = useWorkshopData();

  const [justSaved, setJustSaved] = useState(false);
  const [saveDetailsOpen, setSaveDetailsOpen] = useState(false);
  const [bellMenuOpen, setBellMenuOpen] = useState(false);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => loadSeenAlertIds());
  const [bellChimeKey, setBellChimeKey] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevUnseenCountRef = useRef<number>(0);

  // Alerta cuando ocurre un guardado en IndexedDB
  useEffect(() => {
    if (!lastSaved) return;
    setJustSaved(true);
    const timer = window.setTimeout(() => {
      setJustSaved(false);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [lastSaved]);

  const activeAlerts = useMemo(() => {
    if (isLoading) return [];
    const all = resolveSmartRemindersAndAlerts({
      settings,
      reminders,
      projects,
      pendingMaterials,
      materials,
      variants,
      paymentPlans,
      installments,
      clients,
    });
    return all.filter((a) => !a.isCompleted);
  }, [
    isLoading,
    settings,
    reminders,
    projects,
    pendingMaterials,
    materials,
    variants,
    paymentPlans,
    installments,
    clients,
  ]);

  const unseenAlerts = useMemo(
    () => activeAlerts.filter((a) => !a.isRead && !seenIds.has(a.id)),
    [activeAlerts, seenIds],
  );

  const hasNewNotifications = unseenAlerts.length > 0;
  const highestUrgency = useMemo<'overdue' | 'due_soon' | 'upcoming' | null>(() => {
    if (activeAlerts.some((a) => a.urgency === 'overdue')) return 'overdue';
    if (activeAlerts.some((a) => a.urgency === 'due_soon')) return 'due_soon';
    if (activeAlerts.length > 0) return 'upcoming';
    return null;
  }, [activeAlerts]);

  // Dispara animación de timbre cuando llegan nuevas notificaciones no vistas
  useEffect(() => {
    const count = unseenAlerts.length;
    if (count > prevUnseenCountRef.current) {
      setBellChimeKey((k) => k + 1);
    }
    prevUnseenCountRef.current = count;
  }, [unseenAlerts.length]);

  // Recordatorio sutil periódico si siguen mensajes nuevos sin abrir
  useEffect(() => {
    if (!hasNewNotifications || bellMenuOpen) return;
    const interval = window.setInterval(() => {
      setBellChimeKey((k) => k + 1);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [hasNewNotifications, bellMenuOpen]);

  // Cierre al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!bellMenuOpen && !saveDetailsOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setBellMenuOpen(false);
        setSaveDetailsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBellMenuOpen(false);
        setSaveDetailsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [bellMenuOpen, saveDetailsOpen]);

  const acknowledgeCurrentAlerts = () => {
    if (activeAlerts.length === 0) return;
    setSeenIds((prev) => {
      const next = new Set(prev);
      for (const a of activeAlerts) {
        next.add(a.id);
      }
      saveSeenAlertIds(next);
      return next;
    });
  };

  const handleToggleBell = () => {
    setSaveDetailsOpen(false);
    setBellMenuOpen((open) => {
      const next = !open;
      if (next) {
        acknowledgeCurrentAlerts();
      }
      return next;
    });
  };

  const handleToggleSaveDetails = () => {
    setBellMenuOpen(false);
    setSaveDetailsOpen((v) => !v);
  };

  const handleMarkCompleted = async (alert: SmartAlertItem) => {
    setBusyAlertId(alert.id);
    try {
      if (alert.reminderId) {
        await updateReminder(alert.reminderId, {
          isCompleted: true,
          isRead: true,
        });
      } else {
        const created = await createReminder({
          type: alert.type,
          title: alert.title,
          message: alert.message,
          triggerAt: alert.dueDate,
          relatedEntityId: alert.relatedEntityId,
          relatedEntityType: alert.relatedEntityType,
          isDemo: alert.isDemo,
        });
        await updateReminder(created.id, { isCompleted: true, isRead: true });
      }
    } finally {
      setBusyAlertId(null);
    }
  };

  const handleSnoozeAlert = async (alert: SmartAlertItem, days: number) => {
    const todayKey = toLocalDateKey(new Date());
    const baseKey = toLocalDateKey(alert.triggerAt) || todayKey;
    const nextDateKey = addDaysToDateKey(
      baseKey < todayKey ? todayKey : baseKey,
      days,
    );
    setBusyAlertId(alert.id);
    try {
      if (alert.reminderId) {
        await updateReminder(alert.reminderId, {
          snoozedUntil: nextDateKey,
          isRead: true,
        });
      } else {
        const created = await createReminder({
          type: alert.type,
          title: alert.title,
          message: alert.message,
          triggerAt: alert.dueDate,
          relatedEntityId: alert.relatedEntityId,
          relatedEntityType: alert.relatedEntityType,
          isDemo: alert.isDemo,
        });
        await updateReminder(created.id, {
          snoozedUntil: nextDateKey,
          isRead: true,
        });
      }
    } finally {
      setBusyAlertId(null);
    }
  };

  const handleOpenAlertTarget = (alert: SmartAlertItem) => {
    setBellMenuOpen(false);
    if (alert.relatedEntityType === 'project' && alert.relatedEntityId) {
      onOpenProject(alert.relatedEntityId);
      return;
    }
    if (alert.relatedEntityType === 'pending_material') {
      onNavigate('shopping');
      return;
    }
    if (alert.relatedEntityType === 'variant') {
      onNavigate('inventory');
      return;
    }
    onNavigate('planner');
  };

  const activeCount = activeAlerts.length;

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5 sm:gap-2">
      {/* Indicador Check (chulito) de cambios guardados correctamente */}
      <div className="relative">
        <button
          type="button"
          onClick={handleToggleSaveDetails}
          aria-expanded={saveDetailsOpen}
          aria-label={
            justSaved
              ? `Cambios guardados: ${lastSaved?.summary ?? 'Base local'}`
              : lastSaved
                ? `Último cambio guardado a las ${formatTimeHM(lastSaved.at)}`
                : 'Cambios sincronizados en el dispositivo'
          }
          title={
            lastSaved
              ? `Guardado · ${lastSaved.summary} (${formatTimeHM(lastSaved.at)})`
              : 'Guardado automático en el dispositivo'
          }
          className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${
            justSaved
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-xs'
              : lastSaved
                ? 'border-emerald-200/80 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50'
                : 'border-slate-200/90 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          }`}
        >
          <span
            key={lastSaved?.seq ?? 0}
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
              justSaved
                ? 'animate-header-check-pop bg-emerald-600 text-white'
                : lastSaved
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Check
              className={`h-3.5 w-3.5 ${justSaved ? 'stroke-[2.75]' : 'stroke-[2.25]'}`}
              aria-hidden="true"
            />
          </span>
        </button>

        {saveDetailsOpen && (
          <div
            role="status"
            className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
                </span>
                <span>Estado de guardado</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveDetailsOpen(false)}
                aria-label="Cerrar detalle de guardado"
                className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {lastSaved ? (
              <p className="mt-2 leading-relaxed text-slate-600">
                <span className="font-medium text-emerald-800">
                  Guardado correctamente
                </span>{' '}
                a las{' '}
                <span className="font-mono tabular-nums text-slate-800">
                  {formatTimeHM(lastSaved.at)}
                </span>
                : {lastSaved.summary}.
              </p>
            ) : (
              <p className="mt-2 leading-relaxed text-slate-600">
                Todos tus datos actuales están sincronizados en este dispositivo.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Campana de notificaciones */}
      <div className="relative">
        <button
          type="button"
          onClick={handleToggleBell}
          aria-expanded={bellMenuOpen}
          aria-label={
            activeCount > 0
              ? `Notificaciones: ${activeCount} aviso${activeCount === 1 ? '' : 's'} activo${activeCount === 1 ? '' : 's'}`
              : 'Notificaciones: sin avisos pendientes'
          }
          className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${
            bellMenuOpen
              ? 'border-teal-700 bg-teal-50 text-teal-800'
              : hasNewNotifications
                ? 'border-amber-300 bg-amber-50/70 text-amber-800 hover:bg-amber-50'
                : 'border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          {hasNewNotifications && bellChimeKey > 0 && (
            <span
              key={`halo-${bellChimeKey}`}
              aria-hidden="true"
              className="animate-header-bell-halo pointer-events-none absolute inset-0 rounded-xl border-2 border-amber-400"
            />
          )}

          <Bell
            key={`bell-${bellChimeKey}`}
            className={`h-5 w-5 ${
              hasNewNotifications && bellChimeKey > 0
                ? 'animate-header-bell-ring text-amber-700'
                : ''
            }`}
            aria-hidden="true"
          />

          {activeCount > 0 && (
            <span
              className={`absolute -right-1 -top-1 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold leading-none text-white tabular-nums shadow-xs ${
                highestUrgency === 'overdue'
                  ? 'bg-rose-600'
                  : highestUrgency === 'due_soon'
                    ? 'bg-amber-600'
                    : 'bg-teal-700'
              }`}
            >
              {activeCount > 9 ? '9+' : activeCount}
            </span>
          )}
        </button>

        {bellMenuOpen && (
          <section
            aria-label="Centro de notificaciones"
            className="fixed inset-x-3 top-16 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Notificaciones del taller
                </h2>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {activeCount === 0
                    ? 'Todo al día en este momento'
                    : `${activeCount} aviso${activeCount === 1 ? '' : 's'} pendiente${activeCount === 1 ? '' : 's'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBellMenuOpen(false)}
                aria-label="Cerrar notificaciones"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {activeAlerts.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell
                  className="mx-auto h-7 w-7 text-slate-300"
                  aria-hidden="true"
                />
                <p className="mt-2 text-xs font-semibold text-slate-700">
                  Sin mensajes nuevos
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Cuando haya entregas próximas, cuotas por vencer, compras en camino o stock mínimo aparecerán aquí.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">
                {activeAlerts.slice(0, 12).map((alert) => {
                  const typeMeta = REMINDER_TYPE_META[alert.type];
                  const isBusy = busyAlertId === alert.id;
                  return (
                    <article key={alert.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="font-semibold text-teal-800">
                          {typeMeta.label}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span
                          className={`font-semibold ${
                            alert.urgency === 'overdue'
                              ? 'text-rose-700'
                              : alert.urgency === 'due_soon'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {alert.urgency === 'overdue'
                            ? 'Vencido / requiere atención'
                            : alert.urgency === 'due_soon'
                              ? 'Próximo (≤ 2 días)'
                              : 'Programado'}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-mono text-slate-500 tabular-nums">
                          {formatDateCO(alert.triggerAt)}
                        </span>
                      </div>

                      <p className="text-xs font-semibold text-slate-900">
                        {alert.title}
                      </p>
                      {alert.message && (
                        <p className="text-[11px] leading-relaxed text-slate-600">
                          {alert.message}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleOpenAlertTarget(alert)}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-50/50"
                        >
                          <span>Abrir</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSnoozeAlert(alert, 2)}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <RefreshCw className="h-3 w-3" aria-hidden="true" />
                          <span>+2d</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleMarkCompleted(alert)}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" aria-hidden="true" />
                          <span>Atendido</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <button
                type="button"
                onClick={() => {
                  setBellMenuOpen(false);
                  onNavigate('planner');
                }}
                className="flex w-full min-h-[36px] items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-teal-800 hover:bg-teal-50"
              >
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ver agenda y configurar recordatorios</span>
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
