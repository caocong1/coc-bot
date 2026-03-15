# AGENTS.md

This file provides repository-specific guidance to Codex when working in this project.

## What This Repo Is

A QQ bot platform for Call of Cthulhu (CoC) TRPG. It connects to QQ via NapCat/OneBot and provides dice commands, AI-powered Keeper sessions, a knowledge/RAG pipeline for rulebooks and scenarios, and a SolidJS web console for admin and player management.

## Core Working Rules

- Runtime is Bun. Use Bun commands for project tasks. Do not switch project scripts to npm or plain node.
- After code changes, run `bun tsc --noEmit`.
- There is no real test suite in this repo. Type-checking is the minimum verification bar unless the task requires more.
- Exclude runtime artifacts from commits, especially files like `data/bot.pid`.
- If the user asks for a commit, update versioning and changelog entries as part of that workflow.

## Commands

```bash
bun install
bun run dev
bun tsc --noEmit

bun run web:dev
bun run web:build

bun run import-pdfs
bun run build-indexes
bun run build-indexes:all

bun run migrate
```

## Architecture

### Message Flow

```text
QQ Message -> NapCatTransport -> NapCatEventNormalizer -> CommandParser
  -> command path: CommandRegistry -> handler.handle() -> response
  -> campaign path: CampaignHandler -> KPPipeline -> DashScope AI -> response
```

### Key Modules

- `src/server/index.ts`: entry point. Starts the HTTP server, connects NapCat WebSocket, and initializes subsystems.
- `src/adapters/napcat/`: QQ transport and OneBot event normalization.
- `src/commands/`: command parsing and dispatch. Prefixes include `.`, `!`, and `/`.
- `src/ai/client/DashScopeClient.ts`: Qwen API wrapper for chat, embeddings, and image generation.
- `src/ai/pipeline/KPPipeline.ts`: AI Keeper pipeline, including retrieval, context assembly, drafting, and guardrails.
- `src/runtime/CampaignHandler.ts`: per-group session orchestration with message queueing.
- `src/runtime/SessionState.ts`: per-campaign state, including history, scene data, clues, and pending rolls.
- `src/knowledge/`: import, chunking, indexing, and image library logic for the RAG system.
- `src/storage/Database.ts`: shared SQLite access layer using Bun native APIs and raw SQL.
- `src/api/`: admin and player REST routes served alongside the SPA.
- `src/shared/`: shared contracts, DTOs, and types for backend and frontend.
- `web/`: SolidJS frontend package built separately and served by the backend.

## TypeScript Path Aliases

Defined in `tsconfig.json`:

- `@/*` -> `src/*`
- `@shared/*` -> `src/shared/*`
- `@server/*` -> `src/server/*`
- `@runtime/*` -> `src/runtime/*`
- `@domain/*` -> `src/domain/*`
- `@ai/*` -> `src/ai/*`

## Project Conventions

- AI responses can include `[SHOW_IMAGE:id]` markers. These are extracted before guardrail filtering and sent as separate QQ image messages.
- Image IDs use the `img-{6hex}` format and are stored under `data/knowledge/images/`.
- Knowledge documents may use `=== KP ONLY START ===` and `=== KP ONLY END ===` style markers to separate player-visible and keeper-only content.
- NapCat image CQ code uses the form `[CQ:image,file=file:///absolute/path]`.

## Important Data Paths

- `data/storage/coc-bot.db`
- `data/knowledge/manifest.json`
- `data/knowledge/raw/`
- `data/knowledge/chunks/`
- `data/knowledge/indexes/`
- `data/knowledge/images/`

## Environment

Configuration lives in `.env` and `.env.example`. Key variables include:

- `DASHSCOPE_API_KEY`
- `NAPCAT_WS_URL`
- `NAPCAT_HTTP_URL`
- `ADMIN_SECRET`
- `SERVER_PORT`
- `DATABASE_PATH`

## Documentation and Workflow

- When behavior, structure, commands, or user workflows change, update the relevant files under `docs/`.
- Always consider whether these files need updates:
  - `docs/ROADMAP.md`
  - `docs/architecture/repo-layout-final.md`
  - `docs/CHANGELOG.md`
  - `docs/GETTING_STARTED.md`
  - `docs/TEST_LOG.md`
- If the user asks for a commit:
  - bump `package.json` version appropriately
  - add a changelog entry with version and date
  - stage relevant files but exclude runtime artifacts
  - write a clear commit message

## External Docs

- For external libraries and frameworks, prefer official documentation and primary sources over memory.
- This is especially important for SolidJS, Vite, `mammoth`, and `pdfjs-dist`.

## AI Collaboration

- Codex can consult the local `claude-code` MCP server, backed by `claude mcp serve`.
- Use `claude-code` for second opinions on architecture, risky refactors, edge cases, reviews, or alternative implementations.
- For code generation, prefer asking Claude for a focused patch plan, diff, or snippet. Codex still owns final edits and local validation.
- Do not use `claude-code` for small deterministic edits or simple repository lookups.
- Keep prompts narrow. Include exact file paths, constraints, and the concrete question.
- Validate Claude suggestions locally before applying them.
