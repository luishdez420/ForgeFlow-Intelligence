import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "apps/api/Dockerfile",
  "apps/web/Dockerfile",
  "services/worker/Dockerfile",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing required container definition: ${file}`);
  }
  const contents = readFileSync(file, "utf8");
  if (!contents.includes("org.opencontainers.image.revision")) {
    throw new Error(
      `${file} must label images with the immutable build revision.`,
    );
  }
  if (contents.includes("latest")) {
    throw new Error(`${file} must not use a latest image tag.`);
  }
}

const requiredTaskDefinitions = ["api", "web", "worker", "migration"];

for (const name of requiredTaskDefinitions) {
  const file = `deploy/task-definitions/${name}.json`;
  if (!existsSync(file)) {
    throw new Error(`Missing required task definition: ${file}`);
  }
  const definition = JSON.parse(readFileSync(file, "utf8"));
  if (definition.containerDefinitions?.[0]?.image !== "IMAGE_URI") {
    throw new Error(
      `${file} must accept an immutable image URI at release time.`,
    );
  }
}

console.info("Container contract check passed.");
