// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { downloadJson } from './download'

describe('downloadJson', () => {
  it('revokes the object URL only after the download had time to start', () => {
    vi.useFakeTimers()
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    downloadJson('chats.json', { a: 1 })
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(revoke).toHaveBeenCalledWith('blob:x')
    vi.useRealTimers()
  })
})
