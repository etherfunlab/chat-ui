import type { ModelEntry } from '#shared/models'
import type { ThinkingPref } from './store'

/**
 * The thinking setting to use with a model: on by default at the model's
 * default effort; a model that cannot turn thinking off is always on; an
 * effort the model does not offer falls back to its default.
 */
export function thinkingFor(model: ModelEntry, pref: ThinkingPref | null): ThinkingPref {
  const r = model.reasoning
  if (!r.supported) return { enabled: false, effort: null }
  const effort = pref?.effort && r.effortOptions.includes(pref.effort) ? pref.effort : r.defaultEffort
  const enabled = r.canDisable ? (pref?.enabled ?? true) : true
  return { enabled, effort }
}

/** The reasoning_effort to send, or undefined when the model takes none. */
export function reasoningEffortFor(model: ModelEntry, pref: ThinkingPref): string | undefined {
  const r = model.reasoning
  if (!r.supported || r.effortOptions.length === 0) return undefined
  if (!pref.enabled && r.canDisable) return 'none'
  return pref.effort ?? r.defaultEffort ?? undefined
}
