export type ThemePref = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'cu-theme'

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Theme preference (system / light / dark), applied as `.dark` on <html>. */
export function useTheme() {
  const pref = useState<ThemePref>('theme-pref', () => 'system')

  function apply(): void {
    if (import.meta.server) return
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', resolveTheme(pref.value, systemDark) === 'dark')
  }

  function setPref(p: ThemePref): void {
    pref.value = p
    try {
      if (p === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, p)
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
    apply()
  }

  onMounted(() => {
    pref.value = readPref()
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => { if (pref.value === 'system') apply() }
    mq.addEventListener('change', onChange)
    onBeforeUnmount(() => mq.removeEventListener('change', onChange))
  })

  return { pref, setPref }
}
