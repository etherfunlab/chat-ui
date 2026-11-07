import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { relayChat } from '#server/utils/relay'
import { getRelayDeps } from '#server/utils/relayDeps'
import { clientAbortSignal } from '#server/utils/abort'

/** The web client's chat endpoint: session auth, metered relay, usage event on. */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const wallet = await requireWallet(event)
  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const res = await relayChat(getRelayDeps(), {
    auth: { wallet },
    rawBody,
    signal: clientAbortSignal(event),
    emitUsageEvent: true,
  })
  return sendWebResponse(event, res)
})
