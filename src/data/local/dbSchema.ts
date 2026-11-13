import type { WorkshopStoreName } from '@/src/domain/models/index.ts';

export const DB_NAME = 'app_crochet_db';
export const DB_VERSION = 1;

export interface StoreIndexDefinition {
  readonly name: string;
  readonly keyPath: string;
  readonly unique?: boolean;
}

export interface StoreSchemaDefinition {
  readonly name: WorkshopStoreName;
  readonly keyPath: string;
  readonly indexes: StoreIndexDefinition[];
}

export const STORE_DEFINITIONS: StoreSchemaDefinition[] = [
  {
    name: '_meta_schema',
    keyPath: 'id',
    indexes: [],
  },
  {
    name: 'workshop_settings',
    keyPath: 'id',
    indexes: [],
  },
  {
    name: 'projects',
    keyPath: 'id',
    indexes: [
      { name: 'status', keyPath: 'status' },
      { name: 'clientId', keyPath: 'clientId' },
      { name: 'isDemo', keyPath: 'isDemo' },
      { name: 'updatedAt', keyPath: 'updatedAt' },
    ],
  },
  {
    name: 'project_components',
    keyPath: 'id',
    indexes: [
      { name: 'projectId', keyPath: 'projectId' },
      { name: 'status', keyPath: 'status' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'work_sessions',
    keyPath: 'id',
    indexes: [
      { name: 'projectId', keyPath: 'projectId' },
      { name: 'componentId', keyPath: 'componentId' },
      { name: 'status', keyPath: 'status' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'materials',
    keyPath: 'id',
    indexes: [
      { name: 'category', keyPath: 'category' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'material_variants',
    keyPath: 'id',
    indexes: [
      { name: 'materialId', keyPath: 'materialId' },
      { name: 'colorName', keyPath: 'colorName' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'inventory_reservations',
    keyPath: 'id',
    indexes: [
      { name: 'projectId', keyPath: 'projectId' },
      { name: 'variantId', keyPath: 'variantId' },
      { name: 'status', keyPath: 'status' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'inventory_movements',
    keyPath: 'id',
    indexes: [
      { name: 'variantId', keyPath: 'variantId' },
      { name: 'projectId', keyPath: 'projectId' },
      { name: 'timestamp', keyPath: 'timestamp' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'clients',
    keyPath: 'id',
    indexes: [
      { name: 'name', keyPath: 'name' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'payment_plans',
    keyPath: 'id',
    indexes: [
      { name: 'projectId', keyPath: 'projectId' },
      { name: 'clientId', keyPath: 'clientId' },
      { name: 'status', keyPath: 'status' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'payment_installments',
    keyPath: 'id',
    indexes: [
      { name: 'planId', keyPath: 'planId' },
      { name: 'dueDate', keyPath: 'dueDate' },
      { name: 'status', keyPath: 'status' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
  {
    name: 'financial_transactions',
    keyPath: 'id',
    indexes: [
      { name: 'planId', keyPath: 'planId' },
      { name: 'projectId', keyPath: 'projectId' },
      { name: 'paymentDate', keyPath: 'paymentDate' },
      { name: 'isDemo', keyPath: 'isDemo' },
    ],
  },
];
