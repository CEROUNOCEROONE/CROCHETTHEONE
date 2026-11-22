import { useEffect } from 'react';

type SyncableFormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const NON_VALIDATED_INPUT_TYPES = new Set([
  'hidden',
  'button',
  'submit',
  'reset',
  'image',
]);

function isSyncableFormField(target: EventTarget | null): target is SyncableFormField {
  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    )
  ) {
    return false;
  }
  if (!target.closest('form')) return false;
  if (target.disabled) return false;
  if (target instanceof HTMLInputElement) {
    if (target.readOnly || NON_VALIDATED_INPUT_TYPES.has(target.type)) {
      return false;
    }
  }
  if (target instanceof HTMLTextAreaElement && target.readOnly) {
    return false;
  }
  return true;
}

/**
 * Synchronizes `aria-invalid` with native `:user-invalid` on form controls.
 *
 * - Sets `aria-invalid="false"` on untouched fields when focused so screen
 *   readers (notably Firefox/Safari) do not announce empty required fields as
 *   invalid before user interaction.
 * - Updates `aria-invalid` to `"true"` / `"false"` after interaction (`blur`,
 *   `change`, `input`, `invalid`, `reset`) using `:user-invalid`.
 * - Preserves any field whose `aria-invalid` is explicitly controlled elsewhere.
 */
export function useFormAriaInvalidSync(): void {
  useEffect(() => {
    if (
      typeof document === 'undefined' ||
      typeof CSS === 'undefined' ||
      typeof CSS.supports !== 'function' ||
      !CSS.supports('selector(:user-invalid)')
    ) {
      return;
    }

    const managedFields = new WeakSet<HTMLElement>();
    const pendingResetTimers = new Set<number>();

    const canManage = (el: SyncableFormField): boolean =>
      !el.hasAttribute('aria-invalid') || managedFields.has(el);

    const syncField = (el: SyncableFormField, forceInvalid = false): void => {
      if (!canManage(el)) return;
      const isInvalid = forceInvalid || el.matches(':user-invalid');
      const nextValue = isInvalid ? 'true' : 'false';
      if (el.getAttribute('aria-invalid') !== nextValue) {
        el.setAttribute('aria-invalid', nextValue);
      }
      managedFields.add(el);
    };

    const handleFocusIn = (event: Event): void => {
      if (!isSyncableFormField(event.target)) return;
      if (!event.target.hasAttribute('aria-invalid')) {
        event.target.setAttribute(
          'aria-invalid',
          event.target.matches(':user-invalid') ? 'true' : 'false',
        );
        managedFields.add(event.target);
      }
    };

    const handleInteraction = (event: Event): void => {
      if (!isSyncableFormField(event.target)) return;
      syncField(event.target);
    };

    const handleInvalid = (event: Event): void => {
      if (!isSyncableFormField(event.target)) return;
      syncField(event.target, true);
    };

    const handleReset = (event: Event): void => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      const timerId = window.setTimeout(() => {
        pendingResetTimers.delete(timerId);
        const controls = form.querySelectorAll<SyncableFormField>(
          'input, select, textarea',
        );
        controls.forEach((control) => {
          if (managedFields.has(control) && isSyncableFormField(control)) {
            syncField(control);
          }
        });
      }, 0);
      pendingResetTimers.add(timerId);
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('blur', handleInteraction, true);
    document.addEventListener('change', handleInteraction, true);
    document.addEventListener('input', handleInteraction, true);
    document.addEventListener('invalid', handleInvalid, true);
    document.addEventListener('reset', handleReset, true);

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('blur', handleInteraction, true);
      document.removeEventListener('change', handleInteraction, true);
      document.removeEventListener('input', handleInteraction, true);
      document.removeEventListener('invalid', handleInvalid, true);
      document.removeEventListener('reset', handleReset, true);
      pendingResetTimers.forEach((timerId) => window.clearTimeout(timerId));
      pendingResetTimers.clear();
    };
  }, []);
}
