#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_HARNESS_ROOT="/Users/jkolade/sireskay/github/aos-framework"

resolve_harness_root() {
  if [ -n "${AOS_HARNESS_ROOT:-}" ]; then
    printf '%s\n' "${AOS_HARNESS_ROOT}"
    return 0
  fi

  local repo_local_root
  repo_local_root="$(cd -- "${PLUGIN_ROOT}/../.." && pwd)"
  if [ -f "${repo_local_root}/cli/src/index.ts" ] && [ -f "${repo_local_root}/package.json" ]; then
    printf '%s\n' "${repo_local_root}"
    return 0
  fi

  if [ -f "${DEFAULT_HARNESS_ROOT}/cli/src/index.ts" ] && [ -f "${DEFAULT_HARNESS_ROOT}/package.json" ]; then
    printf '%s\n' "${DEFAULT_HARNESS_ROOT}"
    return 0
  fi

  return 1
}

if ! command -v bun >/dev/null 2>&1; then
  echo "aos-harness requires Bun on PATH." >&2
  echo "Install Bun from https://bun.sh and retry." >&2
  exit 127
fi

if ! REPO_ROOT="$(resolve_harness_root)"; then
  echo "Unable to locate an AOS Harness checkout." >&2
  echo "Set AOS_HARNESS_ROOT to a directory containing cli/src/index.ts." >&2
  exit 1
fi

cd "${REPO_ROOT}"
exec bun run cli/src/index.ts "$@"
