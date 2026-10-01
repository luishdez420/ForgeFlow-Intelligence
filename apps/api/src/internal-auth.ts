import { createHmac, timingSafeEqual } from "node:crypto";

import type { PilotRole } from "@forgeflow/schemas";

import { pool } from "./database.js";

const maxRequestAgeMilliseconds = 5 * 60 * 1000;

export type InternalActor = {
  id: string;
  roles: PilotRole[];
};

export class InternalRequestError extends Error {}

export function internalRequestPayload(
  timestamp: string,
  method: string,
  pathname: string,
  email: string,
  body: string,
): string {
  return [timestamp, method.toUpperCase(), pathname, email, body].join(".");
}

export function signInternalRequest(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifyInternalSignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signInternalRequest(secret, payload), "hex");
  const received = Buffer.from(signature, "hex");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export async function authenticateInternalActor(
  headers: Record<string, string | string[] | undefined>,
  method: string,
  pathname: string,
  body: string,
): Promise<InternalActor> {
  const secret = process.env.FORGEFLOW_INTERNAL_API_SECRET;
  const timestamp = headers["x-forgeflow-timestamp"];
  const signature = headers["x-forgeflow-signature"];
  const email = headers["x-forgeflow-user-email"];
  if (
    !secret ||
    typeof timestamp !== "string" ||
    typeof signature !== "string" ||
    typeof email !== "string"
  ) {
    throw new InternalRequestError("Authenticated internal request required.");
  }
  const timestampMilliseconds = Date.parse(timestamp);
  if (
    Number.isNaN(timestampMilliseconds) ||
    Math.abs(Date.now() - timestampMilliseconds) > maxRequestAgeMilliseconds
  ) {
    throw new InternalRequestError(
      "Internal request timestamp is invalid or expired.",
    );
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (
    !verifyInternalSignature(
      secret,
      internalRequestPayload(
        timestamp,
        method,
        pathname,
        normalizedEmail,
        body,
      ),
      signature,
    )
  ) {
    throw new InternalRequestError("Internal request signature is invalid.");
  }
  const result = await pool.query<{ id: string; role: PilotRole }>(
    `SELECT users.id, user_roles.role
     FROM forgeflow.users
     JOIN forgeflow.user_roles ON user_roles.user_id = users.id
     WHERE users.email = $1 AND users.status = 'ACTIVE'`,
    [normalizedEmail],
  );
  if (result.rows.length === 0) {
    throw new InternalRequestError(
      "User is not in the active analyst allow-list.",
    );
  }
  return {
    id: result.rows[0]!.id,
    roles: [...new Set(result.rows.map((row) => row.role))],
  };
}
