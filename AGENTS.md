<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Korean language quality

Workspace-wide rules live in `~/.claude/CLAUDE.md` (= `~/.codex/AGENTS.md` =
`~/.gemini/GEMINI.md`). `CLAUDE.md` and `GEMINI.md` here point at this file.

- Korean interface strings are checked with `~/dev/korean-language-quality`:
  `node ~/dev/korean-language-quality/bin/kolint.mjs .`. `.kolintrc.json` sets
  the genre to `ux`. The check is advisory tooling; it is not in the build.
- **Do not add a rewriting or "humanising" pass to the translation path.**
  Counter and Live output is produced under a latency budget, and a second model
  call spends that budget re-styling text whose meaning is already guarded
  deterministically by `src/counter/integrity.ts`. Style guidance, where it is
  wanted, belongs in `src/counter/prompt.ts` — in the call that is already being
  made.
- `src/counter/integrity.ts` and `src/counter/domain-vocabulary.ts` are the
  reference implementation of critical-value preservation for this workspace;
  `~/dev/korean-language-quality/js/protect.mjs` follows their approach. If the
  residence-status list or the immigration glossary changes here, check whether
  `rules/lexicon.json` there needs the same change.
