import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ text: string; values?: unknown[] }>,
  ended: false,
}));

vi.mock("pg", () => ({
  Client: class {
    async connect() {}
    async query(text: string, values?: unknown[]) {
      state.queries.push({ text, values });
      if (text.includes("current_user"))
        return { rows: [{ role: "forgeflow_runtime" }] };
      if (text.includes("INSERT INTO forgeflow.companies")) {
        return { rows: [{ ticker: "FFDRILL" }] };
      }
      return { rows: [] };
    }
    async end() {
      state.ended = true;
    }
  },
}));

import { verifyRuntimeDatabaseAccess } from "../src/database-runtime-smoke.js";

describe("runtime database smoke", () => {
  it("performs the disposable read/write verification in a rolled-back transaction", async () => {
    await expect(
      verifyRuntimeDatabaseAccess("postgresql://runtime:secret@db/forgeflow"),
    ).resolves.toEqual({ role: "forgeflow_runtime", ticker: "FFDRILL" });
    expect(state.queries.map((query) => query.text)).toEqual(
      expect.arrayContaining(["BEGIN", "ROLLBACK"]),
    );
    expect(state.ended).toBe(true);
  });
});
