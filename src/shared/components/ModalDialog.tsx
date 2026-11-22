import React, { useEffect, useRef } from 'react';

type ModalDialogAccessibleName =
  | { readonly ariaLabelledBy: string; readonly ariaLabel?: undefined }
  | { readonly ariaLabel: string; readonly ariaLabelledBy?: undefined };

export type ModalDialogProps = ModalDialogAccessibleName & {
  readonly isOpen: boolean;
  readonly isBusy?: boolean;
  readonly mobileAlign?: 'bottom' | 'center';
  readonly panelClassName?: string;
  readonly children: React.ReactNode;
  onClose(): void;
};

/**
 * Contenedor modal liviano basado en <dialog> nativo (top layer).
 * Controlado por React vía showModal()/close(), sin light-dismiss accidental
 * en el backdrop ni lógica de negocio acoplada.
 */
export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  isBusy = false,
  mobileAlign = 'bottom',
  panelClassName = 'max-w-lg p-5 sm:p-6',
  ariaLabel,
  ariaLabelledBy,
  children,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const isOpenRef = useRef(isOpen);
  const isBusyRef = useRef(isBusy);
  const onCloseRef = useRef(onClose);

  isOpenRef.current = isOpen;
  isBusyRef.current = isBusy;
  onCloseRef.current = onClose;

  const restoreFocusIfLost = () => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener || !opener.isConnected) return;

    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) {
      try {
        opener.focus({ preventScroll: true });
      } catch {
        // Ignorar si el elemento ya no es enfocable
      }
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        openerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        try {
          if (typeof dialog.showModal === 'function') {
            dialog.showModal();
          } else {
            dialog.setAttribute('open', '');
          }
        } catch {
          try {
            dialog.show?.();
          } catch {
            // Ignorar si ya está abierto
          }
        }
      }
    } else if (dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
      restoreFocusIfLost();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute('open');
        }
      }
      restoreFocusIfLost();
    };
  }, []);

  const handleNativeCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    if (!isBusyRef.current) {
      onCloseRef.current();
    }
  };

  const handleNativeClose = () => {
    const dialog = dialogRef.current;
    if (isOpenRef.current) {
      if (isBusyRef.current && dialog && !dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // Si el navegador no permite reabrir, sincronizar el estado
          onCloseRef.current();
        }
        return;
      }
      onCloseRef.current();
    }
    restoreFocusIfLost();
  };

  const alignClasses =
    mobileAlign === 'bottom'
      ? 'mx-auto mt-auto mb-3 sm:my-auto'
      : 'm-auto';

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onCancel={handleNativeCancel}
      onClose={handleNativeClose}
      className={`app-modal-dialog fixed inset-0 ${alignClasses} max-h-[90dvh] w-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/50 sm:w-[calc(100%-2rem)] ${panelClassName}`}
    >
      {isOpen && children}
    </dialog>
  );
};
