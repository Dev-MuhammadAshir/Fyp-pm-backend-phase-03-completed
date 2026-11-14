-- This is an empty migration.-- ============================================================================
-- CHECK constraints (SRS §6.2 explicit)
-- ============================================================================

ALTER TABLE users ADD CONSTRAINT users_global_role_check
  CHECK (global_role IN ('Administrator', 'Project Manager', 'Team Member', 'Viewer'));
ALTER TABLE users ADD CONSTRAINT users_capacity_check
  CHECK (configured_capacity_hours BETWEEN 10 AND 80);

ALTER TABLE team_members ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('Admin-Assigned', 'Member'));

ALTER TABLE project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('Manager', 'Contributor', 'Viewer'));

ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('Active', 'OnHold', 'Completed', 'Archived'));
ALTER TABLE projects ADD CONSTRAINT projects_priority_check
  CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE'));
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_type_check
  CHECK (type IN ('BLOCKS'));

ALTER TABLE attachments ADD CONSTRAINT attachments_xor_check
  CHECK ((task_id IS NOT NULL AND comment_id IS NULL)
      OR (task_id IS NULL AND comment_id IS NOT NULL));

ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN ('CREATE', 'UPDATE', 'DELETE'));

ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_risk_type_check
  CHECK (risk_type IN ('WORKLOAD', 'DELAY', 'DEPENDENCY', 'PRIORITY'));
ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_severity_check
  CHECK (severity IN ('Low', 'Medium', 'High', 'Critical'));
ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_status_check
  CHECK (status IN ('Open', 'Resolved'));
ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_score_check
  CHECK (risk_score BETWEEN 0 AND 100);

-- Partial unique index for PIRAE (G-06)
CREATE UNIQUE INDEX idx_risk_open_unique
  ON risk_assessments (project_id, risk_type, target_key)
  WHERE status = 'Open' AND target_key IS NOT NULL;

-- ============================================================================
-- Append-only audit trigger (SRS §6.2, CA-12)
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_logs_prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are forbidden (SRS CA-12)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_mutation();
