import React, { useEffect, useRef, useState } from 'react';
import { Check, Pencil } from 'lucide-react';

export interface DurationInputProps {
  readonly id?: string;
  readonly valueMinutes: number;
  onChangeMinutes(minutes: number): void;
  readonly minMinutes?: number;
  readonly maxMinutes?: number;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
}

function clampMinutes(
  value: number,
  minMinutes: number,
  maxMinutes?: number,
): number {
  const safe = Number.isFinite(value) ? Math.round(value) : minMinutes;
  const aboveMin = Math.max(minMinutes, safe);
  return maxMinutes !== undefined ? Math.min(maxMinutes, aboveMin) : aboveMin;
}

export const DurationInput: React.FC<DurationInputProps> = ({
  id,
  valueMinutes,
  onChangeMinutes,
  minMinutes = 0,
  maxMinutes,
  disabled = false,
  compact = false,
  ariaLabel,
  className = '',
}) => {
  const safeTotal = clampMinutes(valueMinutes, minMinutes, maxMinutes);
  const displayHours = Math.floor(safeTotal / 60);
  const displayMins = safeTotal % 60;

  const [isEditing, setIsEditing] = useState(false);
  const [focusTarget, setFocusTarget] = useState<'hours' | 'minutes'>('hours');
  const [hoursDraft, setHoursDraft] = useState(String(displayHours));
  const [minutesDraft, setMinutesDraft] = useState(String(displayMins));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoursRef = useRef<HTMLInputElement | null>(null);
  const minutesRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setHoursDraft(String(displayHours));
      setMinutesDraft(String(displayMins));
    }
  }, [displayHours, displayMins, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const target = focusTarget === 'minutes' ? minutesRef.current : hoursRef.current;
    if (target) {
      target.focus();
      target.select();
    }
  }, [isEditing, focusTarget]);

  const computeTotal = (nextHoursRaw: string, nextMinutesRaw: string) => {
    const parsedHours = Number.parseInt(nextHoursRaw || '0', 10) || 0;
    const parsedMinutes = Number.parseInt(nextMinutesRaw || '0', 10) || 0;
    return clampMinutes(parsedHours * 60 + parsedMinutes, minMinutes, maxMinutes);
  };

  const enterEdit = (target: 'hours' | 'minutes') => {
    if (disabled) return;
    setHoursDraft(String(displayHours));
    setMinutesDraft(String(displayMins));
    setFocusTarget(target);
    setIsEditing(true);
  };

  const handleHoursChange = (raw: string) => {
    const clean = raw.replace(/\D/g, '').slice(0, 4);
    setHoursDraft(clean);
    onChangeMinutes(computeTotal(clean, minutesDraft));
  };

  const handleMinutesChange = (raw: string) => {
    const clean = raw.replace(/\D/g, '').slice(0, 3);
    setMinutesDraft(clean);
    onChangeMinutes(computeTotal(hoursDraft, clean));
  };

  const handleConfirm = () => {
    const total = computeTotal(hoursDraft, minutesDraft);
    onChangeMinutes(total);
    setHoursDraft(String(Math.floor(total / 60)));
    setMinutesDraft(String(total % 60));
    setIsEditing(false);
  };

  const handleCancel = () => {
    setHoursDraft(String(displayHours));
    setMinutesDraft(String(displayMins));
    setIsEditing(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    }
  };

  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = e.relatedTarget as Node | null;
    if (nextFocused && containerRef.current?.contains(nextFocused)) {
      return;
    }
    handleConfirm();
  };

  if (!isEditing) {
    return (
      <div
        role="group"
        aria-label={ariaLabel}
        onClick={() => enterEdit('hours')}
        className={`group flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-100/90 transition-colors hover:border-slate-300 hover:bg-slate-100 ${
          compact ? 'min-h-[38px] px-2.5 text-xs' : 'min-h-[42px] px-3 text-sm'
        } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${className}`}
      >
        <div className="flex min-w-0 items-center gap-2 font-mono tabular-nums">
          <button
            id={id}
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              enterEdit('hours');
            }}
            className="inline-flex items-baseline gap-1 rounded px-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700/40"
            aria-label={`Editar horas (${displayHours} Hr.)`}
          >
            <span className="font-bold text-slate-900">{displayHours}</span>
            <span className="font-sans font-medium text-slate-500">Hr.</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              enterEdit('minutes');
            }}
            className="inline-flex items-baseline gap-1 rounded px-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700/40"
            aria-label={`Editar minutos (${displayMins} Min.)`}
          >
            <span className="font-bold text-slate-900">{displayMins}</span>
            <span className="font-sans font-medium text-slate-500">Min.</span>
          </button>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            enterEdit('hours');
          }}
          className={`inline-flex shrink-0 items-center justify-center border-l border-slate-200/90 pl-2 text-slate-500 transition-colors group-hover:text-teal-700 ${
            compact ? 'h-6 w-6' : 'h-7 w-7'
          }`}
          aria-label={ariaLabel ? `Editar ${ariaLabel}` : 'Editar horas y minutos'}
        >
          <Pencil
            className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}
            aria-hidden="true"
          />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onBlur={handleContainerBlur}
      className={`flex w-full min-w-0 items-center ${
        compact ? 'gap-1.5' : 'gap-2'
      } ${className}`}
    >
      <label
        className={`flex min-w-0 flex-1 cursor-text items-center justify-between rounded-lg border border-slate-300 bg-white transition-colors focus-within:border-teal-700 focus-within:ring-1 focus-within:ring-teal-700/20 ${
          compact ? 'min-h-[38px] px-2 text-xs' : 'min-h-[42px] px-2.5 text-sm'
        }`}
      >
        <input
          ref={hoursRef}
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={hoursDraft}
          onChange={(e) => handleHoursChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          aria-label="Horas"
          className="w-full min-w-[2ch] bg-transparent font-mono font-bold text-slate-900 tabular-nums focus:outline-none"
        />
        <span className="ml-1 shrink-0 select-none font-sans font-medium text-slate-500">
          Hr.
        </span>
      </label>

      <label
        className={`flex min-w-0 flex-1 cursor-text items-center justify-between rounded-lg border border-slate-300 bg-white transition-colors focus-within:border-teal-700 focus-within:ring-1 focus-within:ring-teal-700/20 ${
          compact ? 'min-h-[38px] px-2 text-xs' : 'min-h-[42px] px-2.5 text-sm'
        }`}
      >
        <input
          ref={minutesRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={minutesDraft}
          onChange={(e) => handleMinutesChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          aria-label="Minutos"
          className="w-full min-w-[2ch] bg-transparent font-mono font-bold text-slate-900 tabular-nums focus:outline-none"
        />
        <span className="ml-1 shrink-0 select-none font-sans font-medium text-slate-500">
          Min.
        </span>
      </label>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleConfirm}
        aria-label="Confirmar tiempo"
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-800 transition-colors hover:border-teal-700 hover:bg-teal-700 hover:text-white ${
          compact ? 'h-[38px] w-[38px]' : 'h-[42px] w-[42px]'
        }`}
      >
        <Check className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
      </button>
    </div>
  );
};
