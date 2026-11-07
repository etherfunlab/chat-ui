import { ref } from 'vue'
import type { ApiKeyRow } from '#server/utils/apiKeys'

export type { ApiKeyRow }

/** Server error codes the panel can phrase; anything else is a generic failure. */
const KNOWN_ERRORS: Record<string, string> = {
  too_many_keys: 'settings.tooManyKeys',
  invalid_key_name: 'settings.invalidKeyName',
}

function errorKey(err: unknown): string {
  const e = err as { data?: { statusMessage?: string }, statusMessage?: string }
  const code = e?.data?.statusMessage ?? e?.statusMessage ?? ''
  return KNOWN_ERRORS[code] ?? 'settings.keyFailed'
}

/** The signed-in wallet's API keys. `create` returns the plaintext, which exists nowhere else. */
export function useApiKeys() {
  const keys = ref<ApiKeyRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      keys.value = (await $fetch<{ keys: ApiKeyRow[] }>('/api/keys')).keys
      error.value = null
    } catch (e) {
      error.value = errorKey(e)
    } finally {
      loading.value = false
    }
  }

  async function create(name: string): Promise<string | null> {
    loading.value = true
    try {
      const { key } = await $fetch<{ key: string, row: ApiKeyRow }>('/api/keys', { method: 'POST', body: { name } })
      error.value = null
      await refresh()
      return key
    } catch (e) {
      error.value = errorKey(e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function revoke(id: string): Promise<void> {
    loading.value = true
    try {
      await $fetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
      error.value = null
      await refresh()
    } catch (e) {
      error.value = errorKey(e)
    } finally {
      loading.value = false
    }
  }

  return { keys, loading, error, refresh, create, revoke }
}
