# npm Release Runbook

## Architecture

- **Source repo:** private (`aos-engineer/aos-harness`).
- **npm packages:** public scoped under `@aos-harness` (plus the unscoped `aos-harness` CLI). Free tier today; will flip to private / paid access-gated in a later release once monetization is ready.
- **Provenance attestations:** intentionally not produced. npm requires a public source repo for provenance; we keep the source private to preserve IP and the option to gate future versions. See "Future monetization" below.
- **Publish path:** tag-triggered GitHub Actions workflow (`.github/workflows/release.yml`) with an `npm-publish` environment gate.

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
# 4. Create the GitHub release:
gh release create v<version> --title "v<version>" --notes-file /tmp/release-notes.md
# 5. Release workflow starts. Post the link in #releases (or equivalent)
#    and @mention a reviewer from the npm-publish environment.
# 6. Reviewer approves. Publish completes in ~3–5 min.
# 7. Verify on a consumer machine:
mkdir /tmp/verify && cd /tmp/verify
npm init -y > /dev/null
npm install @aos-harness/pi-adapter@<version>
npm audit signatures
# Expected:
#   "1 package has a verified registry signature"
# (No "verified attestation" line — that would require --provenance / public source.)
```

## RC (release candidate) publishes

Tags matching `v*-rc.*` (e.g. `v0.7.0-rc.1`) automatically publish to the `next` dist-tag instead of `latest`. Consumers opt in with `npm i @aos-harness/<pkg>@next`.

## 24h environment approval timeout

If a reviewer does not approve within 24h, the workflow auto-cancels. This will happen on Friday-evening tag pushes. To re-trigger:

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

The original stuck tag remains as a dated annotated tag that never published — harmless.

## Break-glass (CI unavailable)

Requires two people. Do NOT do this alone.

1. **Person A** generates a new npm automation token scoped to `@aos-harness`:
   - npm.com → Access Tokens → Generate → Automation → scope `@aos-harness` → copy token.
2. **Person A** shares the token with **Person B** via 1Password shared item or Signal (never Slack/email).
3. **Person B** on a clean checkout at the signed tag publishes via vanilla `npm publish` (our `scripts/publish.ts --ci` refuses to run outside GitHub Actions by design, so break-glass deliberately bypasses it):
   ```bash
   git fetch --tags origin
   git checkout v<version>
   git status --porcelain   # must be empty
   export NODE_AUTH_TOKEN=<the-token>

   # Publish each package in dependency order (matches publish.ts PUBLISH_ORDER)
   for pkg_dir in runtime adapters/shared adapters/claude-code adapters/codex adapters/gemini adapters/pi cli; do
     (cd "$pkg_dir" && npm publish --access public)
   done

   unset NODE_AUTH_TOKEN
   ```
   > **Warning:** plain `npm publish` does NOT apply the `workspace:*` → pinned-version rewrite that `publish.ts` performs. Before running the loop, confirm tarballs are clean by running `bun run publish:dry-run` locally (or manually pin any `workspace:*` references in the package.json files at the tagged commit).
4. **Person A** immediately revokes the token at npm.com.
5. **Both** file an incident issue titled "Break-glass publish of v<version>" documenting why CI was unavailable, what was published, and the fix to prevent recurrence.

## NPM 2FA

Recommended on the `@aos-harness` scope. Configure at npm.com → Organizations → @aos-harness → Packages → Require 2FA. Automation tokens bypass the 2FA prompt (by design — they're issued behind a 2FA challenge) and are the only way CI can publish.

## Verifying registry signatures as a consumer

Every tarball npm serves is signed with npm's registry key. `npm audit signatures` verifies this after install:

```bash
mkdir /tmp/verify && cd /tmp/verify
npm init -y > /dev/null
npm install @aos-harness/pi-adapter@<version>    # note: NOT --no-save
npm audit signatures
# Expected: "1 package has a verified registry signature"
```

Without provenance, `npm audit signatures` will NOT print "verified attestation" — that's expected for private-source packages. Consumers rely on the environment-gated publish path and the clean-tag verification as the supply-chain guarantee instead.

## Secret hygiene

- `NPM_TOKEN` lives ONLY in the `npm-publish` GitHub environment, never at repo level.
- If a repo-level `NPM_TOKEN` is ever added, delete it immediately and rotate the npm token.
- Rotate the automation token on a schedule (every 90 days) or after any suspected compromise.

## Future monetization path

When you're ready to gate downloads to paying users:

1. Upgrade `@aos-harness` to a paid plan (Teams or Organizations) at npmjs.com.
2. In each of the 7 published `package.json` files, change `"publishConfig": { "access": "public" }` → `"publishConfig": { "access": "restricted" }`. Adjust `scripts/publish.ts --ci` to pass `--access restricted` instead of `--access public`.
3. Add paying customers as npm-org members with read permission to the scope (manually or via billing-integrated automation).
4. Bump the version and cut a new release. Previously-public versions stay public (you can deprecate them but not unpublish after 72h).

Pre-monetization versions (0.7.x, 0.8.x …) serve as a free tier entry point; paid features land at a later major.
