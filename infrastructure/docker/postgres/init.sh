#!/bin/sh
# Runs once, when the Postgres data directory is first created.
#
# Two roles, on purpose:
#   tms_owner  owns the schema and is used ONLY to run migrations.
#   tms_app    is what the API connects as. It owns nothing and cannot bypass row-level security,
#              which is what keeps one company's data invisible to another.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE tms_owner LOGIN PASSWORD '${TMS_OWNER_PASSWORD}' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE tms_app   LOGIN PASSWORD '${TMS_APP_PASSWORD}'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE tms      OWNER tms_owner;
CREATE DATABASE tms_test OWNER tms_owner;
SQL
