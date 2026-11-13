import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from './useOnlineStatus.ts';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <span>
          Modo sin conexión — Los cambios se guardan localmente en este dispositivo.
        </span>
      </div>
    </div>
  );
};
