import { z } from "zod";
import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";
import { tavilySearch } from "@tavily/ai-sdk";
import { tavily } from "@tavily/core";
import {
  companySearchAgentInputSchema,
  companySearchAgentOutputSchema,
  verificationAgentInputSchema,
  verificationAssessmentSchema,
  verificationAgentOutputSchema,
} from "@/lib/agents/schemas";
import type { ResearchDispatcherOutput } from "@/lib/agents/dispatcher";

function nowIso(): string {
  return new Date().toISOString();
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function selectFastAnalystModel() {
  const groqApiKey = readEnv("GROQ_API_KEY");
  if (groqApiKey !== undefined) {
    return groq("llama-3.3-70b-versatile");
  }

  const openAiApiKey = readEnv("OPENAI_API_KEY");
  if (openAiApiKey !== undefined) {
    return openai("gpt-4o-mini");
  }

  throw new Error(
    "No inference provider configured. Set GROQ_API_KEY (preferred) or OPENAI_API_KEY.",
  );
}

function isSparseOrGenericEvidence(
  sources: ReadonlyArray<z.infer<typeof verificationAgentInputSchema.shape.sources.element>>,
): boolean {
  if (sources.length < 2) {
    return true;
  }

  const totalSnippetChars = sources.reduce(
    (accumulator, source) => accumulator + (source.snippet?.length ?? 0),
    0,
  );

  const genericSourceCount = sources.filter((source) => {
    const snippet = source.snippet?.toLowerCase() ?? "";
    return (
      snippet.length < 90 ||
      snippet.includes("no snippet") ||
      snippet.includes("summary") ||
      snippet.includes("insufficient") ||
      snippet.includes("generic")
    );
  }).length;

  return totalSnippetChars < 500 || genericSourceCount >= Math.ceil(sources.length * 0.6);
}

function enforceStrictEvidenceGate(
  assessment: z.infer<typeof verificationAssessmentSchema>,
  verificationInput: z.infer<typeof verificationAgentInputSchema>,
): z.infer<typeof verificationAssessmentSchema> {
  if (!isSparseOrGenericEvidence(verificationInput.sources)) {
    return assessment;
  }

  const forcedScore = Math.max(
    0,
    Math.min(assessment.relevance_score, verificationInput.minimumRelevanceScore - 0.2),
  );

  return verificationAssessmentSchema.parse({
    ...assessment,
    relevance_score: forcedScore,
    verdict: "insufficient_evidence",
    shouldRetrySearch: true,
    reformulatedQuery:
      assessment.reformulatedQuery ??
      `${verificationInput.companyName} ${verificationInput.claim} primary source filings and audited metrics`,
    rationale: `Sparse or generic evidence detected, so relevance is forced below threshold for CRAG retry. Original rationale: ${assessment.rationale}`,
  });
}

export function resolveRuntimeProviderLabel(): string {
  if (readEnv("GROQ_API_KEY") !== undefined) {
    return "Groq llama-3.3-70b-versatile";
  }

  if (readEnv("OPENAI_API_KEY") !== undefined) {
    return "OpenAI gpt-4o-mini (fallback)";
  }

  return "No model provider configured";
}

export async function runCompanySearchAgent(
  rawInput: Readonly<z.infer<typeof companySearchAgentInputSchema>>,
): Promise<z.infer<typeof companySearchAgentOutputSchema>> {
  const input = companySearchAgentInputSchema.parse(rawInput);

  const searchTool = tavilySearch({
    apiKey: requireEnv("TAVILY_API_KEY"),
    searchDepth: "advanced",
    maxResults: 5,
  });
  const tavilyClient = tavily({
    apiKey: requireEnv("TAVILY_API_KEY"),
    clientSource: "insight-stream",
  });

  const query =
    input.seedQuery ??
    `${input.companyName} business performance, strategy, and market signals`;

  const searchCapability =
    searchTool.description ??
    "Tavily AI SDK search for real-time and contextual web intelligence.";

  const rawSearchResponse = await tavilyClient.search(query, {
    searchDepth: "advanced",
    maxResults: 5,
    includeRawContent: "markdown",
  });

  const normalizedSources = rawSearchResponse.results ?? [];
  const retrievedAt = nowIso();

  const sourceItems =
    normalizedSources.length > 0
      ? normalizedSources.slice(0, 5).map((result, index) => ({
          id: `${input.companyName
            .toLowerCase()
            .replace(/\s+/g, "-")}-source-${index + 1}`,
          title: result.title,
          url: result.url,
          snippet:
            result.content?.slice(0, 420) ??
            "No snippet provided by the source result.",
          retrievedAt,
        }))
      : [
          {
            id: `${input.companyName.toLowerCase().replace(/\s+/g, "-")}-fallback-source-1`,
            title: `${input.companyName} search summary`,
            url: "https://example.com/fallback-source",
            snippet: `No high-confidence sources returned for query: ${query}`,
            retrievedAt,
          },
        ];

  const summaryPrompt = `You are a senior market intelligence analyst.
Create a cleaned markdown summary of the top findings for "${input.companyName}" based on the sources below.
Use concise bullets and focus on business signals, risks, and opportunities.

Sources:
${sourceItems
  .map(
    (source, index) =>
      `${index + 1}. ${source.title}\nURL: ${source.url}\nSnippet: ${
        source.snippet ?? ""
      }`,
  )
  .join("\n\n")}`;
  const summaryPromptWithCapability = `${summaryPrompt}\n\nSearch capability used: ${searchCapability}`;

  const markdownSummaryResult = await generateText({
    model: selectFastAnalystModel(),
    temperature: 0.2,
    prompt: summaryPromptWithCapability,
  });

  const markdownSummary = markdownSummaryResult.text.trim();

  const findings = sourceItems.slice(0, 5).map((source, index) => ({
    finding:
      index === 0
        ? `### Top Findings\n${markdownSummary}`
        : `- Additional corroboration from [${source.title}](${source.url})`,
    confidence: Math.max(0.6, 0.9 - index * 0.08),
    supportingSourceIds: [source.id],
  }));

  return companySearchAgentOutputSchema.parse({
    companyName: input.companyName,
    executedQuery: query,
    sources: sourceItems,
    findings,
    nextQuerySuggestion: `${input.companyName} latest audited performance and competitive benchmark`,
    generatedAt: retrievedAt,
    shouldEscalateToVerification: true,
  });
}

export async function runVerificationAgent(
  rawInput: Readonly<z.infer<typeof verificationAgentInputSchema>>,
): Promise<z.infer<typeof verificationAgentOutputSchema>> {
  const input = verificationAgentInputSchema.parse(rawInput);

  const verificationPrompt = `Evaluate how well the provided Tavily sources support the user's claim and score relevance quality.
You must be strict: weak, sparse, or generic evidence should fail relevance and trigger CRAG retry.

Company: ${input.companyName}
Claim to verify: ${input.claim}
Minimum relevance threshold: ${input.minimumRelevanceScore}

Sources:
${input.sources
  .map(
    (source, index) =>
      `${index + 1}. ${source.title}\nURL: ${source.url}\nSnippet: ${
        source.snippet ?? ""
      }`,
  )
  .join("\n\n")}

Rules:
- Return a relevance_score between 0 and 1.
- If score is below threshold, set shouldRetrySearch=true.
- Provide a reformulatedQuery targeting missing evidence when retry is needed.
- Keep rationale concrete, citing gaps and strengths in evidence quality.
- You are evaluating Tavily search output quality directly.`;

  const assessmentResult = await generateObject({
    model: selectFastAnalystModel(),
    system: "Senior Business Analyst",
    schema: verificationAssessmentSchema,
    temperature: 0.1,
    prompt: verificationPrompt,
  });
  const enforcedAssessment = enforceStrictEvidenceGate(
    assessmentResult.object,
    input,
  );

  return verificationAgentOutputSchema.parse({
    claimId: input.claimId,
    claim: input.claim,
    assessment: enforcedAssessment,
    citations: input.sources,
    validatedAt: nowIso(),
  });
}

export async function generateResearchReportMarkdown(
  output: Readonly<ResearchDispatcherOutput>,
): Promise<string> {
  const reportPrompt = `Use high-speed throughput to produce a deep, exhaustive business intelligence report.
You are writing for executive and technical readers.
Follow SOLID principle of data presentation:
- Single responsibility per section
- Open/closed structure with clear reusable headings
- Logical bullet point decomposition
- Interface-like clarity for readers
- Dependency inversion style: conclusions must depend on cited evidence

Required format:
1) Clear markdown headers
2) Bullet points for findings and risks
3) Include a markdown table named "Tech Stack" with columns: Layer | Technology | Role
4) Include explicit section for "CRAG Self-Correction Rationale"
5) Include explicit section for "Actionable Next Steps"

Input data:
Final score: ${output.finalVerificationResult.assessment.relevance_score.toFixed(2)}
Final verdict: ${output.finalVerificationResult.assessment.verdict}
Claim: ${output.finalVerificationResult.claim}
Trace:
${output.cragTrace
  .map(
    (trace) =>
      `- Attempt ${trace.attempt}: score=${trace.relevanceScore.toFixed(2)}, verdict=${trace.verdict}, query=${trace.query}`,
  )
  .join("\n")}

Findings:
${output.finalSearchResult.findings.map((finding) => `- ${finding.finding}`).join("\n")}

Sources:
${output.finalSearchResult.sources
  .map((source) => `- ${source.title} (${source.url})`)
  .join("\n")}`;

  const reportResult = await generateText({
    model: selectFastAnalystModel(),
    system: "Senior Business Analyst",
    temperature: 0.2,
    prompt: reportPrompt,
  });

  return reportResult.text.trim();
}
