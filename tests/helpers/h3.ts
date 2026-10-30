import { vi } from 'vitest'

/**
 * Stubs the Nitro auto-imported h3 helpers that handlers call, so a handler
 * module can be imported and invoked directly with a fake event
 * `{ _body: … }`. Call before importing the handler.
 */
export function stubH3Globals(): void {
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  vi.stubGlobal('readBody', (event: { _body: unknown }) => event._body)
  vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))
}

export const evt = (body?: unknown) => ({ _body: body }) as never
