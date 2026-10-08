#!/usr/bin/env bash
set -euo pipefail

required=(
  AWS_REGION TARGET_ENV ECS_CLUSTER ECS_SUBNETS ECS_SECURITY_GROUP
  ECS_TASK_EXECUTION_ROLE_ARN ECS_TASK_ROLE_ARN DATABASE_SECRET_ARN
  INTERNAL_API_SECRET_ARN WEB_AUTH_SECRET_ARN GOOGLE_OAUTH_SECRET_ARN
  SERVICE_DISCOVERY_NAMESPACE_ARN
  API_IMAGE_URI WEB_IMAGE_URI WORKER_IMAGE_URI
)

# A private bootstrap has neither public HTTPS ingress nor a Workspace domain.
# These defaults let the web container start and pass its local health check.
# Replace them before enabling analyst sign-in.
: "${WEB_APP_ORIGIN:=http://localhost:3000}"
: "${GOOGLE_WORKSPACE_DOMAIN:=}"

for name in "${required[@]}"; do
  test -n "${!name:-}" || { echo "Missing required environment variable: $name" >&2; exit 1; }
done

declare -A previous_task_definitions
declare -A created_services

render_task_definition() {
  local service="$1"
  local image_uri="$2"
  sed \
    -e "s|API_ENV|${TARGET_ENV}|g" \
    -e "s|AWS_REGION|${AWS_REGION}|g" \
    -e "s|TASK_EXECUTION_ROLE_ARN|${ECS_TASK_EXECUTION_ROLE_ARN}|g" \
    -e "s|TASK_ROLE_ARN|${ECS_TASK_ROLE_ARN}|g" \
    -e "s|DATABASE_SECRET_ARN|${DATABASE_SECRET_ARN}|g" \
    -e "s|INTERNAL_API_SECRET_ARN|${INTERNAL_API_SECRET_ARN}|g" \
    -e "s|WEB_AUTH_SECRET_ARN|${WEB_AUTH_SECRET_ARN}|g" \
    -e "s|GOOGLE_OAUTH_SECRET_ARN|${GOOGLE_OAUTH_SECRET_ARN}|g" \
    -e "s|WEB_APP_ORIGIN|${WEB_APP_ORIGIN}|g" \
    -e "s|GOOGLE_WORKSPACE_DOMAIN|${GOOGLE_WORKSPACE_DOMAIN}|g" \
    -e "s|IMAGE_URI|${image_uri}|g" \
    "deploy/task-definitions/${service}.json" > "${service}-task.json"
}

rollback() {
  for service in api web worker; do
    local service_name="forgeflow-${TARGET_ENV}-${service}"
    if [[ -n "${previous_task_definitions[$service]:-}" ]]; then
      aws ecs update-service --cluster "$ECS_CLUSTER" --service "$service_name" --task-definition "${previous_task_definitions[$service]}" --force-new-deployment >/dev/null
    elif [[ "${created_services[$service]:-}" == "true" ]]; then
      aws ecs update-service --cluster "$ECS_CLUSTER" --service "$service_name" --desired-count 0 >/dev/null
    fi
  done
}

trap rollback ERR

for service in api web worker; do
  case "$service" in
    api) image_uri="$API_IMAGE_URI" ;;
    web) image_uri="$WEB_IMAGE_URI" ;;
    worker) image_uri="$WORKER_IMAGE_URI" ;;
  esac

  render_task_definition "$service" "$image_uri"
  task_definition=$(aws ecs register-task-definition --cli-input-json "file://${service}-task.json" --query 'taskDefinition.taskDefinitionArn' --output text)
  service_name="forgeflow-${TARGET_ENV}-${service}"
  status=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$service_name" --query 'services[0].status' --output text 2>/dev/null || true)

  if [[ "$status" == "ACTIVE" ]]; then
    previous_task_definitions[$service]=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$service_name" --query 'services[0].taskDefinition' --output text)
    aws ecs update-service --cluster "$ECS_CLUSTER" --service "$service_name" --task-definition "$task_definition" --force-new-deployment >/dev/null
  elif [[ "$service" == "api" ]]; then
    aws ecs create-service \
      --cluster "$ECS_CLUSTER" \
      --service-name "$service_name" \
      --task-definition "$task_definition" \
      --launch-type FARGATE \
      --desired-count 1 \
      --health-check-grace-period-seconds 90 \
      --network-configuration "awsvpcConfiguration={subnets=[$ECS_SUBNETS],securityGroups=[$ECS_SECURITY_GROUP],assignPublicIp=DISABLED}" \
      --service-connect-configuration "enabled=true,namespace=$SERVICE_DISCOVERY_NAMESPACE_ARN,services=[{portName=api,discoveryName=api,clientAliases=[{port=3001,dnsName=api}]}]" \
      >/dev/null
    created_services[$service]=true
  else
    aws ecs create-service \
      --cluster "$ECS_CLUSTER" \
      --service-name "$service_name" \
      --task-definition "$task_definition" \
      --launch-type FARGATE \
      --desired-count 1 \
      --health-check-grace-period-seconds 90 \
      --network-configuration "awsvpcConfiguration={subnets=[$ECS_SUBNETS],securityGroups=[$ECS_SECURITY_GROUP],assignPublicIp=DISABLED}" \
      >/dev/null
    created_services[$service]=true
  fi

  aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$service_name"
done

trap - ERR
