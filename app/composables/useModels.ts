import type { ModelEntry } from '#shared/models'

/** The offered models (GET /api/models), fetched once per page. */
export function useModels() {
  const models = useState<ModelEntry[]>('models', () => [])
  const error = useState<boolean>('models-error', () => false)

  async function load(): Promise<void> {
    if (models.value.length) return
    try {
      models.value = (await $fetch<{ models: ModelEntry[] }>('/api/models')).models
      error.value = false
    } catch {
      error.value = true
    }
  }

  const byId = (id: string | undefined) => models.value.find(m => m.id === id)
  return { models, error, load, byId }
}
