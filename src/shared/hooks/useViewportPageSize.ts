import { useEffect, useState } from 'react';

export type ViewportTier = 'mobile' | 'tablet' | 'desktop';
export type HeightTier = 'compact' | 'regular' | 'tall';

export interface ViewportProfile {
  readonly tier: ViewportTier;
  readonly heightTier: HeightTier;
  readonly isMobile: boolean;
  readonly width: number;
  readonly height: number;
}

function readViewportProfile(): ViewportProfile {
  if (typeof window === 'undefined') {
    return {
      tier: 'desktop',
      heightTier: 'regular',
      isMobile: false,
      width: 1280,
      height: 800,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const tier: ViewportTier =
    width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop';
  const heightTier: HeightTier =
    height < 700 ? 'compact' : height < 880 ? 'regular' : 'tall';

  return {
    tier,
    heightTier,
    isMobile: width < 1024,
    width,
    height,
  };
}

/**
 * Mide el tamaño de pantalla actual con actualización throttled por animationFrame
 * para calcular cuántos elementos completos caben por vista sin recortes.
 */
export function useViewportProfile(): ViewportProfile {
  const [profile, setProfile] = useState<ViewportProfile>(() =>
    readViewportProfile(),
  );

  useEffect(() => {
    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const next = readViewportProfile();
        setProfile((prev) =>
          prev.tier === next.tier &&
          prev.heightTier === next.heightTier &&
          prev.isMobile === next.isMobile
            ? prev
            : next,
        );
      });
    };

    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return profile;
}

/**
 * Divide un arreglo en páginas completas de tamaño fijo >= 1.
 * Garantiza al menos una página (vacía si no hay elementos).
 */
export function chunkIntoPages<T>(items: readonly T[], pageSize: number): T[][] {
  const safeSize = Math.max(1, Math.floor(pageSize));
  if (items.length === 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    pages.push(items.slice(i, i + safeSize));
  }
  return pages;
}

/**
 * Helper declarativo para seleccionar cantidad de elementos completos por vista
 * según el ancho y alto del dispositivo, evitando tarjetas o filas cortadas.
 */
export function pickPageSize(
  profile: ViewportProfile,
  sizes: {
    mobileCompact: number;
    mobileRegular: number;
    tablet?: number;
    desktopCompact: number;
    desktopRegular: number;
    desktopTall?: number;
  },
): number {
  if (profile.tier === 'mobile') {
    return profile.heightTier === 'compact'
      ? sizes.mobileCompact
      : sizes.mobileRegular;
  }
  if (profile.tier === 'tablet') {
    return sizes.tablet ?? sizes.mobileRegular;
  }
  if (profile.heightTier === 'compact') return sizes.desktopCompact;
  if (profile.heightTier === 'tall') {
    return sizes.desktopTall ?? sizes.desktopRegular;
  }
  return sizes.desktopRegular;
}
