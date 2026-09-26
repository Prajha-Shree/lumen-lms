#!/bin/bash
# Runs once, on first init of the Postgres volume.
# Creates the least-privilege runtime role the backend connects as. It is NOT a
# superuser and NOT BYPASSRLS, so Row-Level Security policies always apply to it.
# Tables are created by the owner role (POSTGRES_USER) via Prisma migrations; the
# default privileges below give the app role DML (not DDL) on those tables.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}'
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
  GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};

  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_DB_USER};
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${APP_DB_USER};
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO ${APP_DB_USER};
EOSQL
