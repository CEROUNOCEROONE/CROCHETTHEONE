export const INSTALLATION_ID_STORAGE_KEY = 'crochet_installation_id_v1';

let sessionCachedInstallationId: string | null = null;

function createInstallationUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-a${rand().slice(1)}-${rand()}${rand()}${rand()}`;
}

/**
 * Identidad técnica de la instalación/navegador local.
 * No constituye un mecanismo de autenticación ni validación de licencia.
 * Cuando localStorage no está disponible, conserva un único UUID por sesión en memoria.
 */
export function getOrCreateInstallationId(): string {
  if (sessionCachedInstallationId && sessionCachedInstallationId.trim().length > 0) {
    return sessionCachedInstallationId;
  }

  let stored: string | null = null;
  if (typeof window !== 'undefined') {
    try {
      const candidate = window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY);
      if (candidate && candidate.trim().length > 0) {
        stored = candidate.trim();
      }
    } catch {
      stored = null;
    }
  }

  if (stored) {
    sessionCachedInstallationId = stored;
    return sessionCachedInstallationId;
  }

  const generated = createInstallationUuid();
  sessionCachedInstallationId = generated;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, generated);
    } catch {
      // Fallback seguro en memoria cuando localStorage está bloqueado en esta sesión.
    }
  }

  return sessionCachedInstallationId;
}

export function peekSessionInstallationId(): string | null {
  return sessionCachedInstallationId;
}
