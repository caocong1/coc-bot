# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A QQ bot platform for Call of Cthulhu (CoC) TRPG. It connects to QQ via NapCat/OneBot protocol and provides dice commands, AI-powered Keeper (KP) sessions, a knowledge/RAG system for rulebooks and scenarios, and a SolidJS web console for admin/player management.

## Commands

```bash
# Runtime is Bun — NEVER use npm/node
bun install                  # Install dependencies
bun run dev                  # Start bot (entry: src/server/index.ts)
bun tsc --noEmit             # Type-check (run after every change)

# Web frontend (SolidJS, separate package in web/)
bun run web:dev              # Dev server
bun run web:build            # Production build

# Knowledge pipeline
bun run import-pdfs          # Import PDF/DOCX into knowledge base
bun run build-indexes        # Build embedding indexes
bun run build-indexes:all    # Build all index types (rules, scenario, keeper_secret)

# Database
bun run migrate              # Run migrations
```

There are no test commands — the project has no test suite.

## Architecture

### Message Flow

```
QQ Message → NapCatTransport (WebSocket) → NapCatEventNormalizer → CommandParser
  ├─ Command found → CommandRegistry → handler.handle() → response
  └─ Campaign mode, no command → CampaignHandler → KPPipeline → DashScope AI → response
```

### Key Modules

- **`src/server/index.ts`** — Entry point. Starts HTTP server (port 28765), connects NapCat WebSocket, initializes all subsystems.
- **`src/adapters/napcat/`** — QQ protocol adapter. `NapCatTransport` (WS events + HTTP actions), `NapCatEventNormalizer` (OneBot → internal `MessageContext`).
- **`src/commands/`** — Command system. `CommandParser` handles prefixes (`.` `!` `/`), `CommandRegistry` dispatches to handlers.
- **`src/ai/client/DashScopeClient.ts`** — Qwen AI wrapper. `chat()` for text/vision, `embed()` for RAG embeddings, `generateImage()` async submit+poll, `optimizeImagePrompt()` for English prompt translation.
- **`src/ai/pipeline/KPPipeline.ts`** — AI KP logic: intervention decision → parallel RAG retrieval → context assembly → draft generation → guardrail filtering → image extraction.
- **`src/runtime/CampaignHandler.ts`** — Per-group session management with message queue (concurrency lock). Returns `CampaignOutput {text, images}`.
- **`src/runtime/SessionState.ts`** — Per-campaign state: message history, scene info, clues, pending rolls.
- **`src/knowledge/`** — RAG system. PDF/DOCX import, chunking, embedding indexes, `ImageLibrary` for scenario images.
- **`src/storage/Database.ts`** — SQLite via Bun native. Raw SQL with bound parameters, no ORM. Single shared instance.
- **`src/api/`** — REST API routes. `AdminRoutes` (ADMIN_SECRET auth), `PlayerRoutes` (token auth). Served alongside SPA.
- **`src/shared/`** — Types, DTOs, and contracts shared between backend and web frontend.
- **`web/`** — SolidJS 1.9 + Tailwind CSS 4 + Vite 6 frontend. Separate `package.json`. Built output served by the backend.

### TypeScript Path Aliases

Defined in `tsconfig.json`: `@/*` → `src/`, `@shared/*` → `src/shared/`, `@server/*` → `src/server/`, `@runtime/*` → `src/runtime/`, `@domain/*` → `src/domain/`, `@ai/*` → `src/ai/`.

### Image/Media Conventions

- AI responses use `[SHOW_IMAGE:id]` markers — extracted before guardrail, sent as separate QQ image messages.
- Image IDs follow `img-{6hex}` format, stored in `data/knowledge/images/`.
- Knowledge docs use `=== KP ONLY START/END ===` markers to split player-visible vs keeper-secret content.
- NapCat image CQ code format: `[CQ:image,file=file:///absolute/path]`.

### Data Paths

- `data/storage/coc-bot.db` — SQLite database
- `data/knowledge/manifest.json` — Knowledge file metadata
- `data/knowledge/raw/` — Extracted text
- `data/knowledge/chunks/` — Chunked text for RAG
- `data/knowledge/indexes/` — Vector embeddings
- `data/knowledge/images/` — Image metadata + files

### Environment

Configuration via `.env` (see `.env.example`). Key vars: `DASHSCOPE_API_KEY`, `NAPCAT_WS_URL`, `NAPCAT_HTTP_URL`, `ADMIN_SECRET`, `SERVER_PORT`, `DATABASE_PATH`.

## Documentation Lookup

When writing code that uses external libraries (SolidJS, Vite, mammoth, pdfjs-dist, etc.), use the `find-docs` skill (`npx ctx7@latest`) to fetch up-to-date documentation instead of relying on training data. This is especially important for SolidJS APIs (signals, stores, routing) which differ significantly from React.

## AI Collaboration

When a second opinion or code review from a different AI model is useful, use the `ask-codex` skill. It provides Codex CLI (GPT) via MCP with `codex` (new session) and `codex-reply` (continue conversation) tools. Always use `sandbox: "read-only"` and `approval-policy: "never"` for MCP mode.
