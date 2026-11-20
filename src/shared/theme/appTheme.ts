/**
 * Tema visual de la aplicación. Es una preferencia del dispositivo: se guarda
 * en localStorage y se aplica como atributo data-theme en <html>.
 * Los colores de cada tema viven en src/styles/themes.css.
 */

export type AppThemeId = 'clasico' | 'pastel-claro' | 'pastel-oscuro';

export interface AppThemeDefinition {
  readonly id: AppThemeId;
  readonly label: string;
  readonly description: string;
  /** Color de la barra del navegador en el celular. */
  readonly themeColor: string;
  /** Muestra de fondo, marca y acento para la tarjeta de selección. */
  readonly swatches: readonly [string, string, string];
}

export const APP_THEMES: readonly AppThemeDefinition[] = [
  {
    id: 'clasico',
    label: 'Clásico',
    description: 'Verde azulado original de la app.',
    themeColor: '#0F766E',
    swatches: ['#F8FAFC', '#0F766E', '#B91C1C'],
  },
  {
    id: 'pastel-claro',
    label: 'Pastel floral claro',
    description: 'Crema, malva empolvado y verde salvia, inspirado en un papel de flores.',
    themeColor: '#7E3D59',
    swatches: ['#FBF6F3', '#7E3D59', '#B01D33'],
  },
  {
    id: 'pastel-oscuro',
    label: 'Pastel floral oscuro',
    description: 'La misma familia pastel sobre fondo oscuro, para usar de noche.',
    themeColor: '#1E1A1C',
    swatches: ['#1E1A1C', '#EBB0C8', '#B01D33'],
  },
] as const;

export const APP_THEME_STORAGE_KEY = 'crochet-app-theme';

const DEFAULT_THEME_ID: AppThemeId = 'clasico';

export function isAppThemeId(value: unknown): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value);
}

export function getStoredThemeId(): AppThemeId {
  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isAppThemeId(stored) ? stored : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function applyAppTheme(id: AppThemeId): void {
  const root = document.documentElement;
  if (id === DEFAULT_THEME_ID) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', id);
  }

  const themeColor = APP_THEMES.find((theme) => theme.id === id)?.themeColor;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && themeColor) {
    meta.content = themeColor;
  }

  try {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, id);
  } catch {
    // Sin almacenamiento disponible el tema solo dura esta sesión.
  }
}
