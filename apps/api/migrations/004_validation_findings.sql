-- Persisted, deterministic data-quality findings for a workflow run.

BEGIN;

SET search_path TO forgeflow, public;

CREATE TABLE workflow_validation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  finding_key text NOT NULL,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('ERROR', 'WARNING', 'INFO')),
  data_status text NOT NULL CHECK (data_status IN ('VALID', 'AMBIGUOUS', 'UNAVAILABLE', 'INVALID')),
  subject_type text NOT NULL,
  subject_id text,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, finding_key)
);

CREATE INDEX workflow_validation_findings_workflow_idx
  ON workflow_validation_findings (workflow_run_id, severity, created_at);

CREATE TRIGGER workflow_validation_findings_set_updated_at
  BEFORE UPDATE ON workflow_validation_findings
  FOR EACH ROW EXECUTE FUNCTION forgeflow.set_updated_at();

COMMIT;
