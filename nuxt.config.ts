import tailwindcss from '@tailwindcss/vite'

// Applies the stored theme before first paint, so a night user never sees a
// white flash. Mirrors useTheme(): 'light' / 'dark' are explicit, absent = system.
const THEME_BOOT = `(function(){try{var p=localStorage.getItem('cu-theme');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`

export default defineNuxtConfig({
  compatibilityDate: '2026-10-30',
  modules: ['@pinia/nuxt', '@nuxt/fonts', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      script: [{ innerHTML: THEME_BOOT, tagPosition: 'head' }],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  fonts: {
    // DESIGN.md §3: Inter 500 / 600 / 700 only, self-hosted.
    families: [{ name: 'Inter', provider: 'google', weights: [500, 600, 700] }],
  },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [{ code: 'en', language: 'en-US', file: 'en.ts' }],
    detectBrowserLanguage: { useCookie: true, cookieKey: 'cu_locale' },
    bundle: { optimizeTranslationDirective: false },
  },
  nitro: {
    // @solana/web3.js's ESM build does a directory import from 'jayson' that
    // bundlers resolve but Node native ESM rejects at runtime. Inlining jayson
    // lets Rollup resolve it at build time.
    externals: {
      inline: ['jayson'],
    },
    // Server code uses BigInt literals for exact money math; match the
    // function runtime instead of esbuild's es2019 default.
    esbuild: { options: { target: 'node24' } },
    // Bump together with engines.node and the CI node version. maxDuration
    // covers the relay's 10-minute cap on a single streamed answer.
    vercel: { functions: { runtime: 'nodejs24.x', maxDuration: 800 } },
  },
})
