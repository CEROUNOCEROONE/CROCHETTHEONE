import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Calendar,
  Check,
  CheckCheck,
  ExternalLink,
  History,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import {
  formatDateCO,
  formatDateTimeCO,
} from '@/src/domain/services/formatters.ts';
import {
  addDaysToDateKey,
  REMINDER_TYPE_META,
  resolveSmartRemindersAndAlerts,
  toLocalDateKey,
  type SmartAlertItem,
} from '@/src/domain/services/planningService.ts';
import {
  clearNotificationHistory,
  dismissAlertInCenter,
  markAlertsAsReadInCenter,
  recordNotificationHistoryEvent,
  restoreDismissedAlertsInCenter,
  useNotificationCenterState,
} from '@/src/modules/notifications/notificationCenterStore.ts';
import {
  getNotificationCapabilities,
  requestNotificationPermissionExplicitly,
  type NotificationCapabilities,
} from '@/src/pwa/notificationBridge.ts';
import type { ModuleRouteId } from '@/src/shared/navigation/routes.ts';

interface HeaderStatusBarProps {
  onNavigate(route: ModuleRouteId): void;
  onOpenProject(projectId: string): void;
  onOpenTimer?(): void;
  onOpenNotificationSettings?(): void;
}

type CenterTab = 'pending' | 'history' | 'prefs';

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
  onOpenTimer,
  onOpenNotificationSettings,
}) => {
  const {
    isLoading,
    lastSaved,
    settings,
    reminders,
    projects,
    components,
    workSessions,
    pendingMaterials,
    materials,
    variants,
    paymentPlans,
    installments,
    clients,
    createReminder,
    updateReminder,
    updateSettings,
  } = useWorkshopData();

  const centerState = useNotificationCenterState();

  const [justSaved, setJustSaved] = useState(false);
  const [saveDetailsOpen, setSaveDetailsOpen] = useState(false);
  const [bellMenuOpen, setBellMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CenterTab>('pending');
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [caps, setCaps] = useState<NotificationCapabilities>(() =>
    getNotificationCapabilities(),
  );
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

  const readIdSet = useMemo(
    () => new Set(centerState.readIds),
    [centerState.readIds],
  );
  const dismissedIdSet = useMemo(
    () => new Set(centerState.dismissedIds),
    [centerState.dismissedIds],
  );

  const activeAlerts = useMemo(() => {
    if (isLoading) return [];
    const all = resolveSmartRemindersAndAlerts({
      settings,
      reminders,
      projects,
      components,
      workSessions,
      pendingMaterials,
      materials,
      variants,
      paymentPlans,
      installments,
      clients,
    });
    return all.filter((a) => !a.isCompleted && !dismissedIdSet.has(a.id));
  }, [
    isLoading,
    settings,
    reminders,
    projects,
    components,
    workSessions,
    pendingMaterials,
    materials,
    variants,
    paymentPlans,
    installments,
    clients,
    dismissedIdSet,
  ]);

  const unreadAlerts = useMemo(
    () => activeAlerts.filter((a) => !a.isRead && !readIdSet.has(a.id)),
    [activeAlerts, readIdSet],
  );

  const unreadCount = unreadAlerts.length;
  const activeCount = activeAlerts.length;
  const hasNewNotifications = unreadCount > 0;

  const highestUrgency = useMemo<'overdue' | 'due_soon' | 'upcoming' | null>(() => {
    if (activeAlerts.some((a) => a.urgency === 'overdue')) return 'overdue';
    if (activeAlerts.some((a) => a.urgency === 'due_soon')) return 'due_soon';
    if (activeAlerts.length > 0) return 'upcoming';
    return null;
  }, [activeAlerts]);

  useEffect(() => {
    if (unreadCount > prevUnseenCountRef.current) {
      setBellChimeKey((k) => k + 1);
    }
    prevUnseenCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    if (!hasNewNotifications || bellMenuOpen) return;
    const interval = window.setInterval(() => {
      setBellChimeKey((k) => k + 1);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [hasNewNotifications, bellMenuOpen]);

  // Refrescar estado de permisos cuando se abre o vuelve foco
  useEffect(() => {
    if (!bellMenuOpen) return;
    setCaps(getNotificationCapabilities());
  }, [bellMenuOpen]);

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

  const handleMarkAllRead = () => {
    if (activeAlerts.length === 0) return;
    markAlertsAsReadInCenter(activeAlerts.map((a) => a.id));
  };

  const handleToggleBell = () => {
    setSaveDetailsOpen(false);
    setBellMenuOpen((open) => !open);
  };

  const handleToggleSaveDetails = () => {
    setBellMenuOpen(false);
    setSaveDetailsOpen((v) => !v);
  };

  const handleMarkAlertRead = async (alert: SmartAlertItem) => {
    markAlertsAsReadInCenter([alert.id]);
    if (alert.reminderId && !alert.isRead) {
      await updateReminder(alert.reminderId, { isRead: true });
    }
  };

  const handleMarkCompleted = async (alert: SmartAlertItem) => {
    setBusyAlertId(alert.id);
    try {
      markAlertsAsReadInCenter([alert.id]);
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
      recordNotificationHistoryEvent({
        alertId: alert.id,
        type: alert.type,
        title: alert.title,
        message: alert.message,
        status: 'completed',
        deliveredToOS: false,
      });
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
      markAlertsAsReadInCenter([alert.id]);
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
      recordNotificationHistoryEvent({
        alertId: alert.id,
        type: alert.type,
        title: `${alert.title} (pospuesto +${days}d)`,
        message: alert.message,
        status: 'snoozed',
        deliveredToOS: false,
      });
    } finally {
      setBusyAlertId(null);
    }
  };

  const handleDismissAlert = (alert: SmartAlertItem) => {
    dismissAlertInCenter({
      alertId: alert.id,
      type: alert.type,
      title: alert.title,
      message: alert.message,
    });
  };

  const handleOpenAlertTarget = (alert: SmartAlertItem) => {
    markAlertsAsReadInCenter([alert.id]);
    setBellMenuOpen(false);
    if (
      (alert.type === 'timer_reminder' ||
        alert.relatedEntityType === 'work_session') &&
      onOpenTimer
    ) {
      onOpenTimer();
      return;
    }
    if (alert.type === 'timer_reminder' || alert.relatedEntityType === 'work_session') {
      onNavigate('timer');
      return;
    }
    if (alert.relatedEntityType === 'project' && alert.relatedEntityId) {
      onOpenProject(alert.relatedEntityId);
      return;
    }
    if (
      alert.relatedEntityType === 'installment' ||
      alert.relatedEntityType === 'client'
    ) {
      onNavigate('clients');
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

  const handleRequestPermission = async () => {
    setPermissionLoading(true);
    try {
      const nextPerm = await requestNotificationPermissionExplicitly();
      setCaps(getNotificationCapabilities());
      if (nextPerm === 'granted') {
        await updateSettings({ enableBrowserNotifications: true });
      }
    } finally {
      setPermissionLoading(false);
    }
  };

  const badgeNumber = unreadCount > 0 ? unreadCount : activeCount;

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

      {/* Campana y Centro de Notificaciones */}
      <div className="relative">
        <button
          type="button"
          onClick={handleToggleBell}
          aria-expanded={bellMenuOpen}
          aria-label={
            unreadCount > 0
              ? `Notificaciones: ${unreadCount} sin leer de ${activeCount} activas`
              : activeCount > 0
                ? `Notificaciones: ${activeCount} alertas activas`
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

          {badgeNumber > 0 && (
            <span
              className={`absolute -right-1 -top-1 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold leading-none text-white tabular-nums shadow-xs ${
                highestUrgency === 'overdue'
                  ? 'bg-rose-600'
                  : highestUrgency === 'due_soon'
                    ? 'bg-amber-600'
                    : 'bg-teal-700'
              }`}
            >
              {badgeNumber > 9 ? '9+' : badgeNumber}
            </span>
          )}
        </button>

        {bellMenuOpen && (
          <section
            aria-label="Centro de notificaciones"
            className="fixed inset-x-3 top-16 z-50 flex max-h-[82dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[26rem]"
          >
            {/* Cabecera del centro */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Centro de notificaciones
                </h2>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {unreadCount > 0
                    ? `${unreadCount} sin leer · ${activeCount} activa${activeCount === 1 ? '' : 's'}`
                    : activeCount > 0
                      ? `${activeCount} aviso${activeCount === 1 ? '' : 's'} activo${activeCount === 1 ? '' : 's'}`
                      : 'Sin avisos pendientes'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {activeTab === 'pending' && unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    title="Marcar todas como leídas"
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-teal-800 hover:bg-teal-50"
                  >
                    <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Todo leído</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBellMenuOpen(false)}
                  aria-label="Cerrar notificaciones"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Navegación de pestañas del Centro */}
            <div
              role="tablist"
              aria-label="Vistas del centro de notificaciones"
              className="grid grid-cols-3 gap-1 border-b border-slate-100 bg-slate-50/70 p-1.5"
            >
              {(
                [
                  ['pending', `Pendientes (${activeCount})`, Bell],
                  ['history', `Historial (${centerState.history.length})`, History],
                  ['prefs', 'Permisos', SlidersHorizontal],
                ] as const
              ).map(([tabKey, label, TabIcon]) => {
                const selected = activeTab === tabKey;
                return (
                  <button
                    key={tabKey}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTab(tabKey)}
                    className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                      selected
                        ? 'bg-white text-teal-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <TabIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>

            {/* PESTAÑA 1: PENDIENTES */}
            {activeTab === 'pending' && (
              <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">
                {caps.supported && caps.permission === 'default' && (
                    <div className="flex items-center justify-between gap-2 bg-teal-50/70 px-4 py-2.5 text-[11px]">
                      <span className="text-teal-950">
                        Activa notificaciones en este dispositivo para recibir alertas fuera de la app.
                      </span>
                      <button
                        type="button"
                        disabled={permissionLoading}
                        onClick={() => void handleRequestPermission()}
                        className="shrink-0 rounded-lg bg-teal-700 px-2.5 py-1.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                      >
                        {permissionLoading ? 'Activando...' : 'Activar'}
                      </button>
                    </div>
                  )}

                {activeAlerts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell
                      className="mx-auto h-7 w-7 text-slate-300"
                      aria-hidden="true"
                    />
                    <p className="mt-2 text-xs font-semibold text-slate-700">
                      Todo al día en este momento
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Aquí aparecerán avisos de cronómetro olvidado, entregas, clientes, cuotas, compras e inventario mínimo.
                    </p>
                    {centerState.dismissedIds.length > 0 && (
                      <button
                        type="button"
                        onClick={restoreDismissedAlertsInCenter}
                        className="mt-3 text-[11px] font-semibold text-teal-800 underline"
                      >
                        Restaurar {centerState.dismissedIds.length} aviso(s) descartado(s)
                      </button>
                    )}
                  </div>
                ) : (
                  activeAlerts.slice(0, 15).map((alert) => {
                    const typeMeta = REMINDER_TYPE_META[alert.type];
                    const isBusy = busyAlertId === alert.id;
                    const isUnread = !alert.isRead && !readIdSet.has(alert.id);
                    return (
                      <article
                        key={alert.id}
                        className={`space-y-2 px-4 py-3 ${
                          isUnread ? 'bg-amber-50/25' : 'bg-white'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isUnread && (
                              <span
                                aria-label="Sin leer"
                                className="h-2 w-2 rounded-full bg-teal-600"
                              />
                            )}
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
                                ? 'Urgente / vencido'
                                : alert.urgency === 'due_soon'
                                  ? 'Próximo'
                                  : 'Programado'}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="font-mono text-slate-500 tabular-nums">
                              {formatDateCO(alert.triggerAt)}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDismissAlert(alert)}
                            title="Descartar aviso"
                            aria-label="Descartar aviso"
                            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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

                          {isUnread && (
                            <button
                              type="button"
                              onClick={() => void handleMarkAlertRead(alert)}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                            >
                              <CheckCheck className="h-3 w-3" aria-hidden="true" />
                              <span>Leída</span>
                            </button>
                          )}

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
                  })
                )}
              </div>
            )}

            {/* PESTAÑA 2: HISTORIAL */}
            {activeTab === 'history' && (
              <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">
                {centerState.history.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <History
                      className="mx-auto h-7 w-7 text-slate-300"
                      aria-hidden="true"
                    />
                    <p className="mt-2 text-xs font-semibold text-slate-700">
                      Historial vacío por ahora
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Aquí quedará un registro de los últimos avisos enviados, atendidos o descartados durante los últimos 30 días.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between bg-slate-50/50 px-4 py-2 text-[11px]">
                      <span className="text-slate-500">
                        Últimos {centerState.history.length} eventos
                      </span>
                      <button
                        type="button"
                        onClick={clearNotificationHistory}
                        className="font-semibold text-rose-700 hover:underline"
                      >
                        Limpiar historial
                      </button>
                    </div>
                    {centerState.history.slice(0, 30).map((item) => (
                      <div key={item.id} className="space-y-1 px-4 py-2.5">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                          <span className="font-semibold text-teal-800">
                            {item.type === 'system'
                              ? 'Sistema'
                              : REMINDER_TYPE_META[item.type]?.label ?? item.type}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatDateTimeCO(item.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-800">
                          {item.title}
                        </p>
                        {item.message && (
                          <p className="text-[11px] text-slate-500 line-clamp-2">
                            {item.message}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                            {item.status === 'completed'
                              ? 'Atendido'
                              : item.status === 'dismissed'
                                ? 'Descartado'
                                : item.status === 'snoozed'
                                  ? 'Pospuesto'
                                  : item.status === 'read'
                                    ? 'Leído'
                                    : 'Notificado'}
                          </span>
                          {item.deliveredToOS && (
                            <span className="text-teal-700 font-medium">
                              · Notificación enviada al dispositivo
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* PESTAÑA 3: PERMISOS Y PREFERENCIAS RÁPIDAS */}
            {activeTab === 'prefs' && (
              <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <div className="flex items-start gap-2.5">
                    {caps.permission === 'granted' ? (
                      <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    ) : (
                      <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">
                        Permiso del navegador / Android PWA:{' '}
                        <span
                          className={
                            caps.permission === 'granted'
                              ? 'text-emerald-700'
                              : caps.permission === 'denied'
                                ? 'text-rose-700'
                                : 'text-amber-700'
                          }
                        >
                          {caps.permission === 'granted'
                            ? 'Permitido'
                            : caps.permission === 'denied'
                              ? 'Bloqueado'
                              : caps.permission === 'unsupported'
                                ? 'No compatible'
                                : 'Sin solicitar'}
                        </span>
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                        {caps.permission === 'granted'
                          ? caps.supportsActions
                            ? 'Tu dispositivo soporta notificaciones persistentes con acciones rápidas (Pausar / Finalizar).'
                            : 'Las notificaciones están activas en el sistema. Algunas acciones en barra pueden variar según el navegador.'
                          : caps.permission === 'denied'
                            ? 'El permiso fue bloqueado en este navegador. Puedes seguir usando la campana y alertas internas o habilitarlo desde la configuración del sitio en Chrome/Android.'
                            : 'Actívalo para recibir avisos si dejas el cronómetro corriendo al cambiar de app o cuando tengas entregas urgentes.'}
                      </p>
                    </div>
                  </div>

                  {caps.supported && caps.permission === 'default' && (
                    <button
                      type="button"
                      disabled={permissionLoading}
                      onClick={() => void handleRequestPermission()}
                      className="inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                    >
                      <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {permissionLoading
                          ? 'Solicitando permiso...'
                          : 'Permitir notificaciones PWA'}
                      </span>
                    </button>
                  )}
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                  <div>
                    <p className="font-semibold text-slate-800">
                      Notificaciones en navegador / PWA
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Interruptor maestro para avisos externos del dispositivo
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.enableBrowserNotifications)}
                    onChange={(e) =>
                      void updateSettings({
                        enableBrowserNotifications: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                  <div>
                    <p className="font-semibold text-slate-800">
                      Avisos de cronómetro activo y olvidado
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Barra de estado activa y recordatorio cada{' '}
                      {settings.timerReminderIntervalMinutes ?? 60} min
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.enableTimerNotifications !== false}
                    onChange={(e) =>
                      void updateSettings({
                        enableTimerNotifications: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                </label>

                {onOpenNotificationSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setBellMenuOpen(false);
                      onOpenNotificationSettings();
                    }}
                    className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-teal-700" />
                    <span>Horarios de silencio, sonidos e intervalos</span>
                  </button>
                )}
              </div>
            )}

            {/* Pie del Centro */}
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <button
                type="button"
                onClick={() => {
                  setBellMenuOpen(false);
                  onNavigate('planner');
                }}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-teal-800 hover:bg-teal-50"
              >
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ver agenda</span>
              </button>

              {onOpenNotificationSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setBellMenuOpen(false);
                    onOpenNotificationSettings();
                  }}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Preferencias</span>
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
