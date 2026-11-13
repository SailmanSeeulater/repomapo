import { create } from 'zustand'

/** 'auto' follows the system; the other two are a choice kept in this browser. */
export type Theme = 'auto' | 'light' | 'dark'
const KEY = 'repomapo-theme'

const stored = (): Theme => {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'auto'
  } catch {
    return 'auto'
  }
}
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
const isDark = (t: Theme) => (t === 'auto' ? systemDark() : t === 'dark')

interface ThemeState {
  theme: Theme
  /** What is on screen right now, whichever way it was chosen. */
  dark: boolean
  set(theme: Theme): void
}

export const useTheme = create<ThemeState>((set) => ({
  theme: stored(),
  dark: isDark(stored()),
  set: (theme) => {
    // index.html applies the stored choice before the first paint; this keeps the two in step.
    if (theme === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      if (theme === 'auto') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, theme)
    } catch {
      /* storage is off: the choice lasts until the page is closed */
    }
    set({ theme, dark: isDark(theme) })
  },
}))

if (typeof matchMedia === 'function')
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => useTheme.setState((s) => ({ dark: isDark(s.theme) })))
