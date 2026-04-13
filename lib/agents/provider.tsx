import { createAI, createStreamableValue } from "@ai-sdk/rsc";
import {
  type ResearchDispatcherInput,
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
}>;

type RunResearchResult = Readonly<{
  logStream: ReturnType<typeof createStreamableValue<readonly string[]>>["value"];
  reportStream: ReturnType<typeof createStreamableValue<string>>["value"];
}>;
export type ResearchRunResult = RunResearchResult;

function nowIso(): string {
  return new Date().toISOString();
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
    lastUpdatedAt: nowIso(),
  });
}

function toInitialUIState(): ResearchUIState {
  return {
    status: "idle",
    processLog: [],
    reportMarkdown: "",
    lastScore: null,
  };
}

async function runResearchTerminal(
  rawInput: ResearchDispatcherInput,
): Promise<RunResearchResult> {
  "use server";

  const input = researchDispatcherInputSchema.parse(rawInput);

  const logStream = createStreamableValue<readonly string[]>([]);
  const reportStream = createStreamableValue<string>("");
  let processLog: readonly string[] = [];

  const pushLog = (entry: string): void => {
    processLog = [...processLog, entry];
    logStream.update(processLog);
  };

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
      reportStream.done(finalReport);
      logStream.done(processLog);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Dispatcher execution failed.";
      pushLog(`❌ Research failed: ${message}`);
      reportStream.done(`## Research Failed\n\n${message}`);
      logStream.done(processLog);
    }
  })();

  return {
    logStream: logStream.value,
    reportStream: reportStream.value,
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
