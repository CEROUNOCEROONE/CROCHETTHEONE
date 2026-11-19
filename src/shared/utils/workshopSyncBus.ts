export const WORKSHOP_SYNC_CHANNEL_NAME = 'crochet_workshop_sync_v1';
const FALLBACK_STORAGE_KEY = 'crochet_workshop_sync_pulse_v1';

export type WorkshopSyncScope = 'timer' | 'notifications' | 'all';

export interface WorkshopSyncMessage {
  readonly type: 'WORKSHOP_DB_UPDATED' | 'NOTIFICATIONS_CENTER_UPDATED';
  readonly scope: WorkshopSyncScope;
  readonly senderId: string;
  readonly at: number;
}

const INSTANCE_SENDER_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let sharedChannel: BroadcastChannel | null = null;

function getSharedChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(WORKSHOP_SYNC_CHANNEL_NAME);
    } catch {
      sharedChannel = null;
    }
  }
  return sharedChannel;
}

export function broadcastWorkshopSync(
  type: WorkshopSyncMessage['type'],
  scope: WorkshopSyncScope = 'all',
): void {
  if (typeof window === 'undefined') return;
  const payload: WorkshopSyncMessage = {
    type,
    scope,
    senderId: INSTANCE_SENDER_ID,
    at: Date.now(),
  };

  const channel = getSharedChannel();
  if (channel) {
    try {
      channel.postMessage(payload);
    } catch {
      // Ignorar si el canal se cerró
    }
  }

  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignorar fallo de cuota en localStorage
  }
}

export function subscribeWorkshopSync(
  onMessage: (message: WorkshopSyncMessage) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handlePayload = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Partial<WorkshopSyncMessage>;
    if (
      msg.type !== 'WORKSHOP_DB_UPDATED' &&
      msg.type !== 'NOTIFICATIONS_CENTER_UPDATED'
    ) {
      return;
    }
    if (msg.senderId === INSTANCE_SENDER_ID) return;
    onMessage({
      type: msg.type,
      scope: msg.scope ?? 'all',
      senderId: typeof msg.senderId === 'string' ? msg.senderId : 'external',
      at: typeof msg.at === 'number' ? msg.at : Date.now(),
    });
  };

  const channel = getSharedChannel();
  const handleBcMessage = (event: MessageEvent) => {
    handlePayload(event.data);
  };
  if (channel) {
    channel.addEventListener('message', handleBcMessage);
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== FALLBACK_STORAGE_KEY || !event.newValue) return;
    try {
      handlePayload(JSON.parse(event.newValue));
    } catch {
      // Ignorar JSON corrupto
    }
  };
  window.addEventListener('storage', handleStorage);

  let swHandler: ((event: MessageEvent) => void) | null = null;
  if ('serviceWorker' in navigator) {
    swHandler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SW_DB_UPDATED') {
        handlePayload({
          type: 'WORKSHOP_DB_UPDATED',
          scope: event.data.scope ?? 'timer',
          senderId: 'service-worker',
          at: Date.now(),
        });
      }
    };
    navigator.serviceWorker.addEventListener('message', swHandler);
  }

  return () => {
    if (channel) {
      channel.removeEventListener('message', handleBcMessage);
    }
    window.removeEventListener('storage', handleStorage);
    if (swHandler && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', swHandler);
    }
  };
}
