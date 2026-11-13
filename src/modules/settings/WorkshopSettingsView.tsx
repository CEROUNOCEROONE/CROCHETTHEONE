import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  ShieldCheck,
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
  formatCOP,
  formatDateTimeCO,
  formatDurationMinutes,
} from '@/src/domain/services/formatters.ts';
import { calculateQuoteSummary } from '@/src/domain/services/quoteMath.ts';
import { PWAInstallButton } from '@/src/pwa/PWAInstallButton.tsx';
import { useOnlineStatus } from '@/src/pwa/useOnlineStatus.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';

const STORE_LABELS: Record<string, string> = {
  workshop_settings: 'Configuración',
  clients: 'Clientes',
  materials: 'Materiales',
  material_variants: 'Colores / Variantes',
  projects: 'Proyectos',
  project_components: 'Componentes',
  work_sessions: 'Sesiones de tiempo',
  inventory_reservations: 'Reservas',
  inventory_movements: 'Movimientos Kardex',
  payment_plans: 'Planes de pago',
  payment_installments: 'Cuotas',
  financial_transactions: 'Pagos recibidos',
};

export const WorkshopSettingsView: React.FC = () => {
  const {
    settings,
    stats,
    schemaMeta,
    updateSettings,
    loadDemoData,
    purgeDemoData,
    exportBackup,
    inspectBackup,
    importBackup,
  } = useWorkshopData();
  const isOnline = useOnlineStatus();

  const [workshopName, setWorkshopName] = useState(settings.workshopName);
  const [ownerDisplayName, setOwnerDisplayName] = useState(settings.ownerDisplayName);
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

  const [savingSettings, setSavingSettings] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
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
    setHourlyRateCOP(String(settings.hourlyRateCOP));
    setDailyGoalMinutes(String(settings.dailyGoalMinutes));
    setWeeklyGoalMinutes(String(settings.weeklyGoalMinutes));
    setDefaultMarkupPercent(String(settings.defaultMarkupPercent));
  }, [settings]);

  // Simulación transparente de fórmula Markup + Margen real sobre venta (ejemplo base $100.000 COP)
  const sampleMarkup = Number(defaultMarkupPercent) || 0;
  const formulaPreview = calculateQuoteSummary({
    materialsTotalCOP: 40000,
    effectiveMinutes: 180,
    hourlyRateCOP: Number(hourlyRateCOP) || 0,
    indirectCostsCOP: 5000,
    packagingCostCOP: 5000,
    shippingOrOtherCOP: 0,
    markupPercent: sampleMarkup,
  });

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setFeedback(null);
    try {
      await updateSettings({
        workshopName: workshopName.trim() || BRAND_CONFIG.defaultWorkshopName,
        ownerDisplayName: ownerDisplayName.trim() || 'Artesana',
        hourlyRateCOP: Math.max(0, Number(hourlyRateCOP) || 0),
        dailyGoalMinutes: Math.max(15, Number(dailyGoalMinutes) || 60),
        weeklyGoalMinutes: Math.max(30, Number(weeklyGoalMinutes) || 300),
        defaultMarkupPercent: Math.max(0, Math.min(500, Number(defaultMarkupPercent) || 0)),
      });
      setFeedback({
        type: 'success',
        message: 'Configuración del taller guardada correctamente en IndexedDB.',
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
      const { insertedCount } = await loadDemoData();
      setFeedback({
        type: 'success',
        message: `Se cargaron ${insertedCount} registros de ejemplo identificados como "Ejemplo" sin alterar tus datos reales.`,
      });
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
      const { deletedCount, preservedRealCount } = await purgeDemoData();
      setConfirmPurgeDemoOpen(false);
      setFeedback({
        type: 'success',
        message: `Se eliminaron ${deletedCount} registros de ejemplo. Se conservaron intactos ${preservedRealCount} registros reales.`,
      });
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

      setFeedback({
        type: 'success',
        message: 'Respaldo JSON exportado y descargado correctamente.',
      });
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
      const outcome = await importBackup(inspection, selectedStrategy);
      setConfirmImportOpen(false);
      setInspection(null);
      setFeedback({
        type: 'success',
        message: `Restauración completada: ${outcome.insertedCount} insertados, ${outcome.updatedCount} actualizados y ${outcome.skippedCount} omitidos.`,
      });
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

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          ) : (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
          )}
          <p>{feedback.message}</p>
        </div>
      )}

      {/* 1. Configuración general del taller */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Configuración del taller
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Estos valores se almacenan localmente en IndexedDB y alimentan las metas del
          panel y los cálculos del cotizador en pesos colombianos (COP).
        </p>

        <form onSubmit={(e) => void handleSaveSettings(e)} className="mt-6 space-y-5">
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
                htmlFor="hourlyRateCOP"
                className="block text-xs font-semibold text-slate-700"
              >
                Tarifa por hora de mano de obra (COP)
              </label>
              <input
                id="hourlyRateCOP"
                type="number"
                min={0}
                step={500}
                required
                value={hourlyRateCOP}
                onChange={(e) => setHourlyRateCOP(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
              />
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
                Meta diaria de tejido (minutos)
              </label>
              <input
                id="dailyGoalMinutes"
                type="number"
                min={15}
                max={1440}
                required
                value={dailyGoalMinutes}
                onChange={(e) => setDailyGoalMinutes(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">
                Equivale a {formatDurationMinutes(Number(dailyGoalMinutes) || 0)} al día
              </p>
            </div>

            <div>
              <label
                htmlFor="weeklyGoalMinutes"
                className="block text-xs font-semibold text-slate-700"
              >
                Meta semanal de tejido (minutos)
              </label>
              <input
                id="weeklyGoalMinutes"
                type="number"
                min={30}
                max={10080}
                required
                value={weeklyGoalMinutes}
                onChange={(e) => setWeeklyGoalMinutes(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">
                Equivale a {formatDurationMinutes(Number(weeklyGoalMinutes) || 0)} por
                semana
              </p>
            </div>
          </div>

          {/* Vista previa verificable de la fórmula Markup + Margen Real */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-800">
              Verificación de fórmula del cotizador (simulación con 3 h de tejido +
              $50.000 COP de insumos/empaque)
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <p className="text-slate-500">Costo total</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                  {formatCOP(formulaPreview.totalProductionCostCOP)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">
                  Precio ({formulaPreview.markupPercent}% recargo)
                </p>
                <p className="mt-0.5 font-mono font-semibold text-teal-800 tabular-nums">
                  {formatCOP(formulaPreview.suggestedPriceCOP)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Ganancia neta</p>
                <p className="mt-0.5 font-mono font-semibold text-emerald-700 tabular-nums">
                  {formatCOP(formulaPreview.expectedProfitCOP)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Margen real s/ venta</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                  {formulaPreview.grossMarginPercent}%
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
            >
              {savingSettings ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </div>
        </form>
      </section>

      {/* 2. Respaldo de información: Exportación e Importación Segura */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Respaldo y restauración local
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Exporta una copia en formato JSON de tu base de datos local o restaura un
              respaldo previo con validación de versión, detección de duplicados e
              integridad referencial antes de escribir.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 md:grid-cols-2">
          {/* Exportar */}
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Exportar respaldo (.json)
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Última exportación:{' '}
              {settings.lastBackupExportAt
                ? formatDateTimeCO(settings.lastBackupExportAt)
                : 'Aún no se ha exportado'}
            </p>

            <label className="mt-4 flex min-h-[40px] cursor-pointer items-center gap-2.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={includeDemoInExport}
                onChange={(e) => setIncludeDemoInExport(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
              />
              <span>Incluir registros de ejemplo (isDemo) en el archivo</span>
            </label>

            <button
              type="button"
              disabled={exportBusy}
              onClick={() => void handleExportBackup()}
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>{exportBusy ? 'Generando archivo...' : 'Descargar respaldo JSON'}</span>
            </button>
          </div>

          {/* Importar */}
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Importar y restaurar respaldo
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Se validará el archivo completo antes de solicitar confirmación y modificar
              IndexedDB.
            </p>

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
              className="mt-10 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Upload className="h-4 w-4 text-teal-700" aria-hidden="true" />
              <span>Seleccionar archivo de respaldo (.json)</span>
            </button>
          </div>
        </div>

        {/* Panel de inspección previa del respaldo */}
        {inspection && (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            {!inspection.isValid ? (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Respaldo rechazado por validación</span>
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-700">
                  {inspection.errors.map((errMsg) => (
                    <li key={errMsg}>{errMsg}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setInspection(null)}
                  className="mt-4 inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                >
                  Cerrar aviso
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <FileCheck2 className="h-4 w-4 text-emerald-700" />
                      <span>Archivo válido — Revisión previa a la importación</span>
                    </h3>
                    <p className="mt-1 text-xs text-slate-600">
                      Versión esquema: v{inspection.envelope?.schemaVersion} · Exportado:{' '}
                      {formatDateTimeCO(inspection.envelope?.exportedAt)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-white p-3 text-center text-xs">
                  <div>
                    <p className="text-slate-500">En archivo</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {inspection.totalRecordsInFile}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Nuevos</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-emerald-700 tabular-nums">
                      {inspection.newRecordsCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Duplicados</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-amber-700 tabular-nums">
                      {inspection.duplicateRecordsCount}
                    </p>
                  </div>
                </div>

                {inspection.breakdownByStore.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                    {inspection.breakdownByStore.map((row) => (
                      <div
                        key={row.storeName}
                        className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-b-0"
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

                {/* Selector de estrategia segura */}
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-slate-800">
                    Elige cómo aplicar los registros:
                  </legend>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                    <input
                      type="radio"
                      name="importStrategy"
                      checked={selectedStrategy === 'append_new'}
                      onChange={() => setSelectedStrategy('append_new')}
                      className="mt-0.5 text-teal-700"
                    />
                    <span>
                      <strong className="block text-slate-900">
                        Solo agregar registros nuevos (Recomendado)
                      </strong>
                      Omitir los {inspection.duplicateRecordsCount} registros duplicados. No
                      sobrescribe información actual.
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                    <input
                      type="radio"
                      name="importStrategy"
                      checked={selectedStrategy === 'merge_overwrite'}
                      onChange={() => setSelectedStrategy('merge_overwrite')}
                      className="mt-0.5 text-teal-700"
                    />
                    <span>
                      <strong className="block text-slate-900">
                        Fusionar y actualizar duplicados
                      </strong>
                      Inserta los nuevos y actualiza los registros cuyo ID coincida con el
                      respaldo.
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-rose-200 bg-white p-3 text-xs">
                    <input
                      type="radio"
                      name="importStrategy"
                      checked={selectedStrategy === 'replace_all'}
                      onChange={() => setSelectedStrategy('replace_all')}
                      className="mt-0.5 text-rose-700"
                    />
                    <span>
                      <strong className="block text-rose-800">
                        Reemplazar todo el taller actual
                      </strong>
                      Elimina los datos actuales en este dispositivo y restaura exactamente
                      el archivo seleccionado.
                    </span>
                  </label>
                </fieldset>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setInspection(null)}
                    className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmImportOpen(true)}
                    className="inline-flex min-h-[44px] items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
                  >
                    Continuar con la restauración
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. Datos de demostración aislados (isDemo: true) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Datos de demostración del taller
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Carga ejemplos prácticos (Mariposa de crochet, Amigurumi personalizado por
          $180.000 COP e Hilo de Algodón Blanco de 500 g). Todos se etiquetan como
          &ldquo;Ejemplo&rdquo; y pueden eliminarse de forma transaccional sin afectar tus
          registros reales.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
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
      </section>

      {/* 4. Estado técnico de base local y PWA */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Almacenamiento local y aplicación instalable
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                IndexedDB esquema v{schemaMeta?.currentVersion ?? 1} · Estado de red:{' '}
                {isOnline ? 'En línea' : 'Sin conexión (Offline)'} · Actualizado:{' '}
                {schemaMeta?.lastMigratedAt
                  ? formatDateTimeCO(schemaMeta.lastMigratedAt)
                  : 'Inicial'}
              </p>
            </div>
          </div>
          <PWAInstallButton />
        </div>
      </section>

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
    </div>
  );
};
