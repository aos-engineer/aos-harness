# Provenance Probe Result

**Date:** 2026-04-14
**Probe run:** GitHub Actions run [24408969472](https://github.com/aos-engineer/aos-harness/actions/runs/24408969472) on `feat/cli-adapter-integration`.
**Package used:** `@aos-harness/provenance-probe@0.0.1` (scratch; deprecate after verification completes).

## Finding

**Bun 1.3.12 `bun publish` cannot authenticate against npm in GitHub Actions** when auth is set up via the standard `actions/setup-node@v4` + `registry-url` + `NODE_AUTH_TOKEN` flow.

The workflow's setup-node step writes an `.npmrc` containing:

```
//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}
```

npm's CLI expands the `${NODE_AUTH_TOKEN}` placeholder from the environment at publish time. **Bun's `bun publish` does not perform this expansion** — it reads the literal string `${NODE_AUTH_TOKEN}` as the auth token and fails with:

```
error: missing authentication (run `bunx npm login`)
```

This is independent of the `--provenance` question: Bun cannot publish at all under the CI auth convention. The probe therefore never reached the point of testing whether Bun produces real attestations.

## Decision

`scripts/publish.ts --ci` publishes via the **npm CLI**, not Bun:

```ts
await $`npx --yes npm@latest publish --access public --provenance --tag=${distTag}`
```

This path is expected to:

1. Authenticate correctly via the `actions/setup-node` + `NODE_AUTH_TOKEN` convention.
2. Produce real Sigstore/OIDC-signed provenance attestations that `npm audit signatures` verifies.

Re-running the updated probe workflow will confirm both properties end-to-end.

`bun publish --dry-run` remains the packing mechanism in `--dry-run` mode (local-only, no auth required) — the npm switch is only for the `--ci` upload path.

## Follow-up

The probe workflow (`.github/workflows/provenance-probe.yml`) has been updated to match (`npx npm publish --provenance`) for re-verification. Once a re-run confirms `npm audit signatures @aos-harness/provenance-probe@0.0.1` passes:

1. Deprecate the scratch package: `npm deprecate @aos-harness/provenance-probe "scratch — verification only"`.
2. Delete the `NPM_TOKEN_PROBE` repo secret.
3. Optionally delete `.github/workflows/provenance-probe.yml` and `scripts/provenance-probe/` (or keep them for future audits — workflow-dispatch-only, never auto-fires).

## Reopen conditions

Revisit this decision if any of the following become true:

- Bun's `bun publish` gains `${VAR}` expansion in `.npmrc`.
- Bun gains first-party Sigstore/OIDC provenance support (currently only npm CLI has this).
- Our release workflow begins to require features only Bun's publisher provides (unlikely — this is a publish operation).
