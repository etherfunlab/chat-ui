import { assertSameOrigin } from '#server/utils/sameOrigin'
import { useAppSession } from '#server/utils/session'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const session = await useAppSession(event)
  await session.clear()
  return { ok: true }
})
