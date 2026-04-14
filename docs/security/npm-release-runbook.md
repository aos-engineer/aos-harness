# npm Release Runbook

## Who can publish

Publishing requires (a) a tag push by a maintainer, plus (b) approval from a reviewer configured on the `npm-publish` GitHub environment. No laptop-based publishes in normal operation.

## Normal release

```bash
# 1. Bump versions on main (manually or via a script). All 7 published
#    package.json files must carry the same <version>.
# 2. Commit the bump: `chore(release): <version>`
# 3. Tag and push:
git tag -a v<version> -m "v<version>"
git push origin main
git push origin v<version>
# 4. Release workflow starts. Post the link in #releases (or equivalent)
#    and @mention a reviewer from the npm-publish environment.
# 5. Reviewer approves. Publish completes in ~3–5 min.
# 6. Verify on consumer machine (install-then-audit — npm audit signatures
#    only audits installed dependencies, not arbitrary package@version args):
mkdir /tmp/verify && cd /tmp/verify
npm init -y > /dev/null
npm install --no-save @aos-harness/pi-adapter@<version>
npm audit signatures
```

## RC (release candidate) publishes

Tags matching `v*-rc.*` (e.g. `v0.7.0-rc.1`) automatically publish to the `next` dist-tag instead of `latest`. Consumers opt in with `npm i @aos-harness/<pkg>@next`.

## 24h environment approval timeout

If a reviewer does not approve within 24h, the workflow auto-cancels. **This will happen on Friday-evening tag pushes.** To re-trigger:

```bash
# Delete and re-push the same tag:
git tag -d v<version>
git push --delete origin v<version>
git tag -a v<version> -m "v<version>"
git push origin v<version>

# OR: cut a new rc tag and let that flow through:
git tag -a v<version>-rc.N -m "v<version>-rc.N"
git push origin v<version>-rc.N
```

The original stuck tag remains in the repo as a dated annotated tag that never published — harmless.

## Break-glass (CI unavailable)

Requires two people. Do NOT do this alone.

1. **Person A** generates a new npm automation token scoped to `@aos-harness`:
   - npm.com → Access Tokens → Generate → Automation → scope `@aos-harness` → copy token.
2. **Person A** shares the token with **Person B** via 1Password shared item or Signal (never Slack/email).
3. **Person B** on a clean checkout at the signed tag publishes via vanilla `npm publish` (our `scripts/publish.ts --ci` refuses to run outside GitHub Actions by design, so break-glass deliberately bypasses it):
   ```bash
   # On a clean checkout at the signed tag:
   git fetch --tags origin
   git checkout v<version>
   git status --porcelain   # must be empty
   export NODE_AUTH_TOKEN=<the-token>

   # Publish each package in dependency order (matches publish.ts PUBLISH_ORDER)
   for pkg_dir in runtime adapters/shared adapters/claude-code adapters/codex adapters/gemini adapters/pi cli; do
     (cd "$pkg_dir" && npm publish --access public --provenance)
   done

   unset NODE_AUTH_TOKEN
   ```
   > **Warning:** plain `npm publish` does NOT apply the `workspace:*` → pinned-version rewrite that `publish.ts` performs. Before running the loop, confirm tarballs are clean by running `bun run publish:dry-run` locally (or manually pin any `workspace:*` references in the package.json files at the tagged commit).
4. **Person A** immediately revokes the token at npm.com.
5. **Both** file an incident issue titled "Break-glass publish of v<version>" documenting:
   - Why CI was unavailable
   - What was published
   - What fix prevents recurrence

## NPM 2FA

Required for publish on the `@aos-harness` scope. Configure at npm.com → Organizations → @aos-harness → Packages → Require 2FA. Automation tokens bypass the 2FA prompt (by design — they're issued behind a 2FA challenge) and are the only way CI can publish.

## Verifying provenance as a consumer

`npm audit signatures` only audits packages installed in `node_modules`, so first install the package(s), then audit:

```bash
mkdir /tmp/verify && cd /tmp/verify
npm init -y > /dev/null
npm install @aos-harness/pi-adapter@<version>    # note: NOT --no-save
npm audit signatures
# Expected: "verified" for all packages (audit signatures only walks
# dependencies recorded in package.json, hence no --no-save)

npm view @aos-harness/pi-adapter@<version> dist.attestations
# Expected: present, contains GitHub Actions workflow URL
```

## Secret hygiene

- `NPM_TOKEN` lives ONLY in the `npm-publish` GitHub environment, never at repo level.
- If a repo-level `NPM_TOKEN` is ever added, delete it immediately and rotate the npm token.
- Rotate the automation token on a schedule (every 90 days) or after any suspected compromise.

## Provenance probe (reference)

See `docs/security/provenance-probe-result.md` for the record of the one-time test that verified Bun's `bun publish --provenance` produces valid attestations.
