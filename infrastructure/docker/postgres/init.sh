#!/bin/sh
# Runs once, when the Postgres data directory is first created.
#
# Two roles, on purpose:
#   bifly_owner  owns the schema and is used ONLY to run migrations.
#   bifly_app    is what the API connects as. It owns nothing and cannot bypass row-level security,
#                which is what keeps one company's data invisible to another.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE bifly_owner LOGIN PASSWORD '${BIFLY_OWNER_PASSWORD}' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE bifly_app   LOGIN PASSWORD '${BIFLY_APP_PASSWORD}'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE bifly      OWNER bifly_owner;
CREATE DATABASE bifly_test OWNER bifly_owner;
SQL
