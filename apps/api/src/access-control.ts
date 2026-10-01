import { createHash } from "node:crypto";

import type { PilotRole } from "@forgeflow/schemas";

import { withTransaction, type Queryable } from "./database.js";

export type AccessActor = {
  id: string;
  roles: readonly PilotRole[];
};

export type AuditEventInput = {
  action: string;
  subjectId?: string;
  subjectType: string;
  metadata?: Record<string, unknown>;
};

export type InvitationInput = {
  email: string;
  expiresAt: Date;
  role: PilotRole;
  token: string;
};

export type PersistedUser = {
  id: string;
  status: "ACTIVE" | "REVOKED";
};

const sensitiveMetadataKey =
  /(?:authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key|idempotency[-_]?key)/i;

export class AccessDeniedError extends Error {
  constructor(
    message = "The current user is not permitted to perform this action.",
  ) {
    super(message);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAuditMetadata);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveMetadataKey.test(key)
        ? "[REDACTED]"
        : redactAuditMetadata(entry),
    ]),
  );
}

export function requireRole(actor: AccessActor, requiredRole: PilotRole): void {
  if (actor.roles.includes("ADMIN") || actor.roles.includes(requiredRole)) {
    return;
  }
  throw new AccessDeniedError();
}

export function requireWorkflowAccess(
  actor: AccessActor,
  submittedByUserId: string | null,
): void {
  if (actor.roles.includes("ADMIN") || submittedByUserId === actor.id) {
    return;
  }
  throw new AccessDeniedError("This analysis belongs to another analyst.");
}

export async function recordAuditEvent(
  queryable: Queryable,
  actorUserId: string | null,
  event: AuditEventInput,
): Promise<void> {
  await queryable.query(
    `INSERT INTO forgeflow.audit_events
       (actor_user_id, action, subject_type, subject_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      actorUserId,
      event.action,
      event.subjectType,
      event.subjectId ?? null,
      JSON.stringify(redactAuditMetadata(event.metadata ?? {})),
    ],
  );
}

export async function upsertActiveUser(
  email: string,
  displayName?: string,
): Promise<PersistedUser> {
  const normalizedEmail = normalizeEmail(email);
  return withTransaction(async (client) => {
    const result = await client.query<PersistedUser>(
      `INSERT INTO forgeflow.users (email, display_name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, forgeflow.users.display_name)
       RETURNING id, status`,
      [normalizedEmail, displayName ?? null],
    );
    const user = result.rows[0];
    if (!user) {
      throw new Error("User persistence did not return an identifier.");
    }
    if (user.status === "REVOKED") {
      throw new AccessDeniedError("This user's access has been revoked.");
    }
    return user;
  });
}

export async function acceptInvitation(
  userId: string,
  token: string,
): Promise<PilotRole> {
  return withTransaction(async (client) => {
    const result = await client.query<{ id: string; role: PilotRole }>(
      `UPDATE forgeflow.invitations
       SET status = 'ACCEPTED', accepted_by_user_id = $1, accepted_at = now()
       WHERE token_hash = $2
         AND status = 'PENDING'
         AND expires_at > now()
         AND email = (SELECT email FROM forgeflow.users WHERE id = $1)
       RETURNING id, role`,
      [userId, hashInvitationToken(token)],
    );
    const invitation = result.rows[0];
    if (!invitation) {
      throw new AccessDeniedError(
        "This invitation is invalid, expired, or revoked.",
      );
    }
    await client.query(
      `INSERT INTO forgeflow.user_roles (user_id, role)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, invitation.role],
    );
    await recordAuditEvent(client, userId, {
      action: "INVITATION_ACCEPTED",
      subjectType: "INVITATION",
      subjectId: invitation.id,
      metadata: { role: invitation.role },
    });
    return invitation.role;
  });
}

export async function inviteUser(
  actor: AccessActor,
  invitation: InvitationInput,
): Promise<{ invitationId: string }> {
  requireRole(actor, "ADMIN");
  const email = normalizeEmail(invitation.email);

  return withTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO forgeflow.invitations
         (email, role, token_hash, invited_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        email,
        invitation.role,
        hashInvitationToken(invitation.token),
        actor.id,
        invitation.expiresAt,
      ],
    );
    const invitationId = result.rows[0]?.id;
    if (!invitationId) {
      throw new Error("Invitation persistence did not return an identifier.");
    }
    await recordAuditEvent(client, actor.id, {
      action: "INVITATION_CREATED",
      subjectType: "INVITATION",
      subjectId: invitationId,
      metadata: { email, role: invitation.role },
    });
    return { invitationId };
  });
}

export async function revokeUser(
  actor: AccessActor,
  userId: string,
): Promise<void> {
  requireRole(actor, "ADMIN");
  await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE forgeflow.users
       SET status = 'REVOKED', revoked_at = now()
       WHERE id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    if (result.rowCount !== 1) {
      throw new AccessDeniedError("The active user could not be revoked.");
    }
    await client.query(
      `UPDATE forgeflow.invitations
       SET status = 'REVOKED', revoked_at = now()
       WHERE email = (SELECT email FROM forgeflow.users WHERE id = $1)
         AND status = 'PENDING'`,
      [userId],
    );
    await recordAuditEvent(client, actor.id, {
      action: "USER_REVOKED",
      subjectType: "USER",
      subjectId: userId,
    });
  });
}
