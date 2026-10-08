import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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
const requiredSecretNames = {
  api: ["DATABASE_URL", "FORGEFLOW_INTERNAL_API_SECRET"],
  web: [
    "AUTH_SECRET",
    "AUTH_GOOGLE_ID",
    "AUTH_GOOGLE_SECRET",
    "FORGEFLOW_INTERNAL_API_SECRET",
  ],
};

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
  const secrets = definition.containerDefinitions?.[0]?.secrets ?? [];
  for (const secretName of requiredSecretNames[name] ?? []) {
    if (!secrets.some((secret) => secret.name === secretName)) {
      throw new Error(`${file} must inject ${secretName} at runtime.`);
    }
  }
}

if (
  JSON.parse(readFileSync("deploy/task-definitions/api.json", "utf8"))
    .containerDefinitions?.[0]?.portMappings?.[0]?.name !== "api"
) {
  throw new Error("The API task must name its port for Service Connect.");
}

execFileSync("bash", ["-n", "scripts/deploy-ecs-services.sh"], {
  stdio: "inherit",
});

console.info("Container contract check passed.");
