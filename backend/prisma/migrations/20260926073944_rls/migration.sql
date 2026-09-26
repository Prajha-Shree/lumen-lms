-- Row-Level Security for tenant isolation (ADR-1, docs/architecture.md).
--
-- The backend connects as `lms_app` (NOSUPERUSER, NOBYPASSRLS, not the table owner)
-- and, inside each transaction, runs one of:
--   SELECT set_config('app.tenant_id', '<uuid>', true);   -- normal request
--   SELECT set_config('app.bypass_rls', 'on', true);      -- vetted system operation
-- `true` = transaction-local, so settings never leak to the next pooled request.
-- With neither set, every tenant-owned table appears empty and writes are rejected.

-- NULLIF: once a custom setting has been used on a connection it reverts to '' (not
-- NULL) after the transaction, and ''::uuid would raise instead of matching nothing.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'on' $$;

-- Every tenant-owned table: one policy covering SELECT/INSERT/UPDATE/DELETE.
-- FORCE also applies RLS to the table owner (defense in depth for non-superuser owners).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'refresh_tokens',
    'courses', 'modules', 'lessons', 'lesson_attachments', 'enrollments', 'lesson_progress',
    'cognitive_assessments', 'cognitive_profiles',
    'exams', 'exam_questions', 'exam_sessions', 'proctoring_events',
    'learning_activities', 'user_badges', 'notifications', 'recommendations',
    'forum_threads', 'forum_posts', 'assignments', 'submissions',
    'analytics_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant() OR app_rls_bypass())
         WITH CHECK (tenant_id = app_current_tenant() OR app_rls_bypass())',
      t
    );
  END LOOP;
END $$;

-- tenants: the directory (name, slug) is readable so login can resolve a slug, but a
-- tenant can only modify its own row, and only system operations create or delete.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_read   ON tenants FOR SELECT USING (true);
CREATE POLICY tenants_update ON tenants FOR UPDATE
  USING (id = app_current_tenant() OR app_rls_bypass())
  WITH CHECK (id = app_current_tenant() OR app_rls_bypass());
CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (app_rls_bypass());
CREATE POLICY tenants_delete ON tenants FOR DELETE USING (app_rls_bypass());

-- Grants for the runtime role. The Docker init script sets default privileges on the
-- main database, but test/CI databases are created later, so grant explicitly here too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT USAGE ON SCHEMA public TO lms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lms_app;
    GRANT EXECUTE ON FUNCTION app_current_tenant(), app_rls_bypass() TO lms_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lms_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lms_app;
    -- The runtime role must never touch migration bookkeeping. (Absent in Prisma's
    -- shadow database, hence the guard.)
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON TABLE _prisma_migrations FROM lms_app;
    END IF;
  END IF;
END $$;
