import type { Platform } from '@/platforms/common/types';

export const QUALITY_OPTIONS: readonly string[] = ['原画', '高清', '标清'];

export const DEFAULT_QUALITY = '原画';

export function resolveStoredQuality(platform: Platform): string {
  const saved = window.localStorage.getItem(`${platform}_preferred_quality`);
  if (saved && QUALITY_OPTIONS.includes(saved)) return saved;
  return DEFAULT_QUALITY;
}

export function persistQualityPreference(
  platform: Platform,
  quality: string,
): void {
  try {
    window.localStorage.setItem(`${platform}_preferred_quality`, quality);
  } catch {
    // ignore
  }
}
