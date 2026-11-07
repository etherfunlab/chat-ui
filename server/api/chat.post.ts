import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { relayChat } from '#server/utils/relay'
import { getRelayDeps } from '#server/utils/relayDeps'
import { clientAbortSignal } from '#server/utils/abort'
import { keepAlive } from '#server/utils/keepAlive'

/** The web client's chat endpoint: session auth, metered relay, usage event on. Stop aborts the upstream; settlement still runs. */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const wallet = await requireWallet(event)
  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const res = await relayChat(getRelayDeps(), {
    auth: { wallet },
    rawBody,
    signal: clientAbortSignal(event),
    emitUsageEvent: true,
    disconnect: 'abort',
    keepAlive: work => keepAlive(event, work),
  })
  return sendWebResponse(event, res)
})
