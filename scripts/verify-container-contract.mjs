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
  if (definition.containerDefinitions?.[0]?.image !== "__IMAGE_URI__") {
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

const renderEnvironment = {
  TARGET_ENV: "staging",
  AWS_REGION: "us-east-1",
  ECS_TASK_EXECUTION_ROLE_ARN: "arn:aws:iam::123456789012:role/execution",
  ECS_TASK_ROLE_ARN: "arn:aws:iam::123456789012:role/task",
  DATABASE_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:database",
  INTERNAL_API_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:internal-api",
  WEB_AUTH_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:web-auth",
  GOOGLE_OAUTH_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:google-oauth",
  WEB_APP_ORIGIN: "http://localhost:3000",
  GOOGLE_WORKSPACE_DOMAIN: "",
  IMAGE_URI: "example.invalid/forgeflow@sha256:abc123",
};

for (const name of requiredTaskDefinitions) {
  const rendered = JSON.parse(
    execFileSync(
      "node",
      [
        "scripts/render-task-definition.mjs",
        `deploy/task-definitions/${name}.json`,
      ],
      { encoding: "utf8", env: { ...process.env, ...renderEnvironment } },
    ),
  );
  for (const container of rendered.containerDefinitions ?? []) {
    for (const entry of container.environment ?? []) {
      if (!entry.name?.trim()) {
        throw new Error(`${name} rendered a blank environment variable name.`);
      }
    }
  }
  if (
    name === "web" &&
    rendered.containerDefinitions?.[0]?.environment?.some(
      (entry) => entry.name === "GOOGLE_WORKSPACE_DOMAIN",
    )
  ) {
    throw new Error("A blank optional Workspace domain must be omitted.");
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
