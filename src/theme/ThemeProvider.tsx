import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useAppStore } from '../store/useAppStore';
import { buildTheme, type Theme } from './index';

const ThemeContext = createContext<Theme>(buildTheme('light'));

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  // A user preference of 'light'/'dark' overrides the OS; 'system' defers to it.
  const themeMode = useAppStore((s) => s.themeMode);

  const resolved = themeMode === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : themeMode;
  const theme = useMemo(() => buildTheme(resolved), [resolved]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
