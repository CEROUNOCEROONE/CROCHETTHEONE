import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { BRAND_CONFIG } from '@/src/config/brand.ts';
import { usePWAInstall } from './usePWAInstall.ts';

interface PWAInstallButtonProps {
  readonly compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 whitespace-nowrap shrink-0"
      >
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{compact ? 'Instalar' : 'Instalar App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 whitespace-nowrap shrink-0"
        >
          <Share className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
          <span>{compact ? 'Instalar' : 'Instalar en iPhone / iPad'}</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <h3
                  id="ios-install-title"
                  className="font-display text-lg font-semibold text-slate-900"
                >
                  Instalar {BRAND_CONFIG.appName} en iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Cerrar guía de instalación"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                <li>
                  1. Toca el botón <strong>Compartir</strong> en la barra inferior o
                  superior de Safari.
                </li>
                <li>
                  2. Desliza hacia abajo y selecciona{' '}
                  <strong>Agregar a inicio</strong>.
                </li>
                <li>
                  3. Confirma tocando <strong>Agregar</strong> para usar{' '}
                  {BRAND_CONFIG.shortName} como aplicación independiente.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
