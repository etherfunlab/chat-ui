import type { ModelEntry } from '#shared/models'
import { RelayError } from './errors'

export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
export const bad = (message: string, code = 'invalid_request') => new RelayError(400, code, message)

export function findModel(body: Obj, models: ModelEntry[]): ModelEntry {
  const model = models.find(m => m.id === body.model)
  if (!model) {
    throw bad(`Unknown model: ${typeof body.model === 'string' ? body.model : '(not a string)'}`, 'model_not_found')
  }
  return model
}

export function positiveInt(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw bad(`${name} must be a positive integer`)
  return v
}

export function checkImageCount(images: number, model: ModelEntry): void {
  if (images > 0 && !model.vision) throw bad(`${model.name} does not accept images`, 'model_not_vision')
  if (images > model.maxImages) throw bad(`${model.name} accepts at most ${model.maxImages} images`, 'too_many_images')
}

/**
 * A reasoning effort the model accepts, or undefined when the model has no
 * effort control (the field is then dropped rather than rejected).
 */
export function validEffort(model: ModelEntry, effort: unknown): string | undefined {
  if (effort === undefined || model.reasoning.effortOptions.length === 0) return undefined
  const allowed = [...model.reasoning.effortOptions, ...(model.reasoning.canDisable ? ['none'] : [])]
  if (typeof effort !== 'string' || !allowed.includes(effort)) {
    throw bad(`reasoning_effort for ${model.name} must be one of: ${allowed.join(', ')}`, 'invalid_reasoning_effort')
  }
  return effort
}

export type WebSearch = 'on' | 'auto' | 'off'

/** The upstream's venice_parameters: never its system prompt, only the web search knobs. */
export function veniceParameters(model: ModelEntry, vp: unknown, forceOn = false): { params: Obj, webSearch: WebSearch } {
  const given = isObj(vp) ? vp : {}
  const requested = given.enable_web_search
  const webSearch: WebSearch = !model.webSearch
    ? 'off'
    : forceOn || requested === 'on' ? 'on' : requested === 'auto' ? 'auto' : 'off'
  return {
    params: {
      include_venice_system_prompt: false,
      enable_web_search: webSearch,
      ...(typeof given.enable_web_citations === 'boolean' ? { enable_web_citations: given.enable_web_citations } : {}),
    },
    webSearch,
  }
}
