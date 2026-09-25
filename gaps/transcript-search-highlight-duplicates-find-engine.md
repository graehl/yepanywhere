# Transcript search landing re-implements the viewer find matcher

`packages/client/src/hooks/useSearchMatchHighlight.ts` (`findVisibleMatch`)
walks a transcript row's text nodes, escapes the query, lets whitespace match
any whitespace, and maps the match back to a `Range`. The viewer find engine,
`packages/shared/src/find/documentFind.ts`, does the same with more care: it
lowercases without shifting offsets, keeps matches within one block, and skips
hidden text.

The two differ in case handling. Transcript search takes an explicit
case-sensitivity flag, while viewer find is smart-case. Both should share one
matcher that takes the case mode as a parameter.

Not unified when viewer find landed because changing the transcript search
landing needs its own verification pass over the search UI.

Found 2026-09-25 while adding find to the artifact and file viewers.
