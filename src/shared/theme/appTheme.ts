/**
 * Tema visual de la aplicación. Es una preferencia del dispositivo: se guarda
 * en localStorage y se aplica como atributo data-theme en <html>.
 * Los colores de cada tema viven en src/styles/themes.css.
 */

export type AppThemeId =
  | 'clasico'
  | 'clasico-oscuro'
  | 'pastel-claro'
  | 'pastel-oscuro'
  | 'halloween-claro'
  | 'halloween-oscuro'
  | 'navidad-claro'
  | 'navidad-oscuro';

export type AppThemeCategoryId = 'principal' | 'pastel-floral' | 'halloween' | 'navidad';

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
  /** Etiqueta corta dentro de su categoría (ej. "Claro", "Oscuro"). */
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
    label: 'Clásico',
    description: 'Verde azulado original de la app, en versión clara y oscura.',
    isPrimary: true,
  },
  {
    id: 'pastel-floral',
    label: 'Pastel floral',
    description: 'Crema, malva empolvado y verde salvia.',
  },
  {
    id: 'halloween',
    label: 'Halloween',
    description: 'Naranja calabaza, azul medianoche, fantasmas gatitos y calabazas.',
  },
  {
    id: 'navidad',
    label: 'Navidad',
    description: 'Crema con trazos navideños y versión oscura cálida con figuras festivas.',
  },
] as const;

export const APP_THEMES: readonly AppThemeDefinition[] = [
  {
    id: 'clasico',
    categoryId: 'principal',
    label: 'Clásico claro',
    variantLabel: 'Claro',
    tone: 'light',
    description: 'Verde azulado original de la app sobre fondo claro.',
    themeColor: '#0F766E',
    swatches: ['#F8FAFC', '#0F766E', '#B91C1C'],
  },
  {
    id: 'clasico-oscuro',
    categoryId: 'principal',
    label: 'Clásico oscuro',
    variantLabel: 'Oscuro',
    tone: 'dark',
    description: 'Verde azulado clásico sobre fondo oscuro pizarra, para usar de noche.',
    themeColor: '#0F172A',
    swatches: ['#0F172A', '#2DD4BF', '#DC2626'],
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
  {
    id: 'halloween-claro',
    categoryId: 'halloween',
    label: 'Halloween claro',
    variantLabel: 'Claro',
    tone: 'light',
    description: 'Naranja cálido, violeta eléctrico y fantasmas gatitos por toda la pantalla.',
    themeColor: '#F58B16',
    swatches: ['#FFA63E', '#5316F5', '#DC2626'],
  },
  {
    id: 'halloween-oscuro',
    categoryId: 'halloween',
    label: 'Halloween oscuro',
    variantLabel: 'Oscuro',
    tone: 'dark',
    description: 'Azul medianoche, naranja calabaza, destellos verdes y fantasmas con calabazas.',
    themeColor: '#080E24',
    swatches: ['#080E24', '#FF6B24', '#22E57A'],
  },
  {
    id: 'navidad-claro',
    categoryId: 'navidad',
    label: 'Navidad claro',
    variantLabel: 'Claro',
    tone: 'light',
    description: 'Crema festiva con trazos rojos navideños y guirnalda de bombillas.',
    themeColor: '#1F5E43',
    swatches: ['#FAF3E8', '#1F5E43', '#B51C22'],
  },
  {
    id: 'navidad-oscuro',
    categoryId: 'navidad',
    label: 'Navidad oscuro',
    variantLabel: 'Oscuro',
    tone: 'dark',
    description: 'Fondo cacao nocturno con tapiz de figuras navideñas, verde hoja y acentos rosa cálido.',
    themeColor: '#171112',
    swatches: ['#171112', '#4E9A59', '#F2A7B3'],
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
