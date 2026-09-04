/**
 * Slack text escaping.
 *
 * Split out from `slack.ts` so it can be tested: that module is `server-only`
 * and therefore unimportable from vitest. This function is the reason a task
 * title cannot become a workspace-wide ping, so it is the part that most needs
 * tests.
 */

/**
 * Escape the three characters Slack treats as markup.
 *
 * Slack's own guidance: escape `&`, `<` and `>` and nothing else — the rest of
 * its formatting is driven by those. A task titled `<!channel>` would otherwise
 * notify everyone in the workspace, and `<https://evil.example|Click here>`
 * would render as a disguised link.
 *
 * The ampersand must be replaced FIRST, or the ampersands introduced by the
 * later replacements get escaped a second time.
 */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
