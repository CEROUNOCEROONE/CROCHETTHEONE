import {
  CURRENCY_CATALOG,
  getCurrencySpec,
  roundCurrencyAmount,
  type WorkshopCurrencyCode,
} from './currencyCatalog.ts';

export type ExchangeRateSource = 'open.er-api.com' | 'fawazahmed0/currency-api';

export interface UsdRatesSnapshot {
  readonly base: 'USD';
  readonly dateKey: string; // YYYY-MM-DD local calendar day
  readonly fetchedAt: string; // ISO timestamp
  readonly source: ExchangeRateSource;
  readonly ratesPerUsd: Partial<Record<WorkshopCurrencyCode, number>>;
}

export type UsdRatesSyncStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'offline_cached'
  | 'unavailable';

export interface EnsureUsdRatesResult {
  readonly snapshot: UsdRatesSnapshot | null;
  readonly status: UsdRatesSyncStatus;
}

const STORAGE_KEY = 'workshop_usd_rates_cache_v1';
const PRIMARY_API_URL = 'https://open.er-api.com/v6/latest/USD';
const FALLBACK_API_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json';
const REQUEST_TIMEOUT_MS = 8000;
const RETRY_COOLDOWN_MS = 15 * 60 * 1000;

let inFlightFetch: Promise<EnsureUsdRatesResult> | null = null;
let lastFailedFetchAtMs = 0;

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidRateNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sanitizeRatesRecord(
  rawRates: Record<string, unknown>,
  lowercaseKeys: boolean,
): Partial<Record<WorkshopCurrencyCode, number>> {
  const result: Partial<Record<WorkshopCurrencyCode, number>> = { USD: 1 };
  for (const spec of CURRENCY_CATALOG) {
    if (spec.code === 'USD') {
      result.USD = 1;
      continue;
    }
    const key = lowercaseKeys ? spec.code.toLowerCase() : spec.code;
    const raw = rawRates[key];
    if (isValidRateNumber(raw)) {
      result[spec.code] = raw;
    }
  }
  return result;
}

export function readCachedUsdRates(): UsdRatesSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UsdRatesSnapshot> | null;
    if (
      !parsed ||
      parsed.base !== 'USD' ||
      typeof parsed.dateKey !== 'string' ||
      typeof parsed.fetchedAt !== 'string' ||
      !parsed.ratesPerUsd ||
      typeof parsed.ratesPerUsd !== 'object'
    ) {
      return null;
    }
    const sanitized = sanitizeRatesRecord(
      parsed.ratesPerUsd as Record<string, unknown>,
      false,
    );
    if (Object.keys(sanitized).length < 5) return null;
    return {
      base: 'USD',
      dateKey: parsed.dateKey,
      fetchedAt: parsed.fetchedAt,
      source:
        parsed.source === 'fawazahmed0/currency-api'
          ? 'fawazahmed0/currency-api'
          : 'open.er-api.com',
      ratesPerUsd: sanitized,
    };
  } catch {
    return null;
  }
}

function writeCachedUsdRates(snapshot: UsdRatesSnapshot): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota/private-mode storage errors silently
  }
}

export function isUsdRatesFreshToday(snapshot: UsdRatesSnapshot | null): boolean {
  if (!snapshot) return false;
  return snapshot.dateKey === getLocalDateKey();
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
}

async function fetchPrimaryRates(): Promise<UsdRatesSnapshot | null> {
  try {
    const payload = (await fetchJsonWithTimeout(PRIMARY_API_URL)) as {
      result?: string;
      rates?: Record<string, unknown>;
    } | null;
    if (!payload || payload.result !== 'success' || !payload.rates) {
      return null;
    }
    const ratesPerUsd = sanitizeRatesRecord(payload.rates, false);
    if (Object.keys(ratesPerUsd).length < 15) {
      return null;
    }
    return {
      base: 'USD',
      dateKey: getLocalDateKey(),
      fetchedAt: new Date().toISOString(),
      source: 'open.er-api.com',
      ratesPerUsd,
    };
  } catch {
    return null;
  }
}

async function fetchFallbackRates(): Promise<UsdRatesSnapshot | null> {
  try {
    const payload = (await fetchJsonWithTimeout(FALLBACK_API_URL)) as {
      usd?: Record<string, unknown>;
    } | null;
    if (!payload || !payload.usd || typeof payload.usd !== 'object') {
      return null;
    }
    const ratesPerUsd = sanitizeRatesRecord(payload.usd, true);
    if (Object.keys(ratesPerUsd).length < 15) {
      return null;
    }
    return {
      base: 'USD',
      dateKey: getLocalDateKey(),
      fetchedAt: new Date().toISOString(),
      source: 'fawazahmed0/currency-api',
      ratesPerUsd,
    };
  } catch {
    return null;
  }
}

/**
 * Mantiene actualizada la tasa respecto al dólar (USD) como máximo una vez por día.
 * Si ya existe caché del día actual, no realiza llamadas de red.
 * Si no hay conexión hoy pero existe una tasa guardada previa, la conserva para operar offline.
 */
export async function ensureDailyUsdRates(options?: {
  force?: boolean;
}): Promise<EnsureUsdRatesResult> {
  const force = options?.force ?? false;
  const cached = readCachedUsdRates();

  if (!force && isUsdRatesFreshToday(cached)) {
    return { snapshot: cached, status: 'ready' };
  }

  if (
    !force &&
    lastFailedFetchAtMs > 0 &&
    Date.now() - lastFailedFetchAtMs < RETRY_COOLDOWN_MS
  ) {
    return {
      snapshot: cached,
      status: cached ? 'offline_cached' : 'unavailable',
    };
  }

  if (inFlightFetch) {
    return inFlightFetch;
  }

  inFlightFetch = (async (): Promise<EnsureUsdRatesResult> => {
    try {
      const fresh = (await fetchPrimaryRates()) ?? (await fetchFallbackRates());
      if (fresh) {
        lastFailedFetchAtMs = 0;
        writeCachedUsdRates(fresh);
        return { snapshot: fresh, status: 'ready' };
      }

      lastFailedFetchAtMs = Date.now();
      return {
        snapshot: cached,
        status: cached ? 'offline_cached' : 'unavailable',
      };
    } finally {
      inFlightFetch = null;
    }
  })();

  return inFlightFetch;
}

export function getUsdRateForCurrency(
  currency: WorkshopCurrencyCode,
  snapshot: UsdRatesSnapshot | null,
): number | null {
  if (currency === 'USD') return 1;
  const rate = snapshot?.ratesPerUsd?.[currency];
  return isValidRateNumber(rate) ? rate : null;
}

export function convertToUsdAmount(
  amount: number,
  fromCurrency: WorkshopCurrencyCode,
  snapshot: UsdRatesSnapshot | null,
): number | null {
  if (!Number.isFinite(amount) || fromCurrency === 'USD') return null;
  const ratePerUsd = getUsdRateForCurrency(fromCurrency, snapshot);
  if (!ratePerUsd) return null;
  if (amount === 0) return 0;
  return roundCurrencyAmount(amount / ratePerUsd, 'USD');
}

export function formatUsdRatePerUnit(
  currency: WorkshopCurrencyCode,
  snapshot: UsdRatesSnapshot | null,
): string | null {
  if (currency === 'USD') return null;
  const rate = getUsdRateForCurrency(currency, snapshot);
  if (!rate) return null;
  const spec = getCurrencySpec(currency);
  const decimals = rate >= 1000 ? 0 : rate >= 10 ? 2 : 4;
  const formatted = new Intl.NumberFormat(spec.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rate);
  return `1 USD = ${formatted} ${spec.code}`;
}
