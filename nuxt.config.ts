import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-30',
  modules: ['@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  nitro: {
    // @solana/web3.js's ESM build does a directory import from 'jayson' that
    // bundlers resolve but Node native ESM rejects at runtime. Inlining jayson
    // lets Rollup resolve it at build time.
    externals: {
      inline: ['jayson'],
    },
    // Bump together with engines.node and the CI node version.
    vercel: { functions: { runtime: 'nodejs24.x' } },
  },
})
