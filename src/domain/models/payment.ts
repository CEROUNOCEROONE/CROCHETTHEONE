import type { BaseEntity, ISODate, MoneyCOP } from './common.ts';

export type PaymentPlanModality =
  | 'full'
  | 'deposit_and_balance'
  | 'two_installments'
  | 'three_installments'
  | 'custom';

export type PaymentStatus =
  | 'unpaid'
  | 'deposit_received'
  | 'partial'
  | 'paid'
  | 'overdue';

export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export type PaymentMethod =
  | 'cash'
  | 'nequi'
  | 'daviplata'
  | 'bank_transfer'
  | 'other';

export interface PaymentPlan extends BaseEntity {
  readonly projectId: string;
  readonly clientId: string;
  readonly totalAgreedCOP: MoneyCOP;
  readonly agreementDate: ISODate;
  readonly modality: PaymentPlanModality;
  readonly totalPaidCOP: MoneyCOP;
  readonly balancePendingCOP: MoneyCOP;
  readonly status: PaymentStatus;
  readonly notes: string;
}

export interface PaymentInstallment extends BaseEntity {
  readonly planId: string;
  readonly installmentNumber: number;
  readonly concept: string;
  readonly scheduledAmountCOP: MoneyCOP;
  readonly paidAmountCOP: MoneyCOP;
  readonly dueDate: ISODate;
  readonly status: InstallmentStatus;
}

/**
 * Transacción financiera real recibida. Registro inmutable para trazabilidad.
 */
export interface FinancialTransaction extends BaseEntity {
  readonly planId: string;
  readonly projectId: string;
  readonly clientId: string;
  readonly installmentId: string | null;
  readonly amountCOP: MoneyCOP;
  readonly paymentDate: ISODate;
  readonly paymentMethod: PaymentMethod;
  readonly referenceNumber: string | null;
  readonly notes: string;
}
