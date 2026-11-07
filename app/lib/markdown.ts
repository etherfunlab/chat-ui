import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type { Citation } from '#shared/chat'
import { safeHttpUrl } from '#shared/url'

// html: false — model output is untrusted; raw HTML renders as text.
// markdown-it's link validation refuses javascript:/vbscript:/data: in markdown
// links; citation chips are built by hand below and checked with safeHttpUrl.
// Images are disabled: a remote image loads without a click, so a prompt
// injection could exfiltrate the conversation through its URL.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false }).disable('image')
const esc = md.utils.escapeHtml

const renderToken = md.renderer.renderToken.bind(md.renderer)
md.renderer.rules.link_open = (tokens, idx, options) => {
  tokens[idx]!.attrSet('target', '_blank')
  tokens[idx]!.attrSet('rel', 'noopener noreferrer')
  return renderToken(tokens, idx, options)
}

md.renderer.rules.fence = (tokens, idx, _options, env: { labels?: { copy: string } }) => {
  const t = tokens[idx]!
  const lang = t.info.trim().split(/\s+/)[0] || 'text'
  const copy = env.labels?.copy ?? 'Copy'
  return `<div class="code-block"><div class="code-head"><span>${esc(lang)}</span>`
    + `<button type="button" class="code-copy" data-copy>${esc(copy)}</button></div>`
    + `<pre><code>${esc(t.content)}</code></pre></div>`
}

const MARKER = /\^(\d+(?:\s*,\s*\d+)*)\^/g

function chip(n: number, c: Citation): string {
  return `<a class="cite" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" title="${esc(c.title)}">${n}</a>`
}

// Citation markers (^1^, ^1,2^) in prose become numbered links. Only plain
// text tokens are touched, so code spans and fences keep markers verbatim;
// an out-of-range marker stays as written.
md.core.ruler.push('citations', (state) => {
  const citations = (state.env as { citations?: Citation[] }).citations ?? []
  if (citations.length === 0) return
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue
    const out: Token[] = []
    for (const tok of block.children) {
      if (tok.type !== 'text' || !tok.content.includes('^')) {
        out.push(tok)
        continue
      }
      let last = 0
      const pieces: Token[] = []
      for (const m of tok.content.matchAll(MARKER)) {
        const nums = m[1]!.split(',').map(s => Number(s.trim()))
        if (nums.some(n => n < 1 || n > citations.length || !safeHttpUrl(citations[n - 1]!.url))) continue
        if (m.index! > last) {
          const text = new state.Token('text', '', 0)
          text.content = tok.content.slice(last, m.index)
          pieces.push(text)
        }
        const html = new state.Token('html_inline', '', 0)
        html.content = nums.map(n => chip(n, citations[n - 1]!)).join('')
        pieces.push(html)
        last = m.index! + m[0].length
      }
      if (pieces.length === 0) {
        out.push(tok)
        continue
      }
      if (last < tok.content.length) {
        const text = new state.Token('text', '', 0)
        text.content = tok.content.slice(last)
        pieces.push(text)
      }
      out.push(...pieces)
    }
    block.children = out
  }
})

/** Renders an answer to safe HTML: no raw HTML, safe links, code blocks with a copy button, citation links. */
export function renderMarkdown(text: string, citations: Citation[], labels: { copy: string } = { copy: 'Copy' }): string {
  return md.render(text, { citations, labels })
}
