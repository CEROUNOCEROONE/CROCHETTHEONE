/**
 * Catálogo oficial de monedas admitidas en el taller:
 * Todas las monedas de Latinoamérica + Dólar estadounidense (USD) + Euro (EUR).
 */
export type WorkshopCurrencyCode =
  | 'MXN'
  | 'COP'
  | 'ARS'
  | 'CLP'
  | 'PEN'
  | 'BRL'
  | 'UYU'
  | 'PYG'
  | 'BOB'
  | 'VES'
  | 'CRC'
  | 'GTQ'
  | 'HNL'
  | 'NIO'
  | 'DOP'
  | 'CUP'
  | 'PAB'
  | 'HTG'
  | 'USD'
  | 'EUR';

export interface CurrencySpec {
  readonly code: WorkshopCurrencyCode;
  readonly name: string;
  readonly countries: string;
  readonly locale: string;
  readonly decimals: 0 | 2;
  readonly regionGroup: 'Latinoamérica' | 'Dólar y Euro';
  readonly sampleMaterials: number;
  readonly samplePackaging: number;
}

export const CURRENCY_CATALOG: readonly CurrencySpec[] = [
  {
    code: 'MXN',
    name: 'Peso mexicano',
    countries: 'México',
    locale: 'es-MX',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 350,
    samplePackaging: 45,
  },
  {
    code: 'COP',
    name: 'Peso colombiano',
    countries: 'Colombia',
    locale: 'es-CO',
    decimals: 0,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 40000,
    samplePackaging: 5000,
  },
  {
    code: 'ARS',
    name: 'Peso argentino',
    countries: 'Argentina',
    locale: 'es-AR',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 18000,
    samplePackaging: 2500,
  },
  {
    code: 'CLP',
    name: 'Peso chileno',
    countries: 'Chile',
    locale: 'es-CL',
    decimals: 0,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 15000,
    samplePackaging: 2000,
  },
  {
    code: 'PEN',
    name: 'Sol peruano',
    countries: 'Perú',
    locale: 'es-PE',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 60,
    samplePackaging: 8,
  },
  {
    code: 'BRL',
    name: 'Real brasileño',
    countries: 'Brasil',
    locale: 'pt-BR',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 90,
    samplePackaging: 12,
  },
  {
    code: 'UYU',
    name: 'Peso uruguayo',
    countries: 'Uruguay',
    locale: 'es-UY',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 750,
    samplePackaging: 100,
  },
  {
    code: 'PYG',
    name: 'Guaraní paraguayo',
    countries: 'Paraguay',
    locale: 'es-PY',
    decimals: 0,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 120000,
    samplePackaging: 15000,
  },
  {
    code: 'BOB',
    name: 'Boliviano',
    countries: 'Bolivia',
    locale: 'es-BO',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 120,
    samplePackaging: 15,
  },
  {
    code: 'VES',
    name: 'Bolívar venezolano',
    countries: 'Venezuela',
    locale: 'es-VE',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 850,
    samplePackaging: 120,
  },
  {
    code: 'CRC',
    name: 'Colón costarricense',
    countries: 'Costa Rica',
    locale: 'es-CR',
    decimals: 0,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 9000,
    samplePackaging: 1200,
  },
  {
    code: 'GTQ',
    name: 'Quetzal guatemalteco',
    countries: 'Guatemala',
    locale: 'es-GT',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 140,
    samplePackaging: 20,
  },
  {
    code: 'HNL',
    name: 'Lempira hondureño',
    countries: 'Honduras',
    locale: 'es-HN',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 450,
    samplePackaging: 60,
  },
  {
    code: 'NIO',
    name: 'Córdoba nicaragüense',
    countries: 'Nicaragua',
    locale: 'es-NI',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 650,
    samplePackaging: 80,
  },
  {
    code: 'DOP',
    name: 'Peso dominicano',
    countries: 'República Dominicana',
    locale: 'es-DO',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 1000,
    samplePackaging: 150,
  },
  {
    code: 'CUP',
    name: 'Peso cubano',
    countries: 'Cuba',
    locale: 'es-CU',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 450,
    samplePackaging: 60,
  },
  {
    code: 'PAB',
    name: 'Balboa panameño',
    countries: 'Panamá',
    locale: 'es-PA',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 18,
    samplePackaging: 2.5,
  },
  {
    code: 'HTG',
    name: 'Gourde haitiano',
    countries: 'Haití',
    locale: 'fr-HT',
    decimals: 2,
    regionGroup: 'Latinoamérica',
    sampleMaterials: 2200,
    samplePackaging: 300,
  },
  {
    code: 'USD',
    name: 'Dólar estadounidense',
    countries: 'EE. UU. · Ecuador · El Salvador · Panamá',
    locale: 'en-US',
    decimals: 2,
    regionGroup: 'Dólar y Euro',
    sampleMaterials: 18,
    samplePackaging: 2.5,
  },
  {
    code: 'EUR',
    name: 'Euro',
    countries: 'Unión Europea',
    locale: 'es-ES',
    decimals: 2,
    regionGroup: 'Dólar y Euro',
    sampleMaterials: 16,
    samplePackaging: 2,
  },
] as const;

const CURRENCY_MAP = new Map<WorkshopCurrencyCode, CurrencySpec>(
  CURRENCY_CATALOG.map((spec) => [spec.code, spec]),
);

export function isSupportedCurrency(value: unknown): value is WorkshopCurrencyCode {
  return typeof value === 'string' && CURRENCY_MAP.has(value as WorkshopCurrencyCode);
}

export function getCurrencySpec(code?: string | null): CurrencySpec {
  if (isSupportedCurrency(code)) {
    return CURRENCY_MAP.get(code)!;
  }
  return CURRENCY_MAP.get('COP')!;
}

export function roundCurrencyAmount(
  amount: number,
  code?: WorkshopCurrencyCode,
): number {
  if (!Number.isFinite(amount)) return 0;
  const spec = getCurrencySpec(code);
  if (spec.decimals === 0) {
    return Math.round(amount);
  }
  return Math.round(amount * 100) / 100;
}

/**
 * Redondea costos unitarios por gramo/metro/unidad conservando al menos 2 decimales
 * (incluso en monedas sin centavos como COP) para evitar errores de redondeo en promedios ponderados.
 */
export function roundUnitCostAmount(
  amount: number,
  code?: WorkshopCurrencyCode,
): number {
  if (!Number.isFinite(amount)) return 0;
  const spec = getCurrencySpec(code);
  const decimals = Math.max(2, spec.decimals);
  const factor = 10 ** decimals;
  return Math.round(amount * factor) / factor;
}

export function toMinorUnits(
  amount: number,
  code?: WorkshopCurrencyCode,
): number {
  if (!Number.isFinite(amount)) return 0;
  const spec = getCurrencySpec(code);
  const factor = spec.decimals === 2 ? 100 : 1;
  return Math.round(amount * factor);
}

export function fromMinorUnits(
  minor: number,
  code?: WorkshopCurrencyCode,
): number {
  if (!Number.isFinite(minor)) return 0;
  const spec = getCurrencySpec(code);
  if (spec.decimals === 0) {
    return Math.round(minor);
  }
  return Math.round(minor) / 100;
}

export function getMoneyInputStep(code?: WorkshopCurrencyCode): string {
  const spec = getCurrencySpec(code);
  return spec.decimals > 0 ? '0.01' : '1';
}

export function parseNonNegativeMoney(
  raw: string,
  code?: WorkshopCurrencyCode,
): number {
  const spec = getCurrencySpec(code);
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('-')) return 0;

  if (spec.decimals === 0) {
    const decimalNormalized = trimmed.replace(',', '.');
    if (
      /^\d+\.\d{1,2}$/.test(decimalNormalized) ||
      /^\.\d{1,2}$/.test(decimalNormalized)
    ) {
      const n = Number.parseFloat(decimalNormalized);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    }
    const cleaned = trimmed.replace(/[^\d]/g, '');
    if (!cleaned) return 0;
    const n = Number.parseInt(cleaned, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  // Permite punto o coma decimal conservando solo el primer separador
  const normalized = trimmed.replace(',', '.').replace(/[^\d.]/g, '');
  const parts = normalized.split('.');
  const rebuilt =
    parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : parts[0];
  const n = Number.parseFloat(rebuilt);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function parseNonNegativeUnitCost(
  raw: string,
  code?: WorkshopCurrencyCode,
): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('-')) return 0;
  const normalized = trimmed.replace(',', '.').replace(/[^\d.]/g, '');
  const parts = normalized.split('.');
  const rebuilt =
    parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : parts[0];
  const n = Number.parseFloat(rebuilt);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundUnitCostAmount(n, code);
}

export function validateNonNegativeDecimalInput(
  raw: string,
  options?: { required?: boolean; fieldLabel?: string },
): string | null {
  const label = options?.fieldLabel ?? 'El valor';
  const trimmed = raw.trim();
  if (!trimmed) {
    return options?.required ? `${label} es obligatorio.` : null;
  }
  if (trimmed.startsWith('-')) {
    return `${label} no puede ser negativo.`;
  }
  const normalized = trimmed.replace(',', '.');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return `${label} debe ser un número válido no negativo (ej. 22,50 o 22.50).`;
  }
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n < 0) {
    return `${label} debe ser un número válido no negativo.`;
  }
  return null;
}
