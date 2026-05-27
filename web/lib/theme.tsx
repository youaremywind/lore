'use client';

import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  auroraBackgroundEnabled: boolean;
  setAuroraBackgroundEnabled: (enabled: boolean) => void;
  theme: Theme;
  toggleAuroraBackground: () => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'lore-theme';
const AURORA_BACKGROUND_STORAGE_KEY = 'lore-aurora-background';
const ThemeContext = createContext<ThemeContextValue>({
  auroraBackgroundEnabled: false,
  setAuroraBackgroundEnabled: () => {},
  theme: 'dark',
  toggleAuroraBackground: () => {},
  toggleTheme: () => {},
});

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  // Initial state reads the attribute set by the inline <head> script (no flash).
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  });
  const [auroraBackgroundEnabled, setAuroraBackgroundEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(AURORA_BACKGROUND_STORAGE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setAuroraBackgroundEnabled = useCallback((enabled: boolean) => {
    setAuroraBackgroundEnabledState(enabled);
    try { window.localStorage.setItem(AURORA_BACKGROUND_STORAGE_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const toggleAuroraBackground = useCallback(() => {
    setAuroraBackgroundEnabledState((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(AURORA_BACKGROUND_STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ auroraBackgroundEnabled, setAuroraBackgroundEnabled, theme, toggleAuroraBackground, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
