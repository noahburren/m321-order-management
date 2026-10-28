#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
CREATE USER order_service WITH PASSWORD '${ORDER_DB_PASSWORD}';
CREATE USER processing_service WITH PASSWORD '${PROCESSING_DB_PASSWORD}';
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA order_service AUTHORIZATION order_service;
CREATE SCHEMA processing_service AUTHORIZATION processing_service;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO order_service, processing_service;
EOSQL
