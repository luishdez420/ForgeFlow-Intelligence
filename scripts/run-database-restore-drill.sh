#!/usr/bin/env bash
set -euo pipefail

required=(
  AWS_REGION TARGET_ENV ECS_CLUSTER ECS_SUBNETS ECS_SECURITY_GROUP
  ECS_TASK_EXECUTION_ROLE_ARN ECS_TASK_ROLE_ARN
  RESTORE_MIGRATION_SECRET_ARN RESTORE_RUNTIME_SECRET_ARN
)

for name in "${required[@]}"; do
  test -n "${!name:-}" || {
    echo "Missing required environment variable: $name" >&2
    exit 1
  }
done

api_service="forgeflow-${TARGET_ENV}-api"
api_task_definition=$(aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$api_service" \
  --query 'services[0].taskDefinition' \
  --output text)
test "$api_task_definition" != "None" || {
  echo "No active API service exists for ${api_service}." >&2
  exit 1
}

image_uri=$(aws ecs describe-task-definition \
  --task-definition "$api_task_definition" \
  --query "taskDefinition.containerDefinitions[?name=='api'].image | [0]" \
  --output text)
test -n "$image_uri" && test "$image_uri" != "None" || {
  echo "Unable to determine the deployed API image." >&2
  exit 1
}

rendered_task=$(mktemp)
trap 'rm -f "$rendered_task"' EXIT

run_restore_task() {
  local template="$1"
  local container_name="$2"
  local task_definition
  local task_arn
  local task_id
  local exit_code

  DATABASE_SECRET_ARN="$RESTORE_MIGRATION_SECRET_ARN" \
    DATABASE_RUNTIME_SECRET_ARN="$RESTORE_RUNTIME_SECRET_ARN" \
    IMAGE_URI="$image_uri" \
    node scripts/render-task-definition.mjs "$template" > "$rendered_task"
  task_definition=$(aws ecs register-task-definition \
    --cli-input-json "file://${rendered_task}" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)
  task_arn=$(aws ecs run-task \
    --cluster "$ECS_CLUSTER" \
    --launch-type FARGATE \
    --task-definition "$task_definition" \
    --network-configuration "awsvpcConfiguration={subnets=[$ECS_SUBNETS],securityGroups=[$ECS_SECURITY_GROUP],assignPublicIp=DISABLED}" \
    --query 'tasks[0].taskArn' \
    --output text)
  aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$task_arn"
  exit_code=$(aws ecs describe-tasks \
    --cluster "$ECS_CLUSTER" \
    --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' \
    --output text)
  if [ "$exit_code" != "0" ]; then
    task_id="${task_arn##*/}"
    echo "${container_name} stopped with exit code ${exit_code}." >&2
    aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
      --query 'tasks[0].{stoppedReason:stoppedReason,containers:containers[].{name:name,reason:reason,exitCode:exitCode}}' \
      --output json >&2 || true
    aws logs get-log-events \
      --log-group-name "/forgeflow/${TARGET_ENV}/database-role-bootstrap" \
      --log-stream-name "ecs/${container_name}/${task_id}" \
      --start-from-head \
      --query 'events[].message' \
      --output text >&2 || true
    exit 1
  fi
  echo "${container_name} succeeded."
}

run_restore_task \
  deploy/task-definitions/database-role-bootstrap.json \
  database-role-bootstrap
run_restore_task \
  deploy/task-definitions/database-runtime-smoke.json \
  database-runtime-smoke

echo "Restore drill passed: constrained runtime access was verified against the isolated database."
