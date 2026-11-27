import type { H3Event } from 'h3'
import { waitUntil } from '@vercel/functions'

/**
 * Lets server-side work outlive the response. With supportsCancellation on,
 * Vercel terminates a function the moment the client disconnects, and only
 * work registered with waitUntil survives: the upstream read and the ledger
 * settlement must be, or a hang-up would leave the hold open and the
 * answer unbilled. Elsewhere this is a no-op.
 */
export function keepAlive(event: H3Event, work: Promise<unknown>): void {
  event.waitUntil(work)
  waitUntil(work)
}
