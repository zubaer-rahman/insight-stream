# Insight Stream

Insight Stream is a production-focused multi-agent research terminal for verified business intelligence.  
It combines Tavily search, CRAG-style verification loops, and a human override fallback in a Next.js 16 + React 19 dashboard.

## Multi-Agent Architecture

### Agents

- `CompanySearchAgent`: gathers external sources and generates cleaned markdown findings.
- `VerificationAgent` ("critic"): scores evidence quality and relevance against a target claim.
- `ResearchDispatcher`: orchestrates Search -> Verify -> Retry until quality threshold or max attempts.

### Data Contracts

All agent I/O is schema-first through Zod:

- `lib/agents/schemas.ts`
- `lib/agents/dispatcher.ts`
- `lib/agents/implementations.ts`

This ensures strict typed handoffs and consistent CRAG behavior.

## CRAG Implementation

The dispatcher applies corrective retrieval loops:

1. Run search query for company + claim context.
2. Verify with structured relevance scoring.
3. If below threshold (`0.8` by default), reformulate and retry.
4. Stream rationale and retry signals into the Process Log.
5. If retries are exhausted, show **Manual Override** for human-in-the-loop guidance.

## Observability and Local Context

- **LangSmith-ready tracing**: `traceAgenticWorkflow` wrapper in dispatcher emits `Input -> Search -> Verify -> Retry -> Output` stages when `LANGSMITH_API_KEY` is set.
- **MCP-lite local context**: verified reports are cached with Next.js `use cache` for fast same-query rehydration.
- **UI signal for cache hit**: process log shows  
  `✅ Verified result found in local context. Loading...`

## Tech Stack

| Layer | Technology | Role |
| --- | --- | --- |
| App Framework | Next.js 16.2.3 | App Router + Server Actions |
| UI Runtime | React 19 | Client/server rendering and hooks |
| Agent State | `@ai-sdk/rsc` | `createAI`, streamable UI state |
| Search | Tavily (`@tavily/core`, `@tavily/ai-sdk`) | Real-time web retrieval |
| Verification/Report LLM | Groq (`llama-3.3-70b-versatile`) | Fast critic + report generation |
| Fallback LLM | OpenAI (`gpt-4o-mini`) | Structured output fallback |
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

For low-cost or no-cost experimentation:

- Use free-tier keys where available:
  - Tavily free tier for search
  - Groq free tier for inference
- Keep `OPENAI_API_KEY` unset unless fallback is needed.
- Lower `maxResults` and `maxAttempts` in UI payloads for reduced token/search usage.

## Production Notes for IT Magnet

- Keep schema versions and prompt templates under change control.
- Persist traces externally when `LANGSMITH_API_KEY` is enabled.
- Add role-based controls for Manual Override actions before client deployment.
