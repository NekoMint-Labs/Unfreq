#!/bin/sh
set -eu

npm run api:migrate
exec npm --workspace @unfreq/api run start
