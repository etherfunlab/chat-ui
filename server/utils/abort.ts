import type { H3Event } from 'h3'

/** Aborts when the client disconnects before the response finished. */
export function clientAbortSignal(event: H3Event): AbortSignal {
  const ac = new AbortController()
  const res = event.node.res
  res.once('close', () => {
    if (!res.writableFinished) ac.abort()
  })
  return ac.signal
}
