'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
type EffectiveTheme = 'light' | 'dark';

type ThemeContextValue = {
  userPreference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setUserPreference: (pref: ThemePreference) => void;
  toggleLightDark: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORE_KEY = 'theme_preference';

async function setTauriWindowTheme(theme: EffectiveTheme) {
  try {
    const mod = await import('@tauri-apps/api/webviewWindow');
    const win = mod.WebviewWindow.getCurrent();
    await win.setTheme(theme);
  } catch {
    // 非 Tauri 环境无需处理
  }
}

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
    ? 'dark'
    : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 偏好与系统主题都在 useState 惰性初始化阶段从存储 / matchMedia 读取，
  // 首帧即拿到正确主题，避免在挂载 effect 里同步 setState 造成的闪变与告警。
  const [userPreference, setUserPreferenceState] = useState<ThemePreference>(
    () => {
      try {
        const stored = window.localStorage.getItem(STORE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system')
          return stored;
      } catch {
        // ignore
      }
      return 'system';
    },
  );
  const [systemTheme, setSystemTheme] =
    useState<EffectiveTheme>(getSystemTheme);

  // 仅订阅系统主题变化（事件驱动，非同步 setState）。
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;

    const handler = (e: MediaQueryListEvent) =>
      setSystemTheme(e.matches ? 'dark' : 'light');
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const effectiveTheme: EffectiveTheme =
    userPreference === 'system' ? systemTheme : userPreference;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    void setTauriWindowTheme(effectiveTheme);
  }, [effectiveTheme]);

  const value = useMemo<ThemeContextValue>(() => {
    return {
      userPreference,
      effectiveTheme,
      setUserPreference: (pref) => {
        setUserPreferenceState(pref);
        try {
          window.localStorage.setItem(STORE_KEY, pref);
        } catch {
          // ignore
        }
      },
      toggleLightDark: () => {
        const next = effectiveTheme === 'light' ? 'dark' : 'light';
        setUserPreferenceState(next);
        try {
          window.localStorage.setItem(STORE_KEY, next);
        } catch {
          // ignore
        }
      },
    };
  }, [effectiveTheme, userPreference]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
