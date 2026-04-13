import { getMutableAIState } from "@ai-sdk/rsc";
import { z } from "zod";
import {
  companySearchAgentInputSchema,
  companySearchAgentOutputSchema,
  verificationAgentInputSchema,
  verificationAgentOutputSchema,
} from "@/lib/agents/schemas";

const CRAG_DEFAULT_RELEVANCE_THRESHOLD = 0.8;
const CRAG_DEFAULT_MAX_ATTEMPTS = 3;

export const researchDispatcherInputSchema = z
  .object({
    companyName: z.string().min(2).max(160),
    claim: z.string().min(5).max(1000),
    initialQuery: z.string().min(3).max(500).optional(),
    maxResults: z.number().int().min(1).max(20).default(8),
    requireFreshSources: z.boolean().default(true),
    minimumRelevanceScore: z
      .number()
      .min(0)
      .max(1)
      .default(CRAG_DEFAULT_RELEVANCE_THRESHOLD),
    maxAttempts: z.number().int().min(1).max(6).default(CRAG_DEFAULT_MAX_ATTEMPTS),
  })
  .strict();

const cragTraceItemSchema = z
  .object({
    attempt: z.number().int().min(1),
    query: z.string().min(3).max(500),
    relevanceScore: z.number().min(0).max(1),
    verdict: z.enum([
      "verified",
      "partially_verified",
      "not_verified",
      "insufficient_evidence",
    ]),
    shouldRetrySearch: z.boolean(),
    reformulatedQuery: z.string().min(3).max(500).optional(),
    missingInfo: z.string().min(1),
  })
  .strict();

export const researchDispatcherStateSchema = z
  .object({
    status: z.enum(["idle", "running", "completed", "failed"]),
    companyName: z.string().min(2).max(160),
    claim: z.string().min(5).max(1000),
    currentAttempt: z.number().int().min(0),
    currentQuery: z.string().min(3).max(500),
    minimumRelevanceScore: z.number().min(0).max(1),
    trace: z.array(cragTraceItemSchema),
    lastError: z.string().optional(),
    lastUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const researchDispatcherOutputSchema = z
  .object({
    status: z.enum(["completed", "failed"]),
    attempts: z.number().int().min(1),
    minimumRelevanceScore: z.number().min(0).max(1),
    finalQuery: z.string().min(3).max(500),
    finalSearchResult: companySearchAgentOutputSchema,
    finalVerificationResult: verificationAgentOutputSchema,
    cragTrace: z.array(cragTraceItemSchema).min(1),
  })
  .strict();

export type ResearchDispatcherInput = Readonly<
  z.infer<typeof researchDispatcherInputSchema>
>;
export type ResearchDispatcherState = Readonly<
  z.infer<typeof researchDispatcherStateSchema>
>;
export type ResearchDispatcherOutput = Readonly<
  z.infer<typeof researchDispatcherOutputSchema>
>;

type CompanySearchRunner = (
  input: Readonly<z.infer<typeof companySearchAgentInputSchema>>,
) => Promise<z.infer<typeof companySearchAgentOutputSchema>>;

type VerificationRunner = (
  input: Readonly<z.infer<typeof verificationAgentInputSchema>>,
) => Promise<z.infer<typeof verificationAgentOutputSchema>>;

type ResearchDispatcherRuntime = Readonly<{
  runCompanySearchAgent: CompanySearchRunner;
  runVerificationAgent: VerificationRunner;
}>;

let runtime: ResearchDispatcherRuntime | undefined;

export function registerResearchDispatcherRuntime(
  nextRuntime: ResearchDispatcherRuntime,
): void {
  runtime = nextRuntime;
}

function getRequiredRuntime(): ResearchDispatcherRuntime {
  if (runtime === undefined) {
    throw new Error(
      "ResearchDispatcher runtime is not registered. Call registerResearchDispatcherRuntime() during server startup.",
    );
  }

  return runtime;
}

type AIStateHandle = Readonly<{
  update: (next: ResearchDispatcherState) => void;
  done: (next: ResearchDispatcherState) => void;
}>;

function createAIStateHandle(initialState: ResearchDispatcherState): AIStateHandle {
  try {
    const mutableState = getMutableAIState();
    const currentStateResult = researchDispatcherStateSchema.safeParse(
      mutableState.get(),
    );

    if (!currentStateResult.success) {
      mutableState.update(initialState);
    }

    return {
      update(next) {
        mutableState.update(next);
      },
      done(next) {
        mutableState.done(next);
      },
    };
  } catch {
    return {
      update(next) {
        void next;
      },
      done(next) {
        void next;
      },
    };
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function deriveReformulatedQuery(params: {
  currentQuery: string;
  claim: string;
  missingInfo: string;
  modelSuggestedQuery?: string;
}): string {
  if (params.modelSuggestedQuery !== undefined) {
    return params.modelSuggestedQuery;
  }

  return `For claim "${params.claim}", find evidence about: ${params.missingInfo}. Query focus: ${params.currentQuery}`;
}

function deriveMissingInfo(rationale: string): string {
  const trimmed = rationale.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return "Additional authoritative and current corroborating sources are needed.";
}

export async function researchDispatcherAction(
  rawInput: ResearchDispatcherInput,
): Promise<ResearchDispatcherOutput> {
  "use server";

  const input = researchDispatcherInputSchema.parse(rawInput);
  const requiredRuntime = getRequiredRuntime();

  let activeQuery = input.initialQuery ?? `${input.companyName} company profile`;

  let state: ResearchDispatcherState = {
    status: "running",
    companyName: input.companyName,
    claim: input.claim,
    currentAttempt: 0,
    currentQuery: activeQuery,
    minimumRelevanceScore: input.minimumRelevanceScore,
    trace: [],
    lastUpdatedAt: nowIso(),
  };

  const stateHandle = createAIStateHandle(state);
  stateHandle.update(state);

  let finalSearchResult: z.infer<typeof companySearchAgentOutputSchema> | undefined;
  let finalVerificationResult:
    | z.infer<typeof verificationAgentOutputSchema>
    | undefined;

  try {
    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
      const searchInput = companySearchAgentInputSchema.parse({
        companyName: input.companyName,
        seedQuery: activeQuery,
        maxResults: input.maxResults,
        requireFreshSources: input.requireFreshSources,
      });

      const searchResult = companySearchAgentOutputSchema.parse(
        await requiredRuntime.runCompanySearchAgent(searchInput),
      );
      finalSearchResult = searchResult;

      const verificationInput = verificationAgentInputSchema.parse({
        companyName: input.companyName,
        claim: input.claim,
        sources: searchResult.sources,
        minimumRelevanceScore: input.minimumRelevanceScore,
      });

      const verificationResult = verificationAgentOutputSchema.parse(
        await requiredRuntime.runVerificationAgent(verificationInput),
      );
      finalVerificationResult = verificationResult;

      const assessment = verificationResult.assessment;
      const missingInfo = deriveMissingInfo(assessment.rationale);
      const relevanceBelowThreshold =
        assessment.relevance_score < input.minimumRelevanceScore;
      const shouldRetry =
        relevanceBelowThreshold &&
        assessment.shouldRetrySearch &&
        attempt < input.maxAttempts;

      const reformulatedQuery = shouldRetry
        ? deriveReformulatedQuery({
            currentQuery: activeQuery,
            claim: input.claim,
            missingInfo,
            modelSuggestedQuery: assessment.reformulatedQuery,
          })
        : undefined;

      state = researchDispatcherStateSchema.parse({
        ...state,
        currentAttempt: attempt,
        currentQuery: activeQuery,
        trace: [
          ...state.trace,
          {
            attempt,
            query: activeQuery,
            relevanceScore: assessment.relevance_score,
            verdict: assessment.verdict,
            shouldRetrySearch: shouldRetry,
            reformulatedQuery,
            missingInfo,
          },
        ],
        lastUpdatedAt: nowIso(),
      });
      stateHandle.update(state);

      if (!shouldRetry) {
        break;
      }

      activeQuery = reformulatedQuery ?? activeQuery;
    }

    if (finalSearchResult === undefined || finalVerificationResult === undefined) {
      throw new Error("Dispatcher finished without agent outputs.");
    }

    const output = researchDispatcherOutputSchema.parse({
      status: "completed",
      attempts: state.currentAttempt,
      minimumRelevanceScore: input.minimumRelevanceScore,
      finalQuery: activeQuery,
      finalSearchResult,
      finalVerificationResult,
      cragTrace: state.trace,
    });

    stateHandle.done(
      researchDispatcherStateSchema.parse({
        ...state,
        status: "completed",
        lastUpdatedAt: nowIso(),
      }),
    );

    return output;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dispatcher execution failed.";

    stateHandle.done(
      researchDispatcherStateSchema.parse({
        ...state,
        status: "failed",
        lastError: message,
        lastUpdatedAt: nowIso(),
      }),
    );

    throw error;
  }
}

export const ResearchDispatcher = researchDispatcherAction;
