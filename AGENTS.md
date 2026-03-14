# AGENTS.md

## AI Collaboration

- Codex can consult the local `claude-code` MCP server, which is backed by `claude mcp serve`.
- Use `claude-code` for a second opinion on non-trivial architecture, risky refactors, edge cases, review, or alternative implementations.
- For code generation, prefer asking Claude for a focused patch plan, diff, or snippet. Codex should still own the final file edits and validation.
- Do not use `claude-code` for small deterministic edits, rote searches, or when a single-model answer is clearly sufficient.
- Keep prompts narrow: include exact file paths, constraints, and the concrete question to answer.
- Validate Claude suggestions locally before applying them.
