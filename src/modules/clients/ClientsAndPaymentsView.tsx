import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Calendar,
  Check,
  Copy,
  CreditCard,
  Edit3,
  FileText,
  Lock,
  Phone,
  Plus,
  Receipt,
  Search,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useWorkshopData } from '@/src/data/DataContext.tsx';
import type {
  Client,
  FinancialTransaction,
  PaymentInstallment,
  PaymentMethod,
  PaymentPlan,
  PaymentPlanModality,
  PaymentStatus,
} from '@/src/domain/models/index.ts';
import {
  fromMinorUnits,
  getCurrencySpec,
  parseNonNegativeMoney,
  toMinorUnits,
} from '@/src/domain/services/currencyCatalog.ts';
import { formatCOP, formatDateCO } from '@/src/domain/services/formatters.ts';
import {
  buildDefaultInstallmentSchedule,
  buildPaymentPlanStatementText,
  computeClientAccountSummaries,
  getPaymentMethodLabel,
  getPaymentModalityLabel,
  INSTALLMENT_STATUS_META,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_MODALITY_OPTIONS,
  PAYMENT_STATUS_META,
  recomputePlanAndInstallments,
  type ClientAccountSummary,
  type InstallmentDraftInput,
} from '@/src/domain/services/clientPaymentService.ts';
import { toLocalDateKey } from '@/src/domain/services/planningService.ts';
import {
  canConfigurePaymentInstallments,
  canExportAccountStatement,
  FREE_MAX_PAYMENT_INSTALLMENTS,
} from '@/src/domain/services/planCapabilities.ts';
import { ConfirmModal } from '@/src/shared/components/ConfirmModal.tsx';
import { EmptyState } from '@/src/shared/components/EmptyState.tsx';
import { FeatureGate } from '@/src/shared/components/FeatureGate.tsx';
import { InlineFeedbackAlert } from '@/src/shared/components/InlineFeedbackAlert.tsx';
import {
  SnapDeck,
  SnapSlide,
  type SnapDeckHandle,
} from '@/src/shared/components/SnapDeck.tsx';
import { StatusBadge } from '@/src/shared/components/StatusBadge.tsx';
import { UsdEquiv } from '@/src/shared/components/UsdEquiv.tsx';
import { useEscapeKey } from '@/src/shared/hooks/useEscapeKey.ts';
import {
  chunkIntoPages,
  pickPageSize,
  useViewportProfile,
} from '@/src/shared/hooks/useViewportPageSize.ts';

interface ClientsAndPaymentsViewProps {
  readonly initialProjectId?: string | null;
  readonly initialClientId?: string | null;
  onClearInitialTarget?(): void;
  onOpenProject?(projectId: string): void;
}

type ClientsTab = 'clients' | 'plans' | 'ledger';
type ClientFilter = 'all' | 'with_balance' | 'overdue' | 'settled';
type PlanFilter = 'all' | 'open' | 'overdue' | 'paid';

interface EditableInstallmentRow extends InstallmentDraftInput {
  readonly localKey: string;
  readonly lockedPaidCOP: number;
  readonly amountRaw?: string;
}

function makeLocalKey(prefix = 'inst_row'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeMoneyDraft(raw: string, decimals: number): string {
  if (decimals === 0) {
    return raw.replace(/[^\d]/g, '');
  }
  const normalized = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const parts = normalized.split('.');
  if (parts.length <= 1) return parts[0] ?? '';
  const frac = parts.slice(1).join('').slice(0, decimals);
  return `${parts[0]}.${frac}`;
}

export const ClientsAndPaymentsView: React.FC<ClientsAndPaymentsViewProps> = ({
  initialProjectId = null,
  initialClientId = null,
  onClearInitialTarget,
  onOpenProject,
}) => {
  const {
    settings,
    effectiveTier,
    clients,
    projects,
    paymentPlans,
    installments,
    transactions,
    createClient,
    updateClient,
    deleteClient,
    createPaymentPlan,
    updatePaymentPlan,
    deletePaymentPlan,
    recordPaymentTransaction,
  } = useWorkshopData();

  const [planGateNotice, setPlanGateNotice] = useState<string | null>(null);
  const [statementGateOpen, setStatementGateOpen] = useState(false);

  const snapDeckRef = useRef<SnapDeckHandle | null>(null);
  const profile = useViewportProfile();
  const todayKey = useMemo(() => toLocalDateKey(new Date()), []);

  const [activeTab, setActiveTab] = useState<ClientsTab>('clients');
  const [clientFilter, setClientFilter] = useState<ClientFilter>('all');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [ledgerMethodFilter, setLedgerMethodFilter] = useState<'all' | PaymentMethod>('all');
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [focusedClientId, setFocusedClientId] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{
    type: 'error';
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Modal Cliente
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);

  // Modal Crear / Editar Plan de Pago
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PaymentPlan | null>(null);
  const [planProjectId, setPlanProjectId] = useState('');
  const [planClientId, setPlanClientId] = useState('');
  const [planTotalRaw, setPlanTotalRaw] = useState('');
  const [planDateKey, setPlanDateKey] = useState(todayKey);
  const [planModality, setPlanModality] =
    useState<PaymentPlanModality>('deposit_and_balance');
  const [planNotes, setPlanNotes] = useState('');
  const [planRows, setPlanRows] = useState<EditableInstallmentRow[]>([]);
  const [includeInitialPayment, setIncludeInitialPayment] = useState(false);
  const [initPayAmountRaw, setInitPayAmountRaw] = useState('');
  const [initPayMethod, setInitPayMethod] = useState<PaymentMethod>('nequi');
  const [initPayRef, setInitPayRef] = useState('');
  const [initPayDateKey, setInitPayDateKey] = useState(todayKey);
  const [planToDelete, setPlanToDelete] = useState<PaymentPlan | null>(null);

  // Modal Registrar Abono
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payPlanId, setPayPlanId] = useState('');
  const [payInstallmentId, setPayInstallmentId] = useState('');
  const [payAmountRaw, setPayAmountRaw] = useState('');
  const [payDateKey, setPayDateKey] = useState(todayKey);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('nequi');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // Modal Estado de Cuenta
  const [statementText, setStatementText] = useState<string | null>(null);
  const [copiedStatement, setCopiedStatement] = useState(false);

  const hasOpenModal = Boolean(
    clientModalOpen || planModalOpen || payModalOpen || statementText !== null,
  );

  useEscapeKey(
    hasOpenModal && !busy && !clientToDelete && !planToDelete && !statementGateOpen,
    () => {
      setFeedback(null);
      if (statementText !== null) {
        setStatementText(null);
        return;
      }
      if (payModalOpen) {
        setPayModalOpen(false);
        return;
      }
      if (planModalOpen) {
        setPlanModalOpen(false);
        return;
      }
      if (clientModalOpen) {
        setClientModalOpen(false);
      }
    },
  );

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients],
  );
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const planByProjectId = useMemo(
    () => new Map(paymentPlans.map((p) => [p.projectId, p])),
    [paymentPlans],
  );
  const planById = useMemo(
    () => new Map(paymentPlans.map((p) => [p.id, p])),
    [paymentPlans],
  );

  const installmentsByPlan = useMemo(() => {
    const map = new Map<string, PaymentInstallment[]>();
    for (const inst of installments) {
      const arr = map.get(inst.planId) ?? [];
      arr.push(inst);
      map.set(inst.planId, arr);
    }
    return map;
  }, [installments]);

  const transactionsByPlan = useMemo(() => {
    const map = new Map<string, FinancialTransaction[]>();
    for (const tx of transactions) {
      const arr = map.get(tx.planId) ?? [];
      arr.push(tx);
      map.set(tx.planId, arr);
    }
    return map;
  }, [transactions]);

  const clientSummaries = useMemo(
    () =>
      computeClientAccountSummaries({
        clients,
        projects,
        paymentPlans,
        installments,
        transactions,
        todayKey,
      }),
    [clients, projects, paymentPlans, installments, transactions, todayKey],
  );

  const enrichedPlans = useMemo(() => {
    return paymentPlans
      .map((plan) => {
        const planInstallments = installmentsByPlan.get(plan.id) ?? [];
        const recomputed = recomputePlanAndInstallments(
          plan,
          planInstallments,
          todayKey,
        );
        const planTxs = (transactionsByPlan.get(plan.id) ?? []).toSorted((a, b) =>
          b.paymentDate.localeCompare(a.paymentDate),
        );
        const project = projectById.get(plan.projectId) ?? null;
        const client = clientById.get(plan.clientId) ?? null;
        return {
          plan,
          recomputed,
          project,
          client,
          transactions: planTxs,
        };
      })
      .sort((a, b) => {
        // Priorizar mora y saldo pendiente arriba
        const score = (status: PaymentStatus) =>
          status === 'overdue'
            ? 0
            : status === 'partial' || status === 'deposit_received' || status === 'unpaid'
              ? 1
              : 2;
        const diff = score(a.recomputed.status) - score(b.recomputed.status);
        if (diff !== 0) return diff;
        return b.plan.updatedAt.localeCompare(a.plan.updatedAt);
      });
  }, [
    paymentPlans,
    installmentsByPlan,
    transactionsByPlan,
    projectById,
    clientById,
    todayKey,
  ]);

  // Totales globales de cartera de clientes
  const portfolioTotals = useMemo(() => {
    let totalAgreedCOP = 0;
    let totalCollectedCOP = 0;
    let totalPendingCOP = 0;
    let overduePlansCount = 0;
    let overdueInstallmentsCount = 0;

    for (const item of enrichedPlans) {
      totalAgreedCOP += item.plan.totalAgreedCOP;
      totalCollectedCOP += item.recomputed.totalPaidCOP;
      totalPendingCOP += item.recomputed.balancePendingCOP;
      if (item.recomputed.status === 'overdue') {
        overduePlansCount += 1;
      }
      for (const inst of item.recomputed.effectiveInstallments) {
        if (inst.status === 'overdue') {
          overdueInstallmentsCount += 1;
        }
      }
    }

    return {
      totalAgreedCOP,
      totalCollectedCOP,
      totalPendingCOP,
      overduePlansCount,
      overdueInstallmentsCount,
    };
  }, [enrichedPlans]);

  // Proyectos elegibles para crear un plan nuevo (que aún no tienen plan)
  const projectsAvailableForNewPlan = useMemo(() => {
    return projects
      .filter((p) => !planByProjectId.has(p.id) && p.status !== 'cancelled')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [projects, planByProjectId]);

  const jumpToTab = (tab: ClientsTab) => {
    setActiveTab(tab);
    setFeedback(null);
    window.requestAnimationFrame(() => {
      if (tab === 'clients') snapDeckRef.current?.goToSlide(0, 'smooth');
      if (tab === 'plans') snapDeckRef.current?.goToSlide(0, 'smooth');
      if (tab === 'ledger') snapDeckRef.current?.goToSlide(0, 'smooth');
    });
  };

  // Manejo de saltos desde Proyectos, Cotizador, Panel o Notificaciones
  useEffect(() => {
    if (!initialProjectId && !initialClientId) return;

    if (initialProjectId) {
      const existingPlan = planByProjectId.get(initialProjectId);
      setFocusedProjectId(initialProjectId);
      setFocusedClientId(null);
      setActiveTab('plans');

      if (!existingPlan) {
        const proj = projectById.get(initialProjectId);
        if (proj) {
          openCreatePlanModal(proj.id, proj.clientId ?? undefined);
        }
      }
    } else if (initialClientId) {
      setFocusedClientId(initialClientId);
      setFocusedProjectId(null);
      setActiveTab('plans');
    }

    onClearInitialTarget?.();
  }, [initialProjectId, initialClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtros aplicados
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredClientSummaries = useMemo(() => {
    return clientSummaries.filter((summary) => {
      if (clientFilter === 'with_balance' && summary.pendingBalanceCOP <= 0) {
        return false;
      }
      if (clientFilter === 'overdue' && !summary.hasOverdue) {
        return false;
      }
      if (
        clientFilter === 'settled' &&
        (summary.plans.length === 0 || summary.pendingBalanceCOP > 0)
      ) {
        return false;
      }
      if (!normalizedSearch) return true;
      const haystack = [
        summary.client.name,
        summary.client.phone,
        summary.client.email ?? '',
        summary.client.address ?? '',
        summary.client.notes,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [clientSummaries, clientFilter, normalizedSearch]);

  const filteredPlans = useMemo(() => {
    return enrichedPlans.filter((entry) => {
      if (focusedProjectId && entry.plan.projectId !== focusedProjectId) {
        return false;
      }
      if (focusedClientId && entry.plan.clientId !== focusedClientId) {
        return false;
      }
      if (planFilter === 'open' && entry.recomputed.balancePendingCOP <= 0) {
        return false;
      }
      if (planFilter === 'overdue' && entry.recomputed.status !== 'overdue') {
        return false;
      }
      if (planFilter === 'paid' && entry.recomputed.status !== 'paid') {
        return false;
      }
      if (!normalizedSearch) return true;
      const haystack = [
        entry.client?.name ?? '',
        entry.project?.name ?? '',
        entry.plan.notes,
        getPaymentModalityLabel(entry.plan.modality),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [
    enrichedPlans,
    focusedProjectId,
    focusedClientId,
    planFilter,
    normalizedSearch,
  ]);

  const filteredTransactions = useMemo(() => {
    return transactions
      .toSorted((a, b) => {
        const d = b.paymentDate.localeCompare(a.paymentDate);
        return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
      })
      .filter((tx) => {
        if (ledgerMethodFilter !== 'all' && tx.paymentMethod !== ledgerMethodFilter) {
          return false;
        }
        if (focusedClientId && tx.clientId !== focusedClientId) {
          return false;
        }
        if (focusedProjectId && tx.projectId !== focusedProjectId) {
          return false;
        }
        if (!normalizedSearch) return true;
        const client = clientById.get(tx.clientId);
        const project = projectById.get(tx.projectId);
        const haystack = [
          client?.name ?? '',
          project?.name ?? '',
          tx.referenceNumber ?? '',
          tx.notes,
          getPaymentMethodLabel(tx.paymentMethod),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      });
  }, [
    transactions,
    ledgerMethodFilter,
    focusedClientId,
    focusedProjectId,
    normalizedSearch,
    clientById,
    projectById,
  ]);

  const ledgerByMethod = useMemo(() => {
    const totals: Record<PaymentMethod, { count: number; totalCOP: number }> = {
      nequi: { count: 0, totalCOP: 0 },
      daviplata: { count: 0, totalCOP: 0 },
      cash: { count: 0, totalCOP: 0 },
      bank_transfer: { count: 0, totalCOP: 0 },
      other: { count: 0, totalCOP: 0 },
    };
    for (const tx of transactions) {
      totals[tx.paymentMethod].count += 1;
      totals[tx.paymentMethod].totalCOP += tx.amountCOP;
    }
    return totals;
  }, [transactions]);

  // ---------------- Handlers Clientes ----------------

  const openCreateClientModal = () => {
    setEditingClient(null);
    setClientName('');
    setClientPhone('');
    setClientEmail('');
    setClientAddress('');
    setClientNotes('');
    setFeedback(null);
    setClientModalOpen(true);
  };

  const openEditClientModal = (client: Client) => {
    setEditingClient(client);
    setClientName(client.name);
    setClientPhone(client.phone);
    setClientEmail(client.email ?? '');
    setClientAddress(client.address ?? '');
    setClientNotes(client.notes);
    setFeedback(null);
    setClientModalOpen(true);
  };

  const handleSubmitClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (editingClient) {
        await updateClient(editingClient.id, {
          name: clientName,
          phone: clientPhone,
          email: clientEmail || null,
          address: clientAddress || null,
          notes: clientNotes,
        });
      } else {
        const created = await createClient({
          name: clientName,
          phone: clientPhone,
          email: clientEmail || null,
          address: clientAddress || null,
          notes: clientNotes,
        });
        if (planModalOpen && !planClientId) {
          setPlanClientId(created.id);
        }
      }
      setClientModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo guardar el cliente.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteClient = async () => {
    if (!clientToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deleteClient(clientToDelete.id);
      if (focusedClientId === clientToDelete.id) {
        setFocusedClientId(null);
      }
      setClientToDelete(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo eliminar el cliente.',
      });
      setClientToDelete(null);
    } finally {
      setBusy(false);
    }
  };

  // ---------------- Handlers Planes de Pago ----------------

  const regenerateDraftRows = (
    totalCOP: number,
    modality: PaymentPlanModality,
    dateKey: string,
  ) => {
    const generated = buildDefaultInstallmentSchedule(totalCOP, modality, dateKey);
    setPlanRows(
      generated.map((row) => ({
        ...row,
        localKey: makeLocalKey(),
        lockedPaidCOP: 0,
      })),
    );
    if (includeInitialPayment && generated[0]) {
      setInitPayAmountRaw(String(generated[0].scheduledAmountCOP));
    }
  };

  const openCreatePlanModal = (
    preferredProjectId?: string,
    preferredClientId?: string,
  ) => {
    const defaultProj =
      (preferredProjectId
        ? projectsAvailableForNewPlan.find((p) => p.id === preferredProjectId)
        : undefined) ?? projectsAvailableForNewPlan[0];

    const projId = defaultProj?.id ?? '';
    const resolvedClient =
      preferredClientId ??
      defaultProj?.clientId ??
      clients.find((c) => Boolean(defaultProj) && c.isDemo === defaultProj!.isDemo)
        ?.id ??
      clients[0]?.id ??
      '';
    const initialTotal =
      defaultProj && defaultProj.estimatedBudgetCOP > 0
        ? defaultProj.estimatedBudgetCOP
        : 100000;
    const defaultModality: PaymentPlanModality = 'deposit_and_balance';

    setEditingPlan(null);
    setPlanProjectId(projId);
    setPlanClientId(resolvedClient);
    setPlanTotalRaw(String(initialTotal));
    setPlanDateKey(todayKey);
    setPlanModality(defaultModality);
    setPlanNotes('');
    setIncludeInitialPayment(false);
    setInitPayMethod('nequi');
    setInitPayRef('');
    setInitPayDateKey(todayKey);

    const schedule = buildDefaultInstallmentSchedule(
      initialTotal,
      defaultModality,
      todayKey,
    );
    setPlanRows(
      schedule.map((row) => ({
        ...row,
        localKey: makeLocalKey(),
        lockedPaidCOP: 0,
      })),
    );
    setInitPayAmountRaw(String(schedule[0]?.scheduledAmountCOP ?? 0));
    setPlanGateNotice(null);
    setFeedback(null);
    setPlanModalOpen(true);
  };

  const openEditPlanModal = (plan: PaymentPlan) => {
    const existingInsts = (installmentsByPlan.get(plan.id) ?? []).toSorted(
      (a, b) => a.installmentNumber - b.installmentNumber,
    );

    setEditingPlan(plan);
    setPlanProjectId(plan.projectId);
    setPlanClientId(plan.clientId);
    setPlanTotalRaw(String(plan.totalAgreedCOP));
    setPlanDateKey(toLocalDateKey(plan.agreementDate) || todayKey);
    setPlanModality(plan.modality);
    setPlanNotes(plan.notes);
    setIncludeInitialPayment(false);
    setPlanRows(
      existingInsts.map((inst) => ({
        id: inst.id,
        localKey: inst.id,
        concept: inst.concept,
        scheduledAmountCOP: inst.scheduledAmountCOP,
        dueDateKey: toLocalDateKey(inst.dueDate) || todayKey,
        lockedPaidCOP: inst.paidAmountCOP,
      })),
    );
    setPlanGateNotice(null);
    setFeedback(null);
    setPlanModalOpen(true);
  };

  const handlePlanProjectSelect = (nextProjectId: string) => {
    setPlanProjectId(nextProjectId);
    const proj = projectById.get(nextProjectId);
    if (!proj) return;
    if (proj.clientId) {
      setPlanClientId(proj.clientId);
    } else {
      const compatibleClient = clients.find((c) => c.isDemo === proj.isDemo);
      if (compatibleClient) setPlanClientId(compatibleClient.id);
    }
    if (proj.estimatedBudgetCOP > 0) {
      setPlanTotalRaw(String(proj.estimatedBudgetCOP));
      regenerateDraftRows(proj.estimatedBudgetCOP, planModality, planDateKey);
    }
  };

  const handlePlanRowChange = (
    localKey: string,
    patch: Partial<
      Pick<
        EditableInstallmentRow,
        'concept' | 'scheduledAmountCOP' | 'dueDateKey' | 'amountRaw'
      >
    >,
  ) => {
    setPlanRows((prev) =>
      prev.map((row) => (row.localKey === localKey ? { ...row, ...patch } : row)),
    );
  };

  const handleAddInstallmentRow = () => {
    const check = canConfigurePaymentInstallments(
      effectiveTier,
      planModality,
      planRows.length + 1,
      { isEditingExisting: editingPlan !== null },
    );
    if (!check.allowed) {
      setPlanGateNotice(
        check.reason ??
          `En el plan FREE puedes configurar hasta ${FREE_MAX_PAYMENT_INSTALLMENTS} cuotas con importes libres.`,
      );
      return;
    }
    setPlanGateNotice(null);

    const totalMinor = toMinorUnits(
      parseNonNegativeMoney(planTotalRaw, settings.currency),
      settings.currency,
    );
    const currentSumMinor = planRows.reduce(
      (s, r) => s + toMinorUnits(r.scheduledAmountCOP, settings.currency),
      0,
    );
    const diff = Math.max(
      0,
      fromMinorUnits(totalMinor - currentSumMinor, settings.currency),
    );
    const lastDate = planRows[planRows.length - 1]?.dueDateKey ?? planDateKey;
    setPlanRows((prev) => [
      ...prev,
      {
        localKey: makeLocalKey(),
        concept: `Cuota ${prev.length + 1}`,
        scheduledAmountCOP: diff,
        amountRaw: String(diff),
        dueDateKey: lastDate,
        lockedPaidCOP: 0,
      },
    ]);
  };

  const handleRemoveInstallmentRow = (localKey: string) => {
    setPlanRows((prev) => {
      const target = prev.find((r) => r.localKey === localKey);
      if (!target || target.lockedPaidCOP > 0 || prev.length <= 1) return prev;
      return prev.filter((r) => r.localKey !== localKey);
    });
  };

  const handleSubmitPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalAgreedCOP = parseNonNegativeMoney(planTotalRaw, settings.currency);
    setBusy(true);
    setFeedback(null);
    try {
      if (editingPlan) {
        await updatePaymentPlan(editingPlan.id, {
          totalAgreedCOP,
          agreementDateKey: planDateKey,
          modality: planModality,
          notes: planNotes,
          installments: planRows.map((r) => ({
            id: r.id,
            concept: r.concept,
            scheduledAmountCOP: r.scheduledAmountCOP,
            dueDateKey: r.dueDateKey,
          })),
        });
      } else {
        const installmentCheck = canConfigurePaymentInstallments(
          effectiveTier,
          planModality,
          planRows.length,
          { isEditingExisting: false },
        );
        if (!installmentCheck.allowed) {
          setPlanGateNotice(
            installmentCheck.reason ??
              `En el plan FREE puedes crear planes de 1 pago o hasta ${FREE_MAX_PAYMENT_INSTALLMENTS} cuotas.`,
          );
          setBusy(false);
          return;
        }
        if (!planProjectId) {
          throw new Error('Selecciona el proyecto al que corresponde el plan.');
        }
        if (!planClientId) {
          throw new Error('Selecciona el cliente del plan de pagos.');
        }
        const initAmount = includeInitialPayment
          ? parseNonNegativeMoney(initPayAmountRaw, settings.currency)
          : 0;

        await createPaymentPlan({
          projectId: planProjectId,
          clientId: planClientId,
          totalAgreedCOP,
          agreementDateKey: planDateKey,
          modality: planModality,
          notes: planNotes,
          installments: planRows.map((r) => ({
            concept: r.concept,
            scheduledAmountCOP: r.scheduledAmountCOP,
            dueDateKey: r.dueDateKey,
          })),
          initialPayment:
            includeInitialPayment && initAmount > 0
              ? {
                  amountCOP: initAmount,
                  paymentDateKey: initPayDateKey,
                  paymentMethod: initPayMethod,
                  referenceNumber: initPayRef || null,
                }
              : null,
        });
        setActiveTab('plans');
      }
      setPlanModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo guardar el plan de pagos.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeletePlan = async () => {
    if (!planToDelete) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deletePaymentPlan(planToDelete.id);
      setPlanToDelete(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo eliminar el plan de pagos.',
      });
      setPlanToDelete(null);
    } finally {
      setBusy(false);
    }
  };

  // ---------------- Handlers Abonos ----------------

  const openPaymentModal = (
    planId: string,
    installmentId?: string,
  ) => {
    const plan = planById.get(planId);
    if (!plan) return;
    const planInsts = (installmentsByPlan.get(planId) ?? []).toSorted(
      (a, b) => a.installmentNumber - b.installmentNumber,
    );
    const openInst =
      (installmentId ? planInsts.find((i) => i.id === installmentId) : undefined) ??
      planInsts.find((i) => i.paidAmountCOP < i.scheduledAmountCOP);

    const suggestedCOP = openInst
      ? Math.max(0, openInst.scheduledAmountCOP - openInst.paidAmountCOP)
      : plan.balancePendingCOP;

    setPayPlanId(planId);
    setPayInstallmentId(openInst?.id ?? '');
    setPayAmountRaw(String(suggestedCOP));
    setPayDateKey(todayKey);
    setPayMethod('nequi');
    setPayRef('');
    setPayNotes('');
    setFeedback(null);
    setPayModalOpen(true);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCOP = parseNonNegativeMoney(payAmountRaw, settings.currency);
    setBusy(true);
    setFeedback(null);
    try {
      await recordPaymentTransaction({
        planId: payPlanId,
        installmentId: payInstallmentId || null,
        amountCOP,
        paymentDateKey: payDateKey,
        paymentMethod: payMethod,
        referenceNumber: payRef || null,
        notes: payNotes,
      });
      setPayModalOpen(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'No se pudo registrar el abono.',
      });
    } finally {
      setBusy(false);
    }
  };

  // ---------------- Estado de cuenta compartible ----------------

  const handleOpenStatement = (plan: PaymentPlan) => {
    if (!canExportAccountStatement(effectiveTier)) {
      setStatementGateOpen(true);
      return;
    }
    const client = clientById.get(plan.clientId);
    const project = projectById.get(plan.projectId);
    if (!client || !project) return;
    const text = buildPaymentPlanStatementText({
      workshopName: settings.workshopName,
      client,
      project,
      plan,
      installments: installmentsByPlan.get(plan.id) ?? [],
    });
    setCopiedStatement(false);
    setStatementText(text);
  };

  const handleCopyStatement = async () => {
    if (!canExportAccountStatement(effectiveTier)) {
      setStatementGateOpen(true);
      return;
    }
    if (!statementText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(statementText);
        setCopiedStatement(true);
        window.setTimeout(() => setCopiedStatement(false), 2000);
      }
    } catch {
      // Fallback: el usuario puede copiar manualmente desde el textarea
    }
  };

  // ---------------- Paginación responsive por vista completa ----------------

  const firstClientsLimit = pickPageSize(profile, {
    mobileCompact: 1,
    mobileRegular: 1,
    tablet: 2,
    desktopCompact: 4,
    desktopRegular: 6,
    desktopTall: 6,
  });
  const extraClientsLimit = pickPageSize(profile, {
    mobileCompact: 2,
    mobileRegular: 2,
    tablet: 4,
    desktopCompact: 6,
    desktopRegular: 8,
    desktopTall: 8,
  });
  const plansPerSlide = pickPageSize(profile, {
    mobileCompact: 1,
    mobileRegular: 1,
    tablet: 1,
    desktopCompact: 1,
    desktopRegular: 2,
    desktopTall: 2,
  });
  const firstLedgerLimit = pickPageSize(profile, {
    mobileCompact: 0,
    mobileRegular: 1,
    tablet: 3,
    desktopCompact: 4,
    desktopRegular: 6,
    desktopTall: 8,
  });
  const extraLedgerLimit = pickPageSize(profile, {
    mobileCompact: 3,
    mobileRegular: 4,
    tablet: 6,
    desktopCompact: 6,
    desktopRegular: 8,
    desktopTall: 10,
  });

  const firstClientSummaries = filteredClientSummaries.slice(0, firstClientsLimit);
  const extraClientPages = chunkIntoPages(
    filteredClientSummaries.slice(firstClientsLimit),
    extraClientsLimit,
  );
  const planPages = chunkIntoPages(filteredPlans, plansPerSlide);
  const firstLedgerItems = filteredTransactions.slice(0, firstLedgerLimit);
  const extraLedgerPages = chunkIntoPages(
    filteredTransactions.slice(firstLedgerLimit),
    extraLedgerLimit,
  );

  // ---------------- Cálculos auxiliares de formularios ----------------

  const currencySpec = getCurrencySpec(settings.currency);
  const moneyInputMode = currencySpec.decimals > 0 ? 'decimal' : 'numeric';
  const planDraftSumMinor = planRows.reduce(
    (sum, row) => sum + toMinorUnits(row.scheduledAmountCOP || 0, settings.currency),
    0,
  );
  const planDraftTargetMinor = toMinorUnits(
    parseNonNegativeMoney(planTotalRaw, settings.currency),
    settings.currency,
  );
  const planDraftDiffMinor = planDraftTargetMinor - planDraftSumMinor;
  const planDraftSumCOP = fromMinorUnits(planDraftSumMinor, settings.currency);
  const planDraftTargetCOP = fromMinorUnits(planDraftTargetMinor, settings.currency);
  const planDraftDiffCOP = fromMinorUnits(planDraftDiffMinor, settings.currency);

  const selectedPlanForPay = payPlanId
    ? enrichedPlans.find((e) => e.plan.id === payPlanId) ?? null
    : null;

  const activeFilterBanner =
    focusedClientId || focusedProjectId ? (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2 text-xs text-teal-900">
        <span>
          Filtro activo:{' '}
          <strong className="font-semibold">
            {focusedProjectId
              ? projectById.get(focusedProjectId)?.name ?? 'Proyecto'
              : clientById.get(focusedClientId ?? '')?.name ?? 'Cliente'}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => {
            setFocusedProjectId(null);
            setFocusedClientId(null);
          }}
          className="inline-flex items-center gap-1 font-semibold text-teal-800 hover:text-teal-950"
        >
          <X className="h-3.5 w-3.5" />
          <span>Quitar filtro</span>
        </button>
      </div>
    ) : null;

  // ---------------- Subcomponentes de renderizado ----------------

  const renderClientCard = (summary: ClientAccountSummary) => {
    const {
      client,
      linkedProjects,
      plans,
      totalAgreedCOP,
      totalPaidCOP,
      pendingBalanceCOP,
      hasOverdue,
      overdueCount,
      nextDueDate,
    } = summary;

    return (
      <article
        key={client.id}
        className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-display text-base font-bold text-slate-900">
                  {client.name}
                </h3>
                {client.isDemo && (
                  <span className="text-xs font-medium text-slate-400">
                    · Ejemplo
                  </span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                {client.phone ? (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {client.phone}
                  </span>
                ) : (
                  <span>Sin teléfono</span>
                )}
                {client.email && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{client.email}</span>
                  </>
                )}
              </div>
              {client.address && (
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {client.address}
                </p>
              )}
            </div>

            {plans.length === 0 ? (
              <StatusBadge label="Sin plan" tone="neutral" />
            ) : hasOverdue ? (
              <StatusBadge label={`${overdueCount} vencida${overdueCount === 1 ? '' : 's'}`} tone="danger" />
            ) : pendingBalanceCOP > 0 ? (
              <StatusBadge label="Con saldo" tone="warning" />
            ) : (
              <StatusBadge label="Al día" tone="success" />
            )}
          </div>

          {client.notes && (
            <p className="mt-2.5 line-clamp-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
              {client.notes}
            </p>
          )}

          <dl className="mt-3.5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
            <div>
              <dt className="text-slate-500">Acordado</dt>
              <dd className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                {formatCOP(totalAgreedCOP)}
              </dd>
              <UsdEquiv amount={totalAgreedCOP} block className="text-[10px]" />
            </div>
            <div>
              <dt className="text-slate-500">Abonado</dt>
              <dd className="mt-0.5 font-mono font-semibold text-emerald-700 tabular-nums">
                {formatCOP(totalPaidCOP)}
              </dd>
              <UsdEquiv amount={totalPaidCOP} block className="text-[10px]" />
            </div>
            <div>
              <dt className="text-slate-500">Pendiente</dt>
              <dd
                className={`mt-0.5 font-mono font-bold tabular-nums ${
                  hasOverdue
                    ? 'text-rose-700'
                    : pendingBalanceCOP > 0
                      ? 'text-slate-900'
                      : 'text-emerald-700'
                }`}
              >
                {formatCOP(pendingBalanceCOP)}
              </dd>
              <UsdEquiv amount={pendingBalanceCOP} block className="text-[10px]" />
            </div>
          </dl>

          <p className="mt-2 text-[11px] text-slate-500 tabular-nums">
            {linkedProjects.length} proyecto{linkedProjects.length === 1 ? '' : 's'} ·{' '}
            {plans.length} plan{plans.length === 1 ? '' : 'es'}
            {nextDueDate ? ` · Próxima cuota: ${formatDateCO(nextDueDate)}` : ''}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {plans.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setFocusedClientId(client.id);
                setFocusedProjectId(null);
                jumpToTab('plans');
              }}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
            >
              <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Ver cobros ({plans.length})</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={projectsAvailableForNewPlan.length === 0}
              onClick={() => {
                const candidateProj = linkedProjects.find(
                  (p) => !planByProjectId.has(p.id) && p.status !== 'cancelled',
                );
                openCreatePlanModal(candidateProj?.id, client.id);
              }}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Crear plan</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => openEditClientModal(client)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Editar</span>
          </button>

          <button
            type="button"
            onClick={() => setClientToDelete(client)}
            aria-label={`Eliminar a ${client.name}`}
            className="ml-auto inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-50 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </article>
    );
  };

  const renderPlanCard = (entry: (typeof enrichedPlans)[number]) => {
    const { plan, recomputed, project, client, transactions: planTxs } = entry;
    const statusMeta = PAYMENT_STATUS_META[recomputed.status];
    const paidPercent =
      plan.totalAgreedCOP > 0
        ? Math.min(
            100,
            Math.round((recomputed.totalPaidCOP / plan.totalAgreedCOP) * 100),
          )
        : 0;
    const hasLedgerTxs = planTxs.length > 0;

    return (
      <article
        key={plan.id}
        className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
      >
        {/* Cabecera del plan */}
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{client?.name ?? 'Cliente'}</span>
              <span aria-hidden="true">·</span>
              <span>{getPaymentModalityLabel(plan.modality)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                Acuerdo: {formatDateCO(plan.agreementDate)}
              </span>
              {plan.isDemo && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-slate-400">Ejemplo</span>
                </>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              {project && onOpenProject ? (
                <button
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  className="inline-flex items-center gap-1 text-left font-display text-base font-bold text-slate-900 hover:text-teal-700 sm:text-lg"
                >
                  <span>{project.name}</span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                </button>
              ) : (
                <h3 className="font-display text-base font-bold text-slate-900 sm:text-lg">
                  {project?.name ?? 'Proyecto'}
                </h3>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
            {recomputed.balancePendingCOP > 0 && (
              <button
                type="button"
                onClick={() => openPaymentModal(plan.id)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Registrar abono</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra de resumen financiero del encargo */}
        <div className="mt-4 grid grid-cols-3 gap-3 sm:gap-4">
          <div>
            <p className="text-xs text-slate-500">Valor acordado</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums sm:text-base">
              {formatCOP(plan.totalAgreedCOP)}
            </p>
            <UsdEquiv amount={plan.totalAgreedCOP} block />
          </div>
          <div>
            <p className="text-xs text-slate-500">Abonado a la fecha</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-700 tabular-nums sm:text-base">
              {formatCOP(recomputed.totalPaidCOP)}
            </p>
            <UsdEquiv amount={recomputed.totalPaidCOP} block />
          </div>
          <div>
            <p className="text-xs text-slate-500">Saldo pendiente</p>
            <p
              className={`mt-0.5 font-mono text-sm font-bold tabular-nums sm:text-base ${
                recomputed.status === 'overdue'
                  ? 'text-rose-700'
                  : recomputed.balancePendingCOP > 0
                    ? 'text-slate-900'
                    : 'text-emerald-700'
              }`}
            >
              {formatCOP(recomputed.balancePendingCOP)}
            </p>
            <UsdEquiv amount={recomputed.balancePendingCOP} block />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${
                recomputed.status === 'paid'
                  ? 'bg-emerald-600'
                  : recomputed.status === 'overdue'
                    ? 'bg-rose-600'
                    : 'bg-teal-700'
              }`}
              style={{ width: `${paidPercent}%` }}
            />
          </div>
          <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
            {paidPercent}%
          </span>
        </div>

        {/* Cronograma de cuotas */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold text-slate-600">
            Cronograma de cuotas ({recomputed.effectiveInstallments.length})
          </p>
          <div className="mt-2 divide-y divide-slate-100">
            {recomputed.effectiveInstallments.map((inst) => {
              const instMeta = INSTALLMENT_STATUS_META[inst.status];
              const remainingCOP = Math.max(
                0,
                inst.scheduledAmountCOP - inst.paidAmountCOP,
              );
              return (
                <div
                  key={inst.id}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums">
                        #{inst.installmentNumber}
                      </span>
                      <span className="text-sm font-medium text-slate-900">
                        {inst.concept}
                      </span>
                      <StatusBadge label={instMeta.label} tone={instMeta.tone} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                      Vence: {formatDateCO(inst.dueDate)} · Programado:{' '}
                      {formatCOP(inst.scheduledAmountCOP)}
                      <UsdEquiv
                        amount={inst.scheduledAmountCOP}
                        prefix=" ("
                        suffix=")"
                      />
                      {inst.paidAmountCOP > 0 && (
                        <>
                          {` · Pagado: ${formatCOP(inst.paidAmountCOP)}`}
                          <UsdEquiv
                            amount={inst.paidAmountCOP}
                            prefix=" ("
                            suffix=")"
                          />
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0">
                    <div className="text-right">
                      <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums sm:text-sm">
                        {remainingCOP > 0
                          ? `Restan ${formatCOP(remainingCOP)}`
                          : 'Cubierta'}
                      </span>
                      {remainingCOP > 0 && (
                        <UsdEquiv amount={remainingCOP} block className="text-[10px]" />
                      )}
                    </div>
                    {remainingCOP > 0 && (
                      <button
                        type="button"
                        onClick={() => openPaymentModal(plan.id, inst.id)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-teal-700/30 bg-teal-50/70 px-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 whitespace-nowrap"
                      >
                        <span>Abonar</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {plan.notes && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {plan.notes}
          </p>
        )}

        {/* Acciones del plan */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => openEditPlanModal(plan)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Editar plan / cuotas</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenStatement(plan)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Estado de cuenta</span>
          </button>

          <button
            type="button"
            disabled={hasLedgerTxs}
            title={
              hasLedgerTxs
                ? 'Este plan ya tiene abonos inmutables y no puede eliminarse.'
                : 'Eliminar plan sin abonos'
            }
            onClick={() => setPlanToDelete(plan)}
            className="ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Eliminar plan</span>
          </button>
        </div>
      </article>
    );
  };

  const renderTransactionRow = (tx: FinancialTransaction) => {
    const client = clientById.get(tx.clientId);
    const project = projectById.get(tx.projectId);
    const planInsts = installmentsByPlan.get(tx.planId) ?? [];
    const linkedInst = tx.installmentId
      ? planInsts.find((i) => i.id === tx.installmentId)
      : undefined;

    return (
      <div
        key={tx.id}
        className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono font-medium text-slate-700 tabular-nums">
              {formatDateCO(tx.paymentDate)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-teal-800">
              {getPaymentMethodLabel(tx.paymentMethod)}
            </span>
            {tx.referenceNumber && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-600 tabular-nums">
                  Ref. {tx.referenceNumber}
                </span>
              </>
            )}
            {tx.isDemo && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-400">Ejemplo</span>
              </>
            )}
          </div>

          <p className="mt-0.5 text-sm font-semibold text-slate-900">
            {client?.name ?? 'Cliente'} · {project?.name ?? 'Encargo'}
          </p>

          {(linkedInst || tx.notes) && (
            <p className="mt-0.5 text-xs text-slate-500">
              {linkedInst ? `Aplicado a: ${linkedInst.concept}` : ''}
              {linkedInst && tx.notes ? ' · ' : ''}
              {tx.notes}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0">
          <div className="text-right">
            <span className="font-mono text-sm font-bold text-emerald-700 tabular-nums sm:text-base">
              + {formatCOP(tx.amountCOP)}
            </span>
            <UsdEquiv amount={tx.amountCOP} block />
          </div>
        </div>
      </div>
    );
  };

  // ---------------- Barra superior fija del módulo ----------------

  const topSlot = (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="grid w-full grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:inline-flex sm:w-auto sm:items-center"
          role="tablist"
          aria-label="Vistas de clientes y cobros"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'clients'}
            onClick={() => jumpToTab('clients')}
            className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
              activeTab === 'clients'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Clientes ({clients.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'plans'}
            onClick={() => jumpToTab('plans')}
            className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
              activeTab === 'plans'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="sm:hidden">Planes ({paymentPlans.length})</span>
            <span className="hidden sm:inline">
              Planes y cuotas ({paymentPlans.length})
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ledger'}
            onClick={() => jumpToTab('ledger')}
            className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
              activeTab === 'ledger'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <Receipt className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="sm:hidden">Caja ({transactions.length})</span>
            <span className="hidden sm:inline">
              Caja inmutable ({transactions.length})
            </span>
          </button>
        </div>

        {activeTab === 'clients' ? (
          <div className="flex w-full items-center sm:w-auto shrink-0">
            <button
              type="button"
              onClick={openCreateClientModal}
              className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3.5 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap sm:w-auto"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Nuevo cliente</span>
            </button>
          </div>
        ) : (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center shrink-0">
            <button
              type="button"
              onClick={openCreateClientModal}
              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
              <span>Nuevo cliente</span>
            </button>

            <button
              type="button"
              disabled={projectsAvailableForNewPlan.length === 0 || clients.length === 0}
              onClick={() => openCreatePlanModal()}
              title={
                clients.length === 0
                  ? 'Registra primero un cliente.'
                  : projectsAvailableForNewPlan.length === 0
                    ? 'Todos los proyectos activos ya tienen un plan de pago asignado.'
                    : 'Crear plan de pagos'
              }
              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="sm:hidden">Nuevo plan</span>
              <span className="hidden sm:inline">Nuevo plan de pago</span>
            </button>
          </div>
        )}
      </div>

      <InlineFeedbackAlert
        feedback={!hasOpenModal ? feedback : null}
        onDismiss={() => setFeedback(null)}
      />
    </div>
  );

  return (
    <>
      <SnapDeck
        ref={snapDeckRef}
        ariaLabel="Módulo de Clientes y Pagos"
        topSlot={topSlot}
      >
        {/* =================== TAB 1: CLIENTES Y RESUMEN =================== */}
        {activeTab === 'clients' && (
          <SnapSlide id="clients-overview" label="Resumen y clientes">
            <div className="space-y-4">
              {/* KPIs de cartera de clientes (caja separada de costos de taller) */}
              <section aria-label="Indicadores de cobros a clientes">
                <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-4">
                  <div className="border-b border-r border-slate-100 px-4 py-3 lg:border-b-0">
                    <p className="text-xs font-medium text-slate-500">
                      Total acordado (clientes)
                    </p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums sm:text-lg">
                      {formatCOP(portfolioTotals.totalAgreedCOP)}
                    </p>
                    <UsdEquiv amount={portfolioTotals.totalAgreedCOP} block />
                  </div>

                  <div className="border-b border-slate-100 px-4 py-3 lg:border-b-0 lg:border-r">
                    <p className="text-xs font-medium text-slate-500">
                      Ingresos recibidos (caja)
                    </p>
                    <p className="mt-0.5 font-mono text-base font-bold text-emerald-700 tabular-nums sm:text-lg">
                      {formatCOP(portfolioTotals.totalCollectedCOP)}
                    </p>
                    <UsdEquiv amount={portfolioTotals.totalCollectedCOP} block />
                  </div>

                  <div className="border-r border-slate-100 px-4 py-3">
                    <p className="text-xs font-medium text-slate-500">
                      Saldo por cobrar
                    </p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums sm:text-lg">
                      {formatCOP(portfolioTotals.totalPendingCOP)}
                    </p>
                    <UsdEquiv amount={portfolioTotals.totalPendingCOP} block />
                  </div>

                  <div className="px-4 py-3">
                    <p className="text-xs font-medium text-slate-500">
                      Cuotas vencidas
                    </p>
                    <p
                      className={`mt-0.5 font-mono text-base font-bold tabular-nums sm:text-lg ${
                        portfolioTotals.overdueInstallmentsCount > 0
                          ? 'text-rose-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {portfolioTotals.overdueInstallmentsCount}
                      <span className="ml-1.5 text-xs font-normal text-slate-500">
                        ({portfolioTotals.overduePlansCount} plan
                        {portfolioTotals.overduePlansCount === 1 ? '' : 'es'})
                      </span>
                    </p>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Separación financiera: esta sección controla ingresos y saldos de clientes; los gastos de insumos y operación del taller se gestionan en Compras y Cotizador.
                </p>
              </section>

              {/* Buscador y filtros */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por nombre, teléfono o correo..."
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div className="grid w-full grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex sm:w-auto sm:items-center">
                  {(
                    [
                      { id: 'all', label: 'Todos' },
                      { id: 'with_balance', label: 'Con saldo' },
                      { id: 'overdue', label: 'En mora' },
                      { id: 'settled', label: 'Al día' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setClientFilter(item.id)}
                      className={`inline-flex min-h-[32px] items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
                        clientFilter === item.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {clients.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Aún no hay clientes registrados"
                  description="Registra tus clientes para vincular encargos, definir anticipos o planes por cuotas y llevar el historial inmutable de pagos."
                  primaryAction={{
                    label: 'Registrar primer cliente',
                    onClick: openCreateClientModal,
                  }}
                />
              ) : filteredClientSummaries.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="Sin clientes para este filtro"
                  description="Prueba cambiando los términos de búsqueda o el filtro de cartera."
                  primaryAction={{
                    label: 'Ver todos los clientes',
                    onClick: () => {
                      setSearchQuery('');
                      setClientFilter('all');
                    },
                  }}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {firstClientSummaries.map(renderClientCard)}
                </div>
              )}
            </div>
          </SnapSlide>
        )}

        {activeTab === 'clients' &&
          extraClientPages.map((pageItems, idx) => (
            <SnapSlide
              key={`clients-page-${idx + 2}`}
              id={`clients-page-${idx + 2}`}
              label={`Clientes (${idx + 2})`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Directorio de clientes · Página {idx + 2}
                  </h2>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {filteredClientSummaries.length} en total
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {pageItems.map(renderClientCard)}
                </div>
              </div>
            </SnapSlide>
          ))}

        {/* =================== TAB 2: PLANES Y CUOTAS =================== */}
        {activeTab === 'plans' &&
          (planPages.length === 0 ? (
            <SnapSlide id="plans-empty" label="Planes de pago">
              <div className="space-y-4">
                {activeFilterBanner}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 max-w-md">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar plan por cliente o proyecto..."
                      className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                  <div className="grid w-full grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex sm:w-auto sm:items-center">
                    {(
                      [
                        { id: 'all', label: 'Todos' },
                        { id: 'open', label: 'Pendientes' },
                        { id: 'overdue', label: 'En mora' },
                        { id: 'paid', label: 'Pagados' },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setPlanFilter(item.id)}
                        className={`inline-flex min-h-[32px] items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
                          planFilter === item.id
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <EmptyState
                  icon={CreditCard}
                  title={
                    paymentPlans.length === 0
                      ? 'Sin planes de pago registrados'
                      : 'No hay planes que coincidan con el filtro'
                  }
                  description={
                    paymentPlans.length === 0
                      ? 'Crea un plan de pagos para un proyecto por encargo para definir anticipos, cuotas y llevar el control de saldos pendientes.'
                      : 'Ajusta el filtro de búsqueda o el estado del plan para visualizar otros encargos.'
                  }
                  primaryAction={
                    projectsAvailableForNewPlan.length > 0 && clients.length > 0
                      ? {
                          label: 'Crear plan de pago',
                          onClick: () =>
                            openCreatePlanModal(
                              focusedProjectId ?? undefined,
                              focusedClientId ?? undefined,
                            ),
                        }
                      : undefined
                  }
                />
              </div>
            </SnapSlide>
          ) : (
            planPages.map((pageItems, pageIdx) => (
              <SnapSlide
                key={`plans-page-${pageIdx + 1}`}
                id={`plans-page-${pageIdx + 1}`}
                label={
                  planPages.length > 1
                    ? `Planes (${pageIdx + 1}/${planPages.length})`
                    : 'Planes y cuotas'
                }
              >
                <div className="space-y-4">
                  {pageIdx === 0 && (
                    <>
                      {activeFilterBanner}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="relative flex-1 max-w-md">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                            aria-hidden="true"
                          />
                          <input
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Buscar plan por cliente o proyecto..."
                            className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                          />
                        </div>
                        <div className="grid w-full grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex sm:w-auto sm:items-center">
                          {(
                            [
                              { id: 'all', label: 'Todos' },
                              { id: 'open', label: 'Pendientes' },
                              { id: 'overdue', label: 'En mora' },
                              { id: 'paid', label: 'Pagados' },
                            ] as const
                          ).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setPlanFilter(item.id)}
                              className={`inline-flex min-h-[32px] items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 ${
                                planFilter === item.id
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {pageIdx > 0 && (
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <h2 className="font-display text-base font-bold text-slate-900">
                        Planes y cuotas · Página {pageIdx + 1} de {planPages.length}
                      </h2>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {filteredPlans.length} planes
                      </span>
                    </div>
                  )}

                  <div className="space-y-4">{pageItems.map(renderPlanCard)}</div>
                </div>
              </SnapSlide>
            ))
          ))}

        {/* =================== TAB 3: CAJA E HISTORIAL INMUTABLE =================== */}
        {activeTab === 'ledger' && (
          <SnapSlide id="ledger-overview" label="Caja e historial">
            <div className="space-y-3 sm:space-y-4">
              {activeFilterBanner}

              {/* Desglose equilibrado por medio de pago (6 bloques = 3x2 en móvil, 2x3 en tablet, 1x6 en escritorio) */}
              <section className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-5">
                <div className="flex flex-col gap-1 border-b border-slate-100 pb-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Wallet className="h-4 w-4 shrink-0 text-teal-700 sm:h-5 sm:w-5" aria-hidden="true" />
                    <h2 className="truncate font-display text-sm font-bold text-slate-900 sm:text-base">
                      Ingresos por medio de pago
                    </h2>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 sm:text-xs">
                    <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>Libro inmutable · sin edición ni borrado</span>
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <button
                    type="button"
                    onClick={() => setLedgerMethodFilter('all')}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors sm:px-3 sm:py-2.5 ${
                      ledgerMethodFilter === 'all'
                        ? 'border-teal-700 bg-teal-50/80'
                        : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                    }`}
                  >
                    <p className="truncate text-[11px] font-medium text-slate-600 sm:text-xs">
                      Todos los medios
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-bold text-teal-800 tabular-nums">
                      {formatCOP(portfolioTotals.totalCollectedCOP)}
                    </p>
                    <UsdEquiv amount={portfolioTotals.totalCollectedCOP} block className="text-[10px]" />
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {transactions.length} recibo{transactions.length === 1 ? '' : 's'}
                    </p>
                  </button>

                  {PAYMENT_METHOD_OPTIONS.map((opt) => {
                    const summary = ledgerByMethod[opt.value];
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setLedgerMethodFilter((cur) =>
                            cur === opt.value ? 'all' : opt.value,
                          )
                        }
                        className={`rounded-lg border px-2.5 py-2 text-left transition-colors sm:px-3 sm:py-2.5 ${
                          ledgerMethodFilter === opt.value
                            ? 'border-teal-700 bg-teal-50/80'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                        }`}
                      >
                        <p className="truncate text-[11px] font-medium text-slate-600 sm:text-xs">
                          {opt.value === 'bank_transfer' ? (
                            <>
                              <span className="sm:hidden">Transferencia</span>
                              <span className="hidden sm:inline">{opt.label}</span>
                            </>
                          ) : (
                            opt.label
                          )}
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {formatCOP(summary.totalCOP)}
                        </p>
                        <UsdEquiv amount={summary.totalCOP} block className="text-[10px]" />
                        <p className="text-[11px] text-slate-500 tabular-nums">
                          {summary.count} recibo{summary.count === 1 ? '' : 's'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Búsqueda + lista inicial de transacciones */}
              <div className="relative max-w-md">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por cliente, proyecto o referencia..."
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                />
              </div>

              {filteredTransactions.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="Sin recibos registrados para este criterio"
                  description="Cada anticipo o abono registrado sobre un plan de pagos queda guardado aquí como asiento financiero inmutable."
                />
              ) : firstLedgerItems.length === 0 ? (
                <button
                  type="button"
                  onClick={() => snapDeckRef.current?.goToSlide('ledger-page-2')}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {filteredTransactions.length} recibo
                      {filteredTransactions.length === 1 ? '' : 's'} en caja
                    </p>
                    <p className="text-xs text-slate-500">
                      Desliza o toca aquí para ver el historial detallado
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                </button>
              ) : (
                <section className="rounded-xl border border-slate-200 bg-white px-4 py-2 sm:px-5">
                  <div className="divide-y divide-slate-100">
                    {firstLedgerItems.map(renderTransactionRow)}
                  </div>
                  {extraLedgerPages.length > 0 && (
                    <div className="flex items-center justify-between border-t border-slate-100 py-2.5 text-xs">
                      <span className="text-slate-500 tabular-nums">
                        Mostrando {firstLedgerItems.length} de {filteredTransactions.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => snapDeckRef.current?.goToSlide('ledger-page-2')}
                        className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-900"
                      >
                        <span>Ver todos</span>
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </section>
              )}
            </div>
          </SnapSlide>
        )}

        {activeTab === 'ledger' &&
          extraLedgerPages.map((pageItems, idx) => (
            <SnapSlide
              key={`ledger-page-${idx + 2}`}
              id={`ledger-page-${idx + 2}`}
              label={`Caja (${idx + 2})`}
            >
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Historial de abonos · Página {idx + 2}
                  </h2>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {filteredTransactions.length} en total
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {pageItems.map(renderTransactionRow)}
                </div>
              </section>
            </SnapSlide>
          ))}
      </SnapDeck>

      {/* =================== MODAL CLIENTE (CREAR / EDITAR) =================== */}
      {clientModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="client-modal-title"
        >
          <form
            onSubmit={handleSubmitClient}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2
                id="client-modal-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {editingClient ? 'Editar cliente' : 'Registrar nuevo cliente'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setClientModalOpen(false);
                }}
                aria-label="Cerrar modal de cliente"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <InlineFeedbackAlert
                feedback={feedback}
                onDismiss={() => setFeedback(null)}
              />
              <div>
                <label
                  htmlFor="client-name"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Nombre completo *
                </label>
                <input
                  id="client-name"
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ej. Camila Restrepo"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="client-phone"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Teléfono / WhatsApp
                  </label>
                  <input
                    id="client-phone"
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="Ej. 300 456 7890"
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="client-email"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Correo electrónico
                  </label>
                  <input
                    id="client-email"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="cliente@correo.com"
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="client-address"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Dirección o punto de entrega
                </label>
                <input
                  id="client-address"
                  type="text"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="Ej. Barrio Laureles, Medellín"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="client-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Preferencias y notas
                </label>
                <textarea
                  id="client-notes"
                  rows={2}
                  value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)}
                  placeholder="Ej. Prefiere tonos pastel, empaque para regalo..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setClientModalOpen(false);
                }}
                className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[42px] rounded-lg bg-teal-700 px-4 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {busy
                  ? 'Guardando...'
                  : editingClient
                    ? 'Guardar cambios'
                    : 'Registrar cliente'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =================== MODAL PLAN DE PAGOS (CREAR / EDITAR) =================== */}
      {planModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 sm:p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-modal-title"
        >
          <form
            onSubmit={handleSubmitPlan}
            className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-x-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2
                id="plan-modal-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {editingPlan
                  ? 'Editar plan de pagos y cuotas'
                  : 'Crear plan de pagos'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setPlanModalOpen(false);
                }}
                aria-label="Cerrar modal de plan"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <InlineFeedbackAlert
                feedback={feedback}
                onDismiss={() => setFeedback(null)}
              />
              {!editingPlan ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="plan-project"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Proyecto *
                    </label>
                    <select
                      id="plan-project"
                      required
                      value={planProjectId}
                      onChange={(e) => handlePlanProjectSelect(e.target.value)}
                      className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="">Selecciona un proyecto...</option>
                      {projectsAvailableForNewPlan.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.isDemo ? ' (Ejemplo)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="plan-client"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Cliente *
                    </label>
                    <select
                      id="plan-client"
                      required
                      value={planClientId}
                      onChange={(e) => setPlanClientId(e.target.value)}
                      className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    >
                      <option value="">Selecciona un cliente...</option>
                      {clients
                        .filter((c) => {
                          const proj = projectById.get(planProjectId);
                          return proj ? c.isDemo === proj.isDemo : true;
                        })
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.isDemo ? ' (Ejemplo)' : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                  Proyecto:{' '}
                  <strong className="font-semibold text-slate-900">
                    {projectById.get(editingPlan.projectId)?.name ?? 'Proyecto'}
                  </strong>{' '}
                  · Cliente:{' '}
                  <strong className="font-semibold text-slate-900">
                    {clientById.get(editingPlan.clientId)?.name ?? 'Cliente'}
                  </strong>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="plan-total"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Valor total acordado ({settings.currency}) *
                  </label>
                  <input
                    id="plan-total"
                    type="text"
                    inputMode={moneyInputMode}
                    required
                    value={planTotalRaw}
                    onChange={(e) => {
                      const cleaned = sanitizeMoneyDraft(
                        e.target.value,
                        currencySpec.decimals,
                      );
                      const nextTotal = parseNonNegativeMoney(
                        cleaned,
                        settings.currency,
                      );
                      setPlanTotalRaw(cleaned);
                      if (!editingPlan && nextTotal > 0) {
                        regenerateDraftRows(nextTotal, planModality, planDateKey);
                      }
                    }}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                  <UsdEquiv
                    amount={parseNonNegativeMoney(planTotalRaw, settings.currency)}
                    hideWhenZero
                    block
                    className="mt-1"
                  />
                </div>

                <div>
                  <label
                    htmlFor="plan-date"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Fecha del acuerdo *
                  </label>
                  <input
                    id="plan-date"
                    type="date"
                    required
                    value={planDateKey}
                    onChange={(e) => setPlanDateKey(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="plan-modality"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Modalidad *
                  </label>
                  <select
                    id="plan-modality"
                    value={planModality}
                    onChange={(e) => {
                      const nextMod = e.target.value as PaymentPlanModality;
                      const previewRows = buildDefaultInstallmentSchedule(
                        parseNonNegativeMoney(planTotalRaw, settings.currency),
                        nextMod,
                        planDateKey,
                      );
                      const check = canConfigurePaymentInstallments(
                        effectiveTier,
                        nextMod,
                        previewRows.length,
                        { isEditingExisting: editingPlan !== null },
                      );
                      if (!check.allowed) {
                        setPlanGateNotice(
                          check.reason ??
                            `En el plan FREE puedes crear planes de 1 pago o hasta ${FREE_MAX_PAYMENT_INSTALLMENTS} cuotas con montos libres.`,
                        );
                        return;
                      }
                      setPlanGateNotice(null);
                      setPlanModality(nextMod);
                      if (!editingPlan) {
                        regenerateDraftRows(
                          parseNonNegativeMoney(planTotalRaw, settings.currency),
                          nextMod,
                          planDateKey,
                        );
                      }
                    }}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {PAYMENT_MODALITY_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {planGateNotice && (
                <FeatureGate
                  mode="inline-banner"
                  featureTitle="Planes flexibles de 3 o más cuotas en PRO"
                  description={planGateNotice}
                  freeIncludedNote="En FREE puedes elegir Contado o 2 cuotas (Anticipo + Contraentrega / 2 cuotas) y editar libremente los importes y fechas de ambas cuotas sin distribución rígida 50/50."
                  onClose={() => setPlanGateNotice(null)}
                />
              )}

              {/* Editor de cuotas */}
              <div className="rounded-xl border border-slate-200 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">
                      Desglose de cuotas ({planRows.length})
                    </h3>
                    <p
                      className={`mt-0.5 font-mono text-[11px] tabular-nums ${
                        planDraftDiffMinor === 0
                          ? 'text-emerald-700'
                          : 'font-semibold text-rose-700'
                      }`}
                    >
                      Suma cuotas: {formatCOP(planDraftSumCOP)} / Acordado:{' '}
                      {formatCOP(planDraftTargetCOP)}
                      {planDraftDiffMinor !== 0 &&
                        ` (Diferencia: ${formatCOP(planDraftDiffCOP)})`}
                    </p>
                    <UsdEquiv
                      amount={planDraftSumCOP}
                      prefix="Suma cuotas: "
                      block
                      className="mt-0.5 text-[10px]"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleAddInstallmentRow}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Agregar cuota</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {planRows.map((row, idx) => (
                    <div
                      key={row.localKey}
                      className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-2.5 sm:grid-cols-12 sm:items-end"
                    >
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-medium text-slate-600">
                          Cuota #{idx + 1} · Concepto
                        </label>
                        <input
                          type="text"
                          required
                          value={row.concept}
                          onChange={(e) =>
                            handlePlanRowChange(row.localKey, {
                              concept: e.target.value,
                            })
                          }
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-medium text-slate-600">
                          Valor ({settings.currency})
                        </label>
                        <input
                          type="text"
                          inputMode={moneyInputMode}
                          required
                          value={row.amountRaw ?? String(row.scheduledAmountCOP)}
                          onChange={(e) => {
                            const cleaned = sanitizeMoneyDraft(
                              e.target.value,
                              currencySpec.decimals,
                            );
                            handlePlanRowChange(row.localKey, {
                              amountRaw: cleaned,
                              scheduledAmountCOP: parseNonNegativeMoney(
                                cleaned,
                                settings.currency,
                              ),
                            });
                          }}
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                        <UsdEquiv
                          amount={row.scheduledAmountCOP}
                          hideWhenZero
                          block
                          className="mt-1 text-[10px]"
                        />
                        {row.lockedPaidCOP > 0 && (
                          <span className="text-[10px] text-emerald-700 tabular-nums">
                            Ya pagado: {formatCOP(row.lockedPaidCOP)}
                          </span>
                        )}
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-medium text-slate-600">
                          Vencimiento
                        </label>
                        <input
                          type="date"
                          required
                          value={row.dueDateKey}
                          onChange={(e) =>
                            handlePlanRowChange(row.localKey, {
                              dueDateKey: e.target.value,
                            })
                          }
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>

                      <div className="flex justify-end sm:col-span-1">
                        <button
                          type="button"
                          disabled={row.lockedPaidCOP > 0 || planRows.length <= 1}
                          onClick={() => handleRemoveInstallmentRow(row.localKey)}
                          aria-label={`Quitar cuota ${idx + 1}`}
                          className="inline-flex h-[38px] w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Opción de abono/anticipo inicial solo al crear */}
              {!editingPlan && (
                <div className="rounded-xl border border-slate-200 p-3.5">
                  <label className="flex cursor-pointer items-center gap-2.5 text-xs font-semibold text-slate-900">
                    <input
                      type="checkbox"
                      checked={includeInitialPayment}
                      onChange={(e) => setIncludeInitialPayment(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                    />
                    <span>Registrar anticipo o pago inicial recibido ahora</span>
                  </label>

                  {includeInitialPayment && (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600">
                          Monto recibido ({settings.currency})
                        </label>
                        <input
                          type="text"
                          inputMode={moneyInputMode}
                          value={initPayAmountRaw}
                          onChange={(e) =>
                            setInitPayAmountRaw(
                              sanitizeMoneyDraft(
                                e.target.value,
                                currencySpec.decimals,
                              ),
                            )
                          }
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 px-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                        <UsdEquiv
                          amount={parseNonNegativeMoney(
                            initPayAmountRaw,
                            settings.currency,
                          )}
                          hideWhenZero
                          block
                          className="mt-1 text-[10px]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600">
                          Medio de pago
                        </label>
                        <select
                          value={initPayMethod}
                          onChange={(e) =>
                            setInitPayMethod(e.target.value as PaymentMethod)
                          }
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                        >
                          {PAYMENT_METHOD_OPTIONS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600">
                          Fecha del pago
                        </label>
                        <input
                          type="date"
                          value={initPayDateKey}
                          onChange={(e) => setInitPayDateKey(e.target.value)}
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 px-2.5 text-xs text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600">
                          Comprobante / Referencia
                        </label>
                        <input
                          type="text"
                          value={initPayRef}
                          onChange={(e) => setInitPayRef(e.target.value)}
                          placeholder="Ej. NQ-124890"
                          className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 px-2.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="plan-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Notas del acuerdo
                </label>
                <textarea
                  id="plan-notes"
                  rows={2}
                  value={planNotes}
                  onChange={(e) => setPlanNotes(e.target.value)}
                  placeholder="Condiciones de entrega, envío o acuerdos especiales..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setPlanModalOpen(false);
                }}
                className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || planDraftDiffMinor !== 0}
                className="min-h-[42px] rounded-lg bg-teal-700 px-4 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {busy
                  ? 'Guardando...'
                  : editingPlan
                    ? 'Guardar ajustes'
                    : 'Crear plan de pagos'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =================== MODAL REGISTRAR ABONO INMUTABLE =================== */}
      {payModalOpen && selectedPlanForPay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pay-modal-title"
        >
          <form
            onSubmit={handleSubmitPayment}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2
                  id="pay-modal-title"
                  className="font-display text-lg font-bold text-slate-900"
                >
                  Registrar abono en caja
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedPlanForPay.client?.name ?? 'Cliente'} ·{' '}
                  {selectedPlanForPay.project?.name ?? 'Encargo'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setPayModalOpen(false);
                }}
                aria-label="Cerrar modal de abono"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <InlineFeedbackAlert
                feedback={feedback}
                onDismiss={() => setFeedback(null)}
              />
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs">
                <span className="text-slate-600">Saldo pendiente del plan:</span>
                <div className="text-right">
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatCOP(selectedPlanForPay.recomputed.balancePendingCOP)}
                  </span>
                  <UsdEquiv
                    amount={selectedPlanForPay.recomputed.balancePendingCOP}
                    block
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="pay-installment"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Aplicar primero a cuota
                </label>
                <select
                  id="pay-installment"
                  value={payInstallmentId}
                  onChange={(e) => {
                    const instId = e.target.value;
                    setPayInstallmentId(instId);
                    const inst =
                      selectedPlanForPay.recomputed.effectiveInstallments.find(
                        (i) => i.id === instId,
                      );
                    if (inst) {
                      setPayAmountRaw(
                        String(
                          Math.max(0, inst.scheduledAmountCOP - inst.paidAmountCOP),
                        ),
                      );
                    }
                  }}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                >
                  <option value="">Distribución automática por vencimiento</option>
                  {selectedPlanForPay.recomputed.effectiveInstallments
                    .filter((i) => i.status !== 'paid')
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        #{i.installmentNumber} {i.concept} (restan{' '}
                        {formatCOP(
                          Math.max(0, i.scheduledAmountCOP - i.paidAmountCOP),
                        )}
                        )
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="pay-amount"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Monto recibido ({settings.currency}) *
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setPayAmountRaw(
                        String(selectedPlanForPay.recomputed.balancePendingCOP),
                      )
                    }
                    className="text-[11px] font-semibold text-teal-700 hover:text-teal-900"
                  >
                    Saldar todo (
                    {formatCOP(selectedPlanForPay.recomputed.balancePendingCOP)})
                  </button>
                </div>
                <input
                  id="pay-amount"
                  type="text"
                  inputMode={moneyInputMode}
                  required
                  value={payAmountRaw}
                  onChange={(e) =>
                    setPayAmountRaw(
                      sanitizeMoneyDraft(e.target.value, currencySpec.decimals),
                    )
                  }
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                />
                <UsdEquiv
                  amount={parseNonNegativeMoney(payAmountRaw, settings.currency)}
                  hideWhenZero
                  block
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="pay-method"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Medio de pago *
                  </label>
                  <select
                    id="pay-method"
                    value={payMethod}
                    onChange={(e) =>
                      setPayMethod(e.target.value as PaymentMethod)
                    }
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {PAYMENT_METHOD_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="pay-date"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Fecha del recibo *
                  </label>
                  <div className="relative mt-1">
                    <Calendar
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="pay-date"
                      type="date"
                      required
                      value={payDateKey}
                      onChange={(e) => setPayDateKey(e.target.value)}
                      className="min-h-[42px] w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="pay-ref"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Número de referencia / comprobante
                </label>
                <input
                  id="pay-ref"
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Ej. NQ-014889"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="pay-notes"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Notas del abono
                </label>
                <input
                  id="pay-notes"
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Ej. Transferencia confirmada por WhatsApp"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>

              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Este asiento se guardará como registro financiero inmutable para auditoría.
                </span>
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setPayModalOpen(false);
                }}
                className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[42px] rounded-lg bg-teal-700 px-4 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {busy ? 'Registrando...' : 'Confirmar abono'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =================== MODAL ESTADO DE CUENTA =================== */}
      {statementText !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="statement-modal-title"
        >
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2
                id="statement-modal-title"
                className="font-display text-base font-bold text-slate-900"
              >
                Estado de cuenta para enviar al cliente
              </h2>
              <button
                type="button"
                onClick={() => setStatementText(null)}
                aria-label="Cerrar estado de cuenta"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              readOnly
              rows={11}
              value={statementText}
              className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 focus:outline-none"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStatementText(null)}
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void handleCopyStatement()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-4 text-xs font-semibold text-white hover:bg-teal-800"
              >
                {copiedStatement ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    <span>Copiar texto</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================== CONFIRMACIONES DE BORRADO =================== */}
      <ConfirmModal
        isOpen={Boolean(clientToDelete)}
        title="Eliminar cliente"
        description={`¿Seguro que deseas eliminar a "${clientToDelete?.name ?? ''}"? Solo se permite si no tiene proyectos, cotizaciones o pagos vinculados.`}
        confirmLabel="Sí, eliminar"
        variant="danger"
        isBusy={busy}
        onCancel={() => setClientToDelete(null)}
        onConfirm={() => void handleConfirmDeleteClient()}
      />

      <ConfirmModal
        isOpen={Boolean(planToDelete)}
        title="Eliminar plan de pagos"
        description="¿Seguro que deseas eliminar este plan y sus cuotas programadas? Esta acción solo procede cuando el plan no tiene abonos registrados."
        confirmLabel="Sí, eliminar plan"
        variant="danger"
        isBusy={busy}
        onCancel={() => setPlanToDelete(null)}
        onConfirm={() => void handleConfirmDeletePlan()}
      />

      <FeatureGate
        mode="modal"
        isOpen={statementGateOpen}
        onClose={() => setStatementGateOpen(false)}
        featureTitle="Exportación de estados de cuenta detallados (PRO)"
        description="Genera automáticamente un estado de cuenta completo y formateado con el detalle de cuotas, pagos realizados y saldo pendiente, listo para compartir con tu clienta."
        freeIncludedNote="Puedes consultar libremente todas las cuotas, fechas, historial de abonos y saldos pendientes de cada plan directamente en la pantalla sin restricciones."
      />
    </>
  );
};
