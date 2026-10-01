import { createHmac } from "node:crypto";

import type { Session } from "next-auth";

const apiBase = process.env.FORGEFLOW_API_URL ?? "http://localhost:3001";

function trustedOrigin(request: Request): boolean {
  const configured = process.env.APP_ORIGIN;
  const origin = request.headers.get("origin");
  return Boolean(origin && configured && origin === configured);
}

export async function callInternalApi(
  request: Request,
  session: Session | null,
  pathname: string,
): Promise<Response> {
  const email = session?.user?.email?.trim().toLowerCase();
  const secret = process.env.FORGEFLOW_INTERNAL_API_SECRET;
  if (!email || !secret) return new Response(null, { status: 401 });
  if (request.method !== "GET" && !trustedOrigin(request)) {
    return new Response(null, { status: 403 });
  }
  const body = request.method === "GET" ? "" : await request.text();
  const timestamp = new Date().toISOString();
  const payload = [timestamp, request.method, pathname, email, body].join(".");
  const signature = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
  return fetch(`${apiBase}${pathname}`, {
    method: request.method,
    body: body || undefined,
    headers: {
      "content-type": "application/json",
      "x-forgeflow-signature": signature,
      "x-forgeflow-timestamp": timestamp,
      "x-forgeflow-user-email": email,
    },
    cache: "no-store",
  });
}
