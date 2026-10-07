-- Analyst feedback is an append-only review signal. It is deliberately
-- separate from sources, facts, metrics, and report-item persistence.

BEGIN;

SET search_path TO forgeflow, public;

CREATE TABLE report_item_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  -- This is a durable snapshot reference rather than a foreign key: report
  -- assembly may replace mutable read-model items, while feedback must retain
  -- the exact item/version that an analyst reviewed.
  report_item_id uuid NOT NULL,
  report_version timestamptz NOT NULL,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  classification text NOT NULL CHECK (classification IN ('USEFUL', 'UNCLEAR', 'UNSUPPORTED', 'INCORRECT')),
  comment text CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 2000),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'RESOLVED')),
  resolved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'RESOLVED') = (resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL))
);

CREATE INDEX report_item_feedback_report_item_idx
  ON report_item_feedback (report_id, report_item_id, report_version, created_at DESC);
CREATE INDEX report_item_feedback_review_idx
  ON report_item_feedback (state, created_at DESC);

CREATE TRIGGER report_item_feedback_set_updated_at
  BEFORE UPDATE ON report_item_feedback
  FOR EACH ROW EXECUTE FUNCTION forgeflow.set_updated_at();

COMMIT;
