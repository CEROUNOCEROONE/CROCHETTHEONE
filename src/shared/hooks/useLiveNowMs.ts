import { useEffect, useState } from 'react';

/**
 * Devuelve Date.now() actualizado cada segundo cuando `isRunning` es true,
 * y sincroniza inmediatamente al volver de segundo plano, foco o BFCache
 * sin depender del conteo de ticks para medir tiempo real.
 */
export function useLiveNowMs(isRunning: boolean): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const syncNow = () => {
      setNowMs(Date.now());
    };

    syncNow();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    window.addEventListener('pageshow', syncNow);
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(syncNow, 1000);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pageshow', syncNow);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isRunning]);

  return nowMs;
}
