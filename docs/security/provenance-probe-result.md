# Provenance Probe Result

**Date:** 2026-04-14
**Status:** ✅ VERIFIED — `npm publish --provenance` from GitHub Actions produces valid SLSA attestations that `npm audit signatures` confirms.
**Probe runs:** `24408969472`, `24416197563`, `24418457163`, `24419719695`, `24420001130`, `24420940312` (iterated through multiple issues; last three successfully published `0.0.1`, `0.0.2`, `0.0.3`).
**Package:** `@aos-harness/provenance-probe` (deprecate after cleanup).

## Path taken

The probe uncovered four distinct failure modes before succeeding. Each informed the final publish/verify pipeline:

| # | Failure | Root cause | Fix |
|---|---|---|---|
| 1 | `bun publish` → `missing authentication` | Bun 1.3.12 doesn't expand `${NODE_AUTH_TOKEN}` in `.npmrc` | Switched `scripts/publish.ts --ci` and the probe workflow to `npx npm@latest publish --provenance` |
| 2 | `npm publish --provenance` → HTTP 422: `Unsupported GitHub Actions source repository visibility: "private"` | Provenance requires public source repo | Made `aos-engineer/aos-harness` public |
| 3 | `npm publish --provenance` → HTTP 422: `repository.url` mismatch | Scratch package's `package.json` had stale `aos-framework` URL | Updated probe `repository.url` to `aos-harness` |
| 4 | `npm audit signatures` → `found no dependencies to audit` and `ETARGET no matching version` | Two separate bugs: audit signatures only walks packages in `package.json`, and CDN propagation takes 15-120s after publish | Install without `--no-save`, wrap install in retry loop |

## Final verification

Local end-to-end verification (2026-04-14 20:21 UTC):

```
$ mkdir /tmp/verify && cd /tmp/verify && npm init -y >/dev/null
$ npm install @aos-harness/provenance-probe@0.0.3
  added 1 package
$ npm audit signatures
  audited 1 package in 1s
  1 package has a verified registry signature
  1 package has a verified attestation
$ npm view @aos-harness/provenance-probe@0.0.3 dist.attestations
  {
    url: 'https://registry.npmjs.org/-/npm/v1/attestations/@aos-harness%2fprovenance-probe@0.0.3',
    provenance: { predicateType: 'https://slsa.dev/provenance/v1' }
  }
```

## Decision in code

`scripts/publish.ts --ci` invokes `npx --yes npm@latest publish --access public --provenance --tag=<distTag>`. `.github/workflows/release.yml` verify step installs all 7 tagged packages (with retry for CDN propagation) and runs `npm audit signatures`.

## Cleanup tasks (operator)

Once the real release (`v0.7.0-rc.1`) is published and verified:

1. Deprecate scratch versions:
   ```
   npm deprecate @aos-harness/provenance-probe@0.0.1 "scratch — verification only"
   npm deprecate @aos-harness/provenance-probe@0.0.2 "scratch — verification only"
   npm deprecate @aos-harness/provenance-probe@0.0.3 "scratch — verification only"
   ```
2. Delete repo secret:
   ```
   gh secret delete NPM_TOKEN_PROBE --repo aos-engineer/aos-harness
   ```
3. Optionally remove probe artifacts:
   ```
   git rm -r .github/workflows/provenance-probe.yml scripts/provenance-probe/
   ```
   (Alternative: keep them for future auditing — `workflow_dispatch`-only, never auto-fires.)

## Reopen conditions

Revisit this decision if any become true:

- Bun's `bun publish` gains `${VAR}` expansion in `.npmrc` AND first-party Sigstore/OIDC provenance support (currently only the npm CLI has this).
- npm policy changes (e.g., provenance for private repos becomes supported).
- Our release workflow begins to require features only Bun's publisher provides.
