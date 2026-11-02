#!/bin/sh
set -eu

npm run api:migrate
cd apps/api
exec node dist/server.js
