#!/bin/bash
# Fail if any yaml.load() call lacks { schema: yaml.JSON_SCHEMA }
UNSAFE=$(grep -rn 'yaml\.load(' --include='*.ts' runtime/src/ adapters/ | grep -v 'JSON_SCHEMA' | grep -v 'test' || true)
if [ -n "$UNSAFE" ]; then
  echo "ERROR: Unsafe yaml.load() calls found (missing JSON_SCHEMA):"
  echo "$UNSAFE"
  exit 1
fi
echo "OK: All yaml.load() calls use JSON_SCHEMA"
