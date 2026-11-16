import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  FolderKanban,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type { Quote, QuoteStatus } from '@/src/domain/models/index.ts';
import {
  formatCOP,
  formatDateCO,
  formatDurationMinutes,
} from '@/src/domain/services/formatters.ts';
import {
  formatUnitQuantity,
  MEASUREMENT_UNIT_OPTIONS,
} from '@/src/domain/services/inventoryService.ts';
import { calculateQuoteSummary } from '@/src/domain/services/quoteMath.ts';
import {
  buildWorkshopDefaultPercents,
  calculateAgreedPriceMetrics,
  extractProjectQuotePrefill,
  formatQuoteClientSummaryText,
  QUOTE_STATUS_META,
  QUOTE_STATUS_OPTIONS,
} from '@/src/domain/services/quoteService.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { DurationInput } from '@/src/shared/components/DurationInput.tsx';
import { EmptyState } from '@/src/shared/components/EmptyState.tsx';
import {
  SnapDeck,
  SnapSlide,
  type SnapDeckHandle,
} from '@/src/shared/components/SnapDeck.tsx';
import { StatusBadge } from '@/src/shared/components/StatusBadge.tsx';
import {
  chunkIntoPages,
  pickPageSize,
  useViewportProfile,
} from '@/src/shared/hooks/useViewportPageSize.ts';

interface QuotingViewProps {
  readonly initialProjectId?: string | null;
  onClearInitialProject?(): void;
  onNavigateToSettings?(): void;
  onOpenProject?(projectId: string): void;
}

type QuotingTab = 'simulator' | 'history';
type HistoryStatusFilter = 'all' | QuoteStatus;

interface MaterialLineDraft {
  readonly localKey: string;
  readonly variantId: string | null;
  readonly label: string;
  readonly colorName: string;
  readonly unit: string;
  readonly quantity: string;
  readonly unitCostCOP: string;
}

function makeLocalKey(): string {
  return `ql_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseNonNegativeFloat(raw: string): number {
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseNonNegativeInt(raw: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function roundUpToNearestThousand(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.ceil(amount / 1000) * 1000;
}

const MARKUP_PRESETS = [20, 30, 40, 50];

export const QuotingView: React.FC<QuotingViewProps> = ({
  initialProjectId = null,
  onClearInitialProject,
  onNavigateToSettings,
  onOpenProject,
}) => {
  const {
    settings,
    projects,
    components,
    clients,
    materials,
    variants,
    reservations,
    movements,
    quotes,
    stats,
    createQuote,
    updateQuote,
    deleteQuote,
    applyQuotePriceToProject,
  } = useWorkshopData();

  const snapDeckRef = useRef<SnapDeckHandle | null>(null);
  const viewportProfile = useViewportProfile();

  const [activeTab, setActiveTab] = useState<QuotingTab>('simulator');

  // Estado del editor / simulador
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editingIsDemo, setEditingIsDemo] = useState<boolean | null>(null);
  const [title, setTitle] = useState('Nueva cotización de taller');
  const [projectId, setProjectId] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [status, setStatus] = useState<QuoteStatus>('draft');
  const [effectiveMinutes, setEffectiveMinutes] = useState<number>(120);
  const [hourlyRateRaw, setHourlyRateRaw] = useState<string>(
    String(settings.hourlyRateCOP),
  );
  const [rentPercentRaw, setRentPercentRaw] = useState<string>(
    String(settings.rentCostPercent),
  );
  const [electricityPercentRaw, setElectricityPercentRaw] = useState<string>(
    String(settings.electricityCostPercent),
  );
  const [internetPercentRaw, setInternetPercentRaw] = useState<string>(
    String(settings.internetCostPercent),
  );
  const [wastePercentRaw, setWastePercentRaw] = useState<string>(
    String(settings.wasteAndContingencyPercent),
  );
  const [manualIndirectRaw, setManualIndirectRaw] = useState<string>('0');
  const [packagingRaw, setPackagingRaw] = useState<string>('0');
  const [shippingRaw, setShippingRaw] = useState<string>('0');
  const [markupPercentRaw, setMarkupPercentRaw] = useState<string>(
    String(settings.defaultMarkupPercent),
  );
  const [finalAgreedPriceRaw, setFinalAgreedPriceRaw] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [materialLines, setMaterialLines] = useState<MaterialLineDraft[]>([]);
  const [showAdvancedIndirects, setShowAdvancedIndirects] = useState(false);

  // Selector rápido de catálogo
  const [pickerVariantId, setPickerVariantId] = useState<string>('');
  const [pickerQuantityRaw, setPickerQuantityRaw] = useState<string>('100');

  // Mensajes de estado y acciones
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'error';
    message: string;
  } | null>(null);
  const [sharePreviewText, setSharePreviewText] = useState<string | null>(null);
  const [copiedJustNow, setCopiedJustNow] = useState(false);

  // Historial y filtros
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] =
    useState<HistoryStatusFilter>('all');
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null);

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients],
  );
  const materialById = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );
  const variantById = useMemo(
    () => new Map(variants.map((v) => [v.id, v])),
    [variants],
  );

  const selectedProject = projectId ? projectById.get(projectId) ?? null : null;

  // Entorno activo de aislamiento para el formulario:
  // si edita una cotización guardada, respeta su flag isDemo;
  // si vincula un proyecto o cliente, hereda su flag isDemo.
  const targetEnvironmentIsDemo = useMemo(() => {
    if (editingQuoteId && editingIsDemo !== null) return editingIsDemo;
    if (selectedProject) return selectedProject.isDemo;
    if (clientId) {
      const c = clientById.get(clientId);
      if (c) return c.isDemo;
    }
    if (materialLines.some((l) => l.variantId && variantById.get(l.variantId)?.isDemo)) {
      return true;
    }
    return false;
  }, [
    editingQuoteId,
    editingIsDemo,
    selectedProject,
    clientId,
    clientById,
    materialLines,
    variantById,
  ]);

  const selectableProjects = useMemo(() => {
    if (editingQuoteId && editingIsDemo !== null) {
      return projects.filter((p) => p.isDemo === editingIsDemo);
    }
    return projects;
  }, [projects, editingQuoteId, editingIsDemo]);

  const selectableClients = useMemo(() => {
    if (selectedProject || (editingQuoteId && editingIsDemo !== null)) {
      return clients.filter((c) => c.isDemo === targetEnvironmentIsDemo);
    }
    return clients;
  }, [clients, selectedProject, editingQuoteId, editingIsDemo, targetEnvironmentIsDemo]);

  const selectableVariants = useMemo(() => {
    const hasLinkedProjectOrClient = Boolean(selectedProject || clientId || editingQuoteId);
    const filtered = hasLinkedProjectOrClient
      ? variants.filter((v) => v.isDemo === targetEnvironmentIsDemo)
      : variants;
    return filtered.slice().sort((a, b) => {
      const matA = materialById.get(a.materialId)?.name ?? '';
      const matB = materialById.get(b.materialId)?.name ?? '';
      return `${matA} ${a.colorName}`.localeCompare(`${matB} ${b.colorName}`, 'es');
    });
  }, [
    variants,
    selectedProject,
    clientId,
    editingQuoteId,
    targetEnvironmentIsDemo,
    materialById,
  ]);

  const projectPrefill = useMemo(() => {
    if (!selectedProject) return null;
    return extractProjectQuotePrefill({
      project: selectedProject,
      components,
      variants,
      materials,
      reservations,
      movements,
    });
  }, [selectedProject, components, variants, materials, reservations, movements]);

  const applyProjectImport = (
    targetProjId: string,
    mode: 'auto' | 'effective' | 'estimated' = 'auto',
    materialsOnly = false,
  ) => {
    const proj = projectById.get(targetProjId);
    if (!proj) return;
    const prefill = extractProjectQuotePrefill({
      project: proj,
      components,
      variants,
      materials,
      reservations,
      movements,
    });

    if (!materialsOnly) {
      setProjectId(proj.id);
      if (proj.clientId) {
        setClientId(proj.clientId);
      } else if (clientId) {
        const currentClient = clientById.get(clientId);
        if (currentClient && currentClient.isDemo !== proj.isDemo) {
          setClientId('');
        }
      }
      if (!editingQuoteId) {
        setTitle(prefill.title);
      }
      if (mode === 'effective' && prefill.effectiveMinutesLogged > 0) {
        setEffectiveMinutes(prefill.effectiveMinutesLogged);
      } else if (mode === 'estimated' && prefill.estimatedMinutesPlanned > 0) {
        setEffectiveMinutes(prefill.estimatedMinutesPlanned);
      } else if (prefill.recommendedMinutes > 0) {
        setEffectiveMinutes(prefill.recommendedMinutes);
      }
    }

    if (prefill.materialLines.length > 0) {
      setMaterialLines(
        prefill.materialLines.map((line) => ({
          localKey: makeLocalKey(),
          variantId: line.variantId,
          label: line.label,
          colorName: line.colorName,
          unit: line.unit ?? 'unit',
          quantity: String(line.quantity),
          unitCostCOP: String(line.unitCostCOP),
        })),
      );
    } else if (!materialsOnly) {
      setMaterialLines([]);
    }
  };

  useEffect(() => {
    if (!initialProjectId) return;
    const target = projects.find((p) => p.id === initialProjectId);
    if (target) {
      setEditingQuoteId(null);
      setEditingIsDemo(null);
      setActiveTab('simulator');
      snapDeckRef.current?.goToSlide('quote-overview', 'auto');
      setFeedback(null);
      const defaults = buildWorkshopDefaultPercents(settings);
      setHourlyRateRaw(String(defaults.hourlyRateCOP));
      setRentPercentRaw(String(defaults.rentPercent));
      setElectricityPercentRaw(String(defaults.electricityPercent));
      setInternetPercentRaw(String(defaults.internetPercent));
      setWastePercentRaw(String(defaults.wasteContingencyPercent));
      setMarkupPercentRaw(String(defaults.markupPercent));
      setManualIndirectRaw('0');
      setPackagingRaw('0');
      setShippingRaw('0');
      setFinalAgreedPriceRaw('');
      setStatus('draft');
      setNotes('');
      applyProjectImport(target.id, 'auto', false);
    }
    onClearInitialProject?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProjectId, projects]);

  const resetSimulatorToNew = () => {
    const defaults = buildWorkshopDefaultPercents(settings);
    setEditingQuoteId(null);
    setEditingIsDemo(null);
    setTitle('Nueva cotización de taller');
    setProjectId('');
    setClientId('');
    setStatus('draft');
    setEffectiveMinutes(120);
    setHourlyRateRaw(String(defaults.hourlyRateCOP));
    setRentPercentRaw(String(defaults.rentPercent));
    setElectricityPercentRaw(String(defaults.electricityPercent));
    setInternetPercentRaw(String(defaults.internetPercent));
    setWastePercentRaw(String(defaults.wasteContingencyPercent));
    setManualIndirectRaw('0');
    setPackagingRaw('0');
    setShippingRaw('0');
    setMarkupPercentRaw(String(defaults.markupPercent));
    setFinalAgreedPriceRaw('');
    setNotes('');
    setMaterialLines([]);
    setFeedback(null);
  };

  const handleLoadQuoteIntoEditor = (quote: Quote, asDuplicate = false) => {
    setActiveTab('simulator');
    setFeedback(null);
    setSharePreviewText(null);
    snapDeckRef.current?.goToSlide('quote-overview');
    if (asDuplicate) {
      setEditingQuoteId(null);
      setEditingIsDemo(null);
      setTitle(`${quote.title} (copia)`);
      setStatus('draft');
    } else {
      setEditingQuoteId(quote.id);
      setEditingIsDemo(quote.isDemo);
      setTitle(quote.title);
      setStatus(quote.status);
    }

    setProjectId(quote.projectId ?? '');
    setClientId(quote.clientId ?? '');
    setEffectiveMinutes(
      quote.effectiveMinutesUsed ?? Math.round(quote.effectiveHoursUsed * 60),
    );
    setHourlyRateRaw(String(quote.hourlyRateCOP));

    const rent = quote.rentPercent ?? settings.rentCostPercent;
    const elec = quote.electricityPercent ?? settings.electricityCostPercent;
    const inet = quote.internetPercent ?? settings.internetCostPercent;
    const waste = quote.wasteContingencyPercent ?? settings.wasteAndContingencyPercent;
    const inferredManual =
      quote.manualIndirectCostsCOP ??
      Math.max(
        0,
        quote.indirectCostsCOP -
          (quote.fixedServicesIndirectCOP ?? 0) -
          (quote.wasteContingencyCOP ?? 0),
      );

    setRentPercentRaw(String(rent));
    setElectricityPercentRaw(String(elec));
    setInternetPercentRaw(String(inet));
    setWastePercentRaw(String(waste));
    setManualIndirectRaw(String(inferredManual));
    setPackagingRaw(String(quote.packagingCostCOP));
    setShippingRaw(String(quote.shippingOrOtherCOP));
    setMarkupPercentRaw(String(quote.markupPercent));
    setFinalAgreedPriceRaw(
      quote.finalAgreedPriceCOP !== null ? String(quote.finalAgreedPriceCOP) : '',
    );
    setNotes(quote.notes);
    setMaterialLines(
      quote.materialsSnapshot.map((line) => ({
        localKey: makeLocalKey(),
        variantId: line.variantId,
        label: line.label,
        colorName: line.colorName,
        unit: line.unit ?? 'unit',
        quantity: String(line.quantity),
        unitCostCOP: String(line.unitCostCOP),
      })),
    );
  };

  const handleProjectSelectionChange = (nextProjId: string) => {
    if (!nextProjId) {
      setProjectId('');
      return;
    }
    applyProjectImport(nextProjId, 'auto', false);
  };

  const handleUnlinkAsStandalone = () => {
    setEditingQuoteId(null);
    setEditingIsDemo(null);
    setProjectId('');
    setClientId('');
    setMaterialLines((prev) =>
      prev.map((line) => ({
        ...line,
        variantId: null,
      })),
    );
  };

  const handleAddCatalogLine = () => {
    const targetVariant = variantById.get(pickerVariantId);
    if (!targetVariant) {
      setFeedback({
        type: 'error',
        message: 'Selecciona un material y color del catálogo para agregarlo.',
      });
      return;
    }
    const qty = parseNonNegativeFloat(pickerQuantityRaw);
    if (qty <= 0) {
      setFeedback({
        type: 'error',
        message: 'La cantidad del material debe ser mayor a 0.',
      });
      return;
    }
    const parentMat = materialById.get(targetVariant.materialId);
    setMaterialLines((prev) => [
      ...prev,
      {
        localKey: makeLocalKey(),
        variantId: targetVariant.id,
        label: parentMat?.name ?? 'Material',
        colorName: targetVariant.colorName,
        unit: parentMat?.unit ?? 'unit',
        quantity: String(qty),
        unitCostCOP: String(targetVariant.unitCostCOP),
      },
    ]);
    setPickerVariantId('');
    setPickerQuantityRaw('100');
    setFeedback(null);
  };

  const handleAddManualLine = () => {
    setMaterialLines((prev) => [
      ...prev,
      {
        localKey: makeLocalKey(),
        variantId: null,
        label: '',
        colorName: 'Estándar',
        unit: 'unit',
        quantity: '1',
        unitCostCOP: '0',
      },
    ]);
    setFeedback(null);
  };

  const handleUpdateLine = (
    localKey: string,
    patch: Partial<Omit<MaterialLineDraft, 'localKey'>>,
  ) => {
    setMaterialLines((prev) =>
      prev.map((line) =>
        line.localKey === localKey ? { ...line, ...patch } : line,
      ),
    );
  };

  const handleRemoveLine = (localKey: string) => {
    setMaterialLines((prev) => prev.filter((l) => l.localKey !== localKey));
  };

  const handleRestoreWorkshopPercents = () => {
    const defaults = buildWorkshopDefaultPercents(settings);
    setRentPercentRaw(String(defaults.rentPercent));
    setElectricityPercentRaw(String(defaults.electricityPercent));
    setInternetPercentRaw(String(defaults.internetPercent));
    setWastePercentRaw(String(defaults.wasteContingencyPercent));
  };

  // Cálculos en vivo del simulador
  const livePricing = useMemo(() => {
    const materialsTotalCOP = materialLines.reduce((sum, line) => {
      const qty = parseNonNegativeFloat(line.quantity);
      const unitCost = parseNonNegativeInt(line.unitCostCOP);
      return sum + Math.round(qty * unitCost);
    }, 0);

    const hourlyRateCOP = parseNonNegativeInt(hourlyRateRaw);
    const rentPercent = parseNonNegativeFloat(rentPercentRaw);
    const electricityPercent = parseNonNegativeFloat(electricityPercentRaw);
    const internetPercent = parseNonNegativeFloat(internetPercentRaw);
    const wasteContingencyPercent = parseNonNegativeFloat(wastePercentRaw);
    const manualIndirectCostsCOP = parseNonNegativeInt(manualIndirectRaw);
    const packagingCostCOP = parseNonNegativeInt(packagingRaw);
    const shippingOrOtherCOP = parseNonNegativeInt(shippingRaw);
    const markupPercent = parseNonNegativeFloat(markupPercentRaw);

    const summary = calculateQuoteSummary({
      materialsTotalCOP,
      effectiveMinutes,
      hourlyRateCOP,
      indirectCostsCOP: manualIndirectCostsCOP,
      packagingCostCOP,
      shippingOrOtherCOP,
      markupPercent,
      rentPercent,
      electricityPercent,
      internetPercent,
      wasteContingencyPercent,
    });

    const trimmedAgreed = finalAgreedPriceRaw.trim();
    const hasAgreedPrice = trimmedAgreed.length > 0;
    const agreedPriceCOP = hasAgreedPrice
      ? parseNonNegativeInt(trimmedAgreed)
      : null;

    const agreedMetrics =
      agreedPriceCOP !== null
        ? calculateAgreedPriceMetrics(
            summary.totalProductionCostCOP,
            agreedPriceCOP,
          )
        : null;

    return {
      summary,
      hourlyRateCOP,
      rentPercent,
      electricityPercent,
      internetPercent,
      wasteContingencyPercent,
      manualIndirectCostsCOP,
      packagingCostCOP,
      shippingOrOtherCOP,
      agreedPriceCOP,
      agreedMetrics,
    };
  }, [
    materialLines,
    effectiveMinutes,
    hourlyRateRaw,
    rentPercentRaw,
    electricityPercentRaw,
    internetPercentRaw,
    wastePercentRaw,
    manualIndirectRaw,
    packagingRaw,
    shippingRaw,
    markupPercentRaw,
    finalAgreedPriceRaw,
  ]);

  const handleSaveQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFeedback({
        type: 'error',
        message: 'Ingresa un título o referencia para guardar la cotización.',
      });
      return;
    }

    const preparedLines = materialLines
      .filter((line) => line.label.trim().length > 0 || line.variantId !== null)
      .map((line) => ({
        variantId: line.variantId,
        label: line.label.trim() || 'Material',
        colorName: line.colorName.trim() || 'Estándar',
        unit: line.unit || 'unit',
        quantity: parseNonNegativeFloat(line.quantity),
        unitCostCOP: parseNonNegativeInt(line.unitCostCOP),
      }));

    if (preparedLines.some((l) => l.quantity <= 0)) {
      setFeedback({
        type: 'error',
        message: 'Todas las líneas de material incluidas deben tener cantidad mayor a 0.',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        projectId: projectId || null,
        clientId: clientId || null,
        title: cleanTitle,
        materialsSnapshot: preparedLines,
        effectiveMinutesUsed: effectiveMinutes,
        hourlyRateCOP: livePricing.hourlyRateCOP,
        manualIndirectCostsCOP: livePricing.manualIndirectCostsCOP,
        rentPercent: livePricing.rentPercent,
        electricityPercent: livePricing.electricityPercent,
        internetPercent: livePricing.internetPercent,
        wasteContingencyPercent: livePricing.wasteContingencyPercent,
        packagingCostCOP: livePricing.packagingCostCOP,
        shippingOrOtherCOP: livePricing.shippingOrOtherCOP,
        markupPercent: livePricing.summary.markupPercent,
        finalAgreedPriceCOP: livePricing.agreedPriceCOP,
        status,
        notes,
      };

      if (editingQuoteId) {
        await updateQuote(editingQuoteId, payload);
      } else {
        const created = await createQuote(payload);
        setEditingQuoteId(created.id);
        setEditingIsDemo(created.isDemo);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible guardar la cotización.',
      });
    } finally {
      setSaving(false);
    }
  };

  const copySummaryText = async (text: string) => {
    setSharePreviewText(text);
    setCopiedJustNow(false);
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedJustNow(true);
        window.setTimeout(() => setCopiedJustNow(false), 2600);
      } catch {
        // Si el iframe bloquea portapapeles automático, el panel visible permite copiar manualmente
      }
    }
  };

  const handleShareCurrentDraft = async () => {
    const client = clientId ? clientById.get(clientId) : null;
    const project = projectId ? projectById.get(projectId) : null;
    const finalPrice =
      livePricing.agreedPriceCOP ?? livePricing.summary.suggestedPriceCOP;

    const text = formatQuoteClientSummaryText({
      title,
      workshopName: settings.workshopName,
      clientName: client?.name ?? null,
      projectName: project?.name ?? null,
      estimatedMinutes: effectiveMinutes,
      materials: materialLines
        .filter((l) => l.label.trim().length > 0 && parseNonNegativeFloat(l.quantity) > 0)
        .map((l) => ({
          label: l.label.trim(),
          colorName: l.colorName.trim() || 'Estándar',
          quantity: parseNonNegativeFloat(l.quantity),
          unit: l.unit,
        })),
      includesPackaging: livePricing.packagingCostCOP > 0,
      includesShipping: livePricing.shippingOrOtherCOP > 0,
      finalPriceCOP: finalPrice,
      notes,
    });

    await copySummaryText(text);
  };

  const handleShareSavedQuote = async (quote: Quote) => {
    const client = quote.clientId ? clientById.get(quote.clientId) : null;
    const project = quote.projectId ? projectById.get(quote.projectId) : null;
    const mins =
      quote.effectiveMinutesUsed ?? Math.round(quote.effectiveHoursUsed * 60);
    const text = formatQuoteClientSummaryText({
      title: quote.title,
      workshopName: settings.workshopName,
      clientName: client?.name ?? null,
      projectName: project?.name ?? null,
      dateIso: quote.updatedAt,
      estimatedMinutes: mins,
      materials: quote.materialsSnapshot.map((m) => ({
        label: m.label,
        colorName: m.colorName,
        quantity: m.quantity,
        unit: m.unit,
      })),
      includesPackaging: quote.packagingCostCOP > 0,
      includesShipping: quote.shippingOrOtherCOP > 0,
      finalPriceCOP: quote.finalAgreedPriceCOP ?? quote.suggestedPriceCOP,
      notes: quote.notes,
    });
    await copySummaryText(text);
  };

  const handleQuickStatusChange = async (quote: Quote, nextStatus: QuoteStatus) => {
    setBusyQuoteId(quote.id);
    setFeedback(null);
    try {
      await updateQuote(quote.id, { status: nextStatus });
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible actualizar el estado.',
      });
    } finally {
      setBusyQuoteId(null);
    }
  };

  const handleApplyToProject = async (quoteId: string) => {
    setBusyQuoteId(quoteId);
    setFeedback(null);
    try {
      await applyQuotePriceToProject(quoteId);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible aplicar el precio al proyecto.',
      });
    } finally {
      setBusyQuoteId(null);
    }
  };

  const handleConfirmDeleteQuote = async () => {
    if (!quoteToDelete) return;
    const targetId = quoteToDelete.id;
    setQuoteToDelete(null);
    setBusyQuoteId(targetId);
    try {
      await deleteQuote(targetId);
      if (editingQuoteId === targetId) {
        resetSimulatorToNew();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible eliminar la cotización.',
      });
    } finally {
      setBusyQuoteId(null);
    }
  };

  const filteredHistoryQuotes = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return quotes
      .filter((item) => {
        if (historyStatusFilter !== 'all' && item.status !== historyStatusFilter) {
          return false;
        }
        if (!q) return true;
        const projName = item.projectId
          ? projectById.get(item.projectId)?.name.toLowerCase() ?? ''
          : '';
        const clientName = item.clientId
          ? clientById.get(item.clientId)?.name.toLowerCase() ?? ''
          : '';
        return (
          item.title.toLowerCase().includes(q) ||
          projName.includes(q) ||
          clientName.includes(q) ||
          item.notes.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [quotes, historyStatusFilter, historySearch, projectById, clientById]);

  const draftOrSentCount = quotes.filter(
    (q) => q.status === 'draft' || q.status === 'sent',
  ).length;

  const editingQuoteObj = editingQuoteId
    ? quotes.find((q) => q.id === editingQuoteId) ?? null
    : null;

  // Paginación adaptativa de líneas de material e historial de cotizaciones
  const materialLinesPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 2,
    mobileRegular: 3,
    tablet: 4,
    desktopCompact: 4,
    desktopRegular: 5,
    desktopTall: 6,
  });
  const historyPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 1,
    tablet: 2,
    desktopCompact: 2,
    desktopRegular: 2,
    desktopTall: 3,
  });

  const materialLinePages = useMemo(
    () => chunkIntoPages(materialLines, materialLinesPageSize),
    [materialLines, materialLinesPageSize],
  );
  const historyPages = useMemo(
    () => chunkIntoPages(filteredHistoryQuotes, historyPageSize),
    [filteredHistoryQuotes, historyPageSize],
  );

  const handleTabJump = (tab: QuotingTab) => {
    setActiveTab(tab);
    if (tab === 'simulator') {
      snapDeckRef.current?.goToSlide('quote-overview');
    } else {
      snapDeckRef.current?.goToSlide('quote-history-0');
    }
  };

  const handleSlideChange = (slideId: string) => {
    if (slideId.startsWith('quote-history')) {
      setActiveTab('history');
    } else {
      setActiveTab('simulator');
    }
  };

  return (
    <>
      <form onSubmit={handleSaveQuote} className="h-full w-full">
        <SnapDeck
          ref={snapDeckRef}
          ariaLabel="Cotizador del taller e historial de cotizaciones"
          onSlideChange={handleSlideChange}
          topSlot={
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
                  role="tablist"
                  aria-label="Secciones del cotizador"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'simulator'}
                    onClick={() => handleTabJump('simulator')}
                    className={`inline-flex min-h-[36px] items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      activeTab === 'simulator'
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    {editingQuoteId ? 'Editor de cotización' : 'Simulador'}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'history'}
                    onClick={() => handleTabJump('history')}
                    className={`inline-flex min-h-[36px] items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      activeTab === 'history'
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    Historial ({quotes.length})
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => snapDeckRef.current?.goToSlide('quote-summary')}
                    className="hidden sm:inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono font-semibold text-teal-800 hover:bg-slate-50 tabular-nums whitespace-nowrap"
                  >
                    <span>
                      Sugerido: {formatCOP(livePricing.summary.suggestedPriceCOP)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetSimulatorToNew();
                      handleTabJump('simulator');
                    }}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Nueva cotización</span>
                    <span className="sm:hidden">Nueva</span>
                  </button>
                </div>
              </div>

              {feedback && (
                <div
                  role="alert"
                  className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 sm:text-sm"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{feedback.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeedback(null)}
                    className="rounded p-1 hover:bg-black/5 shrink-0"
                    aria-label="Cerrar mensaje"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          }
        >
          {/* PANTALLA 1: RESUMEN Y DATOS PRINCIPALES DE LA COTIZACIÓN */}
          <SnapSlide id="quote-overview" label="Resumen y datos">
            <div className="space-y-4">
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      Comercial · Markup + Margen real en COP
                    </p>
                    <h2 className="mt-0.5 font-display text-lg font-bold text-slate-900 sm:text-xl">
                      Cotizador del Taller
                    </h2>
                  </div>
                  {onNavigateToSettings && (
                    <button
                      type="button"
                      onClick={onNavigateToSettings}
                      className="self-start sm:self-auto text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                    >
                      Configurar tarifa ({formatCOP(settings.hourlyRateCOP)}/h) →
                    </button>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 lg:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Cotizaciones</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">
                      {stats.quotesCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Aprobadas</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-700 tabular-nums sm:text-xl">
                      {stats.approvedQuotesCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      Borradores / Enviadas
                    </p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">
                      {draftOrSentCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Tarifa del taller</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums sm:text-lg">
                      {formatCOP(settings.hourlyRateCOP)}/h
                    </p>
                  </div>
                </div>
              </section>

              {editingQuoteId && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Edit3 className="h-4 w-4 text-teal-700 shrink-0" aria-hidden="true" />
                    <span>
                      Editando:{' '}
                      <strong className="text-slate-900">
                        {editingQuoteObj?.title ?? title}
                      </strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={resetSimulatorToNew}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Crear nueva</span>
                  </button>
                </div>
              )}

              {targetEnvironmentIsDemo && !editingQuoteId && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
                  <span>
                    Simulación sobre registros de ejemplo (mantiene aislamiento demo).
                  </span>
                  <button
                    type="button"
                    onClick={handleUnlinkAsStandalone}
                    className="inline-flex min-h-[32px] items-center rounded-lg border border-amber-300 bg-white px-2.5 text-xs font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                  >
                    Desvincular como propia
                  </button>
                </div>
              )}

              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  1. Datos de la cotización
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Simula un diseño libre o importa tiempos y materiales desde un proyecto existente.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="quote-title"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Título o nombre de la pieza
                    </label>
                    <input
                      id="quote-title"
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Ej. Amigurumi Personalizado — Conejo 25 cm"
                      className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="quote-project"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Proyecto vinculado (opcional)
                    </label>
                    <select
                      id="quote-project"
                      value={projectId}
                      onChange={(e) => handleProjectSelectionChange(e.target.value)}
                      className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="">Sin proyecto vinculado (simulación libre)</option>
                      {selectableProjects.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.name}
                          {proj.isDemo ? ' (Ejemplo)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="quote-client"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Cliente (opcional)
                    </label>
                    <select
                      id="quote-client"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="">Sin cliente asignado</option>
                      {selectableClients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                          {client.isDemo ? ' (Ejemplo)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedProject && projectPrefill && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-800">
                        Datos de "{selectedProject.name}"
                      </span>
                      {onOpenProject && (
                        <button
                          type="button"
                          onClick={() => onOpenProject(selectedProject.id)}
                          className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-800"
                        >
                          <span>Abrir proyecto</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-600 tabular-nums">
                      Real:{' '}
                      <strong>
                        {formatDurationMinutes(projectPrefill.effectiveMinutesLogged)}
                      </strong>{' '}
                      · Estimado:{' '}
                      <strong>
                        {formatDurationMinutes(projectPrefill.estimatedMinutesPlanned)}
                      </strong>{' '}
                      · Materiales: <strong>{projectPrefill.materialLines.length}</strong>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {projectPrefill.effectiveMinutesLogged > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEffectiveMinutes(projectPrefill.effectiveMinutesLogged)
                          }
                          className="inline-flex min-h-[32px] items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                        >
                          Usar real ({formatDurationMinutes(projectPrefill.effectiveMinutesLogged)})
                        </button>
                      )}
                      {projectPrefill.estimatedMinutesPlanned > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEffectiveMinutes(projectPrefill.estimatedMinutesPlanned)
                          }
                          className="inline-flex min-h-[32px] items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                        >
                          Usar estimado (
                          {formatDurationMinutes(projectPrefill.estimatedMinutesPlanned)})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          applyProjectImport(selectedProject.id, 'auto', true)
                        }
                        className="inline-flex min-h-[32px] items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                      >
                        Reimportar materiales ({projectPrefill.materialLines.length})
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </SnapSlide>

          {/* PANTALLA(S) 2: MATERIALES E INSUMOS (PAGINADO SIN RECORTES) */}
          {materialLinePages.length === 0 ? (
            <SnapSlide id="quote-materials-0" label="Materiales">
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      2. Materiales e insumos
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Selecciona hilos/colores de tu inventario o añade insumos manuales en COP.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddManualLine}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Línea manual</span>
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                  <div className="sm:col-span-6">
                    <label htmlFor="quote-pick-variant" className="sr-only">
                      Material y color del catálogo
                    </label>
                    <select
                      id="quote-pick-variant"
                      value={pickerVariantId}
                      onChange={(e) => setPickerVariantId(e.target.value)}
                      className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="">Elegir material del inventario...</option>
                      {selectableVariants.map((v) => {
                        const mat = materialById.get(v.materialId);
                        const unit = mat?.unit ?? 'unit';
                        return (
                          <option key={v.id} value={v.id}>
                            {mat?.name ?? 'Material'} · {v.colorName} (
                            {formatCOP(v.unitCostCOP)}/{unit})
                            {v.isDemo ? ' [Ejemplo]' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label htmlFor="quote-pick-qty" className="sr-only">
                      Cantidad
                    </label>
                    <input
                      id="quote-pick-qty"
                      type="number"
                      min="0.01"
                      step="any"
                      value={pickerQuantityRaw}
                      onChange={(e) => setPickerQuantityRaw(e.target.value)}
                      placeholder="Cantidad"
                      className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="button"
                      onClick={handleAddCatalogLine}
                      disabled={!pickerVariantId}
                      className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Agregar</span>
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500">
                  No hay materiales agregados todavía. Selecciona una variante del catálogo o añade una línea manual.
                </div>
              </section>
            </SnapSlide>
          ) : (
            materialLinePages.map((pageLines, pageIdx) => (
              <SnapSlide
                key={`quote-materials-${pageIdx}`}
                id={`quote-materials-${pageIdx}`}
                label={
                  materialLinePages.length > 1
                    ? `Materiales ${pageIdx + 1}/${materialLinePages.length}`
                    : 'Materiales'
                }
              >
                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-semibold text-slate-900">
                        2. Materiales e insumos
                        {materialLinePages.length > 1
                          ? ` (${pageIdx + 1}/${materialLinePages.length})`
                          : ''}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                        Total materiales: {formatCOP(livePricing.summary.materialsTotalCOP)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddManualLine}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Línea manual</span>
                    </button>
                  </div>

                  {pageIdx === 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-12">
                      <div className="sm:col-span-6">
                        <label htmlFor="quote-pick-variant" className="sr-only">
                          Material y color del catálogo
                        </label>
                        <select
                          id="quote-pick-variant"
                          value={pickerVariantId}
                          onChange={(e) => setPickerVariantId(e.target.value)}
                          className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                        >
                          <option value="">Elegir material del inventario...</option>
                          {selectableVariants.map((v) => {
                            const mat = materialById.get(v.materialId);
                            const unit = mat?.unit ?? 'unit';
                            return (
                              <option key={v.id} value={v.id}>
                                {mat?.name ?? 'Material'} · {v.colorName} (
                                {formatCOP(v.unitCostCOP)}/{unit})
                                {v.isDemo ? ' [Ejemplo]' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="sm:col-span-3">
                        <label htmlFor="quote-pick-qty" className="sr-only">
                          Cantidad
                        </label>
                        <input
                          id="quote-pick-qty"
                          type="number"
                          min="0.01"
                          step="any"
                          value={pickerQuantityRaw}
                          onChange={(e) => setPickerQuantityRaw(e.target.value)}
                          placeholder="Cantidad"
                          className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <button
                          type="button"
                          onClick={handleAddCatalogLine}
                          disabled={!pickerVariantId}
                          className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Agregar</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                    {pageLines.map((line) => {
                      const variant = line.variantId
                        ? variantById.get(line.variantId)
                        : null;
                      const qty = parseNonNegativeFloat(line.quantity);
                      const unitCost = parseNonNegativeInt(line.unitCostCOP);
                      const subtotal = Math.round(qty * unitCost);

                      return (
                        <div key={line.localKey} className="py-3 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {line.variantId ? (
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-3.5 w-3.5 shrink-0 rounded border border-slate-300"
                                    style={{
                                      backgroundColor:
                                        variant?.colorHex ?? '#E2E8F0',
                                    }}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate text-sm font-medium text-slate-900">
                                    {line.label} · {line.colorName}
                                  </span>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <input
                                    type="text"
                                    value={line.label}
                                    onChange={(e) =>
                                      handleUpdateLine(line.localKey, {
                                        label: e.target.value,
                                      })
                                    }
                                    placeholder="Nombre del insumo (ej. Relleno)"
                                    aria-label="Nombre del insumo manual"
                                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-teal-700 focus:outline-none"
                                  />
                                  <input
                                    type="text"
                                    value={line.colorName}
                                    onChange={(e) =>
                                      handleUpdateLine(line.localKey, {
                                        colorName: e.target.value,
                                      })
                                    }
                                    placeholder="Color o detalle"
                                    aria-label="Color o detalle del insumo"
                                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:border-teal-700 focus:outline-none"
                                  />
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.localKey)}
                              aria-label={`Quitar ${line.label || 'línea'}`}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>

                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-12 sm:items-end">
                            <div className="sm:col-span-3">
                              <label className="block text-[11px] font-medium text-slate-500">
                                Cantidad ({line.unit || 'unit'})
                              </label>
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                value={line.quantity}
                                onChange={(e) =>
                                  handleUpdateLine(line.localKey, {
                                    quantity: e.target.value,
                                  })
                                }
                                className="mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                              />
                            </div>

                            {!line.variantId && (
                              <div className="sm:col-span-3">
                                <label className="block text-[11px] font-medium text-slate-500">
                                  Unidad
                                </label>
                                <select
                                  value={line.unit}
                                  onChange={(e) =>
                                    handleUpdateLine(line.localKey, {
                                      unit: e.target.value,
                                    })
                                  }
                                  className="mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                                >
                                  {MEASUREMENT_UNIT_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div className={line.variantId ? 'sm:col-span-5' : 'sm:col-span-3'}>
                              <label className="block text-[11px] font-medium text-slate-500">
                                Costo unitario (COP)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={line.unitCostCOP}
                                onChange={(e) =>
                                  handleUpdateLine(line.localKey, {
                                    unitCostCOP: e.target.value,
                                  })
                                }
                                className="mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                              />
                            </div>

                            <div className="sm:col-span-4 text-right sm:pb-1.5">
                              <p className="text-[11px] text-slate-500">Subtotal</p>
                              <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums sm:text-sm">
                                {formatCOP(subtotal)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </SnapSlide>
            ))
          )}

          {/* PANTALLA 3: MANO DE OBRA E INDIRECTOS */}
          <SnapSlide id="quote-labor" label="Mano de obra e indirectos">
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <h3 className="font-display text-base font-semibold text-slate-900">
                3. Mano de obra y costos operativos
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Ajusta horas y minutos dedicados, tarifa por hora y cargos de empaque, envío o taller.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="quote-duration-min"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Tiempo de tejido y acabados
                  </label>
                  <div className="mt-1.5">
                    <DurationInput
                      id="quote-duration-min"
                      valueMinutes={effectiveMinutes}
                      onChangeMinutes={setEffectiveMinutes}
                      minMinutes={0}
                      ariaLabel="Tiempo de tejido y acabados"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="quote-hourly-rate"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Tarifa por hora (COP)
                    </label>
                    {parseNonNegativeInt(hourlyRateRaw) !== settings.hourlyRateCOP && (
                      <button
                        type="button"
                        onClick={() =>
                          setHourlyRateRaw(String(settings.hourlyRateCOP))
                        }
                        className="text-[11px] font-medium text-teal-700 hover:text-teal-800"
                      >
                        Usar del taller ({formatCOP(settings.hourlyRateCOP)})
                      </button>
                    )}
                  </div>
                  <input
                    id="quote-hourly-rate"
                    type="number"
                    min="0"
                    step="500"
                    value={hourlyRateRaw}
                    onChange={(e) => setHourlyRateRaw(e.target.value)}
                    className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="quote-packaging"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Empaque, caja y etiquetas (COP)
                  </label>
                  <input
                    id="quote-packaging"
                    type="number"
                    min="0"
                    step="100"
                    value={packagingRaw}
                    onChange={(e) => setPackagingRaw(e.target.value)}
                    className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="quote-shipping"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Envío u otros directos (COP)
                  </label>
                  <input
                    id="quote-shipping"
                    type="number"
                    min="0"
                    step="500"
                    value={shippingRaw}
                    onChange={(e) => setShippingRaw(e.target.value)}
                    className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-3.5">
                <button
                  type="button"
                  onClick={() => setShowAdvancedIndirects((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-slate-700 hover:text-slate-900"
                >
                  <span className="inline-flex items-center gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    <span>
                      Costos fijos e imprevistos (
                      {livePricing.rentPercent +
                        livePricing.electricityPercent +
                        livePricing.internetPercent}
                      % servicios + {livePricing.wasteContingencyPercent}% merma)
                    </span>
                  </span>
                  {showAdvancedIndirects ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  )}
                </button>

                {showAdvancedIndirects && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">
                        Calculados sobre la base directa (materiales + mano de obra).
                      </p>
                      <button
                        type="button"
                        onClick={handleRestoreWorkshopPercents}
                        className="text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                      >
                        Restaurar valores del taller
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <div>
                        <label
                          htmlFor="quote-rent-pct"
                          className="block text-[11px] font-medium text-slate-600"
                        >
                          Arriendo (%)
                        </label>
                        <input
                          id="quote-rent-pct"
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={rentPercentRaw}
                          onChange={(e) => setRentPercentRaw(e.target.value)}
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="quote-elec-pct"
                          className="block text-[11px] font-medium text-slate-600"
                        >
                          Electricidad (%)
                        </label>
                        <input
                          id="quote-elec-pct"
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={electricityPercentRaw}
                          onChange={(e) => setElectricityPercentRaw(e.target.value)}
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="quote-inet-pct"
                          className="block text-[11px] font-medium text-slate-600"
                        >
                          Internet (%)
                        </label>
                        <input
                          id="quote-inet-pct"
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={internetPercentRaw}
                          onChange={(e) => setInternetPercentRaw(e.target.value)}
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="quote-waste-pct"
                          className="block text-[11px] font-medium text-slate-600"
                        >
                          Imprevistos (%)
                        </label>
                        <input
                          id="quote-waste-pct"
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={wastePercentRaw}
                          onChange={(e) => setWastePercentRaw(e.target.value)}
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label
                          htmlFor="quote-manual-indirect"
                          className="block text-[11px] font-medium text-slate-600"
                        >
                          Extra COP
                        </label>
                        <input
                          id="quote-manual-indirect"
                          type="number"
                          min="0"
                          step="500"
                          value={manualIndirectRaw}
                          onChange={(e) => setManualIndirectRaw(e.target.value)}
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-slate-100 pt-3.5">
                <label
                  htmlFor="quote-notes"
                  className="block text-xs font-medium text-slate-700"
                >
                  Notas y condiciones (se muestran en el resumen al cliente)
                </label>
                <textarea
                  id="quote-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej. Tiempo de entrega estimado: 8 días hábiles. Requiere 50% de anticipo."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </section>
          </SnapSlide>

          {/* PANTALLA 4: DESGLOSE EN VIVO, PRECIO FINAL Y GUARDAR */}
          <SnapSlide id="quote-summary" label="Precio sugerido y guardar">
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-teal-700" aria-hidden="true" />
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    4. Desglose y precio sugerido
                  </h3>
                </div>
                <StatusBadge
                  label={QUOTE_STATUS_META[status].label}
                  tone={QUOTE_STATUS_META[status].tone}
                />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12">
                <div className="lg:col-span-6 space-y-4">
                  <dl className="space-y-2 text-xs sm:text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-600">Materiales e insumos</dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {formatCOP(livePricing.summary.materialsTotalCOP)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-600">
                        Mano de obra ({livePricing.summary.effectiveHours} h ×{' '}
                        {formatCOP(livePricing.hourlyRateCOP)})
                      </dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {formatCOP(livePricing.summary.laborTotalCOP)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      <dt>Subtotal costo directo</dt>
                      <dd className="font-mono font-medium text-slate-700 tabular-nums">
                        {formatCOP(livePricing.summary.directBaseCostCOP)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-600">
                        Servicios fijos taller (
                        {Math.round(
                          (livePricing.rentPercent +
                            livePricing.electricityPercent +
                            livePricing.internetPercent) *
                            100,
                        ) / 100}
                        %)
                      </dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {formatCOP(livePricing.summary.fixedServicesIndirectCOP)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-600">
                        Imprevistos / merma ({livePricing.wasteContingencyPercent}%)
                      </dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {formatCOP(livePricing.summary.wasteContingencyCOP)}
                      </dd>
                    </div>
                    {(livePricing.manualIndirectCostsCOP > 0 ||
                      livePricing.packagingCostCOP > 0 ||
                      livePricing.shippingOrOtherCOP > 0) && (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-600">
                          Empaque, envío y otros fijos
                        </dt>
                        <dd className="font-mono font-medium text-slate-900 tabular-nums">
                          {formatCOP(
                            livePricing.manualIndirectCostsCOP +
                              livePricing.packagingCostCOP +
                              livePricing.shippingOrOtherCOP,
                          )}
                        </dd>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2.5">
                      <dt className="font-semibold text-slate-900">
                        Costo total de producción
                      </dt>
                      <dd className="font-mono text-base font-bold text-slate-900 tabular-nums">
                        {formatCOP(livePricing.summary.totalProductionCostCOP)}
                      </dd>
                    </div>
                  </dl>

                  <div className="border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="quote-markup"
                        className="text-xs font-semibold text-slate-700"
                      >
                        Recargo sobre el costo (Markup %)
                      </label>
                      <div className="flex items-center gap-1">
                        {MARKUP_PRESETS.map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setMarkupPercentRaw(String(pct))}
                            className={`rounded-md px-2 py-1 text-[11px] font-mono font-medium transition-colors ${
                              Number(markupPercentRaw) === pct
                                ? 'bg-teal-700 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>

                    <input
                      id="quote-markup"
                      type="number"
                      min="0"
                      max="500"
                      step="1"
                      value={markupPercentRaw}
                      onChange={(e) => setMarkupPercentRaw(e.target.value)}
                      className="mt-2 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="lg:col-span-6 space-y-3.5">
                  <div className="rounded-xl bg-slate-900 p-4 text-white">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-slate-300">
                        Precio de venta sugerido
                      </span>
                      <span className="font-mono text-xl font-bold tabular-nums sm:text-2xl">
                        {formatCOP(livePricing.summary.suggestedPriceCOP)}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-slate-700/80 pt-2.5 text-xs">
                      <div>
                        <p className="text-slate-400">Utilidad esperada</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                          {formatCOP(livePricing.summary.expectedProfitCOP)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-400">Margen real sobre venta</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
                          {livePricing.summary.grossMarginPercent}%
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="quote-agreed-price"
                        className="text-xs font-semibold text-slate-700"
                      >
                        Precio final acordado (opcional)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setFinalAgreedPriceRaw(
                              String(
                                roundUpToNearestThousand(
                                  livePricing.summary.suggestedPriceCOP,
                                ),
                              ),
                            )
                          }
                          className="text-[11px] font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                        >
                          Redondear a mil
                        </button>
                        {finalAgreedPriceRaw && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <button
                              type="button"
                              onClick={() => setFinalAgreedPriceRaw('')}
                              className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
                            >
                              Limpiar
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <input
                      id="quote-agreed-price"
                      type="number"
                      min="0"
                      step="1000"
                      value={finalAgreedPriceRaw}
                      onChange={(e) => setFinalAgreedPriceRaw(e.target.value)}
                      placeholder={`Por defecto: ${formatCOP(livePricing.summary.suggestedPriceCOP)}`}
                      className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />

                    {livePricing.agreedMetrics && (
                      <div
                        className={`rounded-lg border p-2.5 text-xs ${
                          livePricing.agreedMetrics.isBelowCost
                            ? 'border-rose-200 bg-rose-50 text-rose-800'
                            : 'border-slate-200 bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>Utilidad al precio acordado:</span>
                          <span className="font-mono font-bold tabular-nums">
                            {formatCOP(livePricing.agreedMetrics.profitAtAgreedCOP)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span>Margen real:</span>
                          <span className="font-mono font-semibold tabular-nums">
                            {livePricing.agreedMetrics.grossMarginAtAgreedPercent}% (recargo{' '}
                            {livePricing.agreedMetrics.markupAtAgreedPercent}%)
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="quote-status"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Estado de la cotización
                      </label>
                      <select
                        id="quote-status"
                        value={status}
                        onChange={(e) => setStatus(e.target.value as QuoteStatus)}
                        className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      >
                        {QUOTE_STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={saving}
                      className="sm:col-span-2 inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {saving
                          ? 'Guardando...'
                          : editingQuoteId
                            ? 'Guardar cambios en cotización'
                            : 'Guardar cotización'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleShareCurrentDraft()}
                      className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copiar para cliente</span>
                    </button>

                    {editingQuoteId && editingQuoteObj?.projectId && (
                      <button
                        type="button"
                        disabled={busyQuoteId === editingQuoteId}
                        onClick={() => void handleApplyToProject(editingQuoteId)}
                        className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 text-xs font-medium text-teal-800 hover:bg-teal-100 whitespace-nowrap disabled:opacity-50"
                      >
                        <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Aplicar al proyecto</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </SnapSlide>

          {/* PANTALLA(S) 5: HISTORIAL DE COTIZACIONES */}
          {historyPages.length === 0 ? (
            <SnapSlide id="quote-history-0" label="Historial de cotizaciones">
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="relative flex-1 max-w-md">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Buscar por título, proyecto o cliente..."
                        aria-label="Buscar cotizaciones"
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
                      {(
                        [
                          { id: 'all', label: 'Todas' },
                          { id: 'draft', label: 'Borradores' },
                          { id: 'sent', label: 'Enviadas' },
                          { id: 'approved', label: 'Aprobadas' },
                          { id: 'rejected', label: 'Rechazadas' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setHistoryStatusFilter(tab.id)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                            historyStatusFilter === tab.id
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <EmptyState
                  icon={Calculator}
                  title="No hay cotizaciones registradas con este filtro"
                  description={
                    quotes.length === 0
                      ? 'Crea tu primera simulación de costos y ganancia desde el Simulador para conservar el historial en COP.'
                      : 'Prueba limpiando la búsqueda o seleccionando otro estado.'
                  }
                  primaryAction={{
                    label: 'Ir al simulador',
                    onClick: () => handleTabJump('simulator'),
                  }}
                />
              </div>
            </SnapSlide>
          ) : (
            historyPages.map((pageQuotes, pageIdx) => (
              <SnapSlide
                key={`quote-history-${pageIdx}`}
                id={`quote-history-${pageIdx}`}
                label={
                  historyPages.length > 1
                    ? `Historial ${pageIdx + 1}/${historyPages.length}`
                    : 'Historial de cotizaciones'
                }
              >
                <div className="space-y-4">
                  {pageIdx === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="relative flex-1 max-w-md">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                            aria-hidden="true"
                          />
                          <input
                            type="search"
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                            placeholder="Buscar por título, proyecto o cliente..."
                            aria-label="Buscar cotizaciones"
                            className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
                          {(
                            [
                              { id: 'all', label: 'Todas' },
                              { id: 'draft', label: 'Borradores' },
                              { id: 'sent', label: 'Enviadas' },
                              { id: 'approved', label: 'Aprobadas' },
                              { id: 'rejected', label: 'Rechazadas' },
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setHistoryStatusFilter(tab.id)}
                              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                                historyStatusFilter === tab.id
                                  ? 'bg-white text-slate-900 shadow-sm'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Historial de cotizaciones · Página {pageIdx + 1} de {historyPages.length}
                    </p>
                  )}

                  <div className="space-y-4">
                    {pageQuotes.map((quote) => {
                      const project = quote.projectId
                        ? projectById.get(quote.projectId) ?? null
                        : null;
                      const client = quote.clientId
                        ? clientById.get(quote.clientId) ?? null
                        : null;
                      const statusMeta = QUOTE_STATUS_META[quote.status];
                      const finalPrice =
                        quote.finalAgreedPriceCOP ?? quote.suggestedPriceCOP;
                      const finalMetrics = calculateAgreedPriceMetrics(
                        quote.totalProductionCostCOP,
                        finalPrice,
                      );
                      const mins =
                        quote.effectiveMinutesUsed ??
                        Math.round(quote.effectiveHoursUsed * 60);

                      return (
                        <article
                          key={quote.id}
                          className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 transition-colors hover:border-slate-300"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>Actualizada: {formatDateCO(quote.updatedAt)}</span>
                                {project && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <button
                                      type="button"
                                      onClick={() => onOpenProject?.(project.id)}
                                      className="font-medium text-teal-700 hover:text-teal-800"
                                    >
                                      Proyecto: {project.name}
                                    </button>
                                  </>
                                )}
                                {client && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>Cliente: {client.name}</span>
                                  </>
                                )}
                                {quote.isDemo && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-medium text-slate-400">
                                      Ejemplo
                                    </span>
                                  </>
                                )}
                              </div>
                              <h3 className="mt-1 font-display text-base font-bold text-slate-900 sm:text-lg">
                                {quote.title}
                              </h3>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <StatusBadge
                                label={statusMeta.label}
                                tone={statusMeta.tone}
                              />
                              <select
                                aria-label={`Cambiar estado de ${quote.title}`}
                                value={quote.status}
                                disabled={busyQuoteId === quote.id}
                                onChange={(e) =>
                                  void handleQuickStatusChange(
                                    quote,
                                    e.target.value as QuoteStatus,
                                  )
                                }
                                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
                              >
                                {QUOTE_STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-5">
                            <div>
                              <p className="text-[11px] text-slate-500">
                                Tiempo &amp; Tarifa
                              </p>
                              <p className="mt-0.5 font-mono text-xs font-semibold text-slate-900 tabular-nums sm:text-sm">
                                {formatDurationMinutes(mins)} ·{' '}
                                {formatCOP(quote.hourlyRateCOP)}/h
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Materiales</p>
                              <p className="mt-0.5 font-mono text-xs font-semibold text-slate-900 tabular-nums sm:text-sm">
                                {formatCOP(quote.materialsTotalCOP)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Costo total</p>
                              <p className="mt-0.5 font-mono text-xs font-semibold text-slate-900 tabular-nums sm:text-sm">
                                {formatCOP(quote.totalProductionCostCOP)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">
                                {quote.finalAgreedPriceCOP !== null
                                  ? 'Precio acordado'
                                  : 'Precio sugerido'}
                              </p>
                              <p className="mt-0.5 font-mono text-sm font-bold text-teal-800 tabular-nums sm:text-base">
                                {formatCOP(finalPrice)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">
                                Utilidad / Margen
                              </p>
                              <p
                                className={`mt-0.5 font-mono text-xs font-semibold tabular-nums sm:text-sm ${
                                  finalMetrics.isBelowCost
                                    ? 'text-rose-700'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {formatCOP(finalMetrics.profitAtAgreedCOP)} (
                                {finalMetrics.grossMarginAtAgreedPercent}%)
                              </p>
                            </div>
                          </div>

                          {quote.materialsSnapshot.length > 0 && (
                            <p className="mt-2.5 text-xs text-slate-500 line-clamp-1">
                              Insumos:{' '}
                              {quote.materialsSnapshot
                                .map(
                                  (m) =>
                                    `${m.label} (${m.colorName}: ${formatUnitQuantity(m.quantity, (m.unit as 'g') ?? 'unit')})`,
                                )
                                .join(' · ')}
                            </p>
                          )}

                          {quote.notes && (
                            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600 line-clamp-2">
                              {quote.notes}
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                            <button
                              type="button"
                              onClick={() => handleLoadQuoteIntoEditor(quote, false)}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Abrir en editor</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleLoadQuoteIntoEditor(quote, true)}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Duplicar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleShareSavedQuote(quote)}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copiar para cliente</span>
                            </button>

                            {quote.projectId && (
                              <button
                                type="button"
                                disabled={busyQuoteId === quote.id}
                                onClick={() => void handleApplyToProject(quote.id)}
                                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 text-xs font-medium text-teal-800 hover:bg-teal-100 whitespace-nowrap disabled:opacity-50"
                              >
                                <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Aplicar precio al proyecto</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={busyQuoteId === quote.id}
                              onClick={() => setQuoteToDelete(quote)}
                              className="ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 whitespace-nowrap disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Eliminar</span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </SnapSlide>
            ))
          )}
        </SnapDeck>
      </form>

      {/* Modal con texto compartible para cliente */}
      {sharePreviewText !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Resumen listo para enviar al cliente"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Copy className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Resumen listo para cliente
                </h3>
                {copiedJustNow && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Copiado
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSharePreviewText(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar resumen"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <textarea
              readOnly
              rows={8}
              value={sharePreviewText}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Texto de cotización para cliente"
              className="mt-4 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-800 focus:border-teal-700 focus:outline-none"
            />
            <p className="mt-2 text-[11px] text-slate-500">
              No incluye tu tarifa por hora, costos internos, servicios fijos ni margen de ganancia.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSharePreviewText(null)}
                className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void copySummaryText(sharePreviewText)}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-teal-700 px-4 text-xs font-medium text-white hover:bg-teal-800"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copiar texto</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar cotización */}
      <ConfirmModal
        isOpen={Boolean(quoteToDelete)}
        title="Eliminar cotización"
        description={`¿Deseas eliminar "${quoteToDelete?.title ?? ''}" del historial? Esta acción no modifica tus proyectos ni tu inventario.`}
        confirmLabel="Eliminar cotización"
        variant="danger"
        onConfirm={() => void handleConfirmDeleteQuote()}
        onCancel={() => setQuoteToDelete(null)}
      />
    </>
  );
};
