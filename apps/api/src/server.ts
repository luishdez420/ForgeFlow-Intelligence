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

const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const jsonHeaders = { "content-type": "application/json" };

class RequestBodyError extends Error {}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
}

async function readJson(
  request: import("node:http").IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new RequestBodyError("Request body exceeds 1 MB.");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

  try {
    if (
      request.method === "POST" &&
      pathname === "/workflows/company-analysis"
    ) {
      const parsed = createCompanyAnalysisWorkflowRequestSchema.safeParse(
        await readJson(request),
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
          await createCompanyAnalysisWorkflow(parsed.data),
        ),
      );
      return;
    }

    const workflowMatch = pathname.match(/^\/workflows\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && workflowMatch) {
      sendJson(
        response,
        200,
        workflowDetailSchema.parse(await getWorkflow(workflowMatch[1])),
      );
      return;
    }
    const reportMatch = pathname.match(/^\/reports\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && reportMatch) {
      sendJson(
        response,
        200,
        reportDetailSchema.parse(await getReport(reportMatch[1])),
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
