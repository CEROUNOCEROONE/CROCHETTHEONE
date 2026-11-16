import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

export interface SnapSlideProps {
  readonly id: string;
  readonly label: string;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly innerClassName?: string;
}

/**
 * Vista individual de pantalla completa.
 * - En móvil (< lg): ocupa el 100% del ancho y alto del escenario y hace snap horizontal al deslizar.
 * - En web (>= lg): ocupa el 100% del alto del escenario y hace snap vertical al hacer scroll.
 */
export const SnapSlide: React.FC<SnapSlideProps> = ({
  id,
  label,
  children,
  className = '',
  innerClassName = '',
}) => {
  return (
    <section
      data-snap-slide-id={id}
      aria-label={label}
      className={`h-full w-full shrink-0 snap-start snap-always overflow-y-auto overflow-x-hidden overscroll-y-auto px-4 py-3 sm:px-6 lg:block lg:py-5 lg:pr-14 ${className}`}
    >
      <div className={`mx-auto w-full max-w-6xl ${innerClassName}`}>
        {children}
      </div>
    </section>
  );
};

export interface SnapDeckHandle {
  goToSlide(target: string | number, behavior?: ScrollBehavior): void;
}

export interface SnapDeckProps {
  readonly children: React.ReactNode;
  readonly activeSlideId?: string;
  readonly onSlideChange?: (slideId: string, index: number) => void;
  readonly ariaLabel?: string;
  readonly topSlot?: React.ReactNode;
  readonly className?: string;
}

interface SlideMeta {
  readonly id: string;
  readonly label: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Contenedor universal de navegación por vistas completas:
 * - Web (lg+): scroll vertical con snap estricto por sección + riel lateral de progreso.
 * - Móvil (< lg): swipe horizontal táctil a pantalla completa + barra superior compacta con indicador.
 */
export const SnapDeck = React.forwardRef<SnapDeckHandle, SnapDeckProps>(
  (
    {
      children,
      activeSlideId,
      onSlideChange,
      ariaLabel = 'Secciones de la pantalla',
      topSlot,
      className = '',
    },
    ref,
  ) => {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const activeIndexRef = useRef(0);
    const onSlideChangeRef = useRef(onSlideChange);

    // Extrae metadatos (id y label) de los hijos <SnapSlide> válidos sin re-renderizar innecesariamente
    const slidesMeta = useMemo<SlideMeta[]>(() => {
      const result: SlideMeta[] = [];
      React.Children.forEach(children, (child) => {
        if (!React.isValidElement<SnapSlideProps>(child)) return;
        const id = child.props?.id;
        const label = child.props?.label;
        if (typeof id === 'string' && typeof label === 'string') {
          result.push({ id, label });
        }
      });
      return result;
    }, [children]);

    const slidesMetaRef = useRef(slidesMeta);

    useEffect(() => {
      onSlideChangeRef.current = onSlideChange;
    }, [onSlideChange]);

    useEffect(() => {
      slidesMetaRef.current = slidesMeta;
    }, [slidesMeta]);

    const totalSlides = slidesMeta.length;
    const safeIndex = Math.min(activeIndex, Math.max(0, totalSlides - 1));
    const currentSlide = slidesMeta[safeIndex] ?? null;

    useEffect(() => {
      activeIndexRef.current = safeIndex;
    }, [safeIndex]);

    const scrollToIndex = useCallback(
      (targetIdx: number, behavior?: ScrollBehavior) => {
        const track = trackRef.current;
        const list = slidesMetaRef.current;
        if (!track || list.length === 0) return;
        const clamped = Math.max(0, Math.min(targetIdx, list.length - 1));
        const slideEl = track.children[clamped] as HTMLElement | undefined;
        if (!slideEl) return;

        const isDesktop =
          typeof window !== 'undefined' && window.innerWidth >= 1024;
        const resolvedBehavior: ScrollBehavior =
          behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth');

        if (isDesktop) {
          track.scrollTo({ top: slideEl.offsetTop, behavior: resolvedBehavior });
        } else {
          track.scrollTo({ left: slideEl.offsetLeft, behavior: resolvedBehavior });
        }
        activeIndexRef.current = clamped;
        setActiveIndex(clamped);
        onSlideChangeRef.current?.(list[clamped].id, clamped);
      },
      [],
    );

    const goToSlide = useCallback(
      (target: string | number, behavior?: ScrollBehavior) => {
        if (typeof target === 'number') {
          scrollToIndex(target, behavior);
          return;
        }
        const idx = slidesMetaRef.current.findIndex((s) => s.id === target);
        if (idx >= 0) {
          scrollToIndex(idx, behavior);
        }
      },
      [scrollToIndex],
    );

    useImperativeHandle(ref, () => ({ goToSlide }), [goToSlide]);

    // Sincronización controlada cuando el módulo cambia pestaña o vista externamente
    const lastAppliedExternalIdRef = useRef<string | undefined>(undefined);
    useEffect(() => {
      if (!activeSlideId) {
        lastAppliedExternalIdRef.current = undefined;
        return;
      }
      if (lastAppliedExternalIdRef.current === activeSlideId) return;
      const targetIdx = slidesMeta.findIndex((s) => s.id === activeSlideId);
      if (targetIdx >= 0) {
        lastAppliedExternalIdRef.current = activeSlideId;
        if (targetIdx !== safeIndex) {
          scrollToIndex(targetIdx);
        }
      }
    }, [activeSlideId, slidesMeta, safeIndex, scrollToIndex]);

    // Observa la vista dominante dentro del track con IntersectionObserver (0% scroll jank)
    useEffect(() => {
      const track = trackRef.current;
      if (!track || typeof IntersectionObserver === 'undefined') return;

      const observer = new IntersectionObserver(
        (entries) => {
          let bestEntry: IntersectionObserverEntry | null = null;
          for (const entry of entries) {
            if (
              entry.isIntersecting &&
              entry.intersectionRatio >= 0.55 &&
              (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio)
            ) {
              bestEntry = entry;
            }
          }
          if (!bestEntry) return;
          const slideId = (bestEntry.target as HTMLElement).dataset.snapSlideId;
          if (!slideId) return;
          const idx = slidesMetaRef.current.findIndex((s) => s.id === slideId);
          if (idx >= 0 && activeIndexRef.current !== idx) {
            activeIndexRef.current = idx;
            lastAppliedExternalIdRef.current = slideId;
            setActiveIndex(idx);
            onSlideChangeRef.current?.(slideId, idx);
          }
        },
        {
          root: track,
          threshold: [0.55, 0.85],
        },
      );

      Array.from(track.children).forEach((el) => observer.observe(el));
      return () => observer.disconnect();
    }, [slidesMeta]);

    // Mantiene la alineación exacta al cambiar tamaño de ventana o rotar pantalla
    useEffect(() => {
      const track = trackRef.current;
      if (!track || typeof ResizeObserver === 'undefined') return;

      let prevIsDesktop = window.innerWidth >= 1024;
      const resizeObs = new ResizeObserver(() => {
        const nowIsDesktop = window.innerWidth >= 1024;
        if (nowIsDesktop !== prevIsDesktop) {
          prevIsDesktop = nowIsDesktop;
          const slideEl = track.children[safeIndex] as HTMLElement | undefined;
          if (slideEl) {
            if (nowIsDesktop) {
              track.scrollTo({ top: slideEl.offsetTop, behavior: 'auto' });
            } else {
              track.scrollTo({ left: slideEl.offsetLeft, behavior: 'auto' });
            }
          }
        }
      });

      resizeObs.observe(track);
      return () => resizeObs.disconnect();
    }, [safeIndex]);

    // Si desaparecen páginas por un filtro o búsqueda, ajusta el índice sin dejar vistas en blanco
    useEffect(() => {
      if (totalSlides > 0 && activeIndex >= totalSlides) {
        scrollToIndex(totalSlides - 1, 'auto');
      }
    }, [totalSlides, activeIndex, scrollToIndex]);

    // Navegación por teclado accesible sin interferir al escribir en inputs
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isDesktop =
        typeof window !== 'undefined' && window.innerWidth >= 1024;
      if (isDesktop) {
        if (e.key === 'PageDown') {
          e.preventDefault();
          scrollToIndex(safeIndex + 1);
        } else if (e.key === 'PageUp') {
          e.preventDefault();
          scrollToIndex(safeIndex - 1);
        }
      } else {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          scrollToIndex(safeIndex + 1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          scrollToIndex(safeIndex - 1);
        }
      }
    };

    return (
      <div
        className={`relative flex h-full w-full flex-col overflow-hidden ${className}`}
        onKeyDown={handleKeyDown}
        aria-roledescription="carrusel de vistas"
        aria-label={ariaLabel}
      >
        {/* Barra contextual fija superior del módulo (ej. volver a proyectos o tabs rápidos) */}
        {topSlot && (
          <div className="shrink-0 border-b border-slate-200/80 bg-white/95 px-4 py-2 backdrop-blur-sm sm:px-6">
            <div className="mx-auto w-full max-w-6xl">{topSlot}</div>
          </div>
        )}

        {/* Indicador compacto de swipe en móvil (< lg) */}
        {totalSlides > 1 && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/90 px-3 py-1.5 backdrop-blur-sm lg:hidden">
            <button
              type="button"
              onClick={() => scrollToIndex(safeIndex - 1)}
              disabled={safeIndex === 0}
              aria-label="Vista anterior"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-teal-800 tabular-nums shrink-0">
                {safeIndex + 1}/{totalSlides}
              </span>
              <span className="truncate text-xs font-medium text-slate-700">
                {currentSlide?.label ?? ''}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0" role="tablist" aria-label="Indicador de vistas">
              {slidesMeta.map((slide, idx) => {
                const isCurrent = idx === safeIndex;
                return (
                  <button
                    key={slide.id}
                    type="button"
                    role="tab"
                    aria-selected={isCurrent}
                    aria-label={`Ir a ${slide.label}`}
                    onClick={() => scrollToIndex(idx)}
                    className={`h-2 rounded-full transition-all ${
                      isCurrent
                        ? 'w-5 bg-teal-700'
                        : 'w-2 bg-slate-300 hover:bg-slate-400'
                    }`}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => scrollToIndex(safeIndex + 1)}
              disabled={safeIndex >= totalSlides - 1}
              aria-label="Siguiente vista"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Pista principal con swipe horizontal en móvil y snap vertical por pantalla en web */}
        <div
          ref={trackRef}
          className="no-scrollbar flex min-h-0 flex-1 w-full flex-row overflow-x-auto overflow-y-hidden snap-x snap-mandatory scroll-smooth lg:block lg:overflow-y-auto lg:overflow-x-hidden lg:snap-y lg:snap-mandatory"
        >
          {children}
        </div>

        {/* Riel lateral discreto de progreso y salto en escritorio (lg+) */}
        {totalSlides > 1 && (
          <nav
            aria-label="Navegación entre pantallas de la sección"
            className="pointer-events-none fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-1.5 lg:flex"
          >
            <div className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-sm">
              <button
                type="button"
                onClick={() => scrollToIndex(safeIndex - 1)}
                disabled={safeIndex === 0}
                aria-label="Sección anterior"
                title="Sección anterior"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>

              <div className="flex flex-col items-center gap-1.5 py-1">
                {slidesMeta.map((slide, idx) => {
                  const isCurrent = idx === safeIndex;
                  return (
                    <button
                      key={slide.id}
                      type="button"
                      onClick={() => scrollToIndex(idx)}
                      aria-label={`${idx + 1}. ${slide.label}`}
                      title={`${idx + 1}. ${slide.label}`}
                      aria-current={isCurrent ? 'step' : undefined}
                      className="group relative flex h-4 w-6 items-center justify-center"
                    >
                      <span
                        className={`block rounded-full transition-all ${
                          isCurrent
                            ? 'h-4 w-2 bg-teal-700'
                            : 'h-2 w-2 bg-slate-300 group-hover:bg-slate-500'
                        }`}
                      />
                      <span className="pointer-events-none absolute right-8 hidden whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 shadow-sm group-hover:block">
                        {idx + 1}. {slide.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => scrollToIndex(safeIndex + 1)}
                disabled={safeIndex >= totalSlides - 1}
                aria-label="Siguiente sección"
                title="Siguiente sección"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </nav>
        )}
      </div>
    );
  },
);

SnapDeck.displayName = 'SnapDeck';
