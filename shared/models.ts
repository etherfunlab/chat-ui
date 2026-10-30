/** Upstream prices in USD per 1M tokens (equivalently: micro-USD per token). */
export interface PriceTier {
  input: number
  output: number
  cacheInput?: number
  cacheWrite?: number
}

export interface Pricing extends PriceTier {
  /** Long-context tier: applies to the whole request once input exceeds threshold. */
  extended?: PriceTier & { threshold: number }
}

export interface ModelEntry {
  id: string
  name: string
  contextTokens: number
  maxOutputTokens: number
  pricing: Pricing
  vision: boolean
  /** Images allowed per request; 0 when the model has no vision. */
  maxImages: number
  reasoning: {
    supported: boolean
    /** Selectable effort levels, never including 'none'. */
    effortOptions: string[]
    defaultEffort: string | null
    /** Thinking can be turned off (upstream offers 'none'). */
    canDisable: boolean
  }
  webSearch: boolean
}
