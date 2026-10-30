/** Metered usage of one upstream request. Never carries content. */
export interface Usage {
  /** Total prompt tokens, including cached reads and cache writes. */
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  /** Total completion tokens, including reasoning tokens. */
  outputTokens: number
  reasoningTokens: number
  webSearch: boolean
}

export const ZERO_USAGE: Usage = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  webSearch: false,
})
