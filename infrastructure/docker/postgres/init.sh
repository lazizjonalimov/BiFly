#!/bin/sh
# Runs once, when the Postgres data directory is first created.
#
# Two roles, on purpose:
#   flyfleet_owner  owns the schema and is used ONLY to run migrations.
#   flyfleet_app    is what the API connects as. It owns nothing and cannot bypass row-level security,
#                   which is what keeps one company's data invisible to another.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE flyfleet_owner LOGIN PASSWORD '${FLYFLEET_OWNER_PASSWORD}' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE flyfleet_app   LOGIN PASSWORD '${FLYFLEET_APP_PASSWORD}'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE flyfleet      OWNER flyfleet_owner;
CREATE DATABASE flyfleet_test OWNER flyfleet_owner;
SQL
