import { z } from "zod";

export const sourceCitationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    url: z.string().url(),
    snippet: z.string().min(1).optional(),
    publisher: z.string().min(1).optional(),
    publishedAt: z.string().datetime({ offset: true }).optional(),
    retrievedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const companySearchAgentInputSchema = z
  .object({
    companyName: z.string().min(2).max(160),
    seedQuery: z.string().min(3).max(500).optional(),
    industry: z.string().min(2).max(120).optional(),
    hqCountry: z.string().min(2).max(120).optional(),
    maxResults: z.number().int().min(1).max(20).default(8),
    requireFreshSources: z.boolean().default(true),
  })
  .strict();

export const companySearchFindingSchema = z
  .object({
    finding: z.string().min(1),
    confidence: z.number().min(0).max(1),
    supportingSourceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const companySearchAgentOutputSchema = z
  .object({
    companyName: z.string().min(2).max(160),
    executedQuery: z.string().min(3).max(500),
    sources: z.array(sourceCitationSchema).min(1),
    findings: z.array(companySearchFindingSchema).min(1),
    nextQuerySuggestion: z.string().min(3).max(500).optional(),
    generatedAt: z.string().datetime({ offset: true }),
    shouldEscalateToVerification: z.boolean(),
  })
  .strict();

export const verificationAgentInputSchema = z
  .object({
    claimId: z.string().min(1).optional(),
    companyName: z.string().min(2).max(160),
    claim: z.string().min(5).max(1000),
    sources: z.array(sourceCitationSchema).min(1),
    minimumRelevanceScore: z.number().min(0).max(1).default(0.8),
  })
  .strict();

export const verificationAssessmentSchema = z
  .object({
    relevance_score: z.number().min(0).max(1),
    verdict: z.enum([
      "verified",
      "partially_verified",
      "not_verified",
      "insufficient_evidence",
    ]),
    rationale: z.string().min(1),
    supportingSourceIds: z.array(z.string().min(1)).min(1),
    conflictingSourceIds: z.array(z.string().min(1)).default([]),
    reformulatedQuery: z.string().min(3).max(500).optional(),
    shouldRetrySearch: z.boolean(),
  })
  .strict();

export const verificationAgentOutputSchema = z
  .object({
    claimId: z.string().min(1).optional(),
    claim: z.string().min(5).max(1000),
    assessment: verificationAssessmentSchema,
    citations: z.array(sourceCitationSchema).min(1),
    validatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SourceCitation = Readonly<z.infer<typeof sourceCitationSchema>>;

export type CompanySearchAgentInput = Readonly<
  z.infer<typeof companySearchAgentInputSchema>
>;
export type CompanySearchAgentOutput = Readonly<
  z.infer<typeof companySearchAgentOutputSchema>
>;

export type VerificationAgentInput = Readonly<
  z.infer<typeof verificationAgentInputSchema>
>;
export type VerificationAgentOutput = Readonly<
  z.infer<typeof verificationAgentOutputSchema>
>;
