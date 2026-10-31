import type { ModelEntry } from '#shared/models'
import { RelayError } from './errors'

export interface PreparedChat {
  model: ModelEntry
  upstreamBody: Record<string, unknown>
  stream: boolean
  /** Whether the client itself asked for the usage chunk in the stream. */
  clientWantsUsage: boolean
  requestedMaxOut: number
  webSearch: 'on' | 'auto' | 'off'
}

/** Fields forwarded to the upstream; everything else is dropped. */
const ALLOWED = [
  'model', 'messages', 'stream', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p',
  'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'n', 'reasoning_effort', 'reasoning',
  'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'prompt_cache_key', 'prompt_cache_retention',
] as const

const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool'])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const bad = (message: string, code = 'invalid_request') => new RelayError(400, code, message)

function countImages(messages: Obj[]): number {
  let n = 0
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    for (const part of m.content) if (isObj(part) && part.type === 'image_url') n++
  }
  return n
}

function positiveInt(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw bad(`${name} must be a positive integer`)
  return v
}

/**
 * Validates an OpenAI chat-completions request against the model catalog and
 * reshapes it for the upstream: allow-listed fields only, Venice's own system
 * prompt off, web search limited to on/off/auto, reasoning effort checked
 * against what the model offers, and usage forced into streams for metering.
 */
export function prepareChat(body: unknown, models: ModelEntry[]): PreparedChat {
  if (!isObj(body)) throw bad('Request body must be a JSON object')
  const model = models.find(m => m.id === body.model)
  if (!model) {
    throw bad(`Unknown model: ${typeof body.model === 'string' ? body.model : '(not a string)'}`, 'model_not_found')
  }

  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0) throw bad('messages must be a non-empty array')
  for (const m of messages) {
    if (!isObj(m) || typeof m.role !== 'string' || !ROLES.has(m.role)) throw bad('Each message needs a valid role')
  }
  if (body.n !== undefined && body.n !== 1) throw bad('Only n = 1 is supported')

  const images = countImages(messages as Obj[])
  if (images > 0 && !model.vision) throw bad(`${model.name} does not accept images`, 'model_not_vision')
  if (images > model.maxImages) throw bad(`${model.name} accepts at most ${model.maxImages} images`, 'too_many_images')

  const upstreamBody: Obj = {}
  for (const k of ALLOWED) if (body[k] !== undefined) upstreamBody[k] = body[k]

  // Reasoning effort: one field upstream, validated against the model.
  const effort = body.reasoning_effort ?? (isObj(body.reasoning) ? body.reasoning.effort : undefined)
  delete upstreamBody.reasoning
  delete upstreamBody.reasoning_effort
  if (effort !== undefined && model.reasoning.effortOptions.length > 0) {
    const allowed = [...model.reasoning.effortOptions, ...(model.reasoning.canDisable ? ['none'] : [])]
    if (typeof effort !== 'string' || !allowed.includes(effort)) {
      throw bad(`reasoning_effort for ${model.name} must be one of: ${allowed.join(', ')}`, 'invalid_reasoning_effort')
    }
    upstreamBody.reasoning_effort = effort
  }

  const vp = isObj(body.venice_parameters) ? body.venice_parameters : {}
  const requested = vp.enable_web_search
  const webSearch: PreparedChat['webSearch'] = !model.webSearch
    ? 'off'
    : requested === 'on' || requested === 'auto' ? requested : 'off'
  upstreamBody.venice_parameters = {
    include_venice_system_prompt: false,
    enable_web_search: webSearch,
    ...(typeof vp.enable_web_citations === 'boolean' ? { enable_web_citations: vp.enable_web_citations } : {}),
  }

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
