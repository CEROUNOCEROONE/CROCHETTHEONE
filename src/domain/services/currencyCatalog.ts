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
  if (spec.decimals === 0 && spec.code !== 'COP') {
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
  const factor = spec.decimals === 2 || spec.code === 'COP' ? 100 : 1;
  return Math.round(amount * factor);
}

export function fromMinorUnits(
  minor: number,
  code?: WorkshopCurrencyCode,
): number {
  if (!Number.isFinite(minor)) return 0;
  const spec = getCurrencySpec(code);
  if (spec.decimals === 0 && spec.code !== 'COP') {
    return Math.round(minor);
  }
  return Math.round(minor) / 100;
}

export function getMoneyInputStep(code?: WorkshopCurrencyCode): string {
  const spec = getCurrencySpec(code);
  return spec.decimals > 0 || spec.code === 'COP' ? '0.01' : '1';
}

/**
 * Interpreta formatos decimales sin adivinar cuando hay un único separador
 * seguido de tres dígitos (p. ej. "1.250"). Los grupos de miles deben ser
 * inequívocos o ajustarse a la precisión de la moneda.
 */
export function parseLocalizedNonNegativeDecimal(
  raw: string,
  decimals: number,
): number | null {
  const value = raw.trim();
  const maxFractionDigits = Math.max(2, decimals);
  if (!value || !/^[0-9.,]+$/.test(value)) return null;
  const dots = (value.match(/\./g) ?? []).length;
  const commas = (value.match(/,/g) ?? []).length;
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');
  let integer = value;
  let fraction = '';

  if (dots && commas) {
    const decimalMark = lastDot > lastComma ? '.' : ',';
    const groupingMark = decimalMark === '.' ? ',' : '.';
    const splitAt = value.lastIndexOf(decimalMark);
    integer = value.slice(0, splitAt);
    fraction = value.slice(splitAt + 1);
    if (!fraction || fraction.length > maxFractionDigits) return null;
    const groups = integer.split(groupingMark);
    if (groups.length < 2 || !/^[0-9]{1,3}$/.test(groups[0]) ||
        groups.slice(1).some((group) => !/^[0-9]{3}$/.test(group))) return null;
    integer = groups.join('');
  } else if (dots || commas) {
    const mark = dots ? '.' : ',';
    const groups = value.split(mark);
    if (groups.length > 2) {
      if (!/^[0-9]{1,3}$/.test(groups[0]) ||
          groups.slice(1).some((group) => !/^[0-9]{3}$/.test(group))) return null;
      integer = groups.join('');
    } else {
      const [whole, tail] = groups;
      if (!whole || !tail) return null;
      if (tail.length === 3 && whole.length <= 3) {
        // Para monedas sin decimales, 15.000 es un millar válido.
        // Para monedas decimales, 1.250 es ambiguo: rechazar.
        if (decimals !== 0) return null;
        integer = whole + tail;
      } else if (tail.length <= maxFractionDigits) {
        integer = whole;
        fraction = tail;
      } else {
        return null;
      }
    }
  }

  if (!/^[0-9]+$/.test(integer)) return null;
  const parsed = Number(integer + (fraction ? '.' + fraction : ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseNonNegativeMoney(
  raw: string,
  code?: WorkshopCurrencyCode,
): number {
  const parsed = parseLocalizedNonNegativeDecimal(raw, getCurrencySpec(code).decimals);
  return parsed === null ? 0 : roundCurrencyAmount(parsed, code);
}

export function parseNonNegativeUnitCost(
  raw: string,
  code?: WorkshopCurrencyCode,
): number {
  const parsed = parseLocalizedNonNegativeDecimal(raw, Math.max(2, getCurrencySpec(code).decimals));
  return parsed === null ? 0 : roundUnitCostAmount(parsed, code);
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
