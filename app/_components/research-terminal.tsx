"use client";

import { readStreamableValue, useActions, useUIState } from "@ai-sdk/rsc";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { useActionState, useEffect, useEffectEvent, useRef, useState } from "react";
import type { AgentProviderType, ResearchRunResult } from "@/lib/agents/provider";
import { Logo } from "@/components/ui/logo";

type SubmitState = Readonly<{
  errorMessage: string | null;
}>;

const INITIAL_SUBMIT_STATE: SubmitState = {
  errorMessage: null,
};

const LOCAL_REPORT_STORAGE_KEY = "insight-stream:last-verified-report";
const MIN_CLAIM_LENGTH = 12;

const QUICK_START_CARDS = [
  {
    title: "Analyze Apple's M4 Chipset",
    companyName: "Apple Inc.",
    claim:
      "Evaluate Apple Inc. M4 chipset supply chain concentration and potential launch risk for enterprise rollout.",
  },
  {
    title: "Nvidia Blackwell Infrastructure",
    companyName: "NVIDIA",
    claim:
      "Assess NVIDIA Blackwell infrastructure readiness, hyperscaler adoption signals, and near-term execution bottlenecks.",
  },
  {
    title: "Tesla AI Infrastructure",
    companyName: "Tesla",
    claim:
      "Evaluate Tesla AI infrastructure capacity trajectory and data-center dependency risk over the next four quarters.",
  },
] as const;

type ResearchTerminalProps = Readonly<{
  initialCompanyName?: string;
  initialClaim?: string;
  isRecruiterDemo?: boolean;
}>;

const DEFAULT_COMPANY = "";
const DEFAULT_CLAIM = "";

export function ResearchTerminal({
  initialCompanyName = DEFAULT_COMPANY,
  initialClaim = DEFAULT_CLAIM,
  isRecruiterDemo = false,
}: ResearchTerminalProps) {
  const actions = useActions<AgentProviderType>();
  const [uiState, setUIState] = useUIState<AgentProviderType>();
  const [activeStreams, setActiveStreams] = useState<ResearchRunResult | null>(
    null,
  );
  const [isInsightModalOpen, setIsInsightModalOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const applyLogUpdate = useEffectEvent((logs: readonly string[]) => {
    setUIState((current) => ({
      ...current,
      status: "running",
      processLog: logs,
    }));
  });

  const applyReportUpdate = useEffectEvent((reportMarkdown: string) => {
    setUIState((current) => ({
      ...current,
      reportMarkdown,
    }));
  });

  const applyManualOverrideUpdate = useEffectEvent(
    (requiresManualOverride: boolean) => {
      setUIState((current) => ({
        ...current,
        requiresManualOverride,
        manualOverrideEnabled: requiresManualOverride
          ? current.manualOverrideEnabled
          : false,
      }));
    },
  );

  const [submitState, formAction, isPending] = useActionState(
    async (_previousState: SubmitState, formData: FormData) => {
      const companyNameEntry = formData.get("companyName");
      const claimEntry = formData.get("claim");

      const companyName =
        typeof companyNameEntry === "string" ? companyNameEntry.trim() : "";
      const claim = typeof claimEntry === "string" ? claimEntry.trim() : "";

      if (companyName.length < 2 || claim.length < MIN_CLAIM_LENGTH) {
        return {
          errorMessage:
            `Please provide a valid company name and a claim with at least ${MIN_CLAIM_LENGTH} characters.`,
        };
      }
      if (companyName.toLowerCase() === "apple") {
        return {
          errorMessage:
            "Query is too broad. Try a specific prompt like: Apple Inc. Vision Pro supply chain.",
        };
      }

      setUIState((current) => ({
        ...current,
        status: "running",
        processLog: [],
        reportMarkdown: "",
        lastScore: null,
        requiresManualOverride: false,
        manualOverrideEnabled: false,
      }));

      try {
        const result = await actions.runResearchTerminal({
          companyName,
          claim,
          maxResults: 8,
          requireFreshSources: true,
          minimumRelevanceScore: 0.8,
          maxAttempts: 3,
        });
        setActiveStreams(result);

        return {
          errorMessage: null,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Research terminal failed.";
        setUIState((current) => ({
          ...current,
          status: "failed",
          processLog: [...current.processLog, `❌ Research failed: ${message}`],
        }));
        return {
          errorMessage: message,
        };
      }
    },
    INITIAL_SUBMIT_STATE,
  );

  useEffect(() => {
    try {
      const persisted = localStorage.getItem(LOCAL_REPORT_STORAGE_KEY);
      if (persisted === null) {
        return;
      }

      const parsed: unknown = JSON.parse(persisted);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("reportMarkdown" in parsed) ||
        !("lastScore" in parsed)
      ) {
        return;
      }

      const reportMarkdown = (parsed as { reportMarkdown?: unknown }).reportMarkdown;
      const lastScore = (parsed as { lastScore?: unknown }).lastScore;
      if (typeof reportMarkdown !== "string") {
        return;
      }

      setUIState((current) => {
        if (current.reportMarkdown.length > 0) {
          return current;
        }
        return {
          ...current,
          status: "completed",
          reportMarkdown,
          lastScore: typeof lastScore === "number" ? lastScore : null,
          processLog:
            current.processLog.length > 0
              ? current.processLog
              : ["✅ Restored last verified report from local storage."],
        };
      });
    } catch {
      // Ignore malformed local storage payloads.
    }
  }, [setUIState]);

  useEffect(() => {
    if (uiState.status !== "completed" || uiState.reportMarkdown.trim().length === 0) {
      return;
    }

    localStorage.setItem(
      LOCAL_REPORT_STORAGE_KEY,
      JSON.stringify({
        reportMarkdown: uiState.reportMarkdown,
        lastScore: uiState.lastScore,
      }),
    );
  }, [uiState.status, uiState.reportMarkdown, uiState.lastScore]);

  useEffect(() => {
    if (activeStreams === null) {
      return;
    }

    let cancelled = false;
    let latestLogs: readonly string[] = [];
    let latestManualOverride = false;

    void (async () => {
      try {
        await Promise.all([
          (async () => {
            for await (const logs of readStreamableValue(activeStreams.logStream)) {
              if (!cancelled && logs !== undefined) {
                latestLogs = logs;
                applyLogUpdate(logs);
              }
            }
          })(),
          (async () => {
            for await (const reportChunk of readStreamableValue(
              activeStreams.reportStream,
            )) {
              if (!cancelled && reportChunk !== undefined) {
                applyReportUpdate(reportChunk);
              }
            }
          })(),
          (async () => {
            for await (const manualFlag of readStreamableValue(
              activeStreams.manualOverrideStream,
            )) {
              if (!cancelled && manualFlag !== undefined) {
                latestManualOverride = manualFlag;
                applyManualOverrideUpdate(manualFlag);
              }
            }
          })(),
        ]);

        if (cancelled) {
          return;
        }

        const verifiedLog = [...latestLogs]
          .reverse()
          .find((entry) => entry.includes("Research Verified"));
        const scoreMatch = verifiedLog?.match(/Score:\s([0-9.]+)/);
        const scoreValue =
          scoreMatch !== undefined && scoreMatch !== null
            ? Number.parseFloat(scoreMatch[1])
            : null;

        setUIState((current) => ({
          ...current,
          status: latestManualOverride ? "failed" : "completed",
          lastScore:
            scoreValue !== null && !Number.isNaN(scoreValue) ? scoreValue : null,
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Streaming update failed.";
        setUIState((current) => ({
          ...current,
          status: "failed",
          processLog: [...current.processLog, `❌ Research failed: ${message}`],
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeStreams, setUIState]);

  const showWaitingState =
    uiState.status === "idle" &&
    uiState.reportMarkdown.length === 0 &&
    !isPending &&
    activeStreams === null;
  const showSkeletonLoader =
    uiState.status === "running" && uiState.reportMarkdown.length === 0;
  const isDevelopment = process.env.NODE_ENV === "development";
  const traceUrl =
    process.env.NEXT_PUBLIC_LANGSMITH_PROJECT_URL ?? "https://smith.langchain.com/";

  const applyQuickStart = (card: (typeof QUICK_START_CARDS)[number]): void => {
    const formElement = formRef.current;
    if (formElement === null) {
      return;
    }

    const companyInput = formElement.elements.namedItem(
      "companyName",
    ) as HTMLInputElement | null;
    const claimInput = formElement.elements.namedItem("claim") as HTMLTextAreaElement | null;

    if (companyInput !== null) {
      companyInput.value = card.companyName;
    }
    if (claimInput !== null) {
      claimInput.value = card.claim;
    }
  };

  return (
    <div className="flex flex-1 bg-zinc-950 text-slate-300">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[380px_1fr]">
        <section className="flex h-[calc(100vh-6rem)] flex-col rounded-xl border border-zinc-800 bg-zinc-900/90">
          <header className="border-b border-zinc-800 px-4 py-4">
            <div className="flex items-center gap-3">
              <motion.div
                aria-hidden
                animate={{ opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="h-2.5 w-2.5 rounded-full bg-emerald-400"
              />
              <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
                Process Log
              </h1>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Live CRAG telemetry from the dispatcher.
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsInsightModalOpen(true);
                }}
                className="rounded-md border border-zinc-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-zinc-800"
              >
                Project Insight
              </button>
            </div>
          </header>

          <form
            ref={formRef}
            action={formAction}
            className="space-y-3 border-b border-zinc-800 p-4"
          >
            <input
              name="companyName"
              required
              minLength={2}
              placeholder="Company name"
              defaultValue={initialCompanyName}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-slate-400"
            />
            <textarea
              name="claim"
              required
              minLength={5}
              rows={3}
              placeholder="Claim to verify (e.g. revenue growth, market share)"
              defaultValue={initialClaim}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-slate-400"
            />
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-slate-200 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending
                ? "Running Research..."
                : isRecruiterDemo
                  ? "Run Recruiter Demo"
                  : "Run Research"}
            </button>
            {submitState.errorMessage !== null ? (
              <p className="text-xs text-rose-400">{submitState.errorMessage}</p>
            ) : null}
          </form>

          <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
            {uiState.processLog.length === 0 ? (
              <p className="text-slate-500">No process entries yet.</p>
            ) : (
              uiState.processLog.map((entry, index) => (
                <div
                  key={`${entry}-${index}`}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-slate-300"
                >
                  {entry}
                </div>
              ))
            )}
            {isDevelopment ? (
              <a
                href={traceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block pt-2 text-xs text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
              >
                View LangSmith Trace
              </a>
            ) : null}
          </div>
        </section>

        <section className="h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/90 p-6">
          <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
              Verified Report
            </h2>
            <span className="text-xs text-slate-400">
              Status: {uiState.status}
              {uiState.lastScore !== null
                ? ` | Score ${uiState.lastScore.toFixed(2)}`
                : ""}
            </span>
          </div>
          <article className="prose prose-invert prose-slate max-w-none prose-headings:text-slate-100 prose-p:text-slate-300 prose-strong:text-slate-100 prose-li:text-slate-300">
            {uiState.reportMarkdown.length > 0 ? (
              <ReactMarkdown>{uiState.reportMarkdown}</ReactMarkdown>
            ) : showSkeletonLoader ? (
              <div className="space-y-3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-full animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-11/12 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-10/12 animate-pulse rounded bg-zinc-800" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-full animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-9/12 animate-pulse rounded bg-zinc-800" />
              </div>
            ) : showWaitingState ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <Logo className="h-8 w-8" />
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      Waiting for Input
                    </p>
                    <p className="text-xs text-slate-400">
                      Start with a focused claim to get better CRAG precision.
                    </p>
                  </div>
                </div>
                <div className="grid gap-2">
                  {QUICK_START_CARDS.map((card) => (
                    <button
                      key={card.title}
                      type="button"
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm text-slate-300 transition hover:border-zinc-700 hover:bg-zinc-900"
                      onClick={() => {
                        applyQuickStart(card);
                      }}
                    >
                      {card.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-slate-500">
                Verified markdown report will appear after dispatcher completion.
              </p>
            )}
          </article>
          {uiState.requiresManualOverride ? (
            <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="mb-3 text-sm text-amber-200">
                CRAG exhausted all retries. Manual guidance is required before the
                next run.
              </p>
              <button
                type="button"
                className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange-400"
                onClick={() => {
                  setUIState((current) => ({
                    ...current,
                    manualOverrideEnabled: true,
                    processLog: [
                      ...current.processLog,
                      "🧑‍💼 Manual Override enabled. Refine claim/query and rerun.",
                    ],
                  }));
                }}
              >
                Manual Override
              </button>
              {uiState.manualOverrideEnabled ? (
                <p className="mt-2 text-xs text-amber-100">
                  Human override enabled. Update your claim text and rerun the
                  workflow to guide agent reasoning.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
      {isInsightModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-slate-200 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo className="h-6 w-6" />
                <h3 className="text-base font-semibold">Project Insight</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsInsightModalOpen(false);
                }}
                className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-sm text-slate-300">
              Insight Stream is an AI-First multi-agent pipeline designed to deliver
              verified intelligence with corrective retrieval loops.
            </p>
            <pre className="mb-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-slate-300">
{`Input
  -> CompanySearchAgent (Tavily retrieval)
  -> VerificationAgent (critic scoring)
  -> CRAG Retry (if relevance < threshold)
  -> Verified Report / Manual Override`}
            </pre>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
              <li>Schema-first contracts for every agent handoff.</li>
              <li>LangSmith-ready stage tracing in dispatcher orchestration.</li>
              <li>Local verified-context caching with instant reload path.</li>
              <li>Human-in-the-loop gate when CRAG retries are exhausted.</li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
