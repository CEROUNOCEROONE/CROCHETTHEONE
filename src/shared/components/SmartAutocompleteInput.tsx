import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useId } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { normalizeComparisonKey } from '@/src/domain/services/inventoryService.ts';

export interface SmartSuggestion<T = unknown> {
  id: string;
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeTone?: 'teal' | 'amber' | 'slate' | 'emerald';
  colorHex?: string | null;
  payload?: T;
}

interface SmartAutocompleteInputProps<T = unknown> {
  id?: string;
  value: string;
  onChange: (newValue: string) => void;
  onSelectSuggestion?: (suggestion: SmartSuggestion<T>) => void;
  suggestions: SmartSuggestion<T>[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  maxSuggestions?: number;
  emptyCreationHint?: string;
}

export function SmartAutocompleteInput<T = unknown>({
  id,
  value,
  onChange,
  onSelectSuggestion,
  suggestions,
  placeholder,
  required = false,
  disabled = false,
  className = '',
  inputClassName = '',
  maxSuggestions = 8,
  emptyCreationHint,
}: SmartAutocompleteInputProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [placement, setPlacement] = useState<{ openUpward: boolean; maxHeight: number }>({
    openUpward: false,
    maxHeight: 240,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;

  const queryKey = useMemo(() => normalizeComparisonKey(value), [value]);

  const filteredSuggestions = useMemo(() => {
    if (suggestions.length === 0) return [];
    if (!queryKey) {
      return suggestions.slice(0, maxSuggestions);
    }

    const scored: { item: SmartSuggestion<T>; score: number }[] = [];
    for (const item of suggestions) {
      const valueKey = normalizeComparisonKey(item.value);
      const labelKey = normalizeComparisonKey(item.label);
      const sublabelKey = item.sublabel ? normalizeComparisonKey(item.sublabel) : '';

      let score = 0;
      if (valueKey === queryKey || labelKey === queryKey) {
        score = 100;
      } else if (valueKey.startsWith(queryKey) || labelKey.startsWith(queryKey)) {
        score = 80;
      } else if (valueKey.includes(queryKey) || labelKey.includes(queryKey)) {
        score = 60;
      } else if (sublabelKey.includes(queryKey)) {
        score = 40;
      }

      if (score > 0) {
        scored.push({ item, score });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label, 'es'));
    return scored.slice(0, maxSuggestions).map(entry => entry.item);
  }, [suggestions, queryKey, maxSuggestions]);

  const exactMatch = useMemo(() => {
    if (!queryKey) return null;
    return (
      suggestions.find(
        item =>
          normalizeComparisonKey(item.value) === queryKey ||
          normalizeComparisonKey(item.label) === queryKey
      ) ?? null
    );
  }, [suggestions, queryKey]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [queryKey, isOpen]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const activeOption = optionRefs.current[activeIndex];
    if (activeOption && typeof activeOption.scrollIntoView === 'function') {
      activeOption.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  useEffect(() => {
    const handleOutsidePointer = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, []);

  const showDropdown =
    isOpen && !disabled && (filteredSuggestions.length > 0 || (Boolean(queryKey) && Boolean(emptyCreationHint)));

  const updatePlacement = useCallback(() => {
    const inputEl = inputRef.current;
    if (!inputEl || typeof window === 'undefined') return;

    const inputRect = inputEl.getBoundingClientRect();
    let clipTop = 8;
    let clipBottom = window.innerHeight - 8;

    // Buscar el contenedor scrollable más cercano (por ejemplo, el modal con overflow-y-auto)
    let parent: HTMLElement | null = inputEl.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      const overflowY = style.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const parentRect = parent.getBoundingClientRect();
        clipTop = Math.max(clipTop, parentRect.top + 8);
        clipBottom = Math.min(clipBottom, parentRect.bottom - 8);
        break;
      }
      parent = parent.parentElement;
    }

    // Evitar cubrir la barra de botones de acción (Guardar / Cancelar) al pie del formulario
    const enclosingForm = inputEl.closest('form');
    const submitBtn = enclosingForm?.querySelector('button[type="submit"]') ?? null;
    const footerBar = submitBtn?.parentElement ?? submitBtn;
    if (footerBar) {
      const footerRect = footerBar.getBoundingClientRect();
      if (footerRect.top > inputRect.bottom) {
        clipBottom = Math.min(clipBottom, footerRect.top - 6);
      }
    }

    const spaceBelow = Math.max(0, clipBottom - inputRect.bottom - 6);
    const spaceAbove = Math.max(0, inputRect.top - clipTop - 6);
    const openUpward = spaceBelow < 168 && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(240, Math.max(96, Math.floor(availableSpace)));

    setPlacement(prev =>
      prev.openUpward === openUpward && prev.maxHeight === maxHeight
        ? prev
        : { openUpward, maxHeight }
    );
  }, []);

  useLayoutEffect(() => {
    if (!showDropdown) return;
    updatePlacement();

    const handleReposition = () => updatePlacement();
    window.addEventListener('resize', handleReposition, { passive: true });
    window.addEventListener('scroll', handleReposition, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, { capture: true });
    };
  }, [showDropdown, filteredSuggestions.length, updatePlacement]);

  const handleSelect = (suggestion: SmartSuggestion<T>) => {
    onChange(suggestion.value);
    if (onSelectSuggestion) {
      onSelectSuggestion(suggestion);
    }
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = e.relatedTarget;
    if (nextFocused instanceof Node && containerRef.current?.contains(nextFocused)) {
      return;
    }
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === 'ArrowDown') {
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (filteredSuggestions.length > 0) {
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % filteredSuggestions.length);
      }
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (filteredSuggestions.length > 0) {
        e.preventDefault();
        setActiveIndex(prev => (prev <= 0 ? filteredSuggestions.length - 1 : prev - 1));
      }
    } else if (e.key === 'Enter' && isOpen && activeIndex >= 0 && activeIndex < filteredSuggestions.length) {
      e.preventDefault();
      handleSelect(filteredSuggestions[activeIndex]);
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation?.();
      setIsOpen(false);
      setActiveIndex(-1);
    } else if (e.key === 'Tab' && isOpen) {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const getBadgeClasses = (tone: SmartSuggestion<T>['badgeTone']) => {
    switch (tone) {
      case 'teal':
        return 'bg-[#1D7268]/10 text-[#1D7268] border-[#1D7268]/25';
      case 'emerald':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'amber':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const activeDescendantId =
    showDropdown && activeIndex >= 0 && activeIndex < filteredSuggestions.length
      ? `${listboxId}-opt-${activeIndex}`
      : undefined;

  return (
    <div
      ref={containerRef}
      onBlur={handleContainerBlur}
      className={`relative ${className}`}
    >
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={activeDescendantId}
          required={required}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => {
            if (!disabled && suggestions.length > 0) {
              setIsOpen(true);
            }
          }}
          onChange={e => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={
            inputClassName ||
            'w-full px-3.5 py-2.5 pr-10 bg-[#F8F6F2] border border-[#E5E0D8] rounded-xl text-sm text-[#1E242B] focus:outline-none focus:border-[#1D7268] focus:bg-white transition-all disabled:opacity-60'
          }
        />
        {suggestions.length > 0 && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isOpen ? 'Ocultar sugerencias existentes' : 'Mostrar sugerencias existentes'}
            onMouseDown={e => {
              e.preventDefault();
              setIsOpen(prev => !prev);
              inputRef.current?.focus();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#8E959E] hover:bg-slate-100/80 hover:text-[#1D7268] transition-colors"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180 text-[#1D7268]' : ''}`} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          style={{ maxHeight: `${placement.maxHeight}px` }}
          className={`absolute z-50 left-0 right-0 bg-white border border-[#E5E0D8] rounded-xl shadow-lg overflow-y-auto divide-y divide-[#F3EFEA] ${
            placement.openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {filteredSuggestions.map((suggestion, index) => {
            const isSelected =
              normalizeComparisonKey(suggestion.value) === queryKey ||
              normalizeComparisonKey(suggestion.label) === queryKey;
            const isActive = index === activeIndex;

            return (
              <button
                key={suggestion.id}
                ref={el => {
                  optionRefs.current[index] = el;
                }}
                id={`${listboxId}-opt-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseDown={e => {
                  e.preventDefault();
                  handleSelect(suggestion);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`w-full text-left px-3.5 py-2.5 min-h-[44px] flex items-center justify-between gap-2.5 transition-colors ${
                  isActive
                    ? 'bg-[#1D7268]/8'
                    : isSelected
                    ? 'bg-[#F8F6F2]'
                    : 'hover:bg-[#F8F6F2]/70'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {suggestion.colorHex && (
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/15 shadow-xs"
                      style={{ backgroundColor: suggestion.colorHex }}
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#1E242B] truncate flex items-center gap-1.5">
                      <span className="truncate">{suggestion.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#1D7268] shrink-0" />}
                    </div>
                    {suggestion.sublabel && (
                      <p className="text-[11px] text-[#5A626A] truncate mt-0.5">{suggestion.sublabel}</p>
                    )}
                  </div>
                </div>

                {suggestion.badge && (
                  <span
                    className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md border ${getBadgeClasses(
                      suggestion.badgeTone
                    )}`}
                  >
                    {suggestion.badge}
                  </span>
                )}
              </button>
            );
          })}

          {queryKey && !exactMatch && emptyCreationHint && (
            <div className="px-3.5 py-2 bg-[#F8F6F2]/60 flex items-center gap-2 text-[11px] text-[#5A626A]">
              <Sparkles className="w-3.5 h-3.5 text-[#1D7268] shrink-0" />
              <span className="truncate">{emptyCreationHint}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
