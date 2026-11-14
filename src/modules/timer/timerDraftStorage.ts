const TIMER_NOTE_DRAFTS_KEY = 'app_crochet_timer_note_drafts_v1';

function readAllDrafts(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(TIMER_NOTE_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeAllDrafts(drafts: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIMER_NOTE_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Ignorar si el almacenamiento local no está disponible
  }
}

export function getTimerNoteDraft(componentId: string): string | undefined {
  if (!componentId) return undefined;
  const drafts = readAllDrafts();
  return Object.prototype.hasOwnProperty.call(drafts, componentId)
    ? drafts[componentId]
    : undefined;
}

export function setTimerNoteDraft(componentId: string, value: string): void {
  if (!componentId) return;
  const drafts = readAllDrafts();
  drafts[componentId] = value;
  writeAllDrafts(drafts);
}

export function clearTimerNoteDraft(componentId: string): void {
  if (!componentId) return;
  const drafts = readAllDrafts();
  if (Object.prototype.hasOwnProperty.call(drafts, componentId)) {
    delete drafts[componentId];
    writeAllDrafts(drafts);
  }
}
