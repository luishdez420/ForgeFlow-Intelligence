import { readFileSync } from "node:fs";

const [templatePath] = process.argv.slice(2);

if (!templatePath) {
  throw new Error(
    "Usage: node scripts/render-task-definition.mjs <template-path>",
  );
}

const tokenValues = {
  __API_ENV__: process.env.TARGET_ENV,
  __AWS_REGION__: process.env.AWS_REGION,
  __TASK_EXECUTION_ROLE_ARN__: process.env.ECS_TASK_EXECUTION_ROLE_ARN,
  __TASK_ROLE_ARN__: process.env.ECS_TASK_ROLE_ARN,
  __DATABASE_SECRET_ARN__: process.env.DATABASE_SECRET_ARN,
  __INTERNAL_API_SECRET_ARN__: process.env.INTERNAL_API_SECRET_ARN,
  __WEB_AUTH_SECRET_ARN__: process.env.WEB_AUTH_SECRET_ARN,
  __GOOGLE_OAUTH_SECRET_ARN__: process.env.GOOGLE_OAUTH_SECRET_ARN,
  __WEB_APP_ORIGIN__: process.env.WEB_APP_ORIGIN,
  __GOOGLE_WORKSPACE_DOMAIN__: process.env.GOOGLE_WORKSPACE_DOMAIN,
  __IMAGE_URI__: process.env.IMAGE_URI,
};

const optionalEnvironmentTokens = new Set(["__GOOGLE_WORKSPACE_DOMAIN__"]);
const definition = JSON.parse(readFileSync(templatePath, "utf8"));
const template = JSON.stringify(definition);

for (const [token, value] of Object.entries(tokenValues)) {
  if (!template.includes(token)) continue;
  if (optionalEnvironmentTokens.has(token)) continue;
  if (!value) throw new Error(`Missing value for ${token}.`);
}

const replaceTokens = (value) => {
  if (typeof value === "string") {
    return Object.entries(tokenValues).reduce(
      (rendered, [token, replacement]) =>
        rendered.replaceAll(token, replacement ?? ""),
      value,
    );
  }
  if (Array.isArray(value)) return value.map(replaceTokens);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceTokens(item)]),
    );
  }
  return value;
};

for (const container of definition.containerDefinitions ?? []) {
  container.environment = (container.environment ?? []).filter(
    (entry) =>
      !(
        optionalEnvironmentTokens.has(entry.value) && !tokenValues[entry.value]
      ),
  );
}

const rendered = replaceTokens(definition);
const serialized = JSON.stringify(rendered);

if (/__[A-Z0-9_]+__/.test(serialized)) {
  throw new Error(`Unresolved task-definition placeholder in ${templatePath}.`);
}

for (const container of rendered.containerDefinitions ?? []) {
  for (const entry of container.environment ?? []) {
    if (!entry.name?.trim()) {
      throw new Error(
        `${templatePath} contains a blank environment variable name.`,
      );
    }
    if (entry.value === undefined || entry.value === null) {
      throw new Error(
        `${templatePath} contains an unset environment variable value.`,
      );
    }
  }
}

process.stdout.write(`${JSON.stringify(rendered)}\n`);
