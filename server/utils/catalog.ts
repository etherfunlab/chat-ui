import type { ModelEntry, PriceTier, Pricing } from '#shared/models'
import { getServerConfig } from './config'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const usd = (v: unknown): number | undefined => (isObj(v) ? num(v.usd) : undefined)

function toTier(p: Obj): PriceTier | null {
  const input = usd(p.input)
  const output = usd(p.output)
  if (input === undefined || output === undefined) return null
  const tier: PriceTier = { input, output }
  const cacheInput = usd(p.cache_input)
  const cacheWrite = usd(p.cache_write)
  if (cacheInput !== undefined) tier.cacheInput = cacheInput
  if (cacheWrite !== undefined) tier.cacheWrite = cacheWrite
  return tier
}

/** Maps one entry of Venice GET /models to a ModelEntry; null when malformed. */
export function toModelEntry(raw: unknown): ModelEntry | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !isObj(raw.model_spec)) return null
  const spec = raw.model_spec
  if (!isObj(spec.pricing)) return null
  const base = toTier(spec.pricing)
  if (!base) return null

  const pricing: Pricing = { ...base }
  const ext = spec.pricing.extended
  if (isObj(ext)) {
    const tier = toTier(ext)
    const threshold = num(ext.context_token_threshold)
    if (tier && threshold !== undefined) pricing.extended = { threshold, ...tier }
  }

  const caps = isObj(spec.capabilities) ? spec.capabilities : {}
  const vision = caps.supportsVision === true
  const rawOptions = caps.supportsReasoningEffort === true && Array.isArray(caps.reasoningEffortOptions)
    ? caps.reasoningEffortOptions.filter((o): o is string => typeof o === 'string')
    : []
  const effortOptions = rawOptions.filter(o => o !== 'none')
  let defaultEffort: string | null = null
  if (effortOptions.length) {
    const d = caps.defaultReasoningEffort
    defaultEffort = typeof d === 'string' && effortOptions.includes(d) ? d : effortOptions[0]!
  }

  return {
    id: raw.id,
    name: typeof spec.name === 'string' ? spec.name : raw.id,
    contextTokens: num(spec.availableContextTokens) ?? 0,
    maxOutputTokens: num(spec.maxCompletionTokens) ?? 0,
    pricing,
    vision,
    maxImages: !vision ? 0 : caps.supportsMultipleImages === true ? (num(caps.maxImages) ?? 1) : 1,
    reasoning: {
      supported: caps.supportsReasoning === true,
      effortOptions,
      defaultEffort,
      canDisable: rawOptions.includes('none'),
    },
    webSearch: caps.supportsWebSearch === true,
  }
}

export interface Catalog {
  list: () => Promise<ModelEntry[]>
  get: (id: string) => Promise<ModelEntry | undefined>
}

/**
 * Upstream models in configured order, cached in-process. A failed refresh
 * keeps serving the last good list; only a catalog that never loaded throws.
 */
export function createCatalog(o: {
  fetchModels: () => Promise<unknown>
  modelIds: string[]
  ttlMs?: number
  now?: () => number
}): Catalog {
  const ttl = o.ttlMs ?? 10 * 60 * 1000
  const now = o.now ?? Date.now
  let cached: ModelEntry[] | undefined
  let loadedAt = 0

  async function list(): Promise<ModelEntry[]> {
    if (cached && now() - loadedAt < ttl) return cached
    try {
      const body = await o.fetchModels()
      const data = isObj(body) && Array.isArray(body.data) ? body.data : []
      const byId = new Map<string, ModelEntry>()
      for (const item of data) {
        const entry = toModelEntry(item)
        if (entry) byId.set(entry.id, entry)
      }
      cached = o.modelIds.map(id => byId.get(id)).filter((m): m is ModelEntry => m !== undefined)
      loadedAt = now()
    } catch (err) {
      if (!cached) throw new Error(`model catalog unavailable: ${(err as Error).message}`)
    }
    return cached!
  }

  return {
    list,
    get: async id => (await list()).find(m => m.id === id),
  }
}

let singleton: Catalog | undefined

export function getCatalog(): Catalog {
  if (!singleton) {
    const config = getServerConfig()
    singleton = createCatalog({
      modelIds: config.models,
      fetchModels: async () => {
        const res = await fetch(`${config.veniceBaseUrl}/models?type=text`, {
          headers: { Authorization: `Bearer ${config.veniceApiKey}` },
        })
        if (!res.ok) throw new Error(`upstream /models returned ${res.status}`)
        return res.json()
      },
    })
  }
  return singleton
}
