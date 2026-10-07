import { randomUUID } from "node:crypto";

const sensitiveKey =
  /(?:authorization|cookie|secret|token|password|api[-_]?key)/i;

export function correlationId(value: string | undefined): string {
  return value && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
    ? value
    : randomUUID();
}

export function redactTelemetry(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTelemetry);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactTelemetry(item),
    ]),
  );
}

export function emitOperationalEvent(
  event: string,
  fields: Record<string, unknown>,
): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "api",
      event,
      ...(redactTelemetry(fields) as Record<string, unknown>),
    }),
  );
}
