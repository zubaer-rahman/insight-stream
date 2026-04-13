# Insight Stream

Insight Stream is a Next.js research terminal that orchestrates a search-and-verification workflow.  
It uses Tavily for web retrieval, a verification step for relevance scoring, and a CRAG-style retry loop with manual override support.

## Quick Start for IT Magnet

This project follows an AI-first workflow: search -> verify -> retry (when needed) -> report.

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Configure `.env.local` (minimum):
   ```bash
   TAVILY_API_KEY=...
   GROQ_API_KEY=...
   ```
3. Run locally:
   ```bash
   pnpm dev
   ```
4. Open:
   - Main terminal: `http://localhost:3000`
   - Recruiter demo route: `http://localhost:3000/demo`

For deployment readiness checks, run:

```bash
pnpm deploy
```

## Multi-Agent Architecture

### Agents

- `CompanySearchAgent`: retrieves and summarizes external sources.
- `VerificationAgent`: scores relevance against the requested claim.
- `ResearchDispatcher`: coordinates Search -> Verify -> Retry up to a configured max attempt count.

### Data Contracts

All agent I/O is schema-first through Zod:

- `lib/agents/schemas.ts`
- `lib/agents/dispatcher.ts`
- `lib/agents/implementations.ts`

These schemas enforce typed handoffs between steps.

## CRAG Implementation

The dispatcher applies corrective retrieval loops:

1. Run search query for company + claim context.
2. Verify with structured relevance scoring.
3. If below threshold (`0.8` by default), reformulate and retry.
4. Stream rationale and retry signals to the Process Log.
5. If retries are exhausted, show **Manual Override** for human-in-the-loop guidance.

## Observability and Local Context

- **LangSmith tracing hook**: `traceAgenticWorkflow` in dispatcher emits `Input -> Search -> Verify -> Retry -> Output` stages when `LANGSMITH_API_KEY` is set.
- **Local context cache**: verified reports are cached with Next.js `use cache` for same-query reuse.
- **UI signal for cache hit**: process log shows  
  `✅ Verified result found in local context. Loading...`

## Tech Stack

| Layer | Technology | Role |
| --- | --- | --- |
| App Framework | Next.js 16.2.3 | App Router + Server Actions |
| UI Runtime | React 19 | Client/server rendering and hooks |
| Agent State | `@ai-sdk/rsc` | `createAI`, streamable UI state |
| Search | Tavily (`@tavily/core`, `@tavily/ai-sdk`) | Real-time web retrieval |
| Verification/Report LLM | Groq (`llama-3.3-70b-versatile`) | Verification and report generation |
| Fallback LLM | OpenAI (`gpt-4o-mini`) | Fallback when primary path is unavailable |
| Validation | Zod | Strict contracts for all handoffs |

## How to Run

### 1) Install

```bash
pnpm install
```

### 2) Configure environment

Create `.env.local`:

```bash
TAVILY_API_KEY=...
GROQ_API_KEY=...
OPENAI_API_KEY=...
LANGSMITH_API_KEY=...
```

Notes:
- `LANGSMITH_API_KEY` is optional.
- If `GROQ_API_KEY` is unavailable, verification/report flow falls back to `OPENAI_API_KEY`.

### 3) Run dev server

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Zero-Cost Keys Mode

For lower-cost experimentation:

- Use free-tier keys where available:
  - Tavily free tier for search
  - Groq free tier for inference
- Keep `OPENAI_API_KEY` unset unless fallback is needed.
- Lower `maxResults` and `maxAttempts` in UI payloads for reduced token/search usage.

## Deployment Notes for IT Magnet

- Keep schema versions and prompt templates under change control.
- Persist traces externally when `LANGSMITH_API_KEY` is enabled.
- Add role-based controls for Manual Override actions before client deployment.
