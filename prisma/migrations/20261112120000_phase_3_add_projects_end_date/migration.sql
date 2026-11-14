-- ============================================================================
-- Phase 3 Chunk 3C: Add projects.end_date column
-- ============================================================================
--
-- Traces to:
--   - SRS v3.0 FR-PROJ-02 ("Store objectives, start date, end date,
--     status, priority")
--   - SRS v3.0 §6.2 data dictionary does not freeze start_date / end_date;
--     Master Requirements Catalogue G-03 flags this gap.
--   - Phase 3 Decision D1: add end_date only (start_date was added in
--     Phase 0 by migration 20261104155425_add_check_constraints_and_audit_trigger).
--
-- Additive only. Nullable. No CHECK constraints. No data migration.
-- ============================================================================

ALTER TABLE "projects" ADD COLUMN "end_date" TIMESTAMPTZ(6);
