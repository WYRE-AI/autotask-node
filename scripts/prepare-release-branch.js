#!/usr/bin/env node
/**
 * Prepare a release branch + tag under branch-protected main.
 *
 * Usage (via npm scripts):
 *   npm run release:patch|minor|major
 *
 * Expects package.json version already bumped (--no-git-tag-version).
 * Creates branch release/vX.Y.Z, commits the bump, prints next steps
 * (push branch, open PR, push tag). Does not push to main.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const pkgPath = path.join(process.cwd(), 'package.json');
const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
const tag = `v${version}`;
const branch = `release/${tag}`;

const existingTag = (() => {
  try {
    runCapture(`git rev-parse -q --verify "refs/tags/${tag}"`);
    return true;
  } catch {
    return false;
  }
})();

if (existingTag) {
  console.error(`Error: tag ${tag} already exists`);
  process.exit(1);
}

const status = runCapture('git status --porcelain');
if (!status.includes('package.json')) {
  console.error(
    'Error: expected package.json to be modified with the new version'
  );
  process.exit(1);
}

const unrelatedStaged = runCapture('git diff --cached --name-only')
  .split('\n')
  .filter(
    file => file && !['package.json', 'package-lock.json'].includes(file)
  );
if (unrelatedStaged.length > 0) {
  console.error(
    `Error: unrelated staged changes: ${unrelatedStaged.join(', ')}`
  );
  process.exit(1);
}

run(`git checkout -b "${branch}"`);
run('git add package.json package-lock.json');
run(
  `git commit -m "chore: bump version to ${version}" -- package.json package-lock.json`
);
run(`git tag -a "${tag}" -m "Release ${tag}"`);

console.log(`
Release branch and tag prepared locally.

Next steps (branch protection blocks direct pushes to main):
  1. git push -u origin ${branch}
  2. gh pr create --base main --head ${branch} --title "Release ${tag}" --body "Version bump for ${tag}."
  3. After the PR is approved and merged (or in parallel once the release commit exists):
       git push origin ${tag}
     Pushing the tag triggers .github/workflows/release.yml (publish + GitHub Release).

Do not run: git push origin main
`);
