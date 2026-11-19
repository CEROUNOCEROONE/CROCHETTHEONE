import { useEffect, useRef } from 'react';

/**
 * Ejecuta `onEscape` al presionar Escape mientras `isActive` sea verdadero.
 * Respeta `event.defaultPrevented` para evitar cerrar un modal padre cuando un
 * desplegable interno (por ejemplo autocompletado) ya consumió la tecla.
 */
export function useEscapeKey(isActive: boolean, onEscape: () => void): void {
  const callbackRef = useRef(onEscape);
  callbackRef.current = onEscape;

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      callbackRef.current();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);
}
