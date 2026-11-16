import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  BookmarkCheck,
  Edit3,
  History,
  MinusCircle,
  Package,
  Plus,
  PlusCircle,
  Search,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type {
  InventoryReservation,
  Material,
  MaterialCategory,
  MaterialVariant,
  MeasurementUnit,
} from '@/src/domain/models/index.ts';
import { getMoneyInputStep } from '@/src/domain/services/currencyCatalog.ts';
import { formatCOP, formatDateTimeCO } from '@/src/domain/services/formatters.ts';
import {
  formatUnitQuantity,
  getCategoryLabel,
  getReservationRemaining,
  getUnitShortLabel,
  getVariantAvailableStock,
  getVariantInventoryValueCOP,
  isVariantLowStock,
  MATERIAL_CATEGORY_OPTIONS,
  MEASUREMENT_UNIT_OPTIONS,
  MOVEMENT_TYPE_META,
  RESERVATION_STATUS_META,
} from '@/src/domain/services/inventoryService.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { EmptyState } from '@/src/shared/components/EmptyState.tsx';
import {
  SnapDeck,
  SnapSlide,
  type SnapDeckHandle,
} from '@/src/shared/components/SnapDeck.tsx';
import { canCreateMaterialReservation } from '@/src/domain/services/planCapabilities.ts';
import { FeatureGate } from '@/src/shared/components/FeatureGate.tsx';
import { StatusBadge } from '@/src/shared/components/StatusBadge.tsx';
import { UsdEquiv } from '@/src/shared/components/UsdEquiv.tsx';
import {
  chunkIntoPages,
  pickPageSize,
  useViewportProfile,
} from '@/src/shared/hooks/useViewportPageSize.ts';

type InventoryTab = 'catalog' | 'reservations' | 'kardex';

const COLOR_PRESETS = [
  '#F8FAFC',
  '#0F172A',
  '#F472B6',
  '#FB7185',
  '#F59E0B',
  '#10B981',
  '#0F766E',
  '#38BDF8',
  '#8B5CF6',
  '#D97706',
  '#92400E',
  '#64748B',
];

export const InventoryView: React.FC = () => {
  const {
    settings,
    effectiveTier,
    materials,
    variants,
    reservations,
    movements,
    projects,
    components,
    createMaterial,
    updateMaterial,
    deleteMaterial,
    createVariant,
    updateVariantMetadata,
    deleteVariant,
    adjustVariantStock,
    createReservation,
    modifyReservationQuantity,
    consumeFromReservation,
    releaseReservation,
    recordDirectProjectConsumption,
  } = useWorkshopData();

  const [reserveGateOpen, setReserveGateOpen] = useState(false);

  const snapDeckRef = useRef<SnapDeckHandle | null>(null);
  const viewportProfile = useViewportProfile();

  const [activeTab, setActiveTab] = useState<InventoryTab>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<MaterialCategory | 'all'>('all');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  // Filtros de reservas y Kardex
  const [reservationStatusFilter, setReservationStatusFilter] = useState<'active' | 'all'>('active');
  const [reservationProjectFilter, setReservationProjectFilter] = useState<string>('all');
  const [kardexVariantFilter, setKardexVariantFilter] = useState<string>('all');

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'error';
    message: string;
  } | null>(null);

  // Modal Crear/Editar Material (+ primer color si es nuevo)
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [matName, setMatName] = useState('');
  const [matCategory, setMatCategory] = useState<MaterialCategory>('yarn_cotton');
  const [matBrand, setMatBrand] = useState('');
  const [matUnit, setMatUnit] = useState<MeasurementUnit>('g');
  const [matDescription, setMatDescription] = useState('');
  // Campos de primer color obligatorio al crear material nuevo
  const [firstColorName, setFirstColorName] = useState('');
  const [firstColorHex, setFirstColorHex] = useState('#0F766E');
  const [firstSku, setFirstSku] = useState('');
  const [firstSize, setFirstSize] = useState('');
  const [firstProvider, setFirstProvider] = useState('');
  const [firstCostCOP, setFirstCostCOP] = useState('50');
  const [firstInitialStock, setFirstInitialStock] = useState('100');
  const [firstMinStock, setFirstMinStock] = useState('50');

  // Modal Agregar/Editar Variante de Color
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [variantParentMaterial, setVariantParentMaterial] = useState<Material | null>(null);
  const [editingVariant, setEditingVariant] = useState<MaterialVariant | null>(null);
  const [varColorName, setVarColorName] = useState('');
  const [varColorHex, setVarColorHex] = useState('#0F766E');
  const [varSize, setVarSize] = useState('');
  const [varSku, setVarSku] = useState('');
  const [varProvider, setVarProvider] = useState('');
  const [varCostCOP, setVarCostCOP] = useState('0');
  const [varInitialStock, setVarInitialStock] = useState('0');
  const [varMinStock, setVarMinStock] = useState('0');
  const [varNotes, setVarNotes] = useState('');

  // Modal Ajuste Manual de Stock
  const [adjustStockVariant, setAdjustStockVariant] = useState<MaterialVariant | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<'add' | 'subtract'>('add');
  const [adjustQty, setAdjustQty] = useState('50');
  const [adjustNotes, setAdjustNotes] = useState('');

  // Modal Crear Reserva
  const [reserveModalOpen, setReserveModalOpen] = useState(false);
  const [reserveVariantId, setReserveVariantId] = useState('');
  const [reserveProjectId, setReserveProjectId] = useState('');
  const [reserveComponentId, setReserveComponentId] = useState('');
  const [reserveQuantity, setReserveQuantity] = useState('50');
  const [reserveNotes, setReserveNotes] = useState('');

  // Modal Consumo Directo sin Reserva
  const [directConsumeVariant, setDirectConsumeVariant] = useState<MaterialVariant | null>(null);
  const [directProjectId, setDirectProjectId] = useState('');
  const [directQuantity, setDirectQuantity] = useState('10');
  const [directNotes, setDirectNotes] = useState('');

  // Modal Consumir desde Reserva
  const [consumeResModal, setConsumeResModal] = useState<InventoryReservation | null>(null);
  const [consumeResQty, setConsumeResQty] = useState('');
  const [consumeResNotes, setConsumeResNotes] = useState('');

  // Modal Modificar Reserva
  const [modifyResModal, setModifyResModal] = useState<InventoryReservation | null>(null);
  const [modifyResQty, setModifyResQty] = useState('');
  const [modifyResNotes, setModifyResNotes] = useState('');

  // Confirmaciones de eliminación / liberación
  const [reservationToRelease, setReservationToRelease] =
    useState<InventoryReservation | null>(null);
  const [variantToDelete, setVariantToDelete] = useState<MaterialVariant | null>(null);
  const [materialToDelete, setMaterialToDelete] = useState<Material | null>(null);

  const materialMap = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );
  const variantMap = useMemo(
    () => new Map(variants.map((v) => [v.id, v])),
    [variants],
  );
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const componentMap = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );

  // Indicadores generales de Inventario
  const totalValueCOP = useMemo(
    () => variants.reduce((sum, v) => sum + getVariantInventoryValueCOP(v), 0),
    [variants],
  );
  const lowStockCount = useMemo(
    () => variants.filter((v) => isVariantLowStock(v)).length,
    [variants],
  );
  const activeReservationsCount = useMemo(
    () => reservations.filter((r) => r.status === 'active').length,
    [reservations],
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return materials
      .filter((mat) => {
        if (categoryFilter !== 'all' && mat.category !== categoryFilter) {
          return false;
        }
        const matVariants = variants.filter((v) => v.materialId === mat.id);
        if (lowStockOnly && !matVariants.some((v) => isVariantLowStock(v))) {
          return false;
        }
        if (!q) return true;
        const matchesMat =
          mat.name.toLowerCase().includes(q) ||
          mat.brand.toLowerCase().includes(q);
        const matchesVariant = matVariants.some(
          (v) =>
            v.colorName.toLowerCase().includes(q) ||
            (v.sku ?? '').toLowerCase().includes(q) ||
            v.provider.toLowerCase().includes(q),
        );
        return matchesMat || matchesVariant;
      })
      .map((mat) => {
        const matVariants = variants
          .filter((v) => {
            if (v.materialId !== mat.id) return false;
            if (lowStockOnly && !isVariantLowStock(v)) return false;
            if (!q) return true;
            const matMatch =
              mat.name.toLowerCase().includes(q) ||
              mat.brand.toLowerCase().includes(q);
            if (matMatch) return true;
            return (
              v.colorName.toLowerCase().includes(q) ||
              (v.sku ?? '').toLowerCase().includes(q) ||
              v.provider.toLowerCase().includes(q)
            );
          })
          .sort((a, b) => a.colorName.localeCompare(b.colorName));

        return { material: mat, variants: matVariants };
      });
  }, [materials, variants, searchQuery, categoryFilter, lowStockOnly]);

  const filteredReservations = useMemo(() => {
    return reservations
      .filter((r) => {
        if (reservationStatusFilter === 'active' && r.status !== 'active') {
          return false;
        }
        if (
          reservationProjectFilter !== 'all' &&
          r.projectId !== reservationProjectFilter
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [reservations, reservationStatusFilter, reservationProjectFilter]);

  const filteredMovements = useMemo(() => {
    return movements
      .filter((m) =>
        kardexVariantFilter === 'all' ? true : m.variantId === kardexVariantFilter,
      )
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [movements, kardexVariantFilter]);

  // Paginación adaptativa por tamaño de pantalla para evitar recortes en catálogo, reservas y Kardex
  const catalogPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 2,
    tablet: 3,
    desktopCompact: 3,
    desktopRegular: 4,
    desktopTall: 5,
  });
  const reservationsPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 2,
    tablet: 3,
    desktopCompact: 3,
    desktopRegular: 4,
    desktopTall: 5,
  });
  const kardexPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 2,
    mobileRegular: 3,
    tablet: 4,
    desktopCompact: 4,
    desktopRegular: 5,
    desktopTall: 6,
  });

  type CatalogUnit = {
    material: Material;
    variant: MaterialVariant | null;
  };

  const catalogPages = useMemo(() => {
    const units: CatalogUnit[] = [];
    for (const entry of filteredCatalog) {
      if (entry.variants.length === 0) {
        units.push({ material: entry.material, variant: null });
      } else {
        for (const variant of entry.variants) {
          units.push({ material: entry.material, variant });
        }
      }
    }
    const rawPages = chunkIntoPages(units, catalogPageSize);
    return rawPages.map((pageUnits) => {
      const groups: Array<{
        material: Material;
        variants: MaterialVariant[];
        isEmptyMaterial: boolean;
      }> = [];
      for (const item of pageUnits) {
        const last = groups[groups.length - 1];
        if (last && last.material.id === item.material.id) {
          if (item.variant) last.variants.push(item.variant);
        } else {
          groups.push({
            material: item.material,
            variants: item.variant ? [item.variant] : [],
            isEmptyMaterial: item.variant === null,
          });
        }
      }
      return groups;
    });
  }, [filteredCatalog, catalogPageSize]);

  const reservationPages = useMemo(
    () => chunkIntoPages(filteredReservations, reservationsPageSize),
    [filteredReservations, reservationsPageSize],
  );

  const movementPages = useMemo(
    () => chunkIntoPages(filteredMovements, kardexPageSize),
    [filteredMovements, kardexPageSize],
  );

  const handleTabJump = (tab: InventoryTab) => {
    setActiveTab(tab);
    if (tab === 'catalog') {
      snapDeckRef.current?.goToSlide('inv-overview');
    } else if (tab === 'reservations') {
      snapDeckRef.current?.goToSlide('inv-res-0');
    } else {
      snapDeckRef.current?.goToSlide('inv-kardex-0');
    }
  };

  const handleSlideChange = (slideId: string) => {
    if (slideId.startsWith('inv-res')) {
      setActiveTab('reservations');
    } else if (slideId.startsWith('inv-kardex')) {
      setActiveTab('kardex');
    } else {
      setActiveTab('catalog');
    }
  };

  // Handlers de Material
  const openNewMaterialModal = () => {
    setEditingMaterial(null);
    setMatName('');
    setMatCategory('yarn_cotton');
    setMatBrand('');
    setMatUnit('g');
    setMatDescription('');
    setFirstColorName('');
    setFirstColorHex('#0F766E');
    setFirstSku('');
    setFirstSize('');
    setFirstProvider('');
    setFirstCostCOP('50');
    setFirstInitialStock('100');
    setFirstMinStock('50');
    setMaterialModalOpen(true);
  };

  const openEditMaterialModal = (mat: Material) => {
    setEditingMaterial(mat);
    setMatName(mat.name);
    setMatCategory(mat.category);
    setMatBrand(mat.brand);
    setMatUnit(mat.unit);
    setMatDescription(mat.description);
    setMaterialModalOpen(true);
  };

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (editingMaterial) {
        await updateMaterial(editingMaterial.id, {
          name: matName,
          category: matCategory,
          brand: matBrand,
          unit: matUnit,
          description: matDescription,
        });
      } else {
        const createdMat = await createMaterial({
          name: matName,
          category: matCategory,
          brand: matBrand,
          unit: matUnit,
          description: matDescription,
        });
        await createVariant({
          materialId: createdMat.id,
          colorName: firstColorName,
          colorHex: firstColorHex,
          sizeOrGauge: firstSize || null,
          sku: firstSku || null,
          provider: firstProvider,
          unitCostCOP: Number(firstCostCOP) || 0,
          initialPhysicalStock: Number(firstInitialStock) || 0,
          minStock: Number(firstMinStock) || 0,
          notes: '',
        });
      }
      setMaterialModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Error al guardar el material.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Handlers de Variantes por Color
  const openCreateVariantModal = (mat: Material) => {
    setVariantParentMaterial(mat);
    setEditingVariant(null);
    setVarColorName('');
    setVarColorHex('#F472B6');
    setVarSize('');
    setVarSku('');
    setVarProvider('');
    setVarCostCOP('50');
    setVarInitialStock('100');
    setVarMinStock('50');
    setVarNotes('');
    setVariantModalOpen(true);
  };

  const openEditVariantModal = (mat: Material, variant: MaterialVariant) => {
    setVariantParentMaterial(mat);
    setEditingVariant(variant);
    setVarColorName(variant.colorName);
    setVarColorHex(variant.colorHex ?? '#0F766E');
    setVarSize(variant.sizeOrGauge ?? '');
    setVarSku(variant.sku ?? '');
    setVarProvider(variant.provider);
    setVarCostCOP(String(variant.unitCostCOP));
    setVarInitialStock(String(variant.physicalStock));
    setVarMinStock(String(variant.minStock));
    setVarNotes(variant.notes);
    setVariantModalOpen(true);
  };

  const handleSaveVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantParentMaterial) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (editingVariant) {
        await updateVariantMetadata(editingVariant.id, {
          colorName: varColorName,
          colorHex: varColorHex,
          sizeOrGauge: varSize || null,
          sku: varSku || null,
          provider: varProvider,
          unitCostCOP: Number(varCostCOP) || 0,
          minStock: Number(varMinStock) || 0,
          notes: varNotes,
        });
      } else {
        await createVariant({
          materialId: variantParentMaterial.id,
          colorName: varColorName,
          colorHex: varColorHex,
          sizeOrGauge: varSize || null,
          sku: varSku || null,
          provider: varProvider,
          unitCostCOP: Number(varCostCOP) || 0,
          initialPhysicalStock: Number(varInitialStock) || 0,
          minStock: Number(varMinStock) || 0,
          notes: varNotes,
        });
      }
      setVariantModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Error al guardar el color.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Ajuste de Stock Físico
  const openAdjustStockModal = (variant: MaterialVariant) => {
    setAdjustStockVariant(variant);
    setAdjustDirection('add');
    setAdjustQty('50');
    setAdjustNotes('');
  };

  const handleConfirmAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustStockVariant) return;
    const rawQty = Number(adjustQty);
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      setFeedback({
        type: 'error',
        message: 'La cantidad del ajuste debe ser mayor a 0.',
      });
      return;
    }
    const delta = adjustDirection === 'add' ? rawQty : -rawQty;
    setBusy(true);
    setFeedback(null);
    try {
      await adjustVariantStock({
        variantId: adjustStockVariant.id,
        quantityDelta: delta,
        notes: adjustNotes,
      });
      setAdjustStockVariant(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible aplicar el ajuste de stock.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Reservas
  const openReserveModal = (variant?: MaterialVariant) => {
    if (!canCreateMaterialReservation(effectiveTier)) {
      setReserveGateOpen(true);
      return;
    }
    const defaultVar = variant ?? variants[0];
    setReserveVariantId(defaultVar?.id ?? '');
    const compatibleProjects = projects.filter((p) =>
      defaultVar?.isDemo ? true : !p.isDemo,
    );
    const firstProj =
      compatibleProjects.find((p) => p.status === 'in_progress') ??
      compatibleProjects[0];
    setReserveProjectId(firstProj?.id ?? '');
    setReserveComponentId('');
    setReserveQuantity('50');
    setReserveNotes('');
    setReserveModalOpen(true);
  };

  const reserveCompatibleProjects = useMemo(() => {
    const selectedVar = variantMap.get(reserveVariantId);
    if (!selectedVar) return projects;
    return selectedVar.isDemo
      ? projects
      : projects.filter((p) => !p.isDemo);
  }, [projects, reserveVariantId, variantMap]);

  const reserveProjectComponents = useMemo(() => {
    return components
      .filter((c) => c.projectId === reserveProjectId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [components, reserveProjectId]);

  const handleConfirmReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateMaterialReservation(effectiveTier)) {
      setReserveModalOpen(false);
      setReserveGateOpen(true);
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await createReservation({
        variantId: reserveVariantId,
        projectId: reserveProjectId,
        componentId: reserveComponentId || null,
        quantity: Number(reserveQuantity) || 0,
        notes: reserveNotes,
      });
      setReserveModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No fue posible crear la reserva.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Consumo directo
  const openDirectConsumeModal = (variant: MaterialVariant) => {
    setDirectConsumeVariant(variant);
    const compatible = variant.isDemo
      ? projects
      : projects.filter((p) => !p.isDemo);
    const firstProj =
      compatible.find((p) => p.status === 'in_progress') ?? compatible[0];
    setDirectProjectId(firstProj?.id ?? '');
    setDirectQuantity('10');
    setDirectNotes('');
  };

  const handleConfirmDirectConsume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directConsumeVariant) return;
    setBusy(true);
    setFeedback(null);
    try {
      await recordDirectProjectConsumption({
        variantId: directConsumeVariant.id,
        projectId: directProjectId,
        quantity: Number(directQuantity) || 0,
        notes: directNotes,
      });
      setDirectConsumeVariant(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible registrar el consumo.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Consumo desde Reserva
  const handleConfirmConsumeFromRes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consumeResModal) return;
    setBusy(true);
    setFeedback(null);
    try {
      await consumeFromReservation({
        reservationId: consumeResModal.id,
        quantity: Number(consumeResQty) || 0,
        notes: consumeResNotes,
      });
      setConsumeResModal(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No fue posible registrar el consumo de la reserva.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Modificar Reserva
  const handleConfirmModifyRes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modifyResModal) return;
    setBusy(true);
    setFeedback(null);
    try {
      await modifyReservationQuantity(
        modifyResModal.id,
        Number(modifyResQty) || 0,
        modifyResNotes,
      );
      setModifyResModal(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar la cantidad reservada.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReleaseReservation = async () => {
    if (!reservationToRelease) return;
    setBusy(true);
    setFeedback(null);
    try {
      await releaseReservation(reservationToRelease.id);
      setReservationToRelease(null);
    } catch (err) {
      setReservationToRelease(null);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo liberar la reserva.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteVariant = async () => {
    if (!variantToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deleteVariant(variantToDelete.id);
      setVariantToDelete(null);
    } catch (err) {
      setVariantToDelete(null);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo eliminar el color.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteMaterial = async () => {
    if (!materialToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deleteMaterial(materialToDelete.id);
      setMaterialToDelete(null);
    } catch (err) {
      setMaterialToDelete(null);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo eliminar el material.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SnapDeck
        ref={snapDeckRef}
        ariaLabel="Inventario por color, reservas y Kardex"
        onSlideChange={handleSlideChange}
        topSlot={
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div
                className="grid w-full grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:inline-flex sm:w-auto sm:items-center"
                role="tablist"
                aria-label="Secciones de inventario"
              >
                {(
                  [
                    {
                      id: 'catalog',
                      label: `Catálogo (${variants.length})`,
                      icon: Package,
                    },
                    {
                      id: 'reservations',
                      label: `Reservas (${activeReservationsCount})`,
                      icon: BookmarkCheck,
                    },
                    {
                      id: 'kardex',
                      label: `Kardex (${movements.length})`,
                      icon: History,
                    },
                  ] as Array<{
                    id: InventoryTab;
                    label: string;
                    icon: typeof Package;
                  }>
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => handleTabJump(tab.id)}
                      className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
                        active
                          ? 'bg-teal-700 text-white'
                          : 'text-slate-600 hover:bg-white hover:text-slate-900'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="hidden sm:flex items-center gap-2 shrink-0">
                {variants.length > 0 && projects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openReserveModal()}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <BookmarkCheck className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    <span>Reservar</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={openNewMaterialModal}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Nuevo material</span>
                </button>
              </div>
            </div>

            {feedback && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900 sm:text-sm"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
                  <p>{feedback.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFeedback(null)}
                  className="text-xs font-medium underline shrink-0"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        }
      >
        {/* PANTALLA 1: RESUMEN DE INVENTARIO Y FILTROS DEL CATÁLOGO */}
        <SnapSlide id="inv-overview" label="Resumen y filtros">
          <div className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 sm:text-xl">
                    Inventario por color y Kardex
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-slate-600">
                    Controla stock físico, reservas compartidas entre proyectos y
                    disponibilidad real de cada color.
                  </p>
                </div>
                <div
                  className={`grid w-full gap-2 sm:hidden ${
                    variants.length > 0 && projects.length > 0
                      ? 'grid-cols-2'
                      : 'grid-cols-1'
                  }`}
                >
                  {variants.length > 0 && projects.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openReserveModal()}
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <BookmarkCheck className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                      <span>Reservar</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openNewMaterialModal}
                    className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                  >
                    <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Nuevo material</span>
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 lg:grid-cols-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">Colores registrados</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">
                    {variants.length}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Valor en stock físico</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">
                    {formatCOP(totalValueCOP)}
                  </p>
                  <UsdEquiv amount={totalValueCOP} block />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Stock bajo mínimo</p>
                  <p
                    className={`mt-0.5 font-mono text-lg font-semibold tabular-nums sm:text-xl ${
                      lowStockCount > 0 ? 'text-amber-700' : 'text-slate-900'
                    }`}
                  >
                    {lowStockCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Reservas activas</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-teal-800 tabular-nums sm:text-xl">
                    {activeReservationsCount}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por material, color, marca, SKU o proveedor..."
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <select
                  aria-label="Filtrar por categoría"
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value as MaterialCategory | 'all')
                  }
                  className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="all">Todas las categorías</option>
                  {MATERIAL_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <label className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={lowStockOnly}
                    onChange={(e) => setLowStockOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <span>Solo stock bajo</span>
                </label>
              </div>

              {filteredCatalog.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  <span className="tabular-nums">
                    {filteredCatalog.length} material
                    {filteredCatalog.length === 1 ? '' : 'es'} ·{' '}
                    {filteredCatalog.reduce((acc, g) => acc + g.variants.length, 0)} color
                    {filteredCatalog.reduce((acc, g) => acc + g.variants.length, 0) === 1
                      ? ''
                      : 'es'}{' '}
                    en {catalogPages.length} vista{catalogPages.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => snapDeckRef.current?.goToSlide('inv-catalog-0')}
                    className="font-semibold text-teal-800 hover:underline"
                  >
                    Ver catálogo por color →
                  </button>
                </div>
              )}
            </section>

            {filteredCatalog.length === 0 && (
              <EmptyState
                icon={Package}
                title={
                  materials.length === 0
                    ? 'Aún no tienes materiales registrados'
                    : 'Ningún material o color coincide con tu filtro'
                }
                description={
                  materials.length === 0
                    ? 'Registra tu primer hilo, lana o insumo indicando su color y costo por unidad.'
                    : 'Prueba limpiando el buscador o cambiando el filtro de categoría.'
                }
                primaryAction={{
                  label: 'Registrar material y color',
                  onClick: openNewMaterialModal,
                }}
              />
            )}
          </div>
        </SnapSlide>

        {/* PANTALLAS DEL CATÁLOGO POR COLOR (PAGINADO SIN RECORTES) */}
        {catalogPages.map((pageGroups, pageIdx) => (
          <SnapSlide
            key={`inv-catalog-${pageIdx}`}
            id={`inv-catalog-${pageIdx}`}
            label={
              catalogPages.length > 1
                ? `Catálogo ${pageIdx + 1}/${catalogPages.length}`
                : 'Catálogo por color'
            }
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Catálogo por color
                  {catalogPages.length > 1
                    ? ` · Página ${pageIdx + 1} de ${catalogPages.length}`
                    : ''}
                </p>
                {(searchQuery || categoryFilter !== 'all' || lowStockOnly) && (
                  <button
                    type="button"
                    onClick={() => snapDeckRef.current?.goToSlide('inv-overview')}
                    className="text-xs font-medium text-teal-800 hover:underline"
                  >
                    Ajustar filtros activos
                  </button>
                )}
              </div>

              {pageGroups.map(({ material, variants: matVariants, isEmptyMaterial }) => (
                <section
                  key={`${material.id}-${pageIdx}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                >
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        {getCategoryLabel(material.category)}
                        {material.brand ? ` · ${material.brand}` : ''}
                        {' · Unidad: '}
                        {getUnitShortLabel(material.unit)}
                        {material.isDemo ? ' · Ejemplo' : ''}
                      </p>
                      <h3 className="mt-0.5 font-display text-base font-semibold text-slate-900">
                        {material.name}
                      </h3>
                      {material.description && (
                        <p className="mt-0.5 text-xs text-slate-600 line-clamp-2">
                          {material.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openCreateVariantModal(material)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Agregar color</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditMaterialModal(material)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                        aria-label={`Editar ${material.name}`}
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      {isEmptyMaterial && (
                        <button
                          type="button"
                          onClick={() => setMaterialToDelete(material)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50"
                          aria-label={`Eliminar ${material.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isEmptyMaterial ? (
                    <div className="py-4 text-center text-xs text-slate-500">
                      Este material aún no tiene colores registrados.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {matVariants.map((variant) => {
                        const available = getVariantAvailableStock(variant);
                        const lowStock = isVariantLowStock(variant);

                        return (
                          <div
                            key={variant.id}
                            className="flex flex-col gap-3 py-3.5 first:pt-3.5 last:pb-0 lg:flex-row lg:items-center lg:justify-between"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <span
                                className="mt-0.5 h-8 w-8 shrink-0 rounded-lg border border-slate-300 shadow-2xs"
                                style={{
                                  backgroundColor: variant.colorHex ?? '#E2E8F0',
                                }}
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-display text-sm font-semibold text-slate-900">
                                    {variant.colorName}
                                  </h4>
                                  {lowStock && (
                                    <StatusBadge label="Stock bajo" tone="warning" />
                                  )}
                                  {variant.sku && (
                                    <span className="font-mono text-[11px] text-slate-500">
                                      SKU {variant.sku}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                                  Costo: {formatCOP(variant.unitCostCOP)} /{' '}
                                  {getUnitShortLabel(material.unit)}
                                  <UsdEquiv amount={variant.unitCostCOP} prefix=" (" suffix=")" />
                                  {variant.sizeOrGauge
                                    ? ` · Calibre ${variant.sizeOrGauge}`
                                    : ''}
                                  {variant.provider ? ` · ${variant.provider}` : ''}
                                  {` · Mínimo: ${formatUnitQuantity(variant.minStock, material.unit)}`}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
                              <div className="grid grid-cols-4 gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs tabular-nums">
                                <div>
                                  <p className="text-[11px] text-slate-500">Físico</p>
                                  <p className="font-mono font-semibold text-slate-900">
                                    {formatUnitQuantity(variant.physicalStock, material.unit)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500">Reservado</p>
                                  <p className="font-mono font-semibold text-slate-700">
                                    {formatUnitQuantity(variant.reservedStock, material.unit)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500">Disponible</p>
                                  <p
                                    className={`font-mono font-bold ${
                                      lowStock ? 'text-amber-700' : 'text-teal-800'
                                    }`}
                                  >
                                    {formatUnitQuantity(available, material.unit)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500">Consumido</p>
                                  <p className="font-mono font-medium text-slate-600">
                                    {formatUnitQuantity(variant.totalConsumed, material.unit)}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={projects.length === 0 || available <= 0}
                                  onClick={() => openReserveModal(variant)}
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-40"
                                >
                                  <BookmarkCheck className="h-3.5 w-3.5" />
                                  <span>Reservar</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAdjustStockModal(variant)}
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5" />
                                  <span>Ajustar</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={projects.length === 0 || available <= 0}
                                  onClick={() => openDirectConsumeModal(variant)}
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                                >
                                  <MinusCircle className="h-3.5 w-3.5" />
                                  <span>Consumir</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditVariantModal(material, variant)}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                  aria-label={`Editar color ${variant.colorName}`}
                                >
                                  <Edit3 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setVariantToDelete(variant)}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50"
                                  aria-label={`Eliminar color ${variant.colorName}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </SnapSlide>
        ))}

        {/* PANTALLAS DE RESERVAS COMPARTIDAS ENTRE PROYECTOS */}
        {reservationPages.length === 0 ? (
          <SnapSlide id="inv-res-0" label="Reservas">
            <div className="space-y-4">
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setReservationStatusFilter('active')}
                        className={`min-h-[34px] rounded-md px-3 text-xs font-medium ${
                          reservationStatusFilter === 'active'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600'
                        }`}
                      >
                        Activas
                      </button>
                      <button
                        type="button"
                        onClick={() => setReservationStatusFilter('all')}
                        className={`min-h-[34px] rounded-md px-3 text-xs font-medium ${
                          reservationStatusFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600'
                        }`}
                      >
                        Todas
                      </button>
                    </div>

                    <select
                      aria-label="Filtrar reservas por proyecto"
                      value={reservationProjectFilter}
                      onChange={(e) => setReservationProjectFilter(e.target.value)}
                      className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="all">Todos los proyectos</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {variants.length > 0 && projects.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openReserveModal()}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 text-xs font-medium text-white hover:bg-teal-800 self-start sm:self-auto"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Nueva reserva</span>
                    </button>
                  )}
                </div>
              </section>

              <EmptyState
                icon={BookmarkCheck}
                title="No hay reservas para mostrar"
                description="Cuando reservas un color para un proyecto, esa cantidad se descuenta del stock disponible para que otros proyectos no usen el mismo material por error."
                primaryAction={
                  variants.length > 0 && projects.length > 0
                    ? {
                        label: 'Crear reserva',
                        onClick: () => openReserveModal(),
                      }
                    : undefined
                }
              />
            </div>
          </SnapSlide>
        ) : (
          reservationPages.map((pageReservations, pageIdx) => (
            <SnapSlide
              key={`inv-res-${pageIdx}`}
              id={`inv-res-${pageIdx}`}
              label={
                reservationPages.length > 1
                  ? `Reservas ${pageIdx + 1}/${reservationPages.length}`
                  : 'Reservas'
              }
            >
              <div className="space-y-4">
                {pageIdx === 0 ? (
                  <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                          <button
                            type="button"
                            onClick={() => setReservationStatusFilter('active')}
                            className={`min-h-[34px] rounded-md px-3 text-xs font-medium ${
                              reservationStatusFilter === 'active'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            Activas
                          </button>
                          <button
                            type="button"
                            onClick={() => setReservationStatusFilter('all')}
                            className={`min-h-[34px] rounded-md px-3 text-xs font-medium ${
                              reservationStatusFilter === 'all'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            Todas
                          </button>
                        </div>

                        <select
                          aria-label="Filtrar reservas por proyecto"
                          value={reservationProjectFilter}
                          onChange={(e) => setReservationProjectFilter(e.target.value)}
                          className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
                        >
                          <option value="all">Todos los proyectos</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {variants.length > 0 && projects.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openReserveModal()}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 text-xs font-medium text-white hover:bg-teal-800 self-start sm:self-auto"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Nueva reserva</span>
                        </button>
                      )}
                    </div>
                  </section>
                ) : (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Reservas · Página {pageIdx + 1} de {reservationPages.length}
                  </p>
                )}

                <section className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                  {pageReservations.map((res) => {
                    const variant = variantMap.get(res.variantId);
                    const material = variant
                      ? materialMap.get(variant.materialId)
                      : undefined;
                    const project = projectMap.get(res.projectId);
                    const component = res.componentId
                      ? componentMap.get(res.componentId)
                      : undefined;
                    const unit = material?.unit ?? 'unit';
                    const remaining = getReservationRemaining(res);
                    const statusMeta = RESERVATION_STATUS_META[res.status];

                    return (
                      <div
                        key={res.id}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span
                            className="mt-0.5 h-7 w-7 shrink-0 rounded-md border border-slate-300"
                            style={{
                              backgroundColor: variant?.colorHex ?? '#E2E8F0',
                            }}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-display text-sm font-semibold text-slate-900">
                                {material?.name ?? 'Material'} ·{' '}
                                {variant?.colorName ?? 'Color'}
                              </h4>
                              <StatusBadge
                                label={statusMeta.label}
                                tone={statusMeta.tone}
                              />
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                              Proyecto: <strong>{project?.name ?? 'Proyecto'}</strong>
                              {component ? ` · Pieza: ${component.name}` : ''}
                              {res.isDemo ? ' · Ejemplo' : ''}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 tabular-nums">
                              Reservado: {formatUnitQuantity(res.reservedQuantity, unit)} ·
                              Consumido: {formatUnitQuantity(res.consumedQuantity, unit)} ·
                              Pendiente:{' '}
                              <strong className="text-slate-900">
                                {formatUnitQuantity(remaining, unit)}
                              </strong>
                              {res.notes ? ` · ${res.notes}` : ''}
                            </p>
                          </div>
                        </div>

                        {res.status === 'active' && (
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setConsumeResModal(res);
                                setConsumeResQty(String(remaining));
                                setConsumeResNotes('');
                              }}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800"
                            >
                              <MinusCircle className="h-3.5 w-3.5" />
                              <span>Registrar consumo</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setModifyResModal(res);
                                setModifyResQty(String(res.reservedQuantity));
                                setModifyResNotes(res.notes);
                              }}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Ajustar</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setReservationToRelease(res)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Unlock className="h-3.5 w-3.5" />
                              <span>Liberar</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              </div>
            </SnapSlide>
          ))
        )}

        {/* PANTALLAS DE KARDEX INMUTABLE */}
        {movementPages.length === 0 ? (
          <SnapSlide id="inv-kardex-0" label="Kardex">
            <div className="space-y-4">
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Historial inmutable de movimientos (Kardex)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Los registros históricos nunca se editan ni eliminan; cualquier
                    cambio genera un nuevo movimiento auditable.
                  </p>
                </div>
                <select
                  aria-label="Filtrar Kardex por color"
                  value={kardexVariantFilter}
                  onChange={(e) => setKardexVariantFilter(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
                >
                  <option value="all">Todos los materiales y colores</option>
                  {variants.map((v) => {
                    const mat = materialMap.get(v.materialId);
                    return (
                      <option key={v.id} value={v.id}>
                        {mat?.name ?? 'Material'} · {v.colorName}
                      </option>
                    );
                  })}
                </select>
              </section>

              <EmptyState
                icon={History}
                title="No hay movimientos en el Kardex"
                description="Cuando registres stock inicial, ajustes, reservas o consumos de proyectos aparecerán aquí de forma cronológica."
              />
            </div>
          </SnapSlide>
        ) : (
          movementPages.map((pageMovements, pageIdx) => (
            <SnapSlide
              key={`inv-kardex-${pageIdx}`}
              id={`inv-kardex-${pageIdx}`}
              label={
                movementPages.length > 1
                  ? `Kardex ${pageIdx + 1}/${movementPages.length}`
                  : 'Kardex'
              }
            >
              <div className="space-y-4">
                {pageIdx === 0 ? (
                  <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-slate-900">
                        Historial inmutable de movimientos (Kardex)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Los registros históricos nunca se editan ni eliminan; cualquier
                        cambio genera un nuevo movimiento auditable.
                      </p>
                    </div>
                    <select
                      aria-label="Filtrar Kardex por color"
                      value={kardexVariantFilter}
                      onChange={(e) => setKardexVariantFilter(e.target.value)}
                      className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="all">Todos los materiales y colores</option>
                      {variants.map((v) => {
                        const mat = materialMap.get(v.materialId);
                        return (
                          <option key={v.id} value={v.id}>
                            {mat?.name ?? 'Material'} · {v.colorName}
                          </option>
                        );
                      })}
                    </select>
                  </section>
                ) : (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Kardex · Página {pageIdx + 1} de {movementPages.length}
                  </p>
                )}

                <section className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                  {pageMovements.map((mov) => {
                    const variant = variantMap.get(mov.variantId);
                    const material = variant
                      ? materialMap.get(variant.materialId)
                      : undefined;
                    const unit = material?.unit ?? 'unit';
                    const project = mov.projectId
                      ? projectMap.get(mov.projectId)
                      : undefined;
                    const meta = MOVEMENT_TYPE_META[mov.type];
                    const sign = mov.quantityDelta > 0 ? '+' : '';

                    return (
                      <div
                        key={mov.id}
                        className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge label={meta.label} tone={meta.tone} />
                            <p className="text-sm font-semibold text-slate-900">
                              {material?.name ?? 'Material'} ·{' '}
                              {variant?.colorName ?? 'Color'}
                            </p>
                            {project && (
                              <span className="text-xs text-slate-600">
                                · {project.name}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {formatDateTimeCO(mov.timestamp)} · Físico:{' '}
                            {mov.previousPhysicalStock} → {mov.newPhysicalStock}{' '}
                            {getUnitShortLabel(unit)} · Reservado:{' '}
                            {mov.previousReservedStock} → {mov.newReservedStock}{' '}
                            {getUnitShortLabel(unit)} · Costo ref:{' '}
                            {formatCOP(mov.unitCostAtMovementCOP)}
                          </p>
                          {mov.notes && (
                            <p className="text-xs text-slate-600">{mov.notes}</p>
                          )}
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <span
                            className={`font-mono text-sm font-bold tabular-nums ${
                              mov.quantityDelta > 0
                                ? 'text-emerald-700'
                                : mov.quantityDelta < 0
                                  ? 'text-rose-700'
                                  : 'text-slate-700'
                            }`}
                          >
                            {sign}
                            {formatUnitQuantity(mov.quantityDelta, unit)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </section>
              </div>
            </SnapSlide>
          ))
        )}
      </SnapDeck>

      {/* MODAL CREAR / EDITAR MATERIAL (+ PRIMER COLOR) */}
      {materialModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="material-modal-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  {editingMaterial
                    ? 'Editar material'
                    : 'Nuevo material y primer color'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {editingMaterial
                    ? 'Actualiza los datos base del material.'
                    : 'Cada hilo, lana o insumo se controla por color independiente.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMaterialModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar formulario"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveMaterial(e)}
              className="mt-5 space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="mat-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Nombre del material *
                  </label>
                  <input
                    id="mat-name"
                    type="text"
                    required
                    placeholder="Ej. Hilo de Algodón Peinado, Lana Merino..."
                    value={matName}
                    onChange={(e) => setMatName(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mat-cat"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Categoría
                  </label>
                  <select
                    id="mat-cat"
                    value={matCategory}
                    onChange={(e) =>
                      setMatCategory(e.target.value as MaterialCategory)
                    }
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {MATERIAL_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mat-unit"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Unidad de medida
                  </label>
                  <select
                    id="mat-unit"
                    value={matUnit}
                    onChange={(e) =>
                      setMatUnit(e.target.value as MeasurementUnit)
                    }
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {MEASUREMENT_UNIT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="mat-brand"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Marca o referencia
                  </label>
                  <input
                    id="mat-brand"
                    type="text"
                    placeholder="Ej. Abuelita, Cisne, Sinfonía..."
                    value={matBrand}
                    onChange={(e) => setMatBrand(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              {!editingMaterial && (
                <div className="space-y-4 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-800">
                    Datos del primer color *
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="first-color-name"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Nombre del color *
                      </label>
                      <input
                        id="first-color-name"
                        type="text"
                        required
                        placeholder="Ej. Blanco Nieve, Rosa Pastel..."
                        value={firstColorName}
                        onChange={(e) => setFirstColorName(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="first-color-hex"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Muestra visual
                      </label>
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          id="first-color-hex"
                          type="color"
                          value={firstColorHex}
                          onChange={(e) => setFirstColorHex(e.target.value)}
                          className="h-[42px] w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                        />
                        <div className="flex flex-wrap gap-1">
                          {COLOR_PRESETS.slice(0, 6).map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              onClick={() => setFirstColorHex(hex)}
                              className="h-6 w-6 rounded border border-slate-300"
                              style={{ backgroundColor: hex }}
                              aria-label={`Color ${hex}`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="first-initial-stock"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Stock físico inicial ({getUnitShortLabel(matUnit)})
                      </label>
                      <input
                        id="first-initial-stock"
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        value={firstInitialStock}
                        onChange={(e) => setFirstInitialStock(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="first-min-stock"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Stock mínimo de alerta
                      </label>
                      <input
                        id="first-min-stock"
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        value={firstMinStock}
                        onChange={(e) => setFirstMinStock(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="first-cost-cop"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Costo por {getUnitShortLabel(matUnit)} ({settings.currency})
                      </label>
                      <input
                        id="first-cost-cop"
                        type="number"
                        min={0}
                        step={getMoneyInputStep(settings.currency)}
                        required
                        value={firstCostCOP}
                        onChange={(e) => setFirstCostCOP(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="first-provider"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Proveedor habitual
                      </label>
                      <input
                        id="first-provider"
                        type="text"
                        placeholder="Ej. Lanas El Centro"
                        value={firstProvider}
                        onChange={(e) => setFirstProvider(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="first-size"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Calibre / tamaño (opcional)
                      </label>
                      <input
                        id="first-size"
                        type="text"
                        placeholder="Ej. 2.5mm - 3.0mm, 12mm"
                        value={firstSize}
                        onChange={(e) => setFirstSize(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="first-sku"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Código / SKU (opcional)
                      </label>
                      <input
                        id="first-sku"
                        type="text"
                        placeholder="Ej. ALG-BLA-01"
                        value={firstSku}
                        onChange={(e) => setFirstSku(e.target.value)}
                        className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setMaterialModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy
                    ? 'Guardando...'
                    : editingMaterial
                      ? 'Guardar cambios'
                      : 'Crear material y color'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL AGREGAR / EDITAR VARIANTE DE COLOR */}
      {variantModalOpen && variantParentMaterial && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="variant-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="variant-modal-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  {editingVariant
                    ? `Editar color · ${variantParentMaterial.name}`
                    : `Agregar color a ${variantParentMaterial.name}`}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {editingVariant
                    ? 'Para cambiar existencias físicas usa "Ajustar" y conservar la trazabilidad del Kardex.'
                    : 'Cada color maneja su stock físico, reservas y alertas independientes.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVariantModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar formulario"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveVariant(e)}
              className="mt-5 space-y-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="var-color-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Nombre del color *
                  </label>
                  <input
                    id="var-color-name"
                    type="text"
                    required
                    value={varColorName}
                    onChange={(e) => setVarColorName(e.target.value)}
                    placeholder="Ej. Azul Celeste"
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="var-color-hex"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Color visual
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      id="var-color-hex"
                      type="color"
                      value={varColorHex}
                      onChange={(e) => setVarColorHex(e.target.value)}
                      className="h-[42px] w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                    />
                    <div className="flex flex-wrap gap-1">
                      {COLOR_PRESETS.slice(6, 12).map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setVarColorHex(hex)}
                          className="h-6 w-6 rounded border border-slate-300"
                          style={{ backgroundColor: hex }}
                          aria-label={`Color ${hex}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {!editingVariant && (
                  <div>
                    <label
                      htmlFor="var-init-stock"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Stock físico inicial ({getUnitShortLabel(variantParentMaterial.unit)})
                    </label>
                    <input
                      id="var-init-stock"
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      value={varInitialStock}
                      onChange={(e) => setVarInitialStock(e.target.value)}
                      className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="var-min-stock"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Stock mínimo ({getUnitShortLabel(variantParentMaterial.unit)})
                  </label>
                  <input
                    id="var-min-stock"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={varMinStock}
                    onChange={(e) => setVarMinStock(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="var-cost"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Costo unitario ({settings.currency})
                  </label>
                  <input
                    id="var-cost"
                    type="number"
                    min={0}
                    step={getMoneyInputStep(settings.currency)}
                    required
                    value={varCostCOP}
                    onChange={(e) => setVarCostCOP(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="var-provider"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Proveedor
                  </label>
                  <input
                    id="var-provider"
                    type="text"
                    value={varProvider}
                    onChange={(e) => setVarProvider(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="var-size"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Calibre / tamaño
                  </label>
                  <input
                    id="var-size"
                    type="text"
                    value={varSize}
                    onChange={(e) => setVarSize(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="var-sku"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    SKU / código
                  </label>
                  <input
                    id="var-sku"
                    type="text"
                    value={varSku}
                    onChange={(e) => setVarSku(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setVariantModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Guardando...' : 'Guardar color'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL AJUSTE MANUAL DE STOCK */}
      {adjustStockVariant && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="adjust-stock-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="adjust-stock-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  Ajustar stock físico
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {materialMap.get(adjustStockVariant.materialId)?.name} ·{' '}
                  {adjustStockVariant.colorName} (actual:{' '}
                  {adjustStockVariant.physicalStock}{' '}
                  {getUnitShortLabel(
                    materialMap.get(adjustStockVariant.materialId)?.unit ?? 'unit',
                  )}
                  )
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustStockVariant(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmAdjustStock(e)}
              className="mt-5 space-y-4"
            >
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustDirection('add')}
                  className={`inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold ${
                    adjustDirection === 'add'
                      ? 'border-teal-700 bg-teal-50 text-teal-800'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>Entrada (+)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustDirection('subtract')}
                  className={`inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold ${
                    adjustDirection === 'subtract'
                      ? 'border-rose-700 bg-rose-50 text-rose-800'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  <MinusCircle className="h-4 w-4" />
                  <span>Salida / Merma (-)</span>
                </button>
              </div>

              <div>
                <label
                  htmlFor="adj-qty"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Cantidad *
                </label>
                <input
                  id="adj-qty"
                  type="number"
                  min={0.01}
                  step="0.01"
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="adj-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Motivo para el Kardex *
                </label>
                <input
                  id="adj-notes"
                  type="text"
                  required
                  minLength={3}
                  placeholder="Ej. Reposición manual de madeja, ajuste por conteo físico..."
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setAdjustStockVariant(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Aplicando...' : 'Registrar movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL RESERVAR MATERIAL PARA PROYECTO */}
      {reserveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reserve-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="reserve-modal-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  Reservar material para proyecto
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Aparta stock disponible sin descontar aún del físico hasta que
                  se consuma en el tejido.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReserveModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmReserve(e)}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor="res-variant"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Material y color *
                </label>
                <select
                  id="res-variant"
                  required
                  value={reserveVariantId}
                  onChange={(e) => setReserveVariantId(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {variants.map((v) => {
                    const mat = materialMap.get(v.materialId);
                    const avail = getVariantAvailableStock(v);
                    return (
                      <option key={v.id} value={v.id}>
                        {mat?.name ?? 'Material'} · {v.colorName} (Disp:{' '}
                        {avail} {getUnitShortLabel(mat?.unit ?? 'unit')})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label
                  htmlFor="res-project"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Proyecto *
                </label>
                <select
                  id="res-project"
                  required
                  value={reserveProjectId}
                  onChange={(e) => {
                    setReserveProjectId(e.target.value);
                    setReserveComponentId('');
                  }}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {reserveCompatibleProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isDemo ? ' (Ejemplo)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {reserveProjectComponents.length > 0 && (
                <div>
                  <label
                    htmlFor="res-comp"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Pieza específica (opcional)
                  </label>
                  <select
                    id="res-comp"
                    value={reserveComponentId}
                    onChange={(e) => setReserveComponentId(e.target.value)}
                    className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="">Todo el proyecto</option>
                    {reserveProjectComponents.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label
                  htmlFor="res-qty"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Cantidad a reservar *
                </label>
                <input
                  id="res-qty"
                  type="number"
                  min={0.01}
                  step="0.01"
                  required
                  value={reserveQuantity}
                  onChange={(e) => setReserveQuantity(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="res-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Notas (opcional)
                </label>
                <input
                  id="res-notes"
                  type="text"
                  placeholder="Ej. Para cuerpo y orejas..."
                  value={reserveNotes}
                  onChange={(e) => setReserveNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setReserveModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || reserveCompatibleProjects.length === 0}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Reservando...' : 'Confirmar reserva'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONSUMO DIRECTO SIN RESERVA */}
      {directConsumeVariant && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="direct-consume-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="direct-consume-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  Registrar consumo directo
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {materialMap.get(directConsumeVariant.materialId)?.name} ·{' '}
                  {directConsumeVariant.colorName} (Disp. sin reserva:{' '}
                  {getVariantAvailableStock(directConsumeVariant)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDirectConsumeVariant(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmDirectConsume(e)}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor="dc-project"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Proyecto *
                </label>
                <select
                  id="dc-project"
                  required
                  value={directProjectId}
                  onChange={(e) => setDirectProjectId(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  {(directConsumeVariant.isDemo
                    ? projects
                    : projects.filter((p) => !p.isDemo)
                  ).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="dc-qty"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Cantidad consumida *
                </label>
                <input
                  id="dc-qty"
                  type="number"
                  min={0.01}
                  step="0.01"
                  required
                  value={directQuantity}
                  onChange={(e) => setDirectQuantity(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="dc-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Nota (opcional)
                </label>
                <input
                  id="dc-notes"
                  type="text"
                  value={directNotes}
                  onChange={(e) => setDirectNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setDirectConsumeVariant(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Registrando...' : 'Descontar stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONSUMIR DESDE RESERVA */}
      {consumeResModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="consume-res-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="consume-res-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  Registrar consumo de reserva
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Pendiente por consumir:{' '}
                  {getReservationRemaining(consumeResModal)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConsumeResModal(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmConsumeFromRes(e)}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor="cres-qty"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Cantidad consumida ahora *
                </label>
                <input
                  id="cres-qty"
                  type="number"
                  min={0.01}
                  max={getReservationRemaining(consumeResModal)}
                  step="0.01"
                  required
                  value={consumeResQty}
                  onChange={(e) => setConsumeResQty(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="cres-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Notas (opcional)
                </label>
                <input
                  id="cres-notes"
                  type="text"
                  placeholder="Ej. Consumo completo de alas..."
                  value={consumeResNotes}
                  onChange={(e) => setConsumeResNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setConsumeResModal(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Guardando...' : 'Confirmar consumo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL MODIFICAR RESERVA */}
      {modifyResModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modify-res-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3
                  id="modify-res-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  Ajustar cantidad reservada
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Mínimo permitido (ya consumido):{' '}
                  {modifyResModal.consumedQuantity}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModifyResModal(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmModifyRes(e)}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor="mres-qty"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Nueva cantidad total reservada *
                </label>
                <input
                  id="mres-qty"
                  type="number"
                  min={Math.max(0.01, modifyResModal.consumedQuantity)}
                  step="0.01"
                  required
                  value={modifyResQty}
                  onChange={(e) => setModifyResQty(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="mres-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Motivo / nota
                </label>
                <input
                  id="mres-notes"
                  type="text"
                  value={modifyResNotes}
                  onChange={(e) => setModifyResNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setModifyResModal(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busy ? 'Actualizando...' : 'Guardar ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMACIONES */}
      <ConfirmModal
        isOpen={Boolean(reservationToRelease)}
        title="Liberar reserva de material"
        description={
          reservationToRelease
            ? `Se liberarán ${getReservationRemaining(reservationToRelease)} unidades pendientes hacia el stock disponible del taller. El historial en el Kardex se conservará.`
            : ''
        }
        confirmLabel="Liberar reserva"
        variant="default"
        isBusy={busy}
        onCancel={() => setReservationToRelease(null)}
        onConfirm={() => void handleConfirmReleaseReservation()}
      />

      <ConfirmModal
        isOpen={Boolean(variantToDelete)}
        title="Eliminar color"
        description={
          variantToDelete
            ? `¿Seguro que deseas eliminar "${variantToDelete.colorName}"? Solo es posible si aún no tiene reservas ni movimientos registrados en el Kardex.`
            : ''
        }
        confirmLabel="Eliminar color"
        variant="danger"
        isBusy={busy}
        onCancel={() => setVariantToDelete(null)}
        onConfirm={() => void handleConfirmDeleteVariant()}
      />

      <ConfirmModal
        isOpen={Boolean(materialToDelete)}
        title="Eliminar material"
        description={
          materialToDelete
            ? `¿Seguro que deseas eliminar "${materialToDelete.name}"?`
            : ''
        }
        confirmLabel="Eliminar material"
        variant="danger"
        isBusy={busy}
        onCancel={() => setMaterialToDelete(null)}
        onConfirm={() => void handleConfirmDeleteMaterial()}
      />

      <FeatureGate
        mode="modal"
        isOpen={reserveGateOpen}
        onClose={() => setReserveGateOpen(false)}
        featureTitle="Reservas compartidas entre proyectos en PRO"
        description="Aparta ovillos, madejas o insumos específicos para un proyecto o pieza concreta antes de tejerlos, protegiendo tu stock disponible frente a otros encargos."
        freeIncludedNote="En FREE puedes registrar materiales y colores ilimitados, ajustar stock, consultar todo el Kardex y registrar consumos directos en tus proyectos. Cualquier reserva ya existente sigue pudiendo consumirse, modificarse o liberarse libremente."
      />
    </>
  );
};
