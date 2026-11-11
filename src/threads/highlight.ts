/** The close mark, drawn: one stroke weight wherever it appears. */
export const ICON_CLOSE = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>'

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const KEYWORDS =
  'package|import|class|data|fun|val|var|private|public|protected|internal|return|require|interface|object|enum|record|static|final|abstract|override|void|new|if|else|for|while|do|when|switch|case|try|catch|finally|throw|throws|extends|implements|this|super|null|true|false|in|is|as|suspend|companion|boolean|int|long|double'
// Runs on escaped text, so a string literal is &quot;...&quot;.
const HL = new RegExp('(&quot;(?:[^&]|&(?!quot;))*&quot;)|(@\\w+)|\\b(' + KEYWORDS + ')\\b', 'g')

/** Escapes a stretch of Kotlin or Java and wraps strings, annotations and keywords in spans. */
export function highlight(code: string): string {
  return esc(code).replace(HL, (m, str, ann) => (str ? '<span class="s">' + m + '</span>' : ann ? '<span class="a">' + m + '</span>' : '<span class="k">' + m + '</span>'))
}
