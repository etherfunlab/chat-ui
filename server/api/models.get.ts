import { getCatalog } from '#server/utils/catalog'

/** The offered models with capabilities and prices, in display order. */
export default defineEventHandler(async () => {
  try {
    return { models: await getCatalog().list() }
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Model list unavailable' })
  }
})
