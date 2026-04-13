import { createAI, createStreamableValue } from "@ai-sdk/rsc";
import {
  type ResearchDispatcherInput,
  type ResearchDispatcherOutput,
  researchDispatcherAction,
  researchDispatcherInputSchema,
  type ResearchDispatcherState,
  registerResearchDispatcherRuntime,
  researchDispatcherStateSchema,
} from "@/lib/agents/dispatcher";
import {
  generateResearchReportMarkdown,
  resolveRuntimeProviderLabel,
  runCompanySearchAgent,
  runVerificationAgent,
} from "@/lib/agents/implementations";

type ResearchStatus = "idle" | "running" | "completed" | "failed";

export type ResearchUIState = Readonly<{
  status: ResearchStatus;
  processLog: readonly string[];
  reportMarkdown: string;
  lastScore: number | null;
  requiresManualOverride: boolean;
  manualOverrideEnabled: boolean;
}>;

type CachedVerifiedContext = Readonly<{
  reportMarkdown: string;
  output: ResearchDispatcherOutput;
  version: number;
}>;

type RunResearchResult = Readonly<{
  logStream: ReturnType<typeof createStreamableValue<readonly string[]>>["value"];
  reportStream: ReturnType<typeof createStreamableValue<string>>["value"];
  manualOverrideStream: ReturnType<typeof createStreamableValue<boolean>>["value"];
}>;
export type ResearchRunResult = RunResearchResult;

const verifiedContextStore = new Map<string, CachedVerifiedContext>();

function toContextKey(companyName: string, claim: string): string {
  return `${companyName.trim().toLowerCase()}::${claim.trim().toLowerCase()}`;
}

async function getVerifiedContextFromCache(
  contextKey: string,
  version: number,
): Promise<CachedVerifiedContext | null> {
  "use cache";
  void version;
  return verifiedContextStore.get(contextKey) ?? null;
}

function toInitialAIState(): ResearchDispatcherState {
  return researchDispatcherStateSchema.parse({
    status: "idle",
    companyName: "Pending Company",
    claim: "Pending claim for verification.",
    currentAttempt: 0,
    currentQuery: "initial query",
    minimumRelevanceScore: 0.8,
    trace: [],
    lastUpdatedAt: "1970-01-01T00:00:00.000Z",
  });
}

function toInitialUIState(): ResearchUIState {
  return {
    status: "idle",
    processLog: [],
    reportMarkdown: "",
    lastScore: null,
    requiresManualOverride: false,
    manualOverrideEnabled: false,
  };
}

async function runResearchTerminal(
  rawInput: ResearchDispatcherInput,
): Promise<RunResearchResult> {
  "use server";

  const input = researchDispatcherInputSchema.parse(rawInput);

  const logStream = createStreamableValue<readonly string[]>([]);
  const reportStream = createStreamableValue<string>("");
  const manualOverrideStream = createStreamableValue<boolean>(false);
  let processLog: readonly string[] = [];

  const pushLog = (entry: string): void => {
    processLog = [...processLog, entry];
    logStream.update(processLog);
  };

  const contextKey = toContextKey(input.companyName, input.claim);
  const cachedVersion = verifiedContextStore.get(contextKey)?.version;
  if (cachedVersion !== undefined) {
    void (async () => {
      const cachedContext = await getVerifiedContextFromCache(contextKey, cachedVersion);
      if (cachedContext !== null) {
        pushLog("✅ Verified result found in local context. Loading...");
        reportStream.done(cachedContext.reportMarkdown);
        manualOverrideStream.done(false);
        logStream.done(processLog);
      } else {
        reportStream.done("");
        manualOverrideStream.done(false);
        logStream.done(processLog);
      }
    })();

    return {
      logStream: logStream.value,
      reportStream: reportStream.value,
      manualOverrideStream: manualOverrideStream.value,
    };
  }

  (async () => {
    try {
      pushLog(`⚙️ Runtime Model: ${resolveRuntimeProviderLabel()}`);
      registerResearchDispatcherRuntime({
        runCompanySearchAgent: async (searchInput) => {
          pushLog(`🔍 Searching for ${searchInput.companyName}...`);
          return runCompanySearchAgent(searchInput);
        },
        runVerificationAgent: async (verificationInput) => {
          const result = await runVerificationAgent(verificationInput);
          const score = result.assessment.relevance_score;
          pushLog(`⚖️ Verifying data relevance (Score: ${score.toFixed(2)})...`);
          pushLog(`🧠 Rationale: ${result.assessment.rationale}`);

          if (result.assessment.shouldRetrySearch) {
            pushLog("🔄 CRAG Triggered: Reformulating query...");
          } else {
            pushLog(`✅ Research Verified (Score: ${score.toFixed(2)}).`);
          }

          return result;
        },
      });

      const output = await researchDispatcherAction(input);
      const finalReport = await generateResearchReportMarkdown(output);
      const requiresManualOverride =
        output.attempts >= input.maxAttempts &&
        output.finalVerificationResult.assessment.verdict !== "verified";

      if (requiresManualOverride) {
        pushLog("🧑‍💼 CRAG exhausted after max attempts. Manual Override required.");
      } else if (output.finalVerificationResult.assessment.verdict === "verified") {
        const nextVersion = (verifiedContextStore.get(contextKey)?.version ?? 0) + 1;
        verifiedContextStore.set(contextKey, {
          reportMarkdown: finalReport,
          output,
          version: nextVersion,
        });
      }

      reportStream.done(finalReport);
      manualOverrideStream.done(requiresManualOverride);
      logStream.done(processLog);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Dispatcher execution failed.";
      pushLog(`❌ Research failed: ${message}`);
      reportStream.done(`## Research Failed\n\n${message}`);
      manualOverrideStream.done(false);
      logStream.done(processLog);
    }
  })();

  return {
    logStream: logStream.value,
    reportStream: reportStream.value,
    manualOverrideStream: manualOverrideStream.value,
  };
}

export const AgentProvider = createAI({
  actions: {
    runResearchTerminal,
  },
  initialAIState: toInitialAIState(),
  initialUIState: toInitialUIState(),
});

export type AgentProviderType = typeof AgentProvider;
