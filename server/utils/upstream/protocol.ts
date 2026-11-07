import type { Usage } from '#shared/billing'
import type { Citation } from '#shared/chat'
import type { ModelEntry } from '#shared/models'

/** A validated request, reshaped for the upstream, plus what the relay needs to meter it. */
export interface Prepared {
  model: ModelEntry
  upstreamBody: Record<string, unknown>
  stream: boolean
  /** Whether usage-only payloads are forwarded to the client (chat: only when it asked). */
  clientWantsUsage: boolean
  requestedMaxOut: number
  webSearch: 'on' | 'auto' | 'off'
}

/** What a payload says about the end of the answer. */
export type StreamEnd = 'none' | 'ok' | 'failed'

/**
 * The protocol-specific half of the relay: how to validate a request and
 * how to read usage, cost, citations, output and completion out of what the
 * upstream sends back. The metering loop in relay.ts is the same for all.
 */
export interface Protocol {
  endpoint: 'chat' | 'responses'
  upstreamPath: '/chat/completions' | '/responses'
  prepare(body: unknown, models: ModelEntry[]): Prepared
  /** Writes the output cap into the upstream body (its field name differs per protocol). */
  setMaxOutput(body: Record<string, unknown>, n: number): void
  usage(payload: unknown): Usage | null
  reportedCost(payload: unknown): number | null
  citations(payload: unknown): Citation[]
  /** Text the model produced, kept in memory only to estimate output tokens. */
  outputText(payload: unknown): string
  end(payload: unknown): StreamEnd
  /** A payload carrying nothing but usage (chat's final chunk). */
  isUsageOnly(payload: unknown): boolean
}
