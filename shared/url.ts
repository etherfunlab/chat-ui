/**
 * The URL itself when it is an absolute http(s) URL, else null. Anything a
 * model, a search result or an imported file supplies goes through this
 * before it can become an href or an image source: `javascript:` and `data:`
 * URLs in a link are script execution in this origin.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}
