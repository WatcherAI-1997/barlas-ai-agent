#!/bin/sh
set -eu

for migration in /migrations/*.sql; do
  echo "Applying ${migration}"
  psql --set ON_ERROR_STOP=1 --file "$migration"
done
