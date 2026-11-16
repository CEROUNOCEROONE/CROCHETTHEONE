import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowRight,
  ClipboardList,
  Edit3,
  FileText,
  Lightbulb,
  PackageCheck,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type {
  MaterialCategory,
  MeasurementUnit,
  NoteOrList,
  NoteOrListType,
  PendingMaterial,
  PendingMaterialStatus,
  ShoppingListItem,
} from '@/src/domain/models/index.ts';
import {
  formatCOP,
  formatDateCO,
  formatDateTimeCO,
} from '@/src/domain/services/formatters.ts';
import {
  formatUnitQuantity,
  getUnitShortLabel,
  MATERIAL_CATEGORY_OPTIONS,
  MEASUREMENT_UNIT_OPTIONS,
} from '@/src/domain/services/inventoryService.ts';
import {
  calculateShoppingListSummary,
  getPendingMaterialRemaining,
  getShoppingItemRemainingToReceive,
  PENDING_MATERIAL_STATUS_META,
  SHOPPING_ITEM_STATUS_META,
} from '@/src/domain/services/procurementService.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
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

interface ShoppingAndNotesViewProps {
  onNavigateToInventory?(): void;
  onOpenProject?(projectId: string): void;
}

type ShoppingTab = 'pending' | 'lists' | 'notes' | 'receipts';

interface ReceiptDraftLine {
  readonly key: string;
  readonly label: string;
  readonly variantId: string;
  readonly requiresVariantSelection: boolean;
  readonly targetIsDemo: boolean | null;
  readonly shoppingListItemId: string | null;
  readonly pendingMaterialId: string | null;
  readonly maxRecommendedQty: number | null;
  readonly quantityReceived: string;
  readonly unitCostCOP: string;
  readonly updateVariantUnitCost: boolean;
  readonly selected: boolean;
}

function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function dateInputToIso(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function todayDateInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const ShoppingAndNotesView: React.FC<ShoppingAndNotesViewProps> = ({
  onNavigateToInventory,
  onOpenProject,
}) => {
  const {
    projects,
    components,
    materials,
    variants,
    pendingMaterials,
    notesAndLists,
    shoppingListItems,
    purchaseReceipts,
    stats,
    createMaterial,
    createVariant,
    createPendingMaterial,
    updatePendingMaterial,
    deletePendingMaterial,
    createNoteOrList,
    updateNoteOrList,
    deleteNoteOrList,
    createShoppingListItem,
    updateShoppingListItem,
    deleteShoppingListItem,
    sendPendingMaterialToShoppingList,
    receivePurchaseReceipt,
  } = useWorkshopData();

  const snapDeckRef = useRef<SnapDeckHandle | null>(null);
  const viewportProfile = useViewportProfile();

  const [activeTab, setActiveTab] = useState<ShoppingTab>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingStatusFilter, setPendingStatusFilter] = useState<
    PendingMaterialStatus | 'open' | 'all'
  >('open');
  const [showArchivedLists, setShowArchivedLists] = useState(false);
  const [notesTypeFilter, setNotesTypeFilter] = useState<'all' | 'free_note' | 'idea'>('all');
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'error';
    message: string;
  } | null>(null);

  // Modal: Crear / Editar Material Pendiente
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [editingPending, setEditingPending] = useState<PendingMaterial | null>(null);
  const [pendProjectId, setPendProjectId] = useState('');
  const [pendComponentId, setPendComponentId] = useState('');
  const [pendVariantId, setPendVariantId] = useState('');
  const [pendQuantityNeeded, setPendQuantityNeeded] = useState('100');
  const [pendProvider, setPendProvider] = useState('');
  const [pendStatus, setPendStatus] = useState<'pending_order' | 'ordered'>('pending_order');
  const [pendEstimatedArrival, setPendEstimatedArrival] = useState('');
  const [pendMarkBlocked, setPendMarkBlocked] = useState(true);
  const [pendNotes, setPendNotes] = useState('');
  // Sub-formulario opcional: crear material + color nuevo rápido para pendiente
  const [quickNewMatOpen, setQuickNewMatOpen] = useState(false);
  const [quickMatName, setQuickMatName] = useState('');
  const [quickMatCategory, setQuickMatCategory] = useState<MaterialCategory>('yarn_cotton');
  const [quickMatUnit, setQuickMatUnit] = useState<MeasurementUnit>('g');
  const [quickVarColor, setQuickVarColor] = useState('');
  const [quickVarCostCOP, setQuickVarCostCOP] = useState('0');

  // Modal: Enviar pendiente a lista de compras
  const [sendToListPending, setSendToListPending] = useState<PendingMaterial | null>(null);
  const [targetListId, setTargetListId] = useState('');
  const [newListInlineTitle, setNewListInlineTitle] = useState('');

  // Modal: Crear / Editar Lista de compras o Nota / Idea
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteOrList | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteType, setNoteType] = useState<NoteOrListType>('shopping_list');
  const [noteProjectId, setNoteProjectId] = useState('');
  const [noteContent, setNoteContent] = useState('');

  // Modal: Agregar / Editar Ítem de Lista de Compras
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemListId, setItemListId] = useState('');
  const [editingItem, setEditingItem] = useState<ShoppingListItem | null>(null);
  const [itemMode, setItemMode] = useState<'catalog' | 'custom'>('catalog');
  const [itemVariantId, setItemVariantId] = useState('');
  const [itemCustomName, setItemCustomName] = useState('');
  const [itemColorName, setItemColorName] = useState('');
  const [itemUnit, setItemUnit] = useState<MeasurementUnit>('g');
  const [itemPlannedQty, setItemPlannedQty] = useState('100');
  const [itemEstimatedPrice, setItemEstimatedPrice] = useState('0');
  const [itemProvider, setItemProvider] = useState('');
  const [itemStatus, setItemStatus] = useState<'pending' | 'purchased_waiting_delivery'>(
    'pending',
  );
  const [itemNotes, setItemNotes] = useState('');

  // Modal: Recepción de Compra (parcial o total -> suma a Inventario + Kardex)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptProvider, setReceiptProvider] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayDateInput());
  const [receiptRefCode, setReceiptRefCode] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptLines, setReceiptLines] = useState<ReceiptDraftLine[]>([]);
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState('');

  // Confirmaciones de eliminación
  const [pendingToDelete, setPendingToDelete] = useState<PendingMaterial | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<NoteOrList | null>(null);
  const [itemToDelete, setItemToDelete] = useState<ShoppingListItem | null>(null);

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const componentMap = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );
  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const variantMap = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  const shoppingLists = useMemo(
    () =>
      notesAndLists
        .filter((n) => n.type === 'shopping_list')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notesAndLists],
  );

  const activeShoppingLists = useMemo(
    () => shoppingLists.filter((l) => l.status === 'active'),
    [shoppingLists],
  );

  const visibleShoppingLists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return shoppingLists.filter((list) => {
      if (!showArchivedLists && list.status === 'archived') return false;
      if (!q) return true;
      const items = shoppingListItems.filter((i) => i.listId === list.id);
      const matchList =
        list.title.toLowerCase().includes(q) || list.content.toLowerCase().includes(q);
      const matchItems = items.some(
        (i) =>
          i.customName.toLowerCase().includes(q) ||
          i.colorName.toLowerCase().includes(q) ||
          i.provider.toLowerCase().includes(q),
      );
      return matchList || matchItems;
    });
  }, [shoppingLists, shoppingListItems, showArchivedLists, searchQuery]);

  const visibleNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notesAndLists
      .filter((n) => n.type !== 'shopping_list')
      .filter((n) => {
        if (!showArchivedNotes && n.status === 'archived') return false;
        if (notesTypeFilter !== 'all' && n.type !== notesTypeFilter) return false;
        if (!q) return true;
        const projName = n.projectId ? projectMap.get(n.projectId)?.name ?? '' : '';
        return (
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          projName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [notesAndLists, showArchivedNotes, notesTypeFilter, searchQuery, projectMap]);

  const filteredPendingMaterials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pendingMaterials
      .filter((pm) => {
        if (pendingStatusFilter === 'open') {
          if (pm.status === 'received' || pm.status === 'cancelled') return false;
        } else if (pendingStatusFilter !== 'all' && pm.status !== pendingStatusFilter) {
          return false;
        }
        if (!q) return true;
        const variant = variantMap.get(pm.variantId);
        const material = variant ? materialMap.get(variant.materialId) : undefined;
        const project = projectMap.get(pm.projectId);
        return (
          (material?.name ?? '').toLowerCase().includes(q) ||
          (variant?.colorName ?? '').toLowerCase().includes(q) ||
          (project?.name ?? '').toLowerCase().includes(q) ||
          pm.provider.toLowerCase().includes(q) ||
          pm.notes.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [
    pendingMaterials,
    pendingStatusFilter,
    searchQuery,
    variantMap,
    materialMap,
    projectMap,
  ]);

  const sortedReceipts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return purchaseReceipts
      .filter((r) => {
        if (!q) return true;
        return (
          r.provider.toLowerCase().includes(q) ||
          (r.referenceCode ?? '').toLowerCase().includes(q) ||
          r.notes.toLowerCase().includes(q) ||
          r.items.some(
            (it) =>
              (it.materialNameSnapshot ?? '').toLowerCase().includes(q) ||
              (it.colorNameSnapshot ?? '').toLowerCase().includes(q),
          )
        );
      })
      .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  }, [purchaseReceipts, searchQuery]);

  const totalReceiptsCOP = useMemo(
    () => purchaseReceipts.reduce((sum, r) => sum + r.totalCostCOP, 0),
    [purchaseReceipts],
  );

  // Paginación adaptativa por tamaño de dispositivo para cero recortes
  const pendingPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 1,
    tablet: 2,
    desktopCompact: 2,
    desktopRegular: 4,
    desktopTall: 4,
  });
  const listsItemPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 2,
    tablet: 3,
    desktopCompact: 3,
    desktopRegular: 4,
    desktopTall: 5,
  });
  const notesPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 2,
    tablet: 2,
    desktopCompact: 2,
    desktopRegular: 4,
    desktopTall: 4,
  });
  const receiptsPageSize = pickPageSize(viewportProfile, {
    mobileCompact: 1,
    mobileRegular: 2,
    tablet: 2,
    desktopCompact: 2,
    desktopRegular: 3,
    desktopTall: 4,
  });

  const pendingPages = useMemo(
    () => chunkIntoPages(filteredPendingMaterials, pendingPageSize),
    [filteredPendingMaterials, pendingPageSize],
  );

  const listPages = useMemo(() => {
    type ListUnit = { list: NoteOrList; item: ShoppingListItem | null };
    const units: ListUnit[] = [];
    for (const list of visibleShoppingLists) {
      const items = shoppingListItems
        .filter((i) => i.listId === list.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (items.length === 0) {
        units.push({ list, item: null });
      } else {
        for (const item of items) {
          units.push({ list, item });
        }
      }
    }
    return chunkIntoPages(units, listsItemPageSize).map((pageUnits) => {
      const groups: Array<{
        list: NoteOrList;
        items: ShoppingListItem[];
        allListItems: ShoppingListItem[];
        isEmptyList: boolean;
      }> = [];
      for (const unit of pageUnits) {
        const last = groups[groups.length - 1];
        if (last && last.list.id === unit.list.id) {
          if (unit.item) last.items.push(unit.item);
        } else {
          const allListItems = shoppingListItems
            .filter((i) => i.listId === unit.list.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          groups.push({
            list: unit.list,
            items: unit.item ? [unit.item] : [],
            allListItems,
            isEmptyList: unit.item === null,
          });
        }
      }
      return groups;
    });
  }, [visibleShoppingLists, shoppingListItems, listsItemPageSize]);

  const notePages = useMemo(
    () => chunkIntoPages(visibleNotes, notesPageSize),
    [visibleNotes, notesPageSize],
  );

  const receiptPages = useMemo(
    () => chunkIntoPages(sortedReceipts, receiptsPageSize),
    [sortedReceipts, receiptsPageSize],
  );

  const handleTabJump = (tab: ShoppingTab) => {
    setActiveTab(tab);
    if (tab === 'pending') snapDeckRef.current?.goToSlide('shop-pending-0');
    else if (tab === 'lists') snapDeckRef.current?.goToSlide('shop-lists-0');
    else if (tab === 'notes') snapDeckRef.current?.goToSlide('shop-notes-0');
    else snapDeckRef.current?.goToSlide('shop-receipts-0');
  };

  const handleSlideChange = (slideId: string) => {
    if (slideId.startsWith('shop-lists')) setActiveTab('lists');
    else if (slideId.startsWith('shop-notes')) setActiveTab('notes');
    else if (slideId.startsWith('shop-receipts')) setActiveTab('receipts');
    else if (slideId.startsWith('shop-pending')) setActiveTab('pending');
  };

  // Variantes compatibles con el proyecto seleccionado (aislamiento isDemo)
  const availableVariantsForProject = (projectId: string) => {
    const proj = projectMap.get(projectId);
    if (!proj) return variants;
    return variants.filter((v) => (proj.isDemo ? true : !v.isDemo));
  };

  const componentsForSelectedProject = useMemo(
    () =>
      components
        .filter((c) => c.projectId === pendProjectId)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [components, pendProjectId],
  );

  const openNewPendingModal = () => {
    const defaultProj = projects[0]?.id ?? '';
    const compatibleVars = availableVariantsForProject(defaultProj);
    setEditingPending(null);
    setPendProjectId(defaultProj);
    setPendComponentId('');
    setPendVariantId(compatibleVars[0]?.id ?? '');
    setPendQuantityNeeded('100');
    setPendProvider(compatibleVars[0]?.provider ?? '');
    setPendStatus('pending_order');
    setPendEstimatedArrival('');
    setPendMarkBlocked(true);
    setPendNotes('');
    setQuickNewMatOpen(compatibleVars.length === 0);
    setQuickMatName('');
    setQuickMatCategory('yarn_cotton');
    setQuickMatUnit('g');
    setQuickVarColor('');
    setQuickVarCostCOP('0');
    setPendingModalOpen(true);
  };

  const openEditPendingModal = (pm: PendingMaterial) => {
    setEditingPending(pm);
    setPendProjectId(pm.projectId);
    setPendComponentId(pm.componentId ?? '');
    setPendVariantId(pm.variantId);
    setPendQuantityNeeded(String(pm.quantityNeeded));
    setPendProvider(pm.provider);
    setPendStatus(pm.status === 'ordered' ? 'ordered' : 'pending_order');
    setPendEstimatedArrival(isoToDateInput(pm.estimatedArrivalDate));
    setPendMarkBlocked(false);
    setPendNotes(pm.notes);
    setQuickNewMatOpen(false);
    setPendingModalOpen(true);
  };

  const handleSavePendingMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (editingPending) {
        await updatePendingMaterial(editingPending.id, {
          quantityNeeded: Number(pendQuantityNeeded),
          provider: pendProvider,
          estimatedArrivalDate: dateInputToIso(pendEstimatedArrival),
          status:
            editingPending.status === 'partially_received' ||
            editingPending.status === 'received' ||
            editingPending.status === 'cancelled'
              ? editingPending.status
              : pendStatus,
          notes: pendNotes,
        });
      } else {
        if (!pendProjectId) {
          throw new Error('Selecciona el proyecto que necesita el material.');
        }

        let targetVariantId = pendVariantId;
        if (quickNewMatOpen) {
          const createdMat = await createMaterial({
            name: quickMatName,
            category: quickMatCategory,
            brand: '',
            unit: quickMatUnit,
            description: 'Creado desde materiales pendientes.',
          });
          const createdVar = await createVariant({
            materialId: createdMat.id,
            colorName: quickVarColor,
            colorHex: '#0F766E',
            sizeOrGauge: null,
            sku: null,
            provider: pendProvider,
            unitCostCOP: Math.max(0, Number(quickVarCostCOP) || 0),
            initialPhysicalStock: 0,
            minStock: 0,
            notes: '',
          });
          targetVariantId = createdVar.id;
        }

        if (!targetVariantId) {
          throw new Error('Selecciona un material y color del inventario.');
        }

        await createPendingMaterial({
          variantId: targetVariantId,
          projectId: pendProjectId,
          componentId: pendComponentId || null,
          quantityNeeded: Number(pendQuantityNeeded),
          provider: pendProvider,
          estimatedArrivalDate: dateInputToIso(pendEstimatedArrival),
          status: pendStatus,
          markComponentBlocked: Boolean(pendComponentId) && pendMarkBlocked,
          notes: pendNotes,
        });
      }
      setPendingModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo guardar el material pendiente.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPendingOrdered = async (pm: PendingMaterial) => {
    setBusy(true);
    setFeedback(null);
    try {
      await updatePendingMaterial(pm.id, {
        status: 'ordered',
        orderedDate: new Date().toISOString(),
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error actualizando estado.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openSendToListModal = (pm: PendingMaterial) => {
    const compatibleLists = activeShoppingLists.filter((l) =>
      pm.isDemo ? l.isDemo : !l.isDemo,
    );
    setSendToListPending(pm);
    setTargetListId(compatibleLists[0]?.id ?? '__new__');
    setNewListInlineTitle('');
  };

  const handleConfirmSendToList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendToListPending) return;
    setBusy(true);
    setFeedback(null);
    try {
      let listIdToUse = targetListId;
      if (targetListId === '__new__' || !listIdToUse) {
        const proj = projectMap.get(sendToListPending.projectId);
        const createdList = await createNoteOrList({
          title:
            newListInlineTitle.trim() ||
            `Lista de compra — ${proj?.name ?? 'Taller'}`,
          type: 'shopping_list',
          projectId: sendToListPending.isDemo ? sendToListPending.projectId : null,
          content: '',
        });
        listIdToUse = createdList.id;
      }

      await sendPendingMaterialToShoppingList(sendToListPending.id, listIdToUse);
      setSendToListPending(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo enviar el material a la lista.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openNewNoteModal = (defaultType: NoteOrListType) => {
    setEditingNote(null);
    setNoteTitle('');
    setNoteType(defaultType);
    setNoteProjectId('');
    setNoteContent('');
    setNoteModalOpen(true);
  };

  const openEditNoteModal = (note: NoteOrList) => {
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteType(note.type);
    setNoteProjectId(note.projectId ?? '');
    setNoteContent(note.content);
    setNoteModalOpen(true);
  };

  const handleSaveNoteOrList = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (editingNote) {
        await updateNoteOrList(editingNote.id, {
          title: noteTitle,
          type: editingNote.type === 'shopping_list' ? 'shopping_list' : noteType,
          projectId: noteProjectId || null,
          content: noteContent,
        });
      } else {
        await createNoteOrList({
          title: noteTitle,
          type: noteType,
          projectId: noteProjectId || null,
          content: noteContent,
        });
      }
      setNoteModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo guardar.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleArchiveNote = async (note: NoteOrList) => {
    setBusy(true);
    setFeedback(null);
    try {
      const nextStatus = note.status === 'active' ? 'archived' : 'active';
      await updateNoteOrList(note.id, { status: nextStatus });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error cambiando estado.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openNewItemModal = (list: NoteOrList) => {
    const compatibleVars = variants.filter((v) => (list.isDemo ? v.isDemo : !v.isDemo));
    const firstVar = compatibleVars[0];
    const firstMat = firstVar ? materialMap.get(firstVar.materialId) : undefined;
    setEditingItem(null);
    setItemListId(list.id);
    setItemMode(compatibleVars.length > 0 ? 'catalog' : 'custom');
    setItemVariantId(firstVar?.id ?? '');
    setItemCustomName('');
    setItemColorName('');
    setItemUnit(firstMat?.unit ?? 'g');
    setItemPlannedQty('100');
    setItemEstimatedPrice(String(firstVar?.unitCostCOP ?? 0));
    setItemProvider(firstVar?.provider ?? '');
    setItemStatus('pending');
    setItemNotes('');
    setItemModalOpen(true);
  };

  const openEditItemModal = (item: ShoppingListItem) => {
    setEditingItem(item);
    setItemListId(item.listId);
    setItemMode(item.variantId ? 'catalog' : 'custom');
    setItemVariantId(item.variantId ?? '');
    setItemCustomName(item.customName);
    setItemColorName(item.colorName);
    setItemUnit(item.unit);
    setItemPlannedQty(String(item.plannedQuantity));
    setItemEstimatedPrice(String(item.estimatedUnitPriceCOP));
    setItemProvider(item.provider);
    setItemStatus(
      item.status === 'purchased_waiting_delivery'
        ? 'purchased_waiting_delivery'
        : 'pending',
    );
    setItemNotes(item.notes);
    setItemModalOpen(true);
  };

  const handleSaveShoppingItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (editingItem) {
        await updateShoppingListItem(editingItem.id, {
          customName: itemMode === 'custom' ? itemCustomName : undefined,
          colorName: itemMode === 'custom' ? itemColorName : undefined,
          unit: itemMode === 'custom' ? itemUnit : undefined,
          plannedQuantity: Number(itemPlannedQty),
          estimatedUnitPriceCOP: Number(itemEstimatedPrice),
          provider: itemProvider,
          status:
            editingItem.status === 'partially_received' ||
            editingItem.status === 'received_in_stock' ||
            editingItem.status === 'cancelled'
              ? editingItem.status
              : itemStatus,
          notes: itemNotes,
        });
      } else {
        await createShoppingListItem({
          listId: itemListId,
          variantId: itemMode === 'catalog' ? itemVariantId || null : null,
          customName: itemCustomName,
          colorName: itemColorName,
          unit: itemUnit,
          plannedQuantity: Number(itemPlannedQty),
          estimatedUnitPriceCOP: Number(itemEstimatedPrice),
          provider: itemProvider,
          status: itemStatus,
          notes: itemNotes,
        });
      }
      setItemModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo guardar el ítem.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleMarkItemPurchased = async (item: ShoppingListItem) => {
    setBusy(true);
    setFeedback(null);
    try {
      await updateShoppingListItem(item.id, {
        status: 'purchased_waiting_delivery',
        purchasedQuantity: item.plannedQuantity,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo actualizar el ítem.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openReceiptFromPending = (pm: PendingMaterial) => {
    const variant = variantMap.get(pm.variantId);
    const mat = variant ? materialMap.get(variant.materialId) : undefined;
    const remaining = getPendingMaterialRemaining(pm);

    setReceiptProvider(pm.provider || variant?.provider || '');
    setReceiptDate(todayDateInput());
    setReceiptRefCode('');
    setReceiptNotes('');
    setReceiptIdempotencyKey(`rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    setReceiptLines([
      {
        key: `pend_${pm.id}`,
        label: `${mat?.name ?? 'Material'} · ${variant?.colorName ?? 'Color'} (${getUnitShortLabel(mat?.unit ?? 'unit')})`,
        variantId: pm.variantId,
        requiresVariantSelection: false,
        targetIsDemo: pm.isDemo,
        shoppingListItemId: null,
        pendingMaterialId: pm.id,
        maxRecommendedQty: remaining,
        quantityReceived: String(remaining > 0 ? remaining : pm.quantityNeeded),
        unitCostCOP: String(variant?.unitCostCOP ?? 0),
        updateVariantUnitCost: true,
        selected: true,
      },
    ]);
    setReceiptModalOpen(true);
  };

  const openReceiptFromListItems = (
    itemsToReceive: ShoppingListItem[],
    defaultProvider: string,
  ) => {
    const lines: ReceiptDraftLine[] = itemsToReceive
      .filter((i) => getShoppingItemRemainingToReceive(i) > 0)
      .map((i) => {
        const remaining = getShoppingItemRemainingToReceive(i);
        const variant = i.variantId ? variantMap.get(i.variantId) : undefined;
        return {
          key: `sli_${i.id}`,
          label: `${i.customName} · ${i.colorName} (${getUnitShortLabel(i.unit)})`,
          variantId: i.variantId ?? '',
          requiresVariantSelection: !i.variantId,
          targetIsDemo: i.isDemo,
          shoppingListItemId: i.id,
          pendingMaterialId: i.pendingMaterialId ?? null,
          maxRecommendedQty: remaining,
          quantityReceived: String(remaining),
          unitCostCOP: String(i.estimatedUnitPriceCOP || variant?.unitCostCOP || 0),
          updateVariantUnitCost: true,
          selected: true,
        };
      });

    if (lines.length === 0) return;

    const firstProvider =
      itemsToReceive.find((i) => i.provider)?.provider || defaultProvider || '';
    setReceiptProvider(firstProvider);
    setReceiptDate(todayDateInput());
    setReceiptRefCode('');
    setReceiptNotes('');
    setReceiptIdempotencyKey(`rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    setReceiptLines(lines);
    setReceiptModalOpen(true);
  };

  const openDirectReceiptModal = () => {
    const firstVar = variants.find((v) => !v.isDemo) ?? variants[0];
    const firstMat = firstVar ? materialMap.get(firstVar.materialId) : undefined;
    setReceiptProvider(firstVar?.provider ?? '');
    setReceiptDate(todayDateInput());
    setReceiptRefCode('');
    setReceiptNotes('');
    setReceiptIdempotencyKey(`rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    setReceiptLines([
      {
        key: `direct_${Date.now()}`,
        label: firstVar
          ? `${firstMat?.name ?? 'Material'} · ${firstVar.colorName}`
          : 'Seleccionar material en inventario',
        variantId: firstVar?.id ?? '',
        requiresVariantSelection: true,
        targetIsDemo: null,
        shoppingListItemId: null,
        pendingMaterialId: null,
        maxRecommendedQty: null,
        quantityReceived: '100',
        unitCostCOP: String(firstVar?.unitCostCOP ?? 0),
        updateVariantUnitCost: true,
        selected: true,
      },
    ]);
    setReceiptModalOpen(true);
  };

  const handleConfirmReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedLines = receiptLines.filter((l) => l.selected);
    if (selectedLines.length === 0) {
      setFeedback({
        type: 'error',
        message: 'Selecciona al menos un material para recibir en stock.',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      await receivePurchaseReceipt({
        provider: receiptProvider,
        receiptDate: dateInputToIso(receiptDate) ?? new Date().toISOString(),
        referenceCode: receiptRefCode.trim() || null,
        notes: receiptNotes,
        idempotencyKey: receiptIdempotencyKey,
        items: selectedLines.map((line) => ({
          variantId: line.variantId,
          shoppingListItemId: line.shoppingListItemId,
          pendingMaterialId: line.pendingMaterialId,
          quantityReceived: Number(line.quantityReceived),
          unitCostCOP: Math.max(0, Number(line.unitCostCOP) || 0),
          updateVariantUnitCost: line.updateVariantUnitCost,
        })),
      });
      setReceiptModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo registrar la recepción en inventario.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePendingConfirm = async () => {
    if (!pendingToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deletePendingMaterial(pendingToDelete.id);
      setPendingToDelete(null);
    } catch (err) {
      setPendingToDelete(null);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo eliminar el pendiente.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteNoteConfirm = async () => {
    if (!noteToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deleteNoteOrList(noteToDelete.id);
      setNoteToDelete(null);
    } catch (err) {
      setNoteToDelete(null);
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo eliminar.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteItemConfirm = async () => {
    if (!itemToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deleteShoppingListItem(itemToDelete.id);
      setItemToDelete(null);
    } catch (err) {
      setItemToDelete(null);
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo eliminar el ítem.',
      });
    } finally {
      setBusy(false);
    }
  };

  const selectedReceiptTotalCOP = useMemo(
    () =>
      receiptLines
        .filter((l) => l.selected)
        .reduce(
          (sum, l) =>
            sum +
            Math.round(
              Math.max(0, Number(l.quantityReceived) || 0) *
                Math.max(0, Number(l.unitCostCOP) || 0),
            ),
          0,
        ),
    [receiptLines],
  );

  return (
    <>
      <SnapDeck
        ref={snapDeckRef}
        ariaLabel="Compras, materiales pendientes, notas y recepciones"
        onSlideChange={handleSlideChange}
        topSlot={
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
                role="tablist"
                aria-label="Vistas de compras y notas"
              >
                {(
                  [
                    { id: 'pending', label: 'Pendientes', icon: ShoppingBag },
                    { id: 'lists', label: 'Listas', icon: ClipboardList },
                    { id: 'notes', label: 'Notas', icon: FileText },
                    { id: 'receipts', label: 'Recepciones', icon: Receipt },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleTabJump(tab.id)}
                      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
                        isActive
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

              <div className="flex items-center gap-2 shrink-0">
                {activeTab === 'pending' && (
                  <button
                    type="button"
                    onClick={openNewPendingModal}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Registrar pendiente</span>
                    <span className="sm:hidden">Pendiente</span>
                  </button>
                )}
                {activeTab === 'lists' && (
                  <button
                    type="button"
                    onClick={() => openNewNoteModal('shopping_list')}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Nueva lista</span>
                  </button>
                )}
                {activeTab === 'notes' && (
                  <button
                    type="button"
                    onClick={() => openNewNoteModal('free_note')}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Nueva nota</span>
                  </button>
                )}
                {activeTab === 'receipts' && (
                  <button
                    type="button"
                    onClick={openDirectReceiptModal}
                    disabled={variants.length === 0}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Registrar recepción</span>
                    <span className="sm:hidden">Recepción</span>
                  </button>
                )}
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
                  className="rounded-lg p-1 text-slate-500 hover:bg-black/5 shrink-0"
                  aria-label="Cerrar aviso"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        }
      >
        {/* PANTALLA 1: RESUMEN GENERAL Y BUSCADOR GLOBAL */}
        <SnapSlide id="shop-overview" label="Resumen de compras">
          <div className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 sm:text-xl">
                    Compras, pendientes y notas
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-slate-600">
                    Organiza faltantes de material, listas de compra, apuntes rápidos y
                    entradas confirmadas al Kardex.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewPendingModal}
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap self-start sm:self-auto"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Registrar pendiente</span>
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 lg:grid-cols-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">Materiales pendientes</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">
                    {stats.pendingMaterialsCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Comprados en camino</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-teal-700 tabular-nums sm:text-xl">
                    {stats.inTransitPurchasesCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Listas y notas activas</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">
                    {stats.activeNotesCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Total recibido en compras</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums sm:text-xl">
                    {formatCOP(totalReceiptsCOP)}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar material, lista, nota, proyecto o proveedor..."
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => handleTabJump('pending')}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100"
                >
                  <span className="font-medium text-slate-700">Pendientes</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {filteredPendingMaterials.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTabJump('lists')}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100"
                >
                  <span className="font-medium text-slate-700">Listas</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {visibleShoppingLists.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTabJump('notes')}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100"
                >
                  <span className="font-medium text-slate-700">Notas</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {visibleNotes.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTabJump('receipts')}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100"
                >
                  <span className="font-medium text-slate-700">Recepciones</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {sortedReceipts.length}
                  </span>
                </button>
              </div>
            </section>
          </div>
        </SnapSlide>

        {/* SECCIÓN 1: MATERIALES PENDIENTES */}
        {pendingPages.length === 0 ? (
          <SnapSlide id="shop-pending-0" label="Materiales pendientes">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { value: 'open', label: 'Activos' },
                    { value: 'pending_order', label: 'Por comprar' },
                    { value: 'ordered', label: 'En camino' },
                    { value: 'partially_received', label: 'Parcial' },
                    { value: 'received', label: 'Recibidos' },
                    { value: 'all', label: 'Todos' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPendingStatusFilter(opt.value)}
                    className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                      pendingStatusFilter === opt.value
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <EmptyState
                icon={ShoppingBag}
                title="No hay materiales pendientes en esta vista"
                description="Registra aquí los hilos, lanas o insumos faltantes para tus proyectos y piezas. Cuando lleguen al taller podrás recibirlos parcial o totalmente hacia el inventario."
                primaryAction={{
                  label: 'Registrar material pendiente',
                  onClick: openNewPendingModal,
                }}
              />
            </div>
          </SnapSlide>
        ) : (
          pendingPages.map((pagePending, pageIdx) => (
            <SnapSlide
              key={`shop-pending-${pageIdx}`}
              id={`shop-pending-${pageIdx}`}
              label={
                pendingPages.length > 1
                  ? `Pendientes ${pageIdx + 1}/${pendingPages.length}`
                  : 'Materiales pendientes'
              }
            >
              <div className="space-y-3">
                {pageIdx === 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { value: 'open', label: 'Activos' },
                        { value: 'pending_order', label: 'Por comprar' },
                        { value: 'ordered', label: 'En camino' },
                        { value: 'partially_received', label: 'Parcial' },
                        { value: 'received', label: 'Recibidos' },
                        { value: 'all', label: 'Todos' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPendingStatusFilter(opt.value)}
                        className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                          pendingStatusFilter === opt.value
                            ? 'bg-slate-900 text-white'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Materiales pendientes · Página {pageIdx + 1} de {pendingPages.length}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {pagePending.map((pm) => {
                    const variant = variantMap.get(pm.variantId);
                    const material = variant ? materialMap.get(variant.materialId) : undefined;
                    const project = projectMap.get(pm.projectId);
                    const component = pm.componentId
                      ? componentMap.get(pm.componentId)
                      : undefined;
                    const unit = material?.unit ?? 'unit';
                    const remaining = getPendingMaterialRemaining(pm);
                    const statusMeta = PENDING_MATERIAL_STATUS_META[pm.status];
                    const isOpen =
                      pm.status === 'pending_order' ||
                      pm.status === 'ordered' ||
                      pm.status === 'partially_received';

                    return (
                      <article
                        key={pm.id}
                        className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <span
                                className="mt-0.5 h-6 w-6 shrink-0 rounded-md border border-slate-300"
                                style={{
                                  backgroundColor: variant?.colorHex ?? '#E2E8F0',
                                }}
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-display text-base font-semibold text-slate-900">
                                    {material?.name ?? 'Material'} · {variant?.colorName ?? 'Color'}
                                  </h3>
                                  {pm.isDemo && (
                                    <span className="text-xs font-medium text-slate-400">
                                      · Ejemplo
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-slate-600">
                                  Proyecto:{' '}
                                  {project ? (
                                    <button
                                      type="button"
                                      onClick={() => onOpenProject?.(project.id)}
                                      className="font-medium text-teal-700 hover:underline"
                                    >
                                      {project.name}
                                    </button>
                                  ) : (
                                    'Sin proyecto'
                                  )}
                                  {component && (
                                    <>
                                      {' · '}
                                      Pieza: <strong className="font-medium">{component.name}</strong>
                                      {component.status === 'blocked_by_material' && (
                                        <span className="ml-1 text-amber-700 font-medium">
                                          (Bloqueada por material)
                                        </span>
                                      )}
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>

                            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                          </div>

                          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
                            <div>
                              <p className="text-slate-500">Necesario</p>
                              <p className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                                {formatUnitQuantity(pm.quantityNeeded, unit)}
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-500">Recibido</p>
                              <p className="mt-0.5 font-mono font-semibold text-emerald-700 tabular-nums">
                                {formatUnitQuantity(pm.quantityReceived, unit)}
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-500">Faltante</p>
                              <p className="mt-0.5 font-mono font-semibold text-amber-700 tabular-nums">
                                {formatUnitQuantity(remaining, unit)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>
                              Proveedor:{' '}
                              <strong className="font-medium text-slate-700">
                                {pm.provider || 'Por definir'}
                              </strong>
                            </span>
                            {pm.orderedDate && (
                              <span>Pedido: {formatDateCO(pm.orderedDate)}</span>
                            )}
                            {pm.estimatedArrivalDate && (
                              <span>Llegada est.: {formatDateCO(pm.estimatedArrivalDate)}</span>
                            )}
                          </div>

                          {pm.notes && (
                            <p className="mt-2 text-xs leading-relaxed text-slate-600 line-clamp-2">
                              {pm.notes}
                            </p>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                          <div className="flex flex-wrap gap-1.5">
                            {pm.status === 'pending_order' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleMarkPendingOrdered(pm)}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                              >
                                <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Comprado</span>
                              </button>
                            )}
                            {isOpen && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openReceiptFromPending(pm)}
                                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                                >
                                  <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Recibir en stock</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openSendToListModal(pm)}
                                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>A lista</span>
                                </button>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditPendingModal(pm)}
                              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                              aria-label="Editar material pendiente"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            {pm.quantityReceived === 0 && (
                              <button
                                type="button"
                                onClick={() => setPendingToDelete(pm)}
                                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                                aria-label="Eliminar material pendiente"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </SnapSlide>
          ))
        )}

        {/* SECCIÓN 2: LISTAS DE COMPRA */}
        {listPages.length === 0 ? (
          <SnapSlide id="shop-lists-0" label="Listas de compra">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  Diferencia lo que falta por comprar de lo que ya compraste y viene en camino.
                </p>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={showArchivedLists}
                    onChange={(e) => setShowArchivedLists(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700"
                  />
                  <span>Mostrar listas archivadas</span>
                </label>
              </div>

              <EmptyState
                icon={ClipboardList}
                title="Aún no hay listas de compras activas"
                description="Organiza tus próximas compras por proveedor o proyecto, marca lo ya comprado en camino y recibe los materiales parcial o totalmente en tu inventario."
                primaryAction={{
                  label: 'Crear lista de compras',
                  onClick: () => openNewNoteModal('shopping_list'),
                }}
              />
            </div>
          </SnapSlide>
        ) : (
          listPages.map((pageGroups, pageIdx) => (
            <SnapSlide
              key={`shop-lists-${pageIdx}`}
              id={`shop-lists-${pageIdx}`}
              label={
                listPages.length > 1
                  ? `Listas ${pageIdx + 1}/${listPages.length}`
                  : 'Listas de compra'
              }
            >
              <div className="space-y-4">
                {pageIdx === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-600">
                      Diferencia lo que falta por comprar de lo que ya compraste y viene en camino.
                    </p>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={showArchivedLists}
                        onChange={(e) => setShowArchivedLists(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-teal-700"
                      />
                      <span>Mostrar listas archivadas</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Listas de compra · Página {pageIdx + 1} de {listPages.length}
                  </p>
                )}

                {pageGroups.map(({ list, items, allListItems, isEmptyList }) => {
                  const summary = calculateShoppingListSummary(allListItems);
                  const project = list.projectId ? projectMap.get(list.projectId) : null;
                  const receivableItems = allListItems.filter(
                    (i) => getShoppingItemRemainingToReceive(i) > 0,
                  );
                  const hasReceivedAny = allListItems.some((i) => i.receivedQuantity > 0);

                  return (
                    <article
                      key={`${list.id}-${pageIdx}`}
                      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                    >
                      <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display text-base font-semibold text-slate-900 sm:text-lg">
                              {list.title}
                            </h3>
                            {list.isDemo && (
                              <span className="text-xs font-medium text-slate-400">
                                · Ejemplo
                              </span>
                            )}
                            {list.status === 'archived' && (
                              <StatusBadge label="Archivada" tone="neutral" />
                            )}
                          </div>
                          {project && (
                            <p className="mt-0.5 text-xs text-slate-500">
                              Proyecto vinculado:{' '}
                              <button
                                type="button"
                                onClick={() => onOpenProject?.(project.id)}
                                className="font-medium text-teal-700 hover:underline"
                              >
                                {project.name}
                              </button>
                            </p>
                          )}
                          {list.content && (
                            <p className="mt-1 text-xs sm:text-sm text-slate-600 line-clamp-2">
                              {list.content}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600 tabular-nums">
                            <span>
                              Por comprar: <strong>{summary.pendingCount}</strong>
                            </span>
                            <span>
                              En camino:{' '}
                              <strong className="text-teal-700">{summary.inTransitCount}</strong>
                            </span>
                            <span>
                              En stock:{' '}
                              <strong className="text-emerald-700">{summary.receivedCount}</strong>
                            </span>
                            <span>
                              Total estimado:{' '}
                              <strong>{formatCOP(summary.estimatedTotalCOP)}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openNewItemModal(list)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                          >
                            <Plus className="h-3.5 w-3.5 text-teal-700" />
                            <span>Agregar ítem</span>
                          </button>

                          {receivableItems.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                openReceiptFromListItems(receivableItems, '')
                              }
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              <span>Recibir compra</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openEditNoteModal(list)}
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                            aria-label="Editar lista"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleToggleArchiveNote(list)}
                            className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                            aria-label={
                              list.status === 'active' ? 'Archivar lista' : 'Reactivar lista'
                            }
                            title={
                              list.status === 'active' ? 'Archivar lista' : 'Reactivar lista'
                            }
                          >
                            {list.status === 'active' ? (
                              <Archive className="h-3.5 w-3.5" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                          </button>

                          {!hasReceivedAny && (
                            <button
                              type="button"
                              onClick={() => setNoteToDelete(list)}
                              className="inline-flex min-h-[38px] items-center rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                              aria-label="Eliminar lista"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isEmptyList ? (
                        <p className="mt-3 text-xs text-slate-500">
                          Esta lista aún no tiene materiales. Usa &ldquo;Agregar ítem&rdquo; para
                          planificar tus compras.
                        </p>
                      ) : (
                        <div className="mt-3 divide-y divide-slate-100">
                          {items.map((item) => {
                            const statusMeta = SHOPPING_ITEM_STATUS_META[item.status];
                            const remaining = getShoppingItemRemainingToReceive(item);
                            const variant = item.variantId
                              ? variantMap.get(item.variantId)
                              : undefined;

                            return (
                              <div
                                key={item.id}
                                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex items-start gap-3 min-w-0">
                                  <span
                                    className="mt-1 h-4 w-4 shrink-0 rounded border border-slate-300"
                                    style={{
                                      backgroundColor: variant?.colorHex ?? '#E2E8F0',
                                    }}
                                    aria-hidden="true"
                                  />
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-medium text-slate-900">
                                        {item.customName} · {item.colorName}
                                      </p>
                                      <StatusBadge
                                        label={statusMeta.label}
                                        tone={statusMeta.tone}
                                      />
                                      {!item.variantId && (
                                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                                          Ítem libre
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500 tabular-nums">
                                      Plan: {formatUnitQuantity(item.plannedQuantity, item.unit)}
                                      {' · '}
                                      Recibido: {formatUnitQuantity(item.receivedQuantity, item.unit)}
                                      {' · '}
                                      Est.: {formatCOP(item.estimatedUnitPriceCOP)}/
                                      {getUnitShortLabel(item.unit)}
                                      {item.provider ? ` · ${item.provider}` : ''}
                                    </p>
                                    {item.notes && (
                                      <p className="mt-0.5 text-xs text-slate-500">
                                        {item.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                  {item.status === 'pending' && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void handleMarkItemPurchased(item)}
                                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100"
                                    >
                                      <Truck className="h-3.5 w-3.5" />
                                      <span>Comprado</span>
                                    </button>
                                  )}

                                  {remaining > 0 && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        openReceiptFromListItems([item], item.provider)
                                      }
                                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                                    >
                                      <PackageCheck className="h-3.5 w-3.5" />
                                      <span>Recibir</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => openEditItemModal(item)}
                                    className="inline-flex min-h-[36px] items-center rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                                    aria-label="Editar ítem"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </button>

                                  {item.receivedQuantity === 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setItemToDelete(item)}
                                      className="inline-flex min-h-[36px] items-center rounded-lg px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                                      aria-label="Eliminar ítem"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </SnapSlide>
          ))
        )}

        {/* SECCIÓN 3: NOTAS RÁPIDAS E IDEAS */}
        {notePages.length === 0 ? (
          <SnapSlide id="shop-notes-0" label="Notas e ideas">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: 'all', label: 'Todas' },
                      { value: 'free_note', label: 'Notas rápidas' },
                      { value: 'idea', label: 'Ideas' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setNotesTypeFilter(f.value)}
                      className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                        notesTypeFilter === f.value
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={showArchivedNotes}
                    onChange={(e) => setShowArchivedNotes(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700"
                  />
                  <span>Mostrar archivadas</span>
                </label>
              </div>

              <EmptyState
                icon={FileText}
                title="No hay notas rápidas ni ideas registradas"
                description="Guarda apuntes de tensión, cambios de ganchillo, combinaciones de colores o recordatorios de compra asociados a tus proyectos."
                primaryAction={{
                  label: 'Crear nota rápida',
                  onClick: () => openNewNoteModal('free_note'),
                }}
              />
            </div>
          </SnapSlide>
        ) : (
          notePages.map((pageNotes, pageIdx) => (
            <SnapSlide
              key={`shop-notes-${pageIdx}`}
              id={`shop-notes-${pageIdx}`}
              label={
                notePages.length > 1
                  ? `Notas ${pageIdx + 1}/${notePages.length}`
                  : 'Notas e ideas'
              }
            >
              <div className="space-y-4">
                {pageIdx === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { value: 'all', label: 'Todas' },
                          { value: 'free_note', label: 'Notas rápidas' },
                          { value: 'idea', label: 'Ideas' },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => setNotesTypeFilter(f.value)}
                          className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                            notesTypeFilter === f.value
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={showArchivedNotes}
                        onChange={(e) => setShowArchivedNotes(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-teal-700"
                      />
                      <span>Mostrar archivadas</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Notas e ideas · Página {pageIdx + 1} de {notePages.length}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {pageNotes.map((note) => {
                    const project = note.projectId ? projectMap.get(note.projectId) : null;
                    return (
                      <article
                        key={note.id}
                        className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5 min-w-0">
                              {note.type === 'idea' ? (
                                <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                              ) : (
                                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
                              )}
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-display text-base font-semibold text-slate-900">
                                    {note.title}
                                  </h3>
                                  {note.isDemo && (
                                    <span className="text-xs font-medium text-slate-400">
                                      · Ejemplo
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {note.type === 'idea' ? 'Idea' : 'Nota rápida'}
                                  {' · '}
                                  Actualizada {formatDateCO(note.updatedAt)}
                                  {project && (
                                    <>
                                      {' · '}
                                      <button
                                        type="button"
                                        onClick={() => onOpenProject?.(project.id)}
                                        className="font-medium text-teal-700 hover:underline"
                                      >
                                        {project.name}
                                      </button>
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>
                            {note.status === 'archived' && (
                              <StatusBadge label="Archivada" tone="neutral" />
                            )}
                          </div>

                          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 line-clamp-5">
                            {note.content || 'Sin contenido adicional.'}
                          </p>
                        </div>

                        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                          <button
                            type="button"
                            onClick={() => openEditNoteModal(note)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleArchiveNote(note)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            {note.status === 'active' ? (
                              <>
                                <Archive className="h-3.5 w-3.5" />
                                <span>Archivar</span>
                              </>
                            ) : (
                              <>
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>Reactivar</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setNoteToDelete(note)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

        {/* SECCIÓN 4: RECEPCIONES E HISTORIAL */}
        {receiptPages.length === 0 ? (
          <SnapSlide id="shop-receipts-0" label="Recepciones">
            <EmptyState
              icon={Receipt}
              title="Aún no hay recepciones registradas"
              description="Cada vez que recibas una compra (parcial o total) desde tus materiales pendientes, listas de compra o directamente, se guardará un comprobante inmutable aquí y sumará al stock de Inventario."
              primaryAction={
                variants.length > 0
                  ? {
                      label: 'Registrar recepción directa',
                      onClick: openDirectReceiptModal,
                    }
                  : undefined
              }
            />
          </SnapSlide>
        ) : (
          receiptPages.map((pageReceipts, pageIdx) => (
            <SnapSlide
              key={`shop-receipts-${pageIdx}`}
              id={`shop-receipts-${pageIdx}`}
              label={
                receiptPages.length > 1
                  ? `Recepciones ${pageIdx + 1}/${receiptPages.length}`
                  : 'Recepciones'
              }
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Recepciones de compra
                    {receiptPages.length > 1
                      ? ` · Página ${pageIdx + 1} de ${receiptPages.length}`
                      : ''}
                  </p>
                  {variants.length > 0 && (
                    <button
                      type="button"
                      onClick={openDirectReceiptModal}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <PackageCheck className="h-3.5 w-3.5 text-teal-700" />
                      <span>Nueva recepción</span>
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {pageReceipts.map((receipt) => (
                    <article
                      key={receipt.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display text-base font-semibold text-slate-900">
                              {receipt.provider}
                            </h3>
                            {receipt.referenceCode && (
                              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                                Ref: {receipt.referenceCode}
                              </span>
                            )}
                            {receipt.isDemo && (
                              <span className="text-xs font-medium text-slate-400">
                                · Ejemplo
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Fecha de recepción: {formatDateTimeCO(receipt.receiptDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Total recepción</p>
                          <p className="font-mono text-base font-bold text-slate-900 tabular-nums">
                            {formatCOP(receipt.totalCostCOP)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {receipt.items.map((line, idx) => {
                          const variant = variantMap.get(line.variantId);
                          const mat = variant
                            ? materialMap.get(variant.materialId)
                            : undefined;
                          const unit = line.unitSnapshot ?? mat?.unit ?? 'unit';
                          const label = `${line.materialNameSnapshot ?? mat?.name ?? 'Material'} · ${line.colorNameSnapshot ?? variant?.colorName ?? 'Color'}`;
                          return (
                            <div
                              key={`${receipt.id}_${idx}`}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <span className="font-medium text-slate-800">{label}</span>
                              <span className="font-mono text-slate-600 tabular-nums">
                                +{formatUnitQuantity(line.quantityReceived, unit)} ×{' '}
                                {formatCOP(line.unitCostCOP)} ={' '}
                                <strong className="text-slate-900">
                                  {formatCOP(Math.round(line.quantityReceived * line.unitCostCOP))}
                                </strong>
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {receipt.notes && (
                        <p className="mt-3 text-xs text-slate-500">{receipt.notes}</p>
                      )}

                      {onNavigateToInventory && (
                        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
                          <button
                            type="button"
                            onClick={onNavigateToInventory}
                            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
                          >
                            <span>Ver entrada en Kardex de Inventario</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </SnapSlide>
          ))
        )}
      </SnapDeck>

      {/* MODAL 1: CREAR / EDITAR MATERIAL PENDIENTE */}
      {pendingModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                {editingPending ? 'Editar material pendiente' : 'Registrar material pendiente'}
              </h2>
              <button
                type="button"
                onClick={() => setPendingModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSavePendingMaterial(e)}
              className="mt-4 space-y-4"
            >
              {!editingPending && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Proyecto que necesita el material
                    </label>
                    <select
                      required
                      value={pendProjectId}
                      onChange={(e) => {
                        const nextProj = e.target.value;
                        setPendProjectId(nextProj);
                        setPendComponentId('');
                        const compat = availableVariantsForProject(nextProj);
                        if (!compat.some((v) => v.id === pendVariantId)) {
                          setPendVariantId(compat[0]?.id ?? '');
                        }
                      }}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="">Selecciona un proyecto...</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.isDemo ? ' (Ejemplo)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {componentsForSelectedProject.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Componente / pieza vinculada (opcional)
                      </label>
                      <select
                        value={pendComponentId}
                        onChange={(e) => setPendComponentId(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      >
                        <option value="">Todo el proyecto (sin pieza específica)</option>
                        {componentsForSelectedProject.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>

                      {pendComponentId && (
                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={pendMarkBlocked}
                            onChange={(e) => setPendMarkBlocked(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-teal-700"
                          />
                          <span>Marcar pieza como &ldquo;Falta material&rdquo; hasta recibirlo</span>
                        </label>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        Material y color
                      </label>
                      <button
                        type="button"
                        onClick={() => setQuickNewMatOpen((v) => !v)}
                        className="text-xs font-medium text-teal-700 hover:underline"
                      >
                        {quickNewMatOpen
                          ? 'Elegir de catálogo existente'
                          : '+ Crear nuevo material rápido'}
                      </button>
                    </div>

                    {!quickNewMatOpen ? (
                      <select
                        required
                        value={pendVariantId}
                        onChange={(e) => {
                          const vId = e.target.value;
                          setPendVariantId(vId);
                          const v = variantMap.get(vId);
                          if (v && !pendProvider) setPendProvider(v.provider);
                        }}
                        className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                      >
                        <option value="">Selecciona color del inventario...</option>
                        {availableVariantsForProject(pendProjectId).map((v) => {
                          const mat = materialMap.get(v.materialId);
                          return (
                            <option key={v.id} value={v.id}>
                              {mat?.name ?? 'Material'} · {v.colorName} (disp:{' '}
                              {Math.max(0, v.physicalStock - v.reservedStock)}{' '}
                              {getUnitShortLabel(mat?.unit ?? 'unit')})
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700">
                              Nombre del material
                            </label>
                            <input
                              type="text"
                              required
                              value={quickMatName}
                              onChange={(e) => setQuickMatName(e.target.value)}
                              placeholder="Ej. Hilo Macramé"
                              className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700">
                              Color obligatorio
                            </label>
                            <input
                              type="text"
                              required
                              value={quickVarColor}
                              onChange={(e) => setQuickVarColor(e.target.value)}
                              placeholder="Ej. Verde Esmeralda"
                              className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700">
                              Categoría
                            </label>
                            <select
                              value={quickMatCategory}
                              onChange={(e) =>
                                setQuickMatCategory(e.target.value as MaterialCategory)
                              }
                              className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
                            >
                              {MATERIAL_CATEGORY_OPTIONS.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700">
                              Unidad y costo est. (COP)
                            </label>
                            <div className="mt-1 flex gap-2">
                              <select
                                value={quickMatUnit}
                                onChange={(e) =>
                                  setQuickMatUnit(e.target.value as MeasurementUnit)
                                }
                                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-sm"
                              >
                                {MEASUREMENT_UNIT_OPTIONS.map((u) => (
                                  <option key={u.value} value={u.value}>
                                    {u.shortLabel}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={0}
                                value={quickVarCostCOP}
                                onChange={(e) => setQuickVarCostCOP(e.target.value)}
                                placeholder="COP"
                                className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Cantidad faltante / necesaria
                  </label>
                  <input
                    type="number"
                    min={0.1}
                    step="any"
                    required
                    value={pendQuantityNeeded}
                    onChange={(e) => setPendQuantityNeeded(e.target.value)}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Estado
                  </label>
                  <select
                    value={pendStatus}
                    onChange={(e) =>
                      setPendStatus(e.target.value as 'pending_order' | 'ordered')
                    }
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="pending_order">Por comprar</option>
                    <option value="ordered">Comprado en camino</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Proveedor o tienda
                  </label>
                  <input
                    type="text"
                    value={pendProvider}
                    onChange={(e) => setPendProvider(e.target.value)}
                    placeholder="Ej. Lanas El Centro"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Fecha estimada de llegada
                  </label>
                  <input
                    type="date"
                    value={pendEstimatedArrival}
                    onChange={(e) => setPendEstimatedArrival(e.target.value)}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Notas
                </label>
                <textarea
                  rows={2}
                  value={pendNotes}
                  onChange={(e) => setPendNotes(e.target.value)}
                  placeholder="Referencia, lote de color o detalle de entrega..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando...' : 'Guardar pendiente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ENVIAR PENDIENTE A LISTA DE COMPRAS */}
      {sendToListPending && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Enviar a lista de compras
              </h2>
              <button
                type="button"
                onClick={() => setSendToListPending(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmSendToList(e)}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Lista de compras destino
                </label>
                <select
                  value={targetListId}
                  onChange={(e) => setTargetListId(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {activeShoppingLists
                    .filter((l) => (sendToListPending.isDemo ? l.isDemo : !l.isDemo))
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  <option value="__new__">+ Crear nueva lista ahora</option>
                </select>
              </div>

              {targetListId === '__new__' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Nombre de la nueva lista
                  </label>
                  <input
                    type="text"
                    required
                    value={newListInlineTitle}
                    onChange={(e) => setNewListInlineTitle(e.target.value)}
                    placeholder="Ej. Compra semanal mercería"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSendToListPending(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Agregando...' : 'Agregar a lista'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CREAR / EDITAR LISTA DE COMPRAS O NOTA / IDEA */}
      {noteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                {editingNote
                  ? editingNote.type === 'shopping_list'
                    ? 'Editar lista de compras'
                    : 'Editar nota'
                  : noteType === 'shopping_list'
                    ? 'Nueva lista de compras'
                    : 'Nueva nota o idea'}
              </h2>
              <button
                type="button"
                onClick={() => setNoteModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveNoteOrList(e)}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Título
                </label>
                <input
                  type="text"
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder={
                    noteType === 'shopping_list'
                      ? 'Ej. Compra mensual de hilos'
                      : 'Ej. Ajuste de puntos para amigurumi'
                  }
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                />
              </div>

              {noteType !== 'shopping_list' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Tipo de apunte
                  </label>
                  <select
                    value={noteType}
                    onChange={(e) => setNoteType(e.target.value as NoteOrListType)}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="free_note">Nota rápida</option>
                    <option value="idea">Idea / Inspiración</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Vincular a un proyecto (opcional)
                </label>
                <select
                  value={noteProjectId}
                  onChange={(e) => setNoteProjectId(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="">General del taller (sin proyecto)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isDemo ? ' (Ejemplo)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  {noteType === 'shopping_list' ? 'Descripción / observaciones' : 'Contenido'}
                </label>
                <textarea
                  rows={4}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Escribe aquí los detalles..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNoteModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: AGREGAR / EDITAR ÍTEM DE LISTA DE COMPRAS */}
      {itemModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                {editingItem ? 'Editar ítem de compra' : 'Agregar ítem a lista'}
              </h2>
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveShoppingItem(e)}
              className="mt-4 space-y-4"
            >
              {!editingItem && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setItemMode('catalog')}
                    className={`flex-1 min-h-[40px] rounded-lg border text-xs font-medium ${
                      itemMode === 'catalog'
                        ? 'border-teal-700 bg-teal-50 text-teal-900'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    Del inventario existente
                  </button>
                  <button
                    type="button"
                    onClick={() => setItemMode('custom')}
                    className={`flex-1 min-h-[40px] rounded-lg border text-xs font-medium ${
                      itemMode === 'custom'
                        ? 'border-teal-700 bg-teal-50 text-teal-900'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    Ítem libre / nuevo
                  </button>
                </div>
              )}

              {itemMode === 'catalog' && !editingItem ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Material y color del catálogo
                  </label>
                  <select
                    required
                    value={itemVariantId}
                    onChange={(e) => {
                      const vId = e.target.value;
                      setItemVariantId(vId);
                      const v = variantMap.get(vId);
                      if (v) {
                        setItemEstimatedPrice(String(v.unitCostCOP));
                        if (!itemProvider) setItemProvider(v.provider);
                      }
                    }}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="">Selecciona un material/color...</option>
                    {variants.map((v) => {
                      const mat = materialMap.get(v.materialId);
                      return (
                        <option key={v.id} value={v.id}>
                          {mat?.name ?? 'Material'} · {v.colorName} (
                          {getUnitShortLabel(mat?.unit ?? 'unit')})
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Nombre del insumo
                    </label>
                    <input
                      type="text"
                      required
                      disabled={Boolean(editingItem?.variantId)}
                      value={itemCustomName}
                      onChange={(e) => setItemCustomName(e.target.value)}
                      placeholder="Ej. Bolsas kraft medianas"
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Color / ref.
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(editingItem?.variantId)}
                      value={itemColorName}
                      onChange={(e) => setItemColorName(e.target.value)}
                      placeholder="Natural"
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    min={0.1}
                    step="any"
                    required
                    value={itemPlannedQty}
                    onChange={(e) => setItemPlannedQty(e.target.value)}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm"
                  />
                </div>
                {itemMode === 'custom' && !editingItem?.variantId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Unidad
                    </label>
                    <select
                      value={itemUnit}
                      onChange={(e) => setItemUnit(e.target.value as MeasurementUnit)}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      {MEASUREMENT_UNIT_OPTIONS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Precio est. / unidad (COP)
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={itemEstimatedPrice}
                    onChange={(e) => setItemEstimatedPrice(e.target.value)}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Proveedor
                  </label>
                  <input
                    type="text"
                    value={itemProvider}
                    onChange={(e) => setItemProvider(e.target.value)}
                    placeholder="Ej. Mercería Central"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Estado actual
                  </label>
                  <select
                    value={itemStatus}
                    onChange={(e) =>
                      setItemStatus(
                        e.target.value as 'pending' | 'purchased_waiting_delivery',
                      )
                    }
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="pending">Pendiente por comprar</option>
                    <option value="purchased_waiting_delivery">
                      Comprado en camino (sin recibir)
                    </option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Notas
                </label>
                <input
                  type="text"
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="Opcional..."
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando...' : 'Guardar ítem'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: RECEPCIÓN DE COMPRA (PARCIAL O TOTAL -> SUMA A INVENTARIO + KARDEX) */}
      {receiptModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Registrar recepción en inventario
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Puedes recibir cantidades parciales o totales. Se sumará automáticamente al stock físico y quedará en el Kardex.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceiptModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmReceipt(e)}
              className="mt-4 space-y-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Proveedor
                  </label>
                  <input
                    type="text"
                    required
                    value={receiptProvider}
                    onChange={(e) => setReceiptProvider(e.target.value)}
                    placeholder="Ej. Lanas El Centro"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Fecha de recepción
                  </label>
                  <input
                    type="date"
                    required
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Factura / remisión (opcional)
                  </label>
                  <input
                    type="text"
                    value={receiptRefCode}
                    onChange={(e) => setReceiptRefCode(e.target.value)}
                    placeholder="Ej. FAC-2041"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-700">
                  Materiales recibidos en esta entrega
                </p>
                {receiptLines.map((line, index) => (
                  <div
                    key={line.key}
                    className={`rounded-xl border p-3.5 ${
                      line.selected
                        ? 'border-teal-200 bg-teal-50/40'
                        : 'border-slate-200 bg-slate-50 opacity-70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-900">
                        <input
                          type="checkbox"
                          checked={line.selected}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setReceiptLines((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, selected: checked } : item,
                              ),
                            );
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-teal-700"
                        />
                        <span>{line.label}</span>
                      </label>
                      {line.maxRecommendedQty !== null && (
                        <span className="font-mono text-xs text-slate-500">
                          Pendiente: {line.maxRecommendedQty}
                        </span>
                      )}
                    </div>

                    {line.selected && (
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {line.requiresVariantSelection && (
                          <div className="sm:col-span-3">
                            <label className="block text-[11px] font-semibold text-slate-700">
                              Color de inventario donde sumará el stock
                            </label>
                            <select
                              required
                              value={line.variantId}
                              onChange={(e) => {
                                const nextVarId = e.target.value;
                                const v = variantMap.get(nextVarId);
                                const m = v ? materialMap.get(v.materialId) : undefined;
                                setReceiptLines((prev) =>
                                  prev.map((item, i) =>
                                    i === index
                                      ? {
                                          ...item,
                                          variantId: nextVarId,
                                          label: v
                                            ? `${m?.name ?? 'Material'} · ${v.colorName}`
                                            : item.label,
                                          unitCostCOP:
                                            Number(item.unitCostCOP) > 0
                                              ? item.unitCostCOP
                                              : String(v?.unitCostCOP ?? 0),
                                        }
                                      : item,
                                  ),
                                );
                              }}
                              className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
                            >
                              <option value="">Selecciona el material/color...</option>
                              {variants
                                .filter((v) =>
                                  line.targetIsDemo === null
                                    ? true
                                    : line.targetIsDemo
                                      ? v.isDemo
                                      : !v.isDemo,
                                )
                                .map((v) => {
                                  const m = materialMap.get(v.materialId);
                                  return (
                                    <option key={v.id} value={v.id}>
                                      {m?.name ?? 'Material'} · {v.colorName} (stock:{' '}
                                      {v.physicalStock} {getUnitShortLabel(m?.unit ?? 'unit')})
                                      {v.isDemo ? ' · Ejemplo' : ''}
                                    </option>
                                  );
                                })}
                            </select>
                          </div>
                        )}

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Cantidad recibida ahora
                          </label>
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            required
                            value={line.quantityReceived}
                            onChange={(e) => {
                              const val = e.target.value;
                              setReceiptLines((prev) =>
                                prev.map((item, i) =>
                                  i === index ? { ...item, quantityReceived: val } : item,
                                ),
                              );
                            }}
                            className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Costo real / unidad (COP)
                          </label>
                          <input
                            type="number"
                            min={0}
                            required
                            value={line.unitCostCOP}
                            onChange={(e) => {
                              const val = e.target.value;
                              setReceiptLines((prev) =>
                                prev.map((item, i) =>
                                  i === index ? { ...item, unitCostCOP: val } : item,
                                ),
                              );
                            }}
                            className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-sm"
                          />
                        </div>

                        <div className="flex items-end pb-1">
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={line.updateVariantUnitCost}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setReceiptLines((prev) =>
                                  prev.map((item, i) =>
                                    i === index
                                      ? { ...item, updateVariantUnitCost: checked }
                                      : item,
                                  ),
                                );
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-teal-700"
                            />
                            <span>Actualizar costo base del color</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Observaciones de la recepción
                </label>
                <input
                  type="text"
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  placeholder="Ej. Llegaron 2 madejas completas, pendiente 1 para el viernes..."
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-xs font-medium text-slate-600">
                  Total de esta recepción
                </span>
                <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {formatCOP(selectedReceiptTotalCOP)}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReceiptModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Registrando...' : 'Confirmar entrada a stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALES DE CONFIRMACIÓN DE ELIMINACIÓN */}
      <ConfirmModal
        isOpen={Boolean(pendingToDelete)}
        title="Eliminar material pendiente"
        description="Se eliminará este requerimiento pendiente de compra. Si ya estaba en una lista de compras, el ítem de la lista se conservará sin vínculo."
        confirmLabel="Sí, eliminar"
        variant="danger"
        isBusy={busy}
        onConfirm={() => void handleDeletePendingConfirm()}
        onCancel={() => setPendingToDelete(null)}
      />

      <ConfirmModal
        isOpen={Boolean(noteToDelete)}
        title={
          noteToDelete?.type === 'shopping_list'
            ? 'Eliminar lista de compras'
            : 'Eliminar nota'
        }
        description="Esta acción eliminará el registro seleccionado y sus ítems pendientes sin recepciones."
        confirmLabel="Sí, eliminar"
        variant="danger"
        isBusy={busy}
        onConfirm={() => void handleDeleteNoteConfirm()}
        onCancel={() => setNoteToDelete(null)}
      />

      <ConfirmModal
        isOpen={Boolean(itemToDelete)}
        title="Eliminar ítem de la lista"
        description="Se quitará este ítem de la lista de compras."
        confirmLabel="Sí, eliminar"
        variant="danger"
        isBusy={busy}
        onConfirm={() => void handleDeleteItemConfirm()}
        onCancel={() => setItemToDelete(null)}
      />
    </>
  );
};
