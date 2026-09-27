-- ForgeFlow MVP initial persistence model.
-- Apply transactionally with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 001_initial_schema.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS forgeflow;
SET search_path TO forgeflow, public;

CREATE FUNCTION forgeflow.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL UNIQUE CHECK (ticker = upper(ticker) AND ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  name text,
  cik text UNIQUE,
  exchange text,
  sector text,
  industry text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('STARTING', 'RUNNING', 'DRAINING', 'STOPPED')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  ticker text NOT NULL CHECK (ticker = upper(ticker) AND ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  workflow_type text NOT NULL CHECK (workflow_type = 'COMPANY_ANALYSIS'),
  definition_version integer NOT NULL DEFAULT 1 CHECK (definition_version > 0),
  state text NOT NULL CHECK (state IN ('PENDING', 'RUNNING', 'WAITING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  idempotency_key text UNIQUE,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (completed_at IS NOT NULL))
);

CREATE TABLE workflow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('FETCH_COMPANY_PROFILE', 'FETCH_SEC_FILINGS', 'FETCH_MARKET_HISTORY', 'NORMALIZE_COMPANY_DATA', 'NORMALIZE_FINANCIAL_DATA', 'CALCULATE_FINANCIAL_METRICS', 'CALCULATE_MARKET_METRICS', 'VALIDATE_SOURCES', 'GENERATE_ANALYSIS', 'ASSEMBLE_REPORT', 'PUBLISH_REPORT')),
  state text NOT NULL CHECK (state IN ('PENDING', 'LEASED', 'RUNNING', 'WAITING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_by_worker_id uuid REFERENCES workers(id),
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((state = 'LEASED') = (lease_token IS NOT NULL)),
  CHECK ((state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (completed_at IS NOT NULL))
);

CREATE TABLE workflow_task_dependencies (
  task_id uuid NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE task_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES workers(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  lease_token uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_class text CHECK (error_class IN ('TRANSIENT', 'RATE_LIMIT', 'VALIDATION', 'AUTHENTICATION', 'PERMANENT')),
  error_code text,
  error_message text,
  UNIQUE (task_id, attempt_number)
);

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  source_type text NOT NULL CHECK (source_type IN ('SEC_FILING', 'COMPANY_WEBSITE', 'MARKET_DATA', 'NEWS', 'USER_DOCUMENT', 'DATABASE', 'API')),
  provider text NOT NULL,
  origin_url text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, origin_url, content_hash)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  external_identifier text,
  filing_date date,
  content_location text,
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, content_hash)
);

CREATE TABLE facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  document_id uuid REFERENCES documents(id),
  field_name text NOT NULL,
  raw_value jsonb NOT NULL,
  normalized_value jsonb,
  normalization_status text NOT NULL CHECK (normalization_status IN ('NORMALIZED', 'UNAVAILABLE', 'AMBIGUOUS', 'REJECTED')),
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE financial_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  metric_name text NOT NULL,
  period_end date,
  value numeric,
  unit text NOT NULL,
  formula_version text NOT NULL,
  input_snapshot jsonb NOT NULL,
  calculation_status text NOT NULL CHECK (calculation_status IN ('CALCULATED', 'UNAVAILABLE', 'INVALID_INPUT')),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL UNIQUE REFERENCES workflow_runs(id),
  company_id uuid REFERENCES companies(id),
  state text NOT NULL CHECK (state IN ('DRAFT', 'PUBLISHED', 'FAILED')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'PUBLISHED') = (published_at IS NOT NULL))
);

CREATE TABLE report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  item_kind text NOT NULL CHECK (item_kind IN ('FACT', 'CALCULATION', 'AI_ANALYSIS', 'UNAVAILABLE')),
  section text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  financial_metric_id uuid REFERENCES financial_metrics(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, display_order)
);

CREATE TABLE report_item_sources (
  report_item_id uuid NOT NULL REFERENCES report_items(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id),
  PRIMARY KEY (report_item_id, source_id)
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid REFERENCES workflow_tasks(id),
  purpose text NOT NULL,
  model text NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  allowed_source_ids jsonb NOT NULL,
  structured_output jsonb,
  input_token_count integer CHECK (input_token_count >= 0),
  output_token_count integer CHECK (output_token_count >= 0),
  estimated_cost numeric CHECK (estimated_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  permission text NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REJECTED')),
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX workflow_tasks_ready_idx ON workflow_tasks (available_at, created_at)
  WHERE state IN ('PENDING', 'RETRYING');
CREATE INDEX workflow_tasks_expired_lease_idx ON workflow_tasks (lease_expires_at)
  WHERE state = 'LEASED';
CREATE INDEX task_attempts_task_idx ON task_attempts (task_id, attempt_number DESC);
CREATE INDEX workflow_task_dependencies_dependency_idx ON workflow_task_dependencies (depends_on_task_id);
CREATE INDEX sources_company_retrieved_idx ON sources (company_id, retrieved_at DESC);
CREATE INDEX facts_company_field_idx ON facts (company_id, field_name, observed_at DESC NULLS LAST);
CREATE INDEX financial_metrics_company_name_idx ON financial_metrics (company_id, metric_name, period_end DESC NULLS LAST);
CREATE INDEX report_items_report_section_idx ON report_items (report_id, section, display_order);

CREATE TRIGGER companies_set_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION forgeflow.set_updated_at();
CREATE TRIGGER workers_set_updated_at BEFORE UPDATE ON workers FOR EACH ROW EXECUTE FUNCTION forgeflow.set_updated_at();
CREATE TRIGGER workflow_runs_set_updated_at BEFORE UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION forgeflow.set_updated_at();
CREATE TRIGGER workflow_tasks_set_updated_at BEFORE UPDATE ON workflow_tasks FOR EACH ROW EXECUTE FUNCTION forgeflow.set_updated_at();
CREATE TRIGGER reports_set_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION forgeflow.set_updated_at();

COMMIT;
