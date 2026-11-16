import type { WorkshopCurrencyCode } from '@/src/domain/services/currencyCatalog.ts';

/**
 * Configuración centralizada de identidad, localización y reglas comerciales.
 * Modificar este archivo permite renombrar o re-estilizar la marca sin tocar
 * la lógica de negocio ni los módulos de la aplicación.
 */
export interface BrandConfig {
  readonly appName: string;
  readonly shortName: string;
  readonly tagline: string;
  readonly defaultWorkshopName: string;
  readonly locale: string;
  readonly currency: WorkshopCurrencyCode;
  readonly dateFormatLabel: 'DD/MM/YYYY';
  readonly themeColor: string;
  readonly backgroundColor: string;
  readonly defaults: {
    readonly hourlyRateCOP: number;
    readonly dailyGoalMinutes: number;
    readonly weeklyGoalMinutes: number;
    readonly defaultMarkupPercent: number;
    readonly rentCostPercent: number;
    readonly electricityCostPercent: number;
    readonly internetCostPercent: number;
    readonly wasteAndContingencyPercent: number;
  };
}

export const BRAND_CONFIG: BrandConfig = {
  appName: 'App Crochet',
  shortName: 'Crochet',
  tagline: 'Gestión integral de taller artesanal',
  defaultWorkshopName: 'Mi Taller de Crochet',
  locale: 'es-CO',
  currency: 'COP',
  dateFormatLabel: 'DD/MM/YYYY',
  themeColor: '#0F766E',
  backgroundColor: '#F8FAFC',
  defaults: {
    hourlyRateCOP: 12000,
    dailyGoalMinutes: 120,
    weeklyGoalMinutes: 600,
    defaultMarkupPercent: 40,
    rentCostPercent: 5,
    electricityCostPercent: 2,
    internetCostPercent: 2,
    wasteAndContingencyPercent: 5,
  },
} as const;
