import type {
  Client,
  FinancialTransaction,
  InstallmentStatus,
  MoneyCOP,
  PaymentInstallment,
  PaymentMethod,
  PaymentPlan,
  PaymentPlanModality,
  PaymentStatus,
  Project,
  ProjectPaymentSummaryStatus,
} from '@/src/domain/models/index.ts';
import { formatCOP, formatDateCO } from './formatters.ts';
import { addDaysToDateKey, dateKeyToMiddayIso, toLocalDateKey } from './planningService.ts';

export interface CreateClientInput {
  readonly name: string;
  readonly phone: string;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly notes?: string;
}

export interface UpdateClientInput {
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly notes?: string;
}

export interface InstallmentDraftInput {
  readonly id?: string;
  readonly concept: string;
  readonly scheduledAmountCOP: MoneyCOP;
  readonly dueDateKey: string;
}

export interface InitialPaymentInput {
  readonly amountCOP: MoneyCOP;
  readonly paymentDateKey: string;
  readonly paymentMethod: PaymentMethod;
  readonly referenceNumber?: string | null;
  readonly notes?: string;
}

export interface CreatePaymentPlanInput {
  readonly projectId: string;
  readonly clientId: string;
  readonly totalAgreedCOP: MoneyCOP;
  readonly agreementDateKey: string;
  readonly modality: PaymentPlanModality;
  readonly notes?: string;
  readonly installments: InstallmentDraftInput[];
  readonly initialPayment?: InitialPaymentInput | null;
}

export interface UpdatePaymentPlanInput {
  readonly totalAgreedCOP: MoneyCOP;
  readonly agreementDateKey?: string;
  readonly modality: PaymentPlanModality;
  readonly notes?: string;
  readonly installments: InstallmentDraftInput[];
}

export interface RecordPaymentTransactionInput {
  readonly planId: string;
  readonly installmentId: string | null;
  readonly amountCOP: MoneyCOP;
  readonly paymentDateKey: string;
  readonly paymentMethod: PaymentMethod;
  readonly referenceNumber?: string | null;
  readonly notes?: string;
}

export const PAYMENT_MODALITY_OPTIONS: Array<{
  readonly value: PaymentPlanModality;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: 'full',
    label: 'Pago único (100%)',
    description: 'Un solo cobro por el valor total del encargo.',
  },
  {
    value: 'deposit_and_balance',
    label: 'Anticipo + Saldo contra entrega',
    description: '50% inicial para apartar agenda/materiales y 50% al entregar.',
  },
  {
    value: 'two_installments',
    label: '2 cuotas iguales',
    description: 'Dividido en dos abonos programados.',
  },
  {
    value: 'three_installments',
    label: 'Anticipo + 3 cuotas',
    description: 'Anticipo inicial (33%) y 3 cuotas periódicas.',
  },
  {
    value: 'custom',
    label: 'Plan personalizado',
    description: 'Define libremente fechas, conceptos y montos de cada cuota.',
  },
];

export const PAYMENT_METHOD_OPTIONS: Array<{
  readonly value: PaymentMethod;
  readonly label: string;
}> = [
  { value: 'nequi', label: 'Nequi' },
  { value: 'daviplata', label: 'Daviplata' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'bank_transfer', label: 'Transferencia bancaria' },
  { value: 'other', label: 'Otro medio' },
];

export const PAYMENT_STATUS_META: Record<
  PaymentStatus,
  {
    readonly label: string;
    readonly tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger';
  }
> = {
  unpaid: { label: 'Sin pagos', tone: 'neutral' },
  deposit_received: { label: 'Anticipo recibido', tone: 'active' },
  partial: { label: 'Pago parcial', tone: 'warning' },
  paid: { label: 'Pagado completo', tone: 'success' },
  overdue: { label: 'Con cuota vencida', tone: 'danger' },
};

export const INSTALLMENT_STATUS_META: Record<
  InstallmentStatus,
  {
    readonly label: string;
    readonly tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger';
  }
> = {
  pending: { label: 'Pendiente', tone: 'neutral' },
  partial: { label: 'Abono parcial', tone: 'warning' },
  paid: { label: 'Pagada', tone: 'success' },
  overdue: { label: 'Vencida', tone: 'danger' },
};

export function getPaymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_OPTIONS.find((m) => m.value === method)?.label ?? 'Otro medio';
}

export function getPaymentModalityLabel(modality: PaymentPlanModality): string {
  return PAYMENT_MODALITY_OPTIONS.find((m) => m.value === modality)?.label ?? 'Personalizado';
}

/**
 * Construye una programación sugerida de cuotas cuya suma en COP enteros
 * coincide exactamente con totalAgreedCOP.
 */
export function buildDefaultInstallmentSchedule(
  totalAgreedCOP: MoneyCOP,
  modality: PaymentPlanModality,
  agreementDateKey: string,
): InstallmentDraftInput[] {
  const safeTotal = Math.max(0, Math.round(totalAgreedCOP || 0));
  const baseDate = agreementDateKey || toLocalDateKey(new Date());

  if (modality === 'full') {
    return [
      {
        concept: 'Pago único del encargo',
        scheduledAmountCOP: safeTotal,
        dueDateKey: baseDate,
      },
    ];
  }

  if (modality === 'deposit_and_balance') {
    const first = Math.round(safeTotal * 0.5);
    const second = Math.max(0, safeTotal - first);
    return [
      {
        concept: 'Anticipo inicial (50%)',
        scheduledAmountCOP: first,
        dueDateKey: baseDate,
      },
      {
        concept: 'Saldo contra entrega (50%)',
        scheduledAmountCOP: second,
        dueDateKey: addDaysToDateKey(baseDate, 14),
      },
    ];
  }

  if (modality === 'two_installments') {
    const first = Math.floor(safeTotal / 2);
    const second = Math.max(0, safeTotal - first);
    return [
      {
        concept: 'Primera cuota',
        scheduledAmountCOP: first,
        dueDateKey: baseDate,
      },
      {
        concept: 'Segunda cuota',
        scheduledAmountCOP: second,
        dueDateKey: addDaysToDateKey(baseDate, 15),
      },
    ];
  }

  if (modality === 'three_installments') {
    const deposit = Math.round((safeTotal / 3) / 1000) * 1000;
    const clampedDeposit = Math.min(safeTotal, Math.max(0, deposit));
    const rest = Math.max(0, safeTotal - clampedDeposit);
    const q1 = Math.floor(rest / 3);
    const q2 = Math.floor(rest / 3);
    const q3 = Math.max(0, rest - q1 - q2);
    return [
      {
        concept: 'Anticipo inicial',
        scheduledAmountCOP: clampedDeposit,
        dueDateKey: baseDate,
      },
      {
        concept: 'Segunda cuota',
        scheduledAmountCOP: q1,
        dueDateKey: addDaysToDateKey(baseDate, 10),
      },
      {
        concept: 'Tercera cuota',
        scheduledAmountCOP: q2,
        dueDateKey: addDaysToDateKey(baseDate, 20),
      },
      {
        concept: 'Saldo contra entrega',
        scheduledAmountCOP: q3,
        dueDateKey: addDaysToDateKey(baseDate, 30),
      },
    ];
  }

  // Personalizado inicial: anticipo + saldo
  const first = Math.round(safeTotal * 0.4);
  const second = Math.max(0, safeTotal - first);
  return [
    {
      concept: 'Cuota 1 / Anticipo',
      scheduledAmountCOP: first,
      dueDateKey: baseDate,
    },
    {
      concept: 'Cuota 2 / Saldo',
      scheduledAmountCOP: second,
      dueDateKey: addDaysToDateKey(baseDate, 15),
    },
  ];
}

export function resolveInstallmentStatus(
  scheduledAmountCOP: MoneyCOP,
  paidAmountCOP: MoneyCOP,
  dueDateIso: string,
  todayKey = toLocalDateKey(new Date()),
): InstallmentStatus {
  const scheduled = Math.max(0, Math.round(scheduledAmountCOP));
  const paid = Math.max(0, Math.round(paidAmountCOP));
  if (scheduled > 0 && paid >= scheduled) return 'paid';
  if (scheduled === 0 && paid === 0) return 'paid';
  const dueKey = toLocalDateKey(dueDateIso);
  if (dueKey && dueKey < todayKey) return 'overdue';
  if (paid > 0) return 'partial';
  return 'pending';
}

export interface RecomputedPlanSummary {
  readonly totalPaidCOP: MoneyCOP;
  readonly balancePendingCOP: MoneyCOP;
  readonly status: PaymentStatus;
  readonly projectPaymentStatus: ProjectPaymentSummaryStatus;
  readonly effectiveInstallments: PaymentInstallment[];
}

export function recomputePlanAndInstallments(
  plan: PaymentPlan,
  rawInstallments: PaymentInstallment[],
  todayKey = toLocalDateKey(new Date()),
): RecomputedPlanSummary {
  const sorted = rawInstallments
    .slice()
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  const effectiveInstallments = sorted.map((inst) => ({
    ...inst,
    status: resolveInstallmentStatus(
      inst.scheduledAmountCOP,
      inst.paidAmountCOP,
      inst.dueDate,
      todayKey,
    ),
  }));

  const totalPaidCOP = effectiveInstallments.reduce(
    (sum, i) => sum + Math.max(0, Math.round(i.paidAmountCOP)),
    0,
  );
  const clampedPaidCOP = Math.min(plan.totalAgreedCOP, totalPaidCOP);
  const balancePendingCOP = Math.max(0, plan.totalAgreedCOP - clampedPaidCOP);

  let status: PaymentStatus;
  if (balancePendingCOP <= 0 && plan.totalAgreedCOP > 0) {
    status = 'paid';
  } else if (effectiveInstallments.some((i) => i.status === 'overdue')) {
    status = 'overdue';
  } else if (clampedPaidCOP > 0) {
    const first = effectiveInstallments[0];
    const onlyFirstPaid =
      effectiveInstallments.length > 1 &&
      first?.status === 'paid' &&
      effectiveInstallments.slice(1).every((i) => i.paidAmountCOP === 0);
    status =
      onlyFirstPaid &&
      (plan.modality === 'deposit_and_balance' ||
        plan.modality === 'three_installments' ||
        first.concept.toLowerCase().includes('anticipo'))
        ? 'deposit_received'
        : 'partial';
  } else {
    status = 'unpaid';
  }

  const projectPaymentStatus: ProjectPaymentSummaryStatus = status;

  return {
    totalPaidCOP: clampedPaidCOP,
    balancePendingCOP,
    status,
    projectPaymentStatus,
    effectiveInstallments,
  };
}

/**
 * Reparte un abono de forma exacta sobre la cuota seleccionada (si se indica)
 * y, si supera su saldo pendiente, sobre las siguientes cuotas abiertas en orden cronológico.
 */
export function allocatePaymentAcrossInstallments(
  installments: PaymentInstallment[],
  targetInstallmentId: string | null,
  amountCOP: MoneyCOP,
  todayKey = toLocalDateKey(new Date()),
): PaymentInstallment[] {
  const sorted = installments
    .slice()
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  let remainingToAllocate = Math.max(0, Math.round(amountCOP));
  if (remainingToAllocate <= 0) {
    throw new Error('El monto del pago debe ser mayor a $0 COP.');
  }

  const totalOpenAcrossInstallments = sorted.reduce(
    (sum, i) => sum + Math.max(0, i.scheduledAmountCOP - i.paidAmountCOP),
    0,
  );
  if (remainingToAllocate > totalOpenAcrossInstallments) {
    throw new Error(
      `El abono (${formatCOP(remainingToAllocate)}) supera el saldo pendiente de las cuotas (${formatCOP(totalOpenAcrossInstallments)}). Ajusta primero el valor acordado del plan si hubo cambios.`,
    );
  }

  const updatedMap = new Map<string, PaymentInstallment>(
    sorted.map((i) => [i.id, i]),
  );

  const applyToOne = (instId: string) => {
    if (remainingToAllocate <= 0) return;
    const current = updatedMap.get(instId);
    if (!current) return;
    const openCOP = Math.max(0, current.scheduledAmountCOP - current.paidAmountCOP);
    if (openCOP <= 0) return;
    const applied = Math.min(openCOP, remainingToAllocate);
    const nextPaid = current.paidAmountCOP + applied;
    remainingToAllocate -= applied;
    updatedMap.set(instId, {
      ...current,
      paidAmountCOP: nextPaid,
      status: resolveInstallmentStatus(
        current.scheduledAmountCOP,
        nextPaid,
        current.dueDate,
        todayKey,
      ),
    });
  };

  if (targetInstallmentId) {
    applyToOne(targetInstallmentId);
  }

  for (const inst of sorted) {
    if (remainingToAllocate <= 0) break;
    if (inst.id === targetInstallmentId) continue;
    applyToOne(inst.id);
  }

  return sorted.map((i) => updatedMap.get(i.id)!);
}

export interface ClientAccountSummary {
  readonly client: Client;
  readonly linkedProjects: Project[];
  readonly plans: PaymentPlan[];
  readonly transactions: FinancialTransaction[];
  readonly totalAgreedCOP: MoneyCOP;
  readonly totalPaidCOP: MoneyCOP;
  readonly pendingBalanceCOP: MoneyCOP;
  readonly hasOverdue: boolean;
  readonly overdueCount: number;
  readonly nextDueDate: string | null;
}

export function computeClientAccountSummaries(params: {
  readonly clients: Client[];
  readonly projects: Project[];
  readonly paymentPlans: PaymentPlan[];
  readonly installments: PaymentInstallment[];
  readonly transactions: FinancialTransaction[];
  readonly todayKey?: string;
}): ClientAccountSummary[] {
  const {
    clients,
    projects,
    paymentPlans,
    installments,
    transactions,
    todayKey = toLocalDateKey(new Date()),
  } = params;

  const instByPlan = new Map<string, PaymentInstallment[]>();
  for (const inst of installments) {
    const arr = instByPlan.get(inst.planId) ?? [];
    arr.push(inst);
    instByPlan.set(inst.planId, arr);
  }

  return clients
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((client) => {
      const linkedProjects = projects.filter((p) => p.clientId === client.id);
      const clientPlans = paymentPlans.filter((pl) => pl.clientId === client.id);
      const clientTransactions = transactions.filter((t) => t.clientId === client.id);

      let totalAgreedCOP = 0;
      let totalPaidCOP = 0;
      let pendingBalanceCOP = 0;
      let overdueCount = 0;
      let nextDueDate: string | null = null;

      for (const plan of clientPlans) {
        const planInsts = instByPlan.get(plan.id) ?? [];
        const recomputed = recomputePlanAndInstallments(plan, planInsts, todayKey);
        totalAgreedCOP += plan.totalAgreedCOP;
        totalPaidCOP += recomputed.totalPaidCOP;
        pendingBalanceCOP += recomputed.balancePendingCOP;

        for (const inst of recomputed.effectiveInstallments) {
          if (inst.status === 'overdue') {
            overdueCount += 1;
          }
          if (inst.status !== 'paid') {
            if (!nextDueDate || inst.dueDate < nextDueDate) {
              nextDueDate = inst.dueDate;
            }
          }
        }
      }

      return {
        client,
        linkedProjects,
        plans: clientPlans,
        transactions: clientTransactions,
        totalAgreedCOP,
        totalPaidCOP,
        pendingBalanceCOP,
        hasOverdue: overdueCount > 0,
        overdueCount,
        nextDueDate,
      };
    });
}

export function buildPaymentPlanStatementText(params: {
  readonly workshopName: string;
  readonly client: Client;
  readonly project: Project;
  readonly plan: PaymentPlan;
  readonly installments: PaymentInstallment[];
}): string {
  const { workshopName, client, project, plan, installments } = params;
  const recomputed = recomputePlanAndInstallments(plan, installments);
  const statusLabel = PAYMENT_STATUS_META[recomputed.status].label;

  const lines: string[] = [
    `*Estado de cuenta · ${workshopName}*`,
    `Cliente: ${client.name}`,
    `Encargo: ${project.name}`,
    `Estado del plan: ${statusLabel}`,
    ``,
    `Valor acordado: ${formatCOP(plan.totalAgreedCOP)}`,
    `Total abonado: ${formatCOP(recomputed.totalPaidCOP)}`,
    `Saldo pendiente: ${formatCOP(recomputed.balancePendingCOP)}`,
    ``,
    `Detalle de cuotas:`,
  ];

  for (const inst of recomputed.effectiveInstallments) {
    const instLabel = INSTALLMENT_STATUS_META[inst.status].label;
    const open = Math.max(0, inst.scheduledAmountCOP - inst.paidAmountCOP);
    lines.push(
      `• ${inst.installmentNumber}. ${inst.concept} (${formatDateCO(inst.dueDate)}): ${formatCOP(inst.scheduledAmountCOP)} — ${instLabel}${
        inst.status !== 'paid' && inst.paidAmountCOP > 0
          ? ` (restan ${formatCOP(open)})`
          : ''
      }`,
    );
  }

  return lines.join('\n');
}

export function validateInstallmentsAgainstTotal(
  totalAgreedCOP: MoneyCOP,
  installments: InstallmentDraftInput[],
): void {
  const safeTotal = Math.round(totalAgreedCOP);
  if (!Number.isFinite(safeTotal) || safeTotal <= 0) {
    throw new Error('El valor total acordado debe ser mayor a $0 COP.');
  }
  if (installments.length === 0) {
    throw new Error('El plan debe tener al menos una cuota programada.');
  }

  let sum = 0;
  for (let i = 0; i < installments.length; i += 1) {
    const row = installments[i];
    if (!row.concept.trim()) {
      throw new Error(`La cuota #${i + 1} requiere un concepto o descripción.`);
    }
    const amt = Math.round(row.scheduledAmountCOP);
    if (!Number.isFinite(amt) || amt < 0) {
      throw new Error(`El valor de la cuota #${i + 1} no puede ser negativo.`);
    }
    if (!row.dueDateKey || Number.isNaN(Date.parse(dateKeyToMiddayIso(row.dueDateKey)))) {
      throw new Error(`La fecha de vencimiento de la cuota #${i + 1} es inválida.`);
    }
    sum += amt;
  }

  if (sum !== safeTotal) {
    throw new Error(
      `La suma de las cuotas (${formatCOP(sum)}) debe coincidir exactamente con el valor acordado (${formatCOP(safeTotal)}).`,
    );
  }
}
