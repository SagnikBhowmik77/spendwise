import { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'spendwise.theme';
const ThemeContext = createContext(null);

const readSaved = () => {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
};

// theme: 'system' | 'light' | 'dark'. public/theme-init.js applies the same rule before React loads.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readSaved);

  useEffect(() => {
    try { localStorage.setItem(KEY, theme); } catch { /* not saved; still applied */ }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020617' : '#4f46e5');
    };
    apply();
    if (theme !== 'system') return undefined;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
