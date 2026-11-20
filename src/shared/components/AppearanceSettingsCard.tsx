import React, { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import {
  APP_THEMES,
  applyAppTheme,
  getStoredThemeId,
  type AppThemeId,
} from '@/src/shared/theme/appTheme.ts';

export const AppearanceSettingsCard: React.FC = () => {
  const [themeId, setThemeId] = useState<AppThemeId>(() => getStoredThemeId());

  const handleSelect = (id: AppThemeId) => {
    setThemeId(id);
    applyAppTheme(id);
  };

  return (
    <section
      aria-labelledby="appearance-settings-title"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
          <Palette className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3
            id="appearance-settings-title"
            className="font-display text-base font-semibold text-slate-900"
          >
            Apariencia
          </h3>
          <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
            Elige cómo se ve la app en este dispositivo. El texto, los avisos y los
            botones se adaptan a cada tema.
          </p>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-labelledby="appearance-settings-title"
        className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3"
      >
        {APP_THEMES.map((theme) => {
          const isSelected = theme.id === themeId;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => handleSelect(theme.id)}
              className={`flex min-h-[44px] flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                isSelected
                  ? 'border-teal-700 bg-teal-50 ring-1 ring-teal-700'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{theme.label}</span>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                )}
              </span>
              <span className="flex h-7 overflow-hidden rounded-md border border-black/10" aria-hidden="true">
                {theme.swatches.map((color) => (
                  <span
                    key={color}
                    className="flex-1"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="text-xs text-slate-600">{theme.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
