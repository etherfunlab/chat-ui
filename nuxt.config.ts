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
    // Server code uses BigInt literals for exact money math; match the
    // function runtime instead of esbuild's es2019 default.
    esbuild: { options: { target: 'node24' } },
    // Bump together with engines.node and the CI node version.
    vercel: { functions: { runtime: 'nodejs24.x' } },
  },
})
