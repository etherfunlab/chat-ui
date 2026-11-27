import { prepareChat } from './prepareChat'
import type { Protocol } from './protocol'
import { citationsFromChat, reportedCostMicro, usageFromChat } from './usage'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null

function outputText(payload: unknown): string {
  if (!isObj(payload) || !Array.isArray(payload.choices)) return ''
  let s = ''
  for (const c of payload.choices) {
    if (!isObj(c)) continue
    const part = isObj(c.delta) ? c.delta : isObj(c.message) ? c.message : null
    if (!part) continue
    if (typeof part.content === 'string') s += part.content
    if (typeof part.reasoning_content === 'string') s += part.reasoning_content
    if (Array.isArray(part.tool_calls)) {
      for (const t of part.tool_calls) {
        if (isObj(t) && isObj(t.function) && typeof t.function.arguments === 'string') s += t.function.arguments
      }
    }
  }
  return s
}

function hasFinishReason(payload: unknown): boolean {
  return isObj(payload) && Array.isArray(payload.choices)
    && payload.choices.some(c => isObj(c) && typeof c.finish_reason === 'string' && c.finish_reason !== '')
}

/** OpenAI chat completions, as served by the upstream. */
export const chatProtocol: Protocol = {
  endpoint: 'chat',
  upstreamPath: '/chat/completions',
  prepare: prepareChat,
  setMaxOutput: (body, n) => { body.max_completion_tokens = n },
  usage: usageFromChat,
  reportedCost: reportedCostMicro,
  citations: citationsFromChat,
  outputText,
  end: payload => (hasFinishReason(payload) ? 'ok' : 'none'),
  isUsageOnly: payload =>
    isObj(payload) && isObj(payload.usage) && (!Array.isArray(payload.choices) || payload.choices.length === 0),
}
