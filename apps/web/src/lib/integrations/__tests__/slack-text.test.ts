import { describe, expect, it } from 'vitest'
import { escapeSlackText } from '../slack-text'

describe('escapeSlackText', () => {
  it('escapes the three characters Slack treats as markup', () => {
    expect(escapeSlackText('a & b')).toBe('a &amp; b')
    expect(escapeSlackText('a < b')).toBe('a &lt; b')
    expect(escapeSlackText('a > b')).toBe('a &gt; b')
  })

  it('defuses a channel-wide ping hidden in a title', () => {
    // A task called "<!channel>" must not notify the whole workspace.
    expect(escapeSlackText('<!channel>')).toBe('&lt;!channel&gt;')
    expect(escapeSlackText('<!here>')).toBe('&lt;!here&gt;')
    expect(escapeSlackText('<@U123456>')).toBe('&lt;@U123456&gt;')
  })

  it('defuses a disguised link', () => {
    expect(escapeSlackText('<https://evil.example|Click here>')).toBe(
      '&lt;https://evil.example|Click here&gt;',
    )
  })

  it('escapes the ampersand first, so nothing is double-escaped', () => {
    // Replacing < before & would turn "<" into "&amp;lt;".
    expect(escapeSlackText('<')).toBe('&lt;')
    expect(escapeSlackText('&lt;')).toBe('&amp;lt;')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeSlackText('Ada created task "Ship it"')).toBe('Ada created task "Ship it"')
    expect(escapeSlackText('')).toBe('')
  })

  it('does not touch characters Slack does not treat as markup', () => {
    // Over-escaping would make every message unreadable.
    expect(escapeSlackText("it's *bold* _italic_ `code`")).toBe("it's *bold* _italic_ `code`")
  })
})
