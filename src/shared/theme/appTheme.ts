/**
 * Tema visual de la aplicación. Es una preferencia del dispositivo: se guarda
 * en localStorage y se aplica como atributo data-theme en <html>.
 * Los colores de cada tema viven en src/styles/themes.css.
 */

export type AppThemeId = 'clasico' | 'pastel-claro' | 'pastel-oscuro';

export type AppThemeCategoryId = 'principal' | 'pastel-floral';

export type AppThemeTone = 'light' | 'dark';

export interface AppThemeCategory {
  readonly id: AppThemeCategoryId;
  readonly label: string;
  readonly description: string;
  /** Marca la categoría principal o predeterminada de la aplicación. */
  readonly isPrimary?: boolean;
}

export interface AppThemeDefinition {
  readonly id: AppThemeId;
  readonly categoryId: AppThemeCategoryId;
  readonly label: string;
  /** Etiqueta corta dentro de su categoría (ej. "Clásico", "Claro", "Oscuro"). */
  readonly variantLabel: string;
  readonly tone: AppThemeTone;
  readonly description: string;
  /** Color de la barra del navegador en el celular. */
  readonly themeColor: string;
  /** Tres colores principales para el círculo cromático de selección. */
  readonly swatches: readonly [string, string, string];
}

export const APP_THEME_CATEGORIES: readonly AppThemeCategory[] = [
  {
    id: 'principal',
    label: 'Principal',
    description: 'Estilo base original de App Crochet.',
    isPrimary: true,
  },
  {
    id: 'pastel-floral',
    label: 'Pastel floral',
    description: 'Crema, malva empolvado y verde salvia.',
  },
] as const;

export const APP_THEMES: readonly AppThemeDefinition[] = [
  {
    id: 'clasico',
    categoryId: 'principal',
    label: 'Clásico',
    variantLabel: 'Clásico',
    tone: 'light',
    description: 'Verde azulado original de la app.',
    themeColor: '#0F766E',
    swatches: ['#F8FAFC', '#0F766E', '#B91C1C'],
  },
  {
    id: 'pastel-claro',
    categoryId: 'pastel-floral',
    label: 'Pastel floral claro',
    variantLabel: 'Claro',
    tone: 'light',
    description: 'Crema, malva empolvado y verde salvia, inspirado en un papel de flores.',
    themeColor: '#7E3D59',
    swatches: ['#FBF6F3', '#7E3D59', '#B01D33'],
  },
  {
    id: 'pastel-oscuro',
    categoryId: 'pastel-floral',
    label: 'Pastel floral oscuro',
    variantLabel: 'Oscuro',
    tone: 'dark',
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

export function getThemeDefinition(id: AppThemeId): AppThemeDefinition {
  return APP_THEMES.find((theme) => theme.id === id) ?? APP_THEMES[0];
}

export function getThemesByCategory(
  categoryId: AppThemeCategoryId,
): readonly AppThemeDefinition[] {
  return APP_THEMES.filter((theme) => theme.categoryId === categoryId);
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
