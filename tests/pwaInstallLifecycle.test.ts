import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPWAInstallController,
  type BeforeInstallPromptEvent,
  type PWAInstallEnvironment,
} from '../src/pwa/usePWAInstall.ts';

interface MockEnvHarness {
  env: PWAInstallEnvironment;
  dispatch: (type: string, event?: Event) => void;
  setStandaloneMedia: (matches: boolean) => void;
  getListenerCount: (type: string) => number;
  getMediaListenerCount: () => number;
}

function createMockEnv(options?: {
  standaloneMedia?: boolean;
  navigatorStandalone?: boolean;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}): MockEnvHarness {
  const windowListeners = new Map<string, Set<EventListener>>();
  const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
  let standaloneMatches = Boolean(options?.standaloneMedia);

  const env: PWAInstallEnvironment = {
    win: {
      addEventListener(type, listener) {
        let bucket = windowListeners.get(type);
        if (!bucket) {
          bucket = new Set();
          windowListeners.set(type, bucket);
        }
        bucket.add(listener);
      },
      removeEventListener(type, listener) {
        windowListeners.get(type)?.delete(listener);
      },
      matchMedia() {
        return {
          get matches() {
            return standaloneMatches;
          },
          addEventListener(_type, listener) {
            mediaListeners.add(listener);
          },
          removeEventListener(_type, listener) {
            mediaListeners.delete(listener);
          },
        };
      },
    },
    nav: {
      userAgent: options?.userAgent ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0',
      platform: options?.platform ?? 'Linux armv8l',
      maxTouchPoints: options?.maxTouchPoints ?? 5,
      standalone: options?.navigatorStandalone,
    },
  };

  return {
    env,
    dispatch(type, event = new Event(type)) {
      const bucket = windowListeners.get(type);
      if (!bucket) return;
      bucket.forEach((listener) => listener(event));
    },
    setStandaloneMedia(matches) {
      standaloneMatches = matches;
      const mediaEvent = { matches } as MediaQueryListEvent;
      mediaListeners.forEach((listener) => listener(mediaEvent));
    },
    getListenerCount(type) {
      return windowListeners.get(type)?.size ?? 0;
    },
    getMediaListenerCount() {
      return mediaListeners.size;
    },
  };
}

function createDeferredPromptEvent(options: {
  outcome?: 'accepted' | 'dismissed';
  promptRejects?: Error;
  manualChoice?: {
    promise: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
}) {
  let promptCalls = 0;
  let prevented = false;

  const event = new Event('beforeinstallprompt', {
    cancelable: true,
  }) as BeforeInstallPromptEvent;

  const originalPreventDefault = event.preventDefault.bind(event);
  event.preventDefault = () => {
    prevented = true;
    originalPreventDefault();
  };

  event.prompt = async () => {
    promptCalls += 1;
    if (promptCalls > 1) {
      throw new Error('The prompt() method may only be called once.');
    }
    if (options.promptRejects) {
      throw options.promptRejects;
    }
  };

  event.userChoice =
    options.manualChoice?.promise ??
    Promise.resolve({
      outcome: options.outcome ?? 'dismissed',
      platform: 'web',
    });

  return {
    event,
    getPromptCalls: () => promptCalls,
    wasPrevented: () => prevented,
  };
}

test('captura beforeinstallprompt, descarta el evento tras rechazo (dismissed) y evita reutilizar evento vencido', async () => {
  const harness = createMockEnv();
  const controller = createPWAInstallController(harness.env);
  const unsub = controller.subscribe(() => {});

  const promptMock = createDeferredPromptEvent({ outcome: 'dismissed' });
  harness.dispatch('beforeinstallprompt', promptMock.event);

  assert.equal(promptMock.wasPrevented(), true);
  assert.equal(controller.getSnapshot().isInstallable, true);
  assert.equal(controller.getSnapshot().isInstalled, false);

  const firstAttempt = await controller.install();
  assert.equal(firstAttempt, false);
  assert.equal(promptMock.getPromptCalls(), 1);
  assert.equal(controller.getSnapshot().isInstallable, false);
  assert.equal(controller.getSnapshot().isInstalled, false);
  assert.equal(controller.getSnapshot().isPrompting, false);
  assert.equal(controller.getSnapshot().lastOutcome, 'dismissed');

  // Un segundo intento sin un nuevo evento del navegador NO debe reutilizar el evento vencido
  const secondAttempt = await controller.install();
  assert.equal(secondAttempt, false);
  assert.equal(promptMock.getPromptCalls(), 1);

  // Si el navegador decide emitir un evento nuevo posteriormente, vuelve a habilitarse limpiamente
  const freshMock = createDeferredPromptEvent({ outcome: 'accepted' });
  harness.dispatch('beforeinstallprompt', freshMock.event);
  assert.equal(controller.getSnapshot().isInstallable, true);

  unsub();
});

test('consume el evento atómicamente antes del await, evita doble clic concurrente y maneja aceptación + appinstalled', async () => {
  const harness = createMockEnv();
  const controller = createPWAInstallController(harness.env);
  const unsubA = controller.subscribe(() => {});
  const unsubB = controller.subscribe(() => {});

  let resolveChoice!: (v: { outcome: 'accepted' | 'dismissed'; platform: string }) => void;
  const choicePromise = new Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>(
    (resolve) => {
      resolveChoice = resolve;
    },
  );

  const promptMock = createDeferredPromptEvent({
    manualChoice: { promise: choicePromise },
  });
  harness.dispatch('beforeinstallprompt', promptMock.event);
  assert.equal(controller.getSnapshot().isInstallable, true);

  // Dos clics simultáneos (por ejemplo doble toque rápido o dos instancias montadas)
  const p1 = controller.install();
  assert.equal(controller.getSnapshot().isInstallable, false);
  assert.equal(controller.getSnapshot().isPrompting, true);

  const p2 = controller.install();
  assert.equal(await p2, false);
  assert.equal(promptMock.getPromptCalls(), 1);

  resolveChoice({ outcome: 'accepted', platform: 'web' });
  assert.equal(await p1, true);
  assert.equal(controller.getSnapshot().isPrompting, false);
  assert.equal(controller.getSnapshot().lastOutcome, 'accepted');
  assert.equal(controller.getSnapshot().isInstallable, false);

  // Confirmación oficial del navegador vía appinstalled
  harness.dispatch('appinstalled');
  assert.equal(controller.getSnapshot().isInstalled, true);
  assert.equal(controller.getSnapshot().isInstallable, false);

  unsubA();
  unsubB();
});

test('maneja errores en prompt() sin promesas sin capturar y limpia el evento fallido', async () => {
  const harness = createMockEnv();
  const controller = createPWAInstallController(harness.env);
  const unsub = controller.subscribe(() => {});

  const brokenMock = createDeferredPromptEvent({
    promptRejects: new Error('Prompt aborted by user agent'),
  });
  harness.dispatch('beforeinstallprompt', brokenMock.event);
  assert.equal(controller.getSnapshot().isInstallable, true);

  const ok = await controller.install();
  assert.equal(ok, false);
  assert.equal(controller.getSnapshot().isInstallable, false);
  assert.equal(controller.getSnapshot().isPrompting, false);
  assert.equal(brokenMock.getPromptCalls(), 1);

  unsub();
});

test('sincroniza instancias lazy montadas después del evento y limpia listeners al desmontar todos los suscriptores', () => {
  const harness = createMockEnv();
  const controller = createPWAInstallController(harness.env);

  // Instancia 1 (ej. AppShell) monta y registra listeners globales una sola vez
  const unsubShell = controller.subscribe(() => {});
  assert.equal(harness.getListenerCount('beforeinstallprompt'), 1);
  assert.equal(harness.getListenerCount('appinstalled'), 1);
  assert.equal(harness.getMediaListenerCount(), 1);

  const promptMock = createDeferredPromptEvent({ outcome: 'dismissed' });
  harness.dispatch('beforeinstallprompt', promptMock.event);

  // Instancia 2 (ej. WorkshopSettingsView lazy) se suscribe más tarde y recibe el evento ya capturado
  const unsubSettings = controller.subscribe(() => {});
  assert.equal(harness.getListenerCount('beforeinstallprompt'), 1);
  assert.equal(controller.getSnapshot().isInstallable, true);

  // Desmontar solo Ajustes mantiene los listeners activos para AppShell
  unsubSettings();
  assert.equal(harness.getListenerCount('beforeinstallprompt'), 1);

  // Desmontar el último suscriptor limpia todos los listeners sin fugas
  unsubShell();
  assert.equal(harness.getListenerCount('beforeinstallprompt'), 0);
  assert.equal(harness.getListenerCount('appinstalled'), 0);
  assert.equal(harness.getMediaListenerCount(), 0);
});

test('detecta standalone inicial, cambios reactivos de display-mode e iPadOS moderno', () => {
  const ipadHarness = createMockEnv({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  });
  const ipadCtrl = createPWAInstallController(ipadHarness.env);
  const unsubIpad = ipadCtrl.subscribe(() => {});
  assert.equal(ipadCtrl.getSnapshot().isIOS, true);
  assert.equal(ipadCtrl.getSnapshot().isInstalled, false);

  // Transición reactiva a display-mode: standalone limpia cualquier prompt y marca instalada
  const promptMock = createDeferredPromptEvent({ outcome: 'dismissed' });
  ipadHarness.dispatch('beforeinstallprompt', promptMock.event);
  assert.equal(ipadCtrl.getSnapshot().isInstallable, true);

  ipadHarness.setStandaloneMedia(true);
  assert.equal(ipadCtrl.getSnapshot().isInstalled, true);
  assert.equal(ipadCtrl.getSnapshot().isInstallable, false);
  unsubIpad();

  // App iniciada directamente en modo standalone ignora beforeinstallprompt
  const standaloneHarness = createMockEnv({ standaloneMedia: true });
  const standaloneCtrl = createPWAInstallController(standaloneHarness.env);
  const unsubStandalone = standaloneCtrl.subscribe(() => {});
  assert.equal(standaloneCtrl.getSnapshot().isInstalled, true);

  const ignoredPrompt = createDeferredPromptEvent({ outcome: 'accepted' });
  standaloneHarness.dispatch('beforeinstallprompt', ignoredPrompt.event);
  assert.equal(standaloneCtrl.getSnapshot().isInstallable, false);
  unsubStandalone();
});
