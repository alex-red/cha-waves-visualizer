export default defineNuxtConfig({
  compatibilityDate: '2026-10-14',
  devtools: { enabled: false },
  nitro: {
    preset: 'static',
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
})
