import { execFileSync } from "node:child_process";

const baseReference = process.env.MIGRATION_BASE_REF ?? "HEAD^";

let changedFiles;
try {
  changedFiles = execFileSync(
    "git",
    [
      "diff",
      "--name-status",
      `${baseReference}...HEAD`,
      "--",
      "apps/api/migrations",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
} catch (error) {
  console.error(
    `Could not compare migrations against ${baseReference}.`,
    error,
  );
  process.exit(1);
}

const modifiedAppliedMigration = changedFiles.find((entry) => {
  const [status, file] = entry.split("\t");
  return status === "M" && /^\d+_.+\.sql$/.test(file ?? "");
});

if (modifiedAppliedMigration) {
  console.error(
    `Applied migrations are immutable: ${modifiedAppliedMigration.split("\t")[1]} was modified. Add a new migration instead.`,
  );
  process.exit(1);
}

console.info(`Migration compatibility check passed against ${baseReference}.`);
