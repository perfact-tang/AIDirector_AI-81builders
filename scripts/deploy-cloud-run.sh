#!/usr/bin/env bash
set -euo pipefail
# 保留旧入口；现在不再需要 DEPLOY_ENV_FILE。
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT/deploy.sh" "$@"
