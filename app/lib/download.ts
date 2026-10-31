/**
 * Saves data as a JSON file. The object URL is revoked only after a delay:
 * revoking right after click() can cancel the download in some browsers,
 * including the in-wallet browsers where export is the only backup.
 */
export function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
