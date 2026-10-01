import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  acceptInvitation,
  inviteUser,
  revokeUser,
  upsertActiveUser,
} from "../src/access-control.js";
import { pool } from "../src/database.js";

const runIntegration = process.env.INTEGRATION_TEST === "1";
const createdUserIds: string[] = [];

describe.skipIf(!runIntegration)("pilot access-control persistence", () => {
  afterAll(async () => {
    await pool.query(
      "DELETE FROM forgeflow.audit_events WHERE actor_user_id = ANY($1::uuid[]) OR subject_id = ANY($1::uuid[])",
      [createdUserIds],
    );
    await pool.query(
      "DELETE FROM forgeflow.invitations WHERE invited_by_user_id = ANY($1::uuid[]) OR accepted_by_user_id = ANY($1::uuid[])",
      [createdUserIds],
    );
    await pool.query("DELETE FROM forgeflow.users WHERE id = ANY($1::uuid[])", [
      createdUserIds,
    ]);
    await pool.end();
  });

  it("persists invitation acceptance, roles, revocation, and redacted audit metadata", async () => {
    const suffix = randomUUID();
    const admin = await upsertActiveUser(`admin-${suffix}@example.com`);
    const analyst = await upsertActiveUser(`analyst-${suffix}@example.com`);
    createdUserIds.push(admin.id, analyst.id);
    await pool.query(
      "INSERT INTO forgeflow.user_roles (user_id, role) VALUES ($1, 'ADMIN')",
      [admin.id],
    );

    const token = `invite-${suffix}`;
    const { invitationId } = await inviteUser(
      { id: admin.id, roles: ["ADMIN"] },
      {
        email: `analyst-${suffix}@example.com`,
        expiresAt: new Date(Date.now() + 60_000),
        role: "ANALYST",
        token,
      },
    );
    expect(await acceptInvitation(analyst.id, token)).toBe("ANALYST");

    const role = await pool.query<{ role: string }>(
      "SELECT role FROM forgeflow.user_roles WHERE user_id = $1",
      [analyst.id],
    );
    expect(role.rows).toContainEqual({ role: "ANALYST" });

    await revokeUser({ id: admin.id, roles: ["ADMIN"] }, analyst.id);
    await expect(
      upsertActiveUser(`analyst-${suffix}@example.com`),
    ).rejects.toThrow("revoked");

    const audit = await pool.query<{ metadata: unknown }>(
      `SELECT metadata FROM forgeflow.audit_events
       WHERE subject_id = $1 AND action = 'INVITATION_CREATED'`,
      [invitationId],
    );
    expect(audit.rows[0]?.metadata).toEqual({
      email: `analyst-${suffix}@example.com`,
      role: "ANALYST",
    });
  });
});
