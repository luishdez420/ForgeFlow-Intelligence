import { createServer } from "node:http";

import {
  apiErrorSchema,
  createCompanyAnalysisWorkflowRequestSchema,
  createCompanyAnalysisWorkflowResponseSchema,
  reportDetailSchema,
  workflowDetailSchema,
} from "@forgeflow/schemas";

import {
  createCompanyAnalysisWorkflow,
  getWorkflow,
  WorkflowNotFoundError,
} from "./workflows.js";
import { getReport, ReportNotFoundError } from "./reports.js";
import {
  authenticateInternalActor,
  InternalRequestError,
} from "./internal-auth.js";
import { AccessDeniedError } from "./access-control.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json",
  "cross-origin-resource-policy": "same-site",
  "x-content-type-options": "nosniff",
};

class RequestBodyError extends Error {}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
}

function readJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new RequestBodyError("Request body must be valid JSON.");
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", service: "forgeflow-api" });
    return;
  }

  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  let requestBody = "";
  if (request.method !== "GET" && request.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    requestBody = Buffer.concat(chunks).toString("utf8");
    if (Buffer.byteLength(requestBody) > 1_000_000) {
      sendJson(
        response,
        400,
        apiErrorSchema.parse({
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body exceeds 1 MB.",
          },
        }),
      );
      return;
    }
  }

  try {
    const actor = await authenticateInternalActor(
      request.headers,
      request.method ?? "GET",
      pathname,
      requestBody,
    );
    if (
      request.method === "POST" &&
      pathname === "/workflows/company-analysis"
    ) {
      const parsed = createCompanyAnalysisWorkflowRequestSchema.safeParse(
        readJson(requestBody),
      );
      if (!parsed.success) {
        sendJson(
          response,
          400,
          apiErrorSchema.parse({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid company-analysis workflow request.",
            },
          }),
        );
        return;
      }
      sendJson(
        response,
        201,
        createCompanyAnalysisWorkflowResponseSchema.parse(
          await createCompanyAnalysisWorkflow({
            ...parsed.data,
            submittedByUserId: actor.id,
          }),
        ),
      );
      return;
    }

    const workflowMatch = pathname.match(/^\/workflows\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && workflowMatch) {
      sendJson(
        response,
        200,
        workflowDetailSchema.parse(await getWorkflow(workflowMatch[1], actor)),
      );
      return;
    }
    const reportMatch = pathname.match(/^\/reports\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && reportMatch) {
      sendJson(
        response,
        200,
        reportDetailSchema.parse(await getReport(reportMatch[1], actor)),
      );
      return;
    }
  } catch (error) {
    if (
      error instanceof WorkflowNotFoundError ||
      error instanceof ReportNotFoundError
    ) {
      sendJson(
        response,
        404,
        apiErrorSchema.parse({
          error: { code: "NOT_FOUND", message: error.message },
        }),
      );
      return;
    }
    if (error instanceof RequestBodyError) {
      sendJson(
        response,
        400,
        apiErrorSchema.parse({
          error: { code: "VALIDATION_ERROR", message: error.message },
        }),
      );
      return;
    }
    if (error instanceof InternalRequestError) {
      sendJson(
        response,
        401,
        apiErrorSchema.parse({
          error: { code: "UNAUTHORIZED", message: "Authentication required." },
        }),
      );
      return;
    }
    if (error instanceof AccessDeniedError) {
      sendJson(
        response,
        403,
        apiErrorSchema.parse({
          error: { code: "FORBIDDEN", message: "Access denied." },
        }),
      );
      return;
    }

    sendJson(
      response,
      500,
      apiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected workflow service failure.",
        },
      }),
    );
    return;
  }

  sendJson(
    response,
    404,
    apiErrorSchema.parse({
      error: { code: "NOT_FOUND", message: "Route not found." },
    }),
  );
});

server.listen(port, () => {
  console.info(`ForgeFlow API listening on http://localhost:${port}`);
});
