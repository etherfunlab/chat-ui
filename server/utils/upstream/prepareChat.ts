import type { ModelEntry } from '#shared/models'
import type { Prepared } from './protocol'
import { bad, checkImageCount, findModel, isObj, positiveInt, validEffort, veniceParameters, type Obj } from './validate'

/** Fields forwarded to the upstream; everything else is dropped. */
const ALLOWED = [
  'model', 'messages', 'stream', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p',
  'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'n', 'reasoning_effort', 'reasoning',
  'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'prompt_cache_key', 'prompt_cache_retention',
] as const

const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool'])

function countImages(messages: Obj[]): number {
  let n = 0
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    for (const part of m.content) if (isObj(part) && part.type === 'image_url') n++
  }
  return n
}

/**
 * Validates an OpenAI chat-completions request against the model catalog and
 * reshapes it for the upstream: allow-listed fields only, Venice's own system
 * prompt off, web search limited to on/off/auto, reasoning effort checked
 * against what the model offers, and usage forced into streams for metering.
 */
export function prepareChat(body: unknown, models: ModelEntry[]): Prepared {
  if (!isObj(body)) throw bad('Request body must be a JSON object')
  const model = findModel(body, models)

  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0) throw bad('messages must be a non-empty array')
  for (const m of messages) {
    if (!isObj(m) || typeof m.role !== 'string' || !ROLES.has(m.role)) throw bad('Each message needs a valid role')
  }
  if (body.n !== undefined && body.n !== 1) throw bad('Only n = 1 is supported')
  checkImageCount(countImages(messages as Obj[]), model)

  const upstreamBody: Obj = {}
  for (const k of ALLOWED) if (body[k] !== undefined) upstreamBody[k] = body[k]

  // Reasoning effort: one field upstream, validated against the model.
  const effort = validEffort(model, body.reasoning_effort ?? (isObj(body.reasoning) ? body.reasoning.effort : undefined))
  delete upstreamBody.reasoning
  delete upstreamBody.reasoning_effort
  if (effort !== undefined) upstreamBody.reasoning_effort = effort

  const { params, webSearch } = veniceParameters(model, body.venice_parameters)
  upstreamBody.venice_parameters = params

  const stream = body.stream === true
  const clientWantsUsage = stream && isObj(body.stream_options) && body.stream_options.include_usage === true
  if (stream) upstreamBody.stream_options = { include_usage: true }

  const asked = positiveInt(body.max_completion_tokens, 'max_completion_tokens')
    ?? positiveInt(body.max_tokens, 'max_tokens')
    ?? model.maxOutputTokens
  delete upstreamBody.max_tokens

  return {
    model,
    upstreamBody,
    stream,
    clientWantsUsage,
    requestedMaxOut: Math.min(asked, model.maxOutputTokens),
    webSearch,
  }
}
