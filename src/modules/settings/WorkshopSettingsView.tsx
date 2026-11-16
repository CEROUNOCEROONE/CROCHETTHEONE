import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  Crown,
  Database,
  Download,
  FileCheck2,
  Fingerprint,
  FlaskConical,
  HelpCircle,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { BRAND_CONFIG } from '@/src/config/brand.ts';
import type {
  BackupImportStrategy,
  BackupInspectionResult,
} from '@/src/data/ports/DataStorePort.ts';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import {
  CURRENCY_CATALOG,
  getCurrencySpec,
  getMoneyInputStep,
  roundCurrencyAmount,
  type WorkshopCurrencyCode,
} from '@/src/domain/services/currencyCatalog.ts';
import {
  formatCOP,
  formatDateCO,
  formatDateTimeCO,
  formatDurationMinutes,
} from '@/src/domain/services/formatters.ts';
import { formatUsdRatePerUnit } from '@/src/domain/services/exchangeRateService.ts';
import { calculateQuoteSummary } from '@/src/domain/services/quoteMath.ts';
import { PWAInstallButton } from '@/src/pwa/PWAInstallButton.tsx';
import { useOnlineStatus } from '@/src/pwa/useOnlineStatus.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { DurationInput } from '@/src/shared/components/DurationInput.tsx';
import { UsdEquiv } from '@/src/shared/components/UsdEquiv.tsx';
import {
  SnapDeck,
  SnapSlide,
  type SnapDeckHandle,
} from '@/src/shared/components/SnapDeck.tsx';

type SettingsStepId = 'general' | 'costs' | 'backups' | 'system';

interface SettingsStepDef {
  readonly id: SettingsStepId;
  readonly number: number;
  readonly label: string;
  readonly mobileLabel: string;
  readonly subtitle: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_STEPS: SettingsStepDef[] = [
  {
    id: 'general',
    number: 1,
    label: 'Taller y metas',
    mobileLabel: 'Taller y metas',
    subtitle: 'Nombre, tarifa y objetivos',
    icon: SlidersHorizontal,
  },
  {
    id: 'costs',
    number: 2,
    label: 'Costos y fórmula',
    mobileLabel: 'Costos y merma',
    subtitle: 'Arriendo, servicios e imprevistos',
    icon: Calculator,
  },
  {
    id: 'backups',
    number: 3,
    label: 'Respaldos JSON',
    mobileLabel: 'Respaldos JSON',
    subtitle: 'Exportar y restaurar copia',
    icon: ShieldCheck,
  },
  {
    id: 'system',
    number: 4,
    label: 'Ejemplos y sistema',
    mobileLabel: 'Ejemplos y PWA',
    subtitle: 'Datos demo e instalación',
    icon: Database,
  },
];

const STORE_LABELS: Record<string, string> = {
  workshop_settings: 'Configuración',
  clients: 'Clientes',
  materials: 'Materiales',
  material_variants: 'Colores / Variantes',
  projects: 'Proyectos',
  project_components: 'Componentes',
  work_sessions: 'Sesiones de tiempo',
  inventory_reservations: 'Reservas',
  pending_materials: 'Materiales pendientes',
  notes_and_lists: 'Notas y listas',
  shopping_list_items: 'Ítems de compra',
  purchase_receipts: 'Recepciones de compra',
  inventory_movements: 'Movimientos Kardex',
  quotes: 'Cotizaciones',
  payment_plans: 'Planes de pago',
  payment_installments: 'Cuotas',
  financial_transactions: 'Pagos recibidos',
  planned_tasks: 'Tareas planificadas',
  reminders: 'Recordatorios',
};

export const WorkshopSettingsView: React.FC = () => {
  const {
    settings,
    stats,
    schemaMeta,
    usdRates,
    usdRatesStatus,
    syncDailyUsdRates,
    updateSettings,
    loadDemoData,
    purgeDemoData,
    exportBackup,
    inspectBackup,
    importBackup,
    installationId,
    effectiveTier,
    capabilities,
    devTierOverride,
    setDevTierOverride,
  } = useWorkshopData();
  const isOnline = useOnlineStatus();

  const snapDeckRef = useRef<SnapDeckHandle | null>(null);
  const [activeStep, setActiveStep] = useState<SettingsStepId>('general');
  const [showFixedCostGuide, setShowFixedCostGuide] = useState(false);

  const [workshopName, setWorkshopName] = useState(settings.workshopName);
  const [ownerDisplayName, setOwnerDisplayName] = useState(settings.ownerDisplayName);
  const [currency, setCurrency] = useState<WorkshopCurrencyCode>(settings.currency);
  const [hourlyRateCOP, setHourlyRateCOP] = useState(String(settings.hourlyRateCOP));
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(
    String(settings.dailyGoalMinutes),
  );
  const [weeklyGoalMinutes, setWeeklyGoalMinutes] = useState(
    String(settings.weeklyGoalMinutes),
  );
  const [defaultMarkupPercent, setDefaultMarkupPercent] = useState(
    String(settings.defaultMarkupPercent),
  );
  const [rentCostPercent, setRentCostPercent] = useState(
    String(settings.rentCostPercent),
  );
  const [electricityCostPercent, setElectricityCostPercent] = useState(
    String(settings.electricityCostPercent),
  );
  const [internetCostPercent, setInternetCostPercent] = useState(
    String(settings.internetCostPercent),
  );
  const [wasteAndContingencyPercent, setWasteAndContingencyPercent] = useState(
    String(settings.wasteAndContingencyPercent),
  );

  const [savingSettings, setSavingSettings] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'error';
    message: string;
  } | null>(null);

  const [demoBusy, setDemoBusy] = useState(false);
  const [confirmPurgeDemoOpen, setConfirmPurgeDemoOpen] = useState(false);

  const [includeDemoInExport, setIncludeDemoInExport] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [inspection, setInspection] = useState<BackupInspectionResult | null>(null);
  const [selectedStrategy, setSelectedStrategy] =
    useState<BackupImportStrategy>('append_new');
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    setWorkshopName(settings.workshopName);
    setOwnerDisplayName(settings.ownerDisplayName);
    setCurrency(settings.currency);
    setHourlyRateCOP(String(settings.hourlyRateCOP));
    setDailyGoalMinutes(String(settings.dailyGoalMinutes));
    setWeeklyGoalMinutes(String(settings.weeklyGoalMinutes));
    setDefaultMarkupPercent(String(settings.defaultMarkupPercent));
    setRentCostPercent(String(settings.rentCostPercent));
    setElectricityCostPercent(String(settings.electricityCostPercent));
    setInternetCostPercent(String(settings.internetCostPercent));
    setWasteAndContingencyPercent(String(settings.wasteAndContingencyPercent));
  }, [settings]);

  const parsePercent = (raw: string) =>
    Math.round(Math.max(0, Math.min(100, Number(raw) || 0)) * 100) / 100;

  const selectedCurrencySpec = getCurrencySpec(currency);
  const sampleMarkup = Number(defaultMarkupPercent) || 0;
  const rentPct = parsePercent(rentCostPercent);
  const electricityPct = parsePercent(electricityCostPercent);
  const internetPct = parsePercent(internetCostPercent);
  const wastePct = parsePercent(wasteAndContingencyPercent);
  const totalFixedPercent =
    Math.round((rentPct + electricityPct + internetPct) * 100) / 100;

  const hasUnsavedSettings = useMemo(() => {
    const cleanName = workshopName.trim() || BRAND_CONFIG.defaultWorkshopName;
    const cleanOwner = ownerDisplayName.trim() || 'Artesana';
    const nextHourly = Math.max(
      0,
      roundCurrencyAmount(Number(hourlyRateCOP) || 0, currency),
    );
    return (
      cleanName !== settings.workshopName ||
      cleanOwner !== settings.ownerDisplayName ||
      currency !== settings.currency ||
      nextHourly !== settings.hourlyRateCOP ||
      Math.max(15, Number(dailyGoalMinutes) || 60) !== settings.dailyGoalMinutes ||
      Math.max(30, Number(weeklyGoalMinutes) || 300) !== settings.weeklyGoalMinutes ||
      Math.max(0, Math.min(500, Number(defaultMarkupPercent) || 0)) !==
        settings.defaultMarkupPercent ||
      rentPct !== settings.rentCostPercent ||
      electricityPct !== settings.electricityCostPercent ||
      internetPct !== settings.internetCostPercent ||
      wastePct !== settings.wasteAndContingencyPercent
    );
  }, [
    workshopName,
    ownerDisplayName,
    currency,
    hourlyRateCOP,
    dailyGoalMinutes,
    weeklyGoalMinutes,
    defaultMarkupPercent,
    rentPct,
    electricityPct,
    internetPct,
    wastePct,
    settings,
  ]);

  const formulaPreview = calculateQuoteSummary({
    materialsTotalCOP: selectedCurrencySpec.sampleMaterials,
    effectiveMinutes: 180,
    hourlyRateCOP: Number(hourlyRateCOP) || 0,
    indirectCostsCOP: 0,
    packagingCostCOP: selectedCurrencySpec.samplePackaging,
    shippingOrOtherCOP: 0,
    markupPercent: sampleMarkup,
    rentPercent: rentPct,
    electricityPercent: electricityPct,
    internetPercent: internetPct,
    wasteContingencyPercent: wastePct,
    currency,
  });

  const handleSaveSettings = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSavingSettings(true);
    setFeedback(null);
    try {
      await updateSettings({
        workshopName: workshopName.trim() || BRAND_CONFIG.defaultWorkshopName,
        ownerDisplayName: ownerDisplayName.trim() || 'Artesana',
        currency,
        hourlyRateCOP: Math.max(
          0,
          roundCurrencyAmount(Number(hourlyRateCOP) || 0, currency),
        ),
        dailyGoalMinutes: Math.max(15, Number(dailyGoalMinutes) || 60),
        weeklyGoalMinutes: Math.max(30, Number(weeklyGoalMinutes) || 300),
        defaultMarkupPercent: Math.max(0, Math.min(500, Number(defaultMarkupPercent) || 0)),
        rentCostPercent: rentPct,
        electricityCostPercent: electricityPct,
        internetCostPercent: internetPct,
        wasteAndContingencyPercent: wastePct,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo guardar la configuración.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLoadDemo = async () => {
    setDemoBusy(true);
    setFeedback(null);
    try {
      await loadDemoData();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error cargando ejemplos.',
      });
    } finally {
      setDemoBusy(false);
    }
  };

  const handleConfirmPurgeDemo = async () => {
    setDemoBusy(true);
    setFeedback(null);
    try {
      await purgeDemoData();
      setConfirmPurgeDemoOpen(false);
    } catch (err) {
      setConfirmPurgeDemoOpen(false);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible eliminar los ejemplos por protección de integridad.',
      });
    } finally {
      setDemoBusy(false);
    }
  };

  const handleExportBackup = async () => {
    setExportBusy(true);
    setFeedback(null);
    try {
      const envelope = await exportBackup(includeDemoInExport);
      const jsonText = JSON.stringify(envelope, null, 2);
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const dateStamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `app-crochet-respaldo-v${envelope.schemaVersion}-${dateStamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error generando el respaldo.',
      });
    } finally {
      setExportBusy(false);
    }
  };

  const handleBackupFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setFeedback(null);
    try {
      const rawText = await file.text();
      const result = await inspectBackup(rawText);
      setInspection(result);
      setSelectedStrategy('append_new');
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo leer el archivo seleccionado.',
      });
    }
  };

  const handleExecuteImport = async () => {
    if (!inspection || !inspection.isValid) return;
    setImportBusy(true);
    setFeedback(null);
    try {
      await importBackup(inspection, selectedStrategy);
      setConfirmImportOpen(false);
      setInspection(null);
    } catch (err) {
      setConfirmImportOpen(false);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Error al aplicar el respaldo. Se revirtieron los cambios.',
      });
    } finally {
      setImportBusy(false);
    }
  };

  const goToStep = (stepId: SettingsStepId) => {
    setActiveStep(stepId);
    snapDeckRef.current?.goToSlide(`settings-${stepId}`);
  };

  const handleSlideChange = (slideId: string) => {
    if (slideId === 'settings-general') setActiveStep('general');
    else if (slideId === 'settings-costs') setActiveStep('costs');
    else if (slideId === 'settings-backups') setActiveStep('backups');
    else if (slideId === 'settings-system') setActiveStep('system');
  };

  const currentStepIndex = SETTINGS_STEPS.findIndex((s) => s.id === activeStep);
  const currentStep = SETTINGS_STEPS[currentStepIndex] ?? SETTINGS_STEPS[0];

  const topSlot = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-display text-sm font-bold text-slate-900 sm:text-base">
            Ajustes · {settings.workshopName}
          </p>
          <button
            type="button"
            onClick={() => goToStep('system')}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              capabilities.isPro
                ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Crown className="h-3 w-3" aria-hidden="true" />
            <span>
              {capabilities.isPro ? 'PRO' : 'Plan FREE'}
            </span>
          </button>
          {hasUnsavedSettings && (
            <span className="inline-flex shrink-0 items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
              Sin guardar
            </span>
          )}
        </div>

        <nav
          aria-label="Secciones de configuración del taller"
          className="grid w-full grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:inline-flex sm:w-auto sm:items-center"
        >
          {SETTINGS_STEPS.map((step) => {
            const isActive = step.id === activeStep;
            const isCompleted = step.number < currentStep.number;
            const shortMobileWord =
              step.id === 'general'
                ? 'Taller'
                : step.id === 'costs'
                  ? 'Costos'
                  : step.id === 'backups'
                    ? 'Copias'
                    : 'Sistema';
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => goToStep(step.id)}
                aria-current={isActive ? 'step' : undefined}
                className={`inline-flex min-h-[36px] items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:gap-1.5 sm:px-2.5 ${
                  isActive
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    isActive
                      ? 'bg-white text-teal-800'
                      : isCompleted
                        ? 'bg-teal-100 text-teal-800'
                        : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {isCompleted ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : step.number}
                </span>
                <span className="sm:hidden">{shortMobileWord}</span>
                <span className="hidden sm:inline">{step.mobileLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {feedback && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900 sm:text-sm"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <p>{feedback.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="shrink-0 text-xs font-medium underline"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <SnapDeck
        ref={snapDeckRef}
        onSlideChange={handleSlideChange}
        ariaLabel="Configuración del taller"
        topSlot={topSlot}
      >
        {/* VISTA 1: IDENTIDAD, TARIFA Y METAS */}
        <SnapSlide id="settings-general" label="Taller y metas">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
            <form
              onSubmit={(e) => void handleSaveSettings(e)}
              className="flex flex-col justify-between space-y-5"
            >
              <div className="space-y-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">
                    Paso 1 de 4 · Configuración base
                  </p>
                  <h3 className="mt-1 font-display text-lg font-semibold text-slate-900">
                    Identidad, tarifa y metas de tejido
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
                    Valores guardados localmente en IndexedDB para todo el taller. Cambiar de moneda ajusta el formato y decimales sin alterar los importes ya guardados.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="workshopName"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Nombre del taller
                    </label>
                    <input
                      id="workshopName"
                      type="text"
                      required
                      value={workshopName}
                      onChange={(e) => setWorkshopName(e.target.value)}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="ownerDisplayName"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Tu nombre
                    </label>
                    <input
                      id="ownerDisplayName"
                      type="text"
                      required
                      value={ownerDisplayName}
                      onChange={(e) => setOwnerDisplayName(e.target.value)}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="workshopCurrency"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Moneda del taller
                    </label>
                    <select
                      id="workshopCurrency"
                      value={currency}
                      onChange={(e) => {
                        const next = e.target.value as WorkshopCurrencyCode;
                        setCurrency(next);
                        if (next !== 'USD') {
                          void syncDailyUsdRates();
                        }
                      }}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <optgroup label="Latinoamérica">
                        {CURRENCY_CATALOG.filter((c) => c.regionGroup === 'Latinoamérica').map(
                          (item) => (
                            <option key={item.code} value={item.code}>
                              {item.code} · {item.name} ({item.countries})
                            </option>
                          ),
                        )}
                      </optgroup>
                      <optgroup label="Dólar y Euro">
                        {CURRENCY_CATALOG.filter((c) => c.regionGroup === 'Dólar y Euro').map(
                          (item) => (
                            <option key={item.code} value={item.code}>
                              {item.code} · {item.name} ({item.countries})
                            </option>
                          ),
                        )}
                      </optgroup>
                    </select>
                    {currency !== 'USD' && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 tabular-nums">
                        {usdRatesStatus === 'loading' && !usdRates
                          ? 'Consultando tasa de referencia USD del día...'
                          : formatUsdRatePerUnit(currency, usdRates)
                            ? `Comparativa automática (1 vez/día): ${formatUsdRatePerUnit(currency, usdRates)} · ${
                                usdRatesStatus === 'offline_cached'
                                  ? `guardada el ${formatDateCO(usdRates?.fetchedAt)}`
                                  : `actualizada hoy (${formatDateCO(usdRates?.fetchedAt)})`
                              }`
                            : 'La comparativa en dólares (USD) se cargará automáticamente cuando haya conexión.'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="hourlyRateCOP"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Tarifa por hora de mano de obra ({currency})
                    </label>
                    <input
                      id="hourlyRateCOP"
                      type="number"
                      min={0}
                      step={getMoneyInputStep(currency)}
                      required
                      value={hourlyRateCOP}
                      onChange={(e) => setHourlyRateCOP(e.target.value)}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                    {currency !== 'USD' && Number(hourlyRateCOP) > 0 && (
                      <UsdEquiv
                        amount={Number(hourlyRateCOP)}
                        currency={currency}
                        prefix="Equivalente por hora: "
                        block
                        className="mt-1"
                      />
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="defaultMarkupPercent"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Recargo base sobre el costo — Markup (%)
                    </label>
                    <input
                      id="defaultMarkupPercent"
                      type="number"
                      min={0}
                      max={500}
                      step={1}
                      required
                      value={defaultMarkupPercent}
                      onChange={(e) => setDefaultMarkupPercent(e.target.value)}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="dailyGoalMinutes"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Meta diaria de tejido
                    </label>
                    <DurationInput
                      id="dailyGoalMinutes"
                      valueMinutes={Number(dailyGoalMinutes) || 0}
                      onChangeMinutes={(mins) => setDailyGoalMinutes(String(mins))}
                      minMinutes={15}
                      maxMinutes={1440}
                      ariaLabel="Meta diaria de tejido"
                      className="mt-1.5"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Total: {Number(dailyGoalMinutes) || 0} minutos al día ({formatDurationMinutes(Number(dailyGoalMinutes) || 0)})
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="weeklyGoalMinutes"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Meta semanal de tejido
                    </label>
                    <DurationInput
                      id="weeklyGoalMinutes"
                      valueMinutes={Number(weeklyGoalMinutes) || 0}
                      onChangeMinutes={(mins) => setWeeklyGoalMinutes(String(mins))}
                      minMinutes={30}
                      maxMinutes={10080}
                      ariaLabel="Meta semanal de tejido"
                      className="mt-1.5"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Total: {Number(weeklyGoalMinutes) || 0} minutos por semana ({formatDurationMinutes(Number(weeklyGoalMinutes) || 0)})
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingSettings ? 'Guardando...' : 'Guardar configuración'}
                </button>
                <button
                  type="button"
                  onClick={() => goToStep('costs')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800"
                >
                  <span>Siguiente: Costos y merma</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </form>
          </div>
        </SnapSlide>

        {/* VISTA 2: COSTOS FIJOS (%), IMPREVISTOS Y FÓRMULA EN VIVO */}
        <SnapSlide id="settings-costs" label="Costos y fórmula">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
            <form
              onSubmit={(e) => void handleSaveSettings(e)}
              className="flex flex-col justify-between space-y-5"
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">
                      Paso 2 de 4 · Estructura de costos
                    </p>
                    <h3 className="mt-1 font-display text-lg font-semibold text-slate-900">
                      Costos fijos, imprevistos y fórmula
                    </h3>
                  </div>
                  <span className="inline-flex items-center rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 font-mono text-xs font-semibold text-teal-800 tabular-nums">
                    Recargo indirecto: {(totalFixedPercent + wastePct).toFixed(1)}%
                  </span>
                </div>

                {/* Costos fijos: Arriendo, Electricidad, Internet */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-800">
                      Costos fijos del espacio y servicios (%)
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowFixedCostGuide((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
                    >
                      <HelpCircle className="h-4 w-4" aria-hidden="true" />
                      <span>{showFixedCostGuide ? 'Ocultar ejemplo' : 'Ver ejemplo guía'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 items-stretch gap-2 sm:gap-3">
                    <div className="flex flex-col justify-between">
                      <label
                        htmlFor="rentCostPercent"
                        className="block text-[11px] font-semibold leading-snug text-slate-700 sm:text-xs"
                      >
                        Arriendo (%)
                      </label>
                      <input
                        id="rentCostPercent"
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        required
                        value={rentCostPercent}
                        onChange={(e) => setRentCostPercent(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none sm:px-3"
                      />
                    </div>

                    <div className="flex flex-col justify-between">
                      <label
                        htmlFor="electricityCostPercent"
                        className="block text-[11px] font-semibold leading-snug text-slate-700 sm:text-xs"
                      >
                        Electricidad (%)
                      </label>
                      <input
                        id="electricityCostPercent"
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        required
                        value={electricityCostPercent}
                        onChange={(e) => setElectricityCostPercent(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none sm:px-3"
                      />
                    </div>

                    <div className="flex flex-col justify-between">
                      <label
                        htmlFor="internetCostPercent"
                        className="block text-[11px] font-semibold leading-snug text-slate-700 sm:text-xs"
                      >
                        Internet (%)
                      </label>
                      <input
                        id="internetCostPercent"
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        required
                        value={internetCostPercent}
                        onChange={(e) => setInternetCostPercent(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none sm:px-3"
                      />
                    </div>
                  </div>

                  {showFixedCostGuide ? (
                    <div className="rounded-lg border border-teal-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
                      <p className="font-semibold text-teal-900">
                        Cómo calcular tu porcentaje de costo fijo:
                      </p>
                      <p className="mt-1">
                        Divide la parte mensual del gasto que usa tu taller entre tus ventas o producción del mes.
                        <br />
                        <strong className="text-slate-900">Ejemplo:</strong> si el arriendo es{' '}
                        <span className="font-mono">$800.000</span>, el taller ocupa un 20% (
                        <span className="font-mono">$160.000/mes</span>) y produces{' '}
                        <span className="font-mono">$2.000.000/mes</span> →{' '}
                        <span className="font-mono font-semibold text-teal-800">$160.000 ÷ $2.000.000 = 8%</span>.
                        Rangos usuales en casa: Arriendo 0%–8%, Electricidad 1%–4%, Internet 1%–3%.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Ej. taller en casa: Arriendo 0%–8% · Electricidad 1%–4% · Internet 1%–3% (Suma: {totalFixedPercent.toFixed(1)}%).
                    </p>
                  )}
                </div>

                {/* Pérdidas, imprevistos y desperdicios */}
                <div className="rounded-xl border border-slate-200 bg-amber-50/40 p-3.5 sm:p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-center">
                    <div className="sm:col-span-5">
                      <label
                        htmlFor="wasteAndContingencyPercent"
                        className="block text-xs font-semibold text-slate-800"
                      >
                        Imprevistos y desperdicios (%)
                      </label>
                      <input
                        id="wasteAndContingencyPercent"
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        required
                        value={wasteAndContingencyPercent}
                        onChange={(e) => setWasteAndContingencyPercent(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-slate-700 sm:col-span-7">
                      <strong className="text-amber-900">Asume pequeñas pérdidas:</strong>{' '}
                      puntas de hilo, nudos o ajustes menores. Ej.: un{' '}
                      <span className="font-mono font-semibold">5%</span> sobre{' '}
                      <span className="font-mono">
                        {formatCOP(formulaPreview.directBaseCostCOP, currency)}
                      </span>{' '}
                      reserva{' '}
                      <span className="font-mono font-semibold text-amber-900">
                        {formatCOP(
                          roundCurrencyAmount(formulaPreview.directBaseCostCOP * 0.05, currency),
                          currency,
                        )}
                      </span>{' '}
                      (rango típico: 3%–8%).
                    </p>
                  </div>
                </div>

                {/* Vista previa en vivo compacta */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
                  <p className="text-xs font-semibold text-slate-800">
                    Simulación en vivo ({currency}: 3 h tejido +{' '}
                    {formatCOP(selectedCurrencySpec.sampleMaterials, currency)} mat. +{' '}
                    {formatCOP(selectedCurrencySpec.samplePackaging, currency)} empaque)
                  </p>
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 border-b border-slate-100 pb-2.5 text-xs sm:grid-cols-4">
                    <div>
                      <p className="text-slate-500">Base directa</p>
                      <p className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCOP(formulaPreview.directBaseCostCOP, currency)}
                      </p>
                      <UsdEquiv amount={formulaPreview.directBaseCostCOP} currency={currency} block />
                    </div>
                    <div>
                      <p className="text-slate-500">Fijos ({totalFixedPercent.toFixed(1)}%)</p>
                      <p className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCOP(formulaPreview.fixedServicesIndirectCOP, currency)}
                      </p>
                      <UsdEquiv amount={formulaPreview.fixedServicesIndirectCOP} currency={currency} block />
                    </div>
                    <div>
                      <p className="text-slate-500">Imprev. ({wastePct.toFixed(1)}%)</p>
                      <p className="font-mono font-semibold text-amber-800 tabular-nums">
                        {formatCOP(formulaPreview.wasteContingencyCOP, currency)}
                      </p>
                      <UsdEquiv amount={formulaPreview.wasteContingencyCOP} currency={currency} block />
                    </div>
                    <div>
                      <p className="text-slate-500">Costo total</p>
                      <p className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCOP(formulaPreview.totalProductionCostCOP, currency)}
                      </p>
                      <UsdEquiv amount={formulaPreview.totalProductionCostCOP} currency={currency} block />
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2.5 text-xs">
                    <div>
                      <p className="text-slate-500">Precio ({formulaPreview.markupPercent}%)</p>
                      <p className="font-mono font-bold text-teal-800 tabular-nums">
                        {formatCOP(formulaPreview.suggestedPriceCOP, currency)}
                      </p>
                      <UsdEquiv amount={formulaPreview.suggestedPriceCOP} currency={currency} block />
                    </div>
                    <div>
                      <p className="text-slate-500">Ganancia neta</p>
                      <p className="font-mono font-bold text-emerald-700 tabular-nums">
                        {formatCOP(formulaPreview.expectedProfitCOP, currency)}
                      </p>
                      <UsdEquiv amount={formulaPreview.expectedProfitCOP} currency={currency} block />
                    </div>
                    <div>
                      <p className="text-slate-500">Margen s/ venta</p>
                      <p className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formulaPreview.grossMarginPercent}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => goToStep('general')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>Anterior</span>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingSettings ? 'Guardando...' : 'Guardar configuración'}
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStep('backups')}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800"
                  >
                    <span>Respaldos JSON</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </SnapSlide>

        {/* VISTA 3: RESPALDO Y RESTAURACIÓN LOCAL */}
        <SnapSlide id="settings-backups" label="Respaldos JSON">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
            <div className="flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">
                    Paso 3 de 4 · Seguridad de tus datos
                  </p>
                  <h3 className="mt-1 font-display text-lg font-semibold text-slate-900">
                    Respaldo y restauración local (.json)
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
                    Exporta o restaura tu base local con validación de versión, detección de duplicados e integridad referencial. El respaldo JSON local es gratuito en todos los planes; el respaldo automático en la nube formará parte de futuras fases PRO.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Exportar */}
                  <div className="flex flex-col justify-between rounded-xl border border-slate-200 p-4">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        Exportar respaldo (.json)
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Último respaldo:{' '}
                        {settings.lastBackupExportAt
                          ? formatDateTimeCO(settings.lastBackupExportAt)
                          : 'Aún sin exportar'}
                      </p>

                      <label className="mt-3 flex min-h-[38px] cursor-pointer items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={includeDemoInExport}
                          onChange={(e) => setIncludeDemoInExport(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                        />
                        <span>Incluir registros de ejemplo (isDemo)</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      disabled={exportBusy}
                      onClick={() => void handleExportBackup()}
                      className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {exportBusy ? 'Generando archivo...' : 'Descargar respaldo JSON'}
                      </span>
                    </button>
                  </div>

                  {/* Importar */}
                  <div className="flex flex-col justify-between rounded-xl border border-slate-200 p-4">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        Importar y restaurar respaldo
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Inspecciona el archivo antes de confirmar cualquier escritura en IndexedDB.
                      </p>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => void handleBackupFileSelected(e)}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
                    >
                      <Upload className="h-4 w-4 text-teal-700" aria-hidden="true" />
                      <span>Seleccionar archivo (.json)</span>
                    </button>
                  </div>
                </div>

                {/* Panel de inspección previa del respaldo */}
                {inspection && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    {!inspection.isValid ? (
                      <div>
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-rose-800">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>Respaldo rechazado por validación</span>
                        </h4>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-700">
                          {inspection.errors.map((errMsg) => (
                            <li key={errMsg}>{errMsg}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => setInspection(null)}
                          className="mt-3 inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                        >
                          Cerrar aviso
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <FileCheck2 className="h-4 w-4 text-emerald-700" />
                            <span>Archivo válido — Revisión previa</span>
                          </h4>
                          <p className="mt-0.5 text-xs text-slate-600">
                            Esquema v{inspection.envelope?.schemaVersion} · Exportado:{' '}
                            {formatDateTimeCO(inspection.envelope?.exportedAt)}
                          </p>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-center text-xs">
                          <div>
                            <p className="text-slate-500">En archivo</p>
                            <p className="font-mono text-base font-semibold text-slate-900 tabular-nums">
                              {inspection.totalRecordsInFile}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500">Nuevos</p>
                            <p className="font-mono text-base font-semibold text-emerald-700 tabular-nums">
                              {inspection.newRecordsCount}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500">Duplicados</p>
                            <p className="font-mono text-base font-semibold text-amber-700 tabular-nums">
                              {inspection.duplicateRecordsCount}
                            </p>
                          </div>
                        </div>

                        {inspection.breakdownByStore.length > 0 && (
                          <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
                            {inspection.breakdownByStore.map((row) => (
                              <div
                                key={row.storeName}
                                className="flex items-center justify-between border-b border-slate-100 py-1 last:border-b-0"
                              >
                                <span className="font-medium text-slate-700">
                                  {STORE_LABELS[row.storeName] ?? row.storeName}
                                </span>
                                <span className="font-mono text-slate-600 tabular-nums">
                                  {row.newCount} nuevos · {row.duplicateCount} dup.
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {inspection.warnings.length > 0 && (
                          <ul className="space-y-1 text-xs text-amber-800">
                            {inspection.warnings.map((w) => (
                              <li key={w}>• {w}</li>
                            ))}
                          </ul>
                        )}

                        <fieldset className="space-y-1.5">
                          <legend className="text-xs font-semibold text-slate-800">
                            Estrategia de restauración:
                          </legend>
                          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                            <input
                              type="radio"
                              name="importStrategy"
                              checked={selectedStrategy === 'append_new'}
                              onChange={() => setSelectedStrategy('append_new')}
                              className="mt-0.5 text-teal-700"
                            />
                            <span>
                              <strong className="text-slate-900">
                                Solo agregar nuevos (Recomendado)
                              </strong>{' '}
                              — Omite {inspection.duplicateRecordsCount} duplicados.
                            </span>
                          </label>

                          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                            <input
                              type="radio"
                              name="importStrategy"
                              checked={selectedStrategy === 'merge_overwrite'}
                              onChange={() => setSelectedStrategy('merge_overwrite')}
                              className="mt-0.5 text-teal-700"
                            />
                            <span>
                              <strong className="text-slate-900">
                                Fusionar y actualizar duplicados
                              </strong>{' '}
                              — Actualiza IDs coincidentes.
                            </span>
                          </label>

                          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-rose-200 bg-white p-2.5 text-xs">
                            <input
                              type="radio"
                              name="importStrategy"
                              checked={selectedStrategy === 'replace_all'}
                              onChange={() => setSelectedStrategy('replace_all')}
                              className="mt-0.5 text-rose-700"
                            />
                            <span>
                              <strong className="text-rose-800">
                                Reemplazar todo el taller actual
                              </strong>{' '}
                              — Restaura exactamente este archivo.
                            </span>
                          </label>
                        </fieldset>

                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setInspection(null)}
                            className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmImportOpen(true)}
                            className="inline-flex min-h-[40px] items-center rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                          >
                            Continuar con la restauración
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => goToStep('costs')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>Anterior</span>
                </button>
                <button
                  type="button"
                  onClick={() => goToStep('system')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800"
                >
                  <span>Siguiente: Ejemplos y PWA</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </SnapSlide>

        {/* VISTA 4: DATOS DE DEMOSTRACIÓN Y ESTADO PWA / BASE LOCAL */}
        <SnapSlide id="settings-system" label="Ejemplos y sistema">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
            <div className="flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">
                    Paso 4 de 4 · Pruebas y dispositivo
                  </p>
                  <h3 className="mt-1 font-display text-lg font-semibold text-slate-900">
                    Ejemplos del taller y aplicación PWA
                  </h3>
                </div>

                {/* Datos demo */}
                <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
                  <div className="flex items-start gap-2.5">
                    <Sparkles
                      className="mt-0.5 h-5 w-5 shrink-0 text-teal-700"
                      aria-hidden="true"
                    />
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        Datos de demostración aislados
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        Carga ejemplos prácticos (Mariposa de crochet, Amigurumi personalizado e Hilo de Algodón Blanco de 500 g). Se etiquetan como &ldquo;Ejemplo&rdquo; y pueden eliminarse de forma segura sin afectar tus datos reales.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      disabled={demoBusy}
                      onClick={() => void handleLoadDemo()}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
                    >
                      {demoBusy
                        ? 'Procesando...'
                        : stats.hasDemoData
                          ? 'Restablecer ejemplos del taller'
                          : 'Cargar ejemplos del taller'}
                    </button>

                    {stats.hasDemoData && (
                      <button
                        type="button"
                        disabled={demoBusy}
                        onClick={() => setConfirmPurgeDemoOpen(true)}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span>Eliminar datos de ejemplo</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Estado técnico IndexedDB y PWA */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <Database
                        className="mt-0.5 h-5 w-5 shrink-0 text-slate-500"
                        aria-hidden="true"
                      />
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">
                          Almacenamiento local y PWA instalable
                        </h4>
                        <p className="mt-1 text-xs text-slate-600">
                          IndexedDB esquema v{schemaMeta?.currentVersion ?? 1} · Red:{' '}
                          {isOnline ? 'En línea' : 'Sin conexión (Offline)'} · Migración:{' '}
                          {schemaMeta?.lastMigratedAt
                            ? formatDateTimeCO(schemaMeta.lastMigratedAt)
                            : 'Inicial'}
                        </p>
                      </div>
                    </div>
                    <PWAInstallButton />
                  </div>
                </div>

                {/* Tu Plan Actual (FREE / PRO) e identificadores técnicos */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Crown
                        className={`mt-0.5 h-5 w-5 shrink-0 ${
                          capabilities.isPro ? 'text-amber-600' : 'text-teal-700'
                        }`}
                        aria-hidden="true"
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">
                            Tu Plan Actual
                          </h4>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                              capabilities.isPro
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-teal-50 text-teal-800 border border-teal-200'
                            }`}
                          >
                            {effectiveTier === 'pro_annual'
                              ? 'PRO Anual'
                              : effectiveTier === 'pro_monthly'
                                ? 'PRO Mensual'
                                : 'FREE'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          {capabilities.isPro
                            ? 'Acceso completo a proyectos ilimitados, cotizaciones ilimitadas, pagos multi-cuota flexibles, estados de cuenta, reservas de stock, recordatorios avanzados y dependencias de materiales.'
                            : 'Tu taller opera completo en el plan FREE: hasta 5 proyectos reales activos, 5 cotizaciones reales guardadas, planes de hasta 2 cuotas libres, caja financiera, inventario Kardex y respaldos JSON locales ilimitados.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs sm:grid-cols-2">
                    <div className="flex items-start gap-2">
                      <Fingerprint
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-700">
                          ID persistente del taller (workshopInstanceId)
                        </p>
                        <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">
                          {settings.workshopInstanceId}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Fingerprint
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-700">
                          ID de esta instalación (installationId)
                        </p>
                        <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">
                          {installationId}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Simulador efímero exclusivo de desarrollo */}
                {import.meta.env.DEV && (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4 sm:p-5 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <FlaskConical
                        className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                        aria-hidden="true"
                      />
                      <div>
                        <h4 className="text-sm font-semibold text-amber-950">
                          Simulador de desarrollo (solo en memoria, sin persistencia)
                        </h4>
                        <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
                          Disponible únicamente en modo desarrollo (VITE DEV). Permite probar límites FREE y capacidades PRO en memoria sin modificar IndexedDB ni incluir este panel en producción.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setDevTierOverride(null)}
                        className={`inline-flex min-h-[38px] items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          devTierOverride === null
                            ? 'bg-slate-900 text-white'
                            : 'border border-amber-300 bg-white text-slate-700 hover:bg-amber-100/60'
                        }`}
                      >
                        Simular FREE (Por defecto)
                      </button>
                      <button
                        type="button"
                        onClick={() => setDevTierOverride('pro_monthly')}
                        className={`inline-flex min-h-[38px] items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          devTierOverride === 'pro_monthly'
                            ? 'bg-amber-700 text-white'
                            : 'border border-amber-300 bg-white text-slate-700 hover:bg-amber-100/60'
                        }`}
                      >
                        Simular PRO Mensual
                      </button>
                      <button
                        type="button"
                        onClick={() => setDevTierOverride('pro_annual')}
                        className={`inline-flex min-h-[38px] items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          devTierOverride === 'pro_annual'
                            ? 'bg-amber-700 text-white'
                            : 'border border-amber-300 bg-white text-slate-700 hover:bg-amber-100/60'
                        }`}
                      >
                        Simular PRO Anual
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => goToStep('backups')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>Anterior</span>
                </button>
                <button
                  type="button"
                  onClick={() => goToStep('general')}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Volver al inicio
                </button>
              </div>
            </div>
          </div>
        </SnapSlide>
      </SnapDeck>

      {/* Modal de confirmación para eliminar ejemplos */}
      <ConfirmModal
        isOpen={confirmPurgeDemoOpen}
        title="Eliminar datos de ejemplo"
        description="Se eliminarán únicamente los registros marcados como ejemplo (isDemo) en orden relacional seguro. Tus proyectos, materiales, configuraciones y respaldos reales permanecerán intactos."
        confirmLabel="Sí, eliminar ejemplos"
        variant="danger"
        isBusy={demoBusy}
        onConfirm={() => void handleConfirmPurgeDemo()}
        onCancel={() => setConfirmPurgeDemoOpen(false)}
      />

      {/* Modal de confirmación para importar respaldo */}
      <ConfirmModal
        isOpen={confirmImportOpen}
        title={
          selectedStrategy === 'replace_all'
            ? 'Confirmar reemplazo total del taller'
            : 'Confirmar importación de respaldo'
        }
        description={
          selectedStrategy === 'replace_all'
            ? 'Esta acción reemplazará todos los datos actuales de este dispositivo por el archivo seleccionado. Si tienes información reciente no respaldada, descarga primero un respaldo antes de continuar.'
            : selectedStrategy === 'merge_overwrite'
              ? `Se agregarán ${inspection?.newRecordsCount ?? 0} registros nuevos y se actualizarán ${inspection?.duplicateRecordsCount ?? 0} registros existentes con el mismo identificador.`
              : `Se agregarán únicamente ${inspection?.newRecordsCount ?? 0} registros nuevos. Se omitirán ${inspection?.duplicateRecordsCount ?? 0} duplicados sin sobrescribir tus datos actuales.`
        }
        confirmLabel="Confirmar importación"
        variant={selectedStrategy === 'replace_all' ? 'danger' : 'default'}
        isBusy={importBusy}
        onConfirm={() => void handleExecuteImport()}
        onCancel={() => setConfirmImportOpen(false)}
      />
    </>
  );
};
