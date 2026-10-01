import { z } from "zod";

export const SCHEMA_PACKAGE_VERSION = "0.1.0";

export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/, "Ticker must be a valid US ticker symbol.");

export const workflowStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "WAITING",
  "RETRYING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
export const taskStateSchema = z.enum([
  "PENDING",
  "LEASED",
  "RUNNING",
  "WAITING",
  "RETRYING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
export const taskKindSchema = z.enum([
  "FETCH_COMPANY_PROFILE",
  "FETCH_SEC_FILINGS",
  "FETCH_MARKET_HISTORY",
  "NORMALIZE_COMPANY_DATA",
  "NORMALIZE_FINANCIAL_DATA",
  "CALCULATE_FINANCIAL_METRICS",
  "CALCULATE_MARKET_METRICS",
  "VALIDATE_SOURCES",
  "GENERATE_ANALYSIS",
  "ASSEMBLE_REPORT",
  "PUBLISH_REPORT",
]);
export const reportItemKindSchema = z.enum([
  "FACT",
  "CALCULATION",
  "AI_ANALYSIS",
  "UNAVAILABLE",
]);
export const sourceTypeSchema = z.enum([
  "SEC_FILING",
  "COMPANY_WEBSITE",
  "MARKET_DATA",
  "NEWS",
  "USER_DOCUMENT",
  "DATABASE",
  "API",
]);
export const pilotRoleSchema = z.enum(["ANALYST", "ADMIN"]);
export const userStatusSchema = z.enum(["ACTIVE", "REVOKED"]);
export const invitationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);

const utcDateTimeSchema = z.string().datetime({ offset: true });
const workflowIdSchema = z.uuid();

export const sourceReferenceSchema = z.object({
  sourceId: z.uuid(),
  sourceType: sourceTypeSchema,
  provider: z.string().min(1).max(100),
  url: z.url(),
  retrievedAt: utcDateTimeSchema,
  documentId: z.uuid().optional(),
  documentSection: z.string().min(1).max(500).optional(),
});

export const createCompanyAnalysisWorkflowRequestSchema = z.object({
  ticker: tickerSchema,
  idempotencyKey: z.string().min(1).max(255).optional(),
});

export const workflowTaskSummarySchema = z.object({
  id: z.uuid(),
  kind: taskKindSchema,
  state: taskStateSchema,
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  dependsOn: z.array(z.uuid()),
  nextAttemptAt: utcDateTimeSchema.nullable(),
  startedAt: utcDateTimeSchema.nullable(),
  completedAt: utcDateTimeSchema.nullable(),
  lastErrorCode: z.string().min(1).max(100).nullable(),
});

export const createCompanyAnalysisWorkflowResponseSchema = z.object({
  workflowId: workflowIdSchema,
  state: workflowStateSchema,
  createdAt: utcDateTimeSchema,
});

export const workflowDetailSchema = z.object({
  id: workflowIdSchema,
  ticker: tickerSchema,
  state: workflowStateSchema,
  createdAt: utcDateTimeSchema,
  startedAt: utcDateTimeSchema.nullable(),
  completedAt: utcDateTimeSchema.nullable(),
  tasks: z.array(workflowTaskSummarySchema),
});

export const reportItemSchema = z
  .object({
    id: z.uuid(),
    kind: reportItemKindSchema,
    section: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    content: z.string().min(1),
    sources: z.array(sourceReferenceSchema),
    calculationId: z.uuid().optional(),
    agentRunId: z.uuid().optional(),
  })
  .superRefine((item, context) => {
    if (item.kind !== "UNAVAILABLE" && item.sources.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message:
          "Facts, calculations, and AI analysis require at least one source.",
      });
    }
  });

export const reportDetailSchema = z.object({
  id: z.uuid(),
  workflowId: workflowIdSchema,
  ticker: tickerSchema,
  publishedAt: utcDateTimeSchema,
  items: z.array(reportItemSchema),
});

export const apiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
]);
export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.uuid().optional(),
  }),
});

export type CreateCompanyAnalysisWorkflowRequest = z.infer<
  typeof createCompanyAnalysisWorkflowRequestSchema
>;
export type CreateCompanyAnalysisWorkflowResponse = z.infer<
  typeof createCompanyAnalysisWorkflowResponseSchema
>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type TaskKind = z.infer<typeof taskKindSchema>;
export type WorkflowTaskSummary = z.infer<typeof workflowTaskSummarySchema>;
export type WorkflowDetail = z.infer<typeof workflowDetailSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type ReportItemKind = z.infer<typeof reportItemKindSchema>;
export type ReportItem = z.infer<typeof reportItemSchema>;
export type ReportDetail = z.infer<typeof reportDetailSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type PilotRole = z.infer<typeof pilotRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;
