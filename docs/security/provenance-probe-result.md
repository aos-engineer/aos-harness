# Provenance Probe Result

**Status:** Pending operator execution (see `docs/superpowers/plans/2026-04-14-publish-pipeline-hardening-plan.md` → Task 0).

When the operator runs the one-time probe publish, this file gets replaced with:
- Bun version tested
- Command used
- Probe package + version
- `npm audit signatures` result (verified / not verified)
- Decision: use `bun publish --provenance` OR fall back to `npx npm@latest publish --provenance`
