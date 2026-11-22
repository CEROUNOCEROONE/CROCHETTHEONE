import React, { useId, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { BRAND_CONFIG } from '@/src/config/brand.ts';
import { ModalDialog } from '@/src/shared/components/ModalDialog.tsx';
import { usePWAInstall } from './usePWAInstall.ts';

interface PWAInstallButtonProps {
  readonly compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
}) => {
  const { isInstallable, isInstalled, isIOS, isPrompting, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const titleId = useId();

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        aria-disabled={isPrompting || undefined}
        onClick={() => {
          if (!isPrompting) {
            void install();
          }
        }}
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

        <ModalDialog
          isOpen={showIOSGuide}
          onClose={() => setShowIOSGuide(false)}
          ariaLabelledBy={titleId}
          mobileAlign="bottom"
          panelClassName="max-w-sm p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <h3
              id={titleId}
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
              <X className="h-5 w-5" aria-hidden="true" />
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
        </ModalDialog>
      </>
    );
  }

  return null;
};
