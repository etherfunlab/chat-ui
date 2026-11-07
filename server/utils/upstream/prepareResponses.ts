import type { ModelEntry } from '#shared/models'
import type { Prepared } from './protocol'
import { bad, checkImageCount, findModel, isObj, positiveInt, validEffort, veniceParameters, type Obj } from './validate'

/** Fields forwarded to the upstream; everything else is dropped. */
const ALLOWED = [
  'model', 'input', 'instructions', 'stream', 'max_output_tokens', 'temperature', 'top_p', 'reasoning',
  'tools', 'tool_choice', 'parallel_tool_calls', 'max_tool_calls', 'text', 'include', 'truncation',
  'prompt_cache_key', 'prompt_cache_retention',
] as const

/** State the upstream does not keep: a client sends the full `input` every turn. */
const UNSUPPORTED = ['previous_response_id', 'background', 'conversation'] as const

/** Tool types this relay can meter: the client's own, and web search (billed as search). Hosted tools run outside metering. */
const isSearchTool = (type: string) => type.startsWith('web_search')
const TOOL_TYPES = new Set(['function', 'custom'])

function countImages(input: unknown): number {
  if (!Array.isArray(input)) return 0
  let n = 0
  for (const item of input) {
    if (!isObj(item) || !Array.isArray(item.content)) continue
    for (const part of item.content) if (isObj(part) && part.type === 'input_image') n++
  }
  return n
}

/** Validates the tool list; returns it without search tools when the model cannot search. */
function checkTools(tools: unknown, model: ModelEntry): { tools: Obj[] | undefined, search: boolean } {
  if (tools === undefined) return { tools: undefined, search: false }
  if (!Array.isArray(tools)) throw bad('tools must be an array')
  let search = false
  const kept: Obj[] = []
  for (const t of tools) {
    const type = isObj(t) && typeof t.type === 'string' ? t.type : ''
    if (isSearchTool(type)) {
      if (model.webSearch) {
        search = true
        kept.push(t as Obj)
      }
      continue
    }
    if (!TOOL_TYPES.has(type)) throw bad(`Unsupported tool type: ${type || '(missing)'}`, 'unsupported_parameter')
    kept.push(t as Obj)
  }
  return { tools: kept, search }
}

/**
 * Validates an OpenAI Responses request and reshapes it for the upstream:
 * allow-listed fields, stateless only (`store: false`, no
 * `previous_response_id`), Venice's own system prompt off, web search
 * limited to on/off/auto, reasoning effort checked against the model.
 */
export function prepareResponses(body: unknown, models: ModelEntry[]): Prepared {
  if (!isObj(body)) throw bad('Request body must be a JSON object')
  const model = findModel(body, models)

  for (const k of UNSUPPORTED) {
    if (body[k] !== undefined && body[k] !== null) {
      throw bad(`${k} is not supported: this endpoint keeps no state, send the full input each turn`, 'unsupported_parameter')
    }
  }
  const input = body.input
  if (!((typeof input === 'string' && input.length > 0) || (Array.isArray(input) && input.length > 0))) {
    throw bad('input must be a non-empty string or array')
  }
  checkImageCount(countImages(input), model)

  const upstreamBody: Obj = {}
  for (const k of ALLOWED) if (body[k] !== undefined) upstreamBody[k] = body[k]
  upstreamBody.store = false
  const { tools, search } = checkTools(body.tools, model)
  if (tools !== undefined) upstreamBody.tools = tools
  // A choice of a search tool the model cannot use would name a tool no longer in the list.
  if (!search && isObj(body.tool_choice) && typeof body.tool_choice.type === 'string' && isSearchTool(body.tool_choice.type)) {
    delete upstreamBody.tool_choice
  }

  if (body.reasoning !== undefined && body.reasoning !== null) {
    if (!isObj(body.reasoning)) throw bad('reasoning must be an object')
    const { effort, ...rest } = body.reasoning
    const valid = validEffort(model, effort)
    upstreamBody.reasoning = valid !== undefined ? { ...rest, effort: valid } : rest
  } else {
    delete upstreamBody.reasoning
  }

  const { params, webSearch } = veniceParameters(model, body.venice_parameters, search)
  upstreamBody.venice_parameters = params

  const asked = positiveInt(body.max_output_tokens, 'max_output_tokens') ?? model.maxOutputTokens

  return {
    model,
    upstreamBody,
    stream: body.stream === true,
    clientWantsUsage: true,
    requestedMaxOut: Math.min(asked, model.maxOutputTokens),
    webSearch,
  }
}
