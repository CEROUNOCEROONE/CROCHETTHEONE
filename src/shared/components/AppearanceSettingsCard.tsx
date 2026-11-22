import React, { useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import {
  APP_THEME_CATEGORIES,
  applyAppTheme,
  getStoredThemeId,
  getThemeDefinition,
  getThemesByCategory,
  type AppThemeCategoryId,
  type AppThemeId,
} from '@/src/shared/theme/appTheme.ts';

type CategoryFilter = 'all' | AppThemeCategoryId;

interface ThemeColorWheelProps {
  readonly swatches: readonly [string, string, string];
  readonly sizeClass?: string;
}

/** Círculo dividido en tres porciones iguales (120° cada una) con los colores del tema. */
const ThemeColorWheel: React.FC<ThemeColorWheelProps> = ({
  swatches,
  sizeClass = 'h-7 w-7',
}) => {
  const [c1, c2, c3] = swatches;
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={`${sizeClass} shrink-0 text-slate-900`}
    >
      <path d="M16 16 L16 1 A15 15 0 0 1 28.99 23.5 Z" fill={c1} />
      <path d="M16 16 L28.99 23.5 A15 15 0 0 1 3.01 23.5 Z" fill={c2} />
      <path d="M16 16 L3.01 23.5 A15 15 0 0 1 16 1 Z" fill={c3} />
      <circle
        cx="16"
        cy="16"
        r="15"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1.25"
      />
    </svg>
  );
};

export const AppearanceSettingsCard: React.FC = () => {
  const [themeId, setThemeId] = useState<AppThemeId>(() => getStoredThemeId());
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

  const currentTheme = getThemeDefinition(themeId);
  const visibleCategories =
    activeCategory === 'all'
      ? APP_THEME_CATEGORIES
      : APP_THEME_CATEGORIES.filter((cat) => cat.id === activeCategory);

  const handleSelect = (id: AppThemeId) => {
    setThemeId(id);
    applyAppTheme(id);
  };

  return (
    <section
      aria-labelledby="appearance-settings-title"
      className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs sm:p-4"
    >
      {/* Cabecera compacta + selector de categorías escalable */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <Palette className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h3
                id="appearance-settings-title"
                className="font-display text-sm font-semibold text-slate-900 sm:text-base"
              >
                Apariencia
              </h3>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <span aria-hidden="true">·</span>
                <ThemeColorWheel
                  swatches={currentTheme.swatches}
                  sizeClass="h-3.5 w-3.5"
                />
                <span className="truncate font-medium text-slate-700">
                  {currentTheme.label}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Categorías de temas"
          className="no-scrollbar inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
            className={`min-h-[32px] shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeCategory === 'all'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            Todas
          </button>
          {APP_THEME_CATEGORIES.map((category) => {
            const isTabActive = activeCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={isTabActive}
                onClick={() => setActiveCategory(category.id)}
                className={`min-h-[32px] shrink-0 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  isTabActive
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Segmentos agrupados por categoría */}
      <div
        role="radiogroup"
        aria-labelledby="appearance-settings-title"
        className={`mt-3 grid gap-2.5 ${
          visibleCategories.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:max-w-md'
        }`}
      >
        {visibleCategories.map((category) => {
          const themes = getThemesByCategory(category.id);
          const hasVariants = themes.length > 1;
          const isCategorySelected = themes.some((t) => t.id === themeId);

          return (
            <div
              key={category.id}
              className={`rounded-xl border p-2.5 transition-colors ${
                isCategorySelected
                  ? 'border-teal-200 bg-slate-50'
                  : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  {category.label}
                </span>
                <span className="text-[11px] text-slate-500">
                  {category.isPrimary
                    ? hasVariants
                      ? 'Principal · Claro / Oscuro'
                      : 'Predeterminado'
                    : hasVariants
                      ? 'Claro / Oscuro'
                      : null}
                </span>
              </div>

              <div
                className={
                  hasVariants ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-1'
                }
              >
                {themes.map((theme) => {
                  const isSelected = theme.id === themeId;
                  const ToneIcon = hasVariants
                    ? theme.tone === 'dark'
                      ? Moon
                      : Sun
                    : null;

                  return (
                    <button
                      key={theme.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={`${theme.label}: ${theme.description}`}
                      title={theme.description}
                      onClick={() => handleSelect(theme.id)}
                      className={`flex min-h-[44px] items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        isSelected
                          ? 'border-teal-700 bg-teal-50 ring-1 ring-teal-700'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ThemeColorWheel swatches={theme.swatches} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 text-xs font-semibold text-slate-900 sm:text-sm">
                            {ToneIcon && (
                              <ToneIcon
                                className="h-3.5 w-3.5 shrink-0 text-slate-500"
                                aria-hidden="true"
                              />
                            )}
                            <span className="truncate">{theme.variantLabel}</span>
                          </span>
                        </span>
                      </span>
                      {isSelected && (
                        <Check
                          className="h-4 w-4 shrink-0 text-teal-700"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
