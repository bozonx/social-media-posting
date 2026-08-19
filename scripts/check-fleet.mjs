#!/usr/bin/env node
/**
 * Reports drift between this service and the fleet reference implementation.
 *
 * The files below are meant to be byte-identical in every service: changing one of them in a
 * single repository is how a fleet stops being a fleet. Nothing enforced that before, and the
 * shared HTTP helpers, the exception filter and `main.ts` had already diverged silently.
 *
 * The reference checkout is found through FLEET_BOILERPLATE_PATH, falling back to a sibling
 * directory. When it is absent — CI, a fresh clone — the check reports that it was skipped and
 * succeeds, because an unavailable reference is not a defect in this repository.
 *
 * Usage: pnpm check:fleet
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files that must be byte-identical across every service in the fleet. */
const SHARED_FILES = [
  '.editorconfig',
  '.npmrc',
  '.prettierrc.yml',
  '.prettierignore',
  'eslint.config.js',
  'knip.json',
  'renovate.json',
  'scripts/check-fleet.mjs',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.spec.json',
  'test/tsconfig.json',
  'test/e2e/env-helper.ts',
  'src/common/auth/auth.hook.ts',
  'src/common/filters/all-exceptions.filter.ts',
  'src/common/http/api-prefix.ts',
  'src/common/logger/logger.factory.ts',
  'src/common/utils/validation-errors.ts',
  'src/config/auth.config.ts',
  'src/config/env.ts',
  'src/config/validate-config.ts',
  'src/modules/health/health.service.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/security.yml',
  '.github/workflows/release.yml',
];

/**
 * Files whose *shared section* must match, rather than the whole file.
 * The value is the heading that opens the service-specific part.
 */
const SHARED_SECTIONS = [{ file: 'AGENTS.md', until: '## Service specifics' }];

const REFERENCE_NAME = 'ivank-microservice-boilerplate';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const referencePath = resolve(
  process.env.FLEET_BOILERPLATE_PATH ?? join(repoRoot, '..', REFERENCE_NAME),
);

/**
 * Reads a file, or returns null when it does not exist.
 *
 * @param path - Absolute file path.
 * @returns File contents, or null.
 */
function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Returns everything before the given heading.
 *
 * @param text - Whole file.
 * @param heading - Heading that opens the service-specific part.
 * @returns The shared part of the file.
 */
function sharedSection(text, heading) {
  const index = text.indexOf(heading);
  return index === -1 ? text : text.slice(0, index);
}

const isReference = repoRoot === referencePath;
const problems = [];

if (!existsSync(referencePath)) {
  console.log(
    `check:fleet skipped: no ${REFERENCE_NAME} checkout at ${referencePath}.\n` +
      'Set FLEET_BOILERPLATE_PATH to compare against one.',
  );
  process.exit(0);
}

for (const file of SHARED_FILES) {
  const mine = read(join(repoRoot, file));
  const theirs = read(join(referencePath, file));

  if (mine === null) {
    problems.push(`missing: ${file}`);
    continue;
  }
  if (theirs === null) {
    problems.push(`missing in ${REFERENCE_NAME}: ${file}`);
    continue;
  }
  if (!isReference && mine !== theirs) {
    problems.push(`drifted: ${file}`);
  }
}

for (const { file, until } of SHARED_SECTIONS) {
  const mine = read(join(repoRoot, file));
  const theirs = read(join(referencePath, file));

  if (mine === null || theirs === null) {
    problems.push(`missing: ${file}`);
    continue;
  }
  if (!isReference && sharedSection(mine, until) !== sharedSection(theirs, until)) {
    problems.push(`drifted (shared section): ${file}`);
  }
}

if (problems.length > 0) {
  console.error(`check:fleet found ${problems.length} problem(s) against ${referencePath}:`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nShared files are changed in the boilerplate and rolled out, never forked per service.\n' +
      'If a difference is deliberate, record it under "Allowed deviations" in docs/standards.md\n' +
      'and take the file off the shared list.',
  );
  process.exit(1);
}

console.log(
  isReference
    ? `check:fleet: all ${SHARED_FILES.length} shared files present in the reference implementation.`
    : `check:fleet: ${SHARED_FILES.length} shared files match ${REFERENCE_NAME}.`,
);
