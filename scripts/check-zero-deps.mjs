#!/usr/bin/env node
/**
 * Fail the build when a published package grows a runtime dependency.
 *
 * The zero-dependency rule is the whole reason this library is embeddable:
 * a vendor SDK wraps platform errors in its own class and loses the HTTP
 * status, `retry_after` and platform code the error contract is built on, and
 * most of them pull Node bindings that will not run on Workers.
 *
 * A rule nobody checks is not a rule, so this runs in CI.
 *
 * Exceptions are declared here, with the reason, and reviewed in the PR that
 * adds one. See dev_docs/package-readiness-plan.md, "Политика зависимостей".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** package name → dependency names it may declare, with why. */
const ALLOWED = {
  // Example of the only admissible case: exotic request-signing cryptography
  // that is more expensive to implement than to take. Must be an
  // optionalDependency of one network's package, never of the core.
};

const packagesDir = 'packages';
const failures = [];

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const manifestPath = join(packagesDir, entry.name, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    continue;
  }

  const allowed = new Set(ALLOWED[manifest.name] ?? []);
  const declared = Object.keys(manifest.dependencies ?? {});
  const unexpected = declared.filter(name => !allowed.has(name));

  if (unexpected.length > 0) {
    failures.push(`${manifest.name} declares runtime dependencies: ${unexpected.join(', ')}`);
  }

  // A peer dependency on a sibling package is the intended way for a platform
  // package to reach the core, so peers are not policed here — but an optional
  // dependency is a real install, and must be declared above.
  const optional = Object.keys(manifest.optionalDependencies ?? {}).filter(
    name => !allowed.has(name),
  );
  if (optional.length > 0) {
    failures.push(
      `${manifest.name} declares undeclared optional dependencies: ${optional.join(', ')}`,
    );
  }
}

if (failures.length > 0) {
  console.error('Zero-dependency policy violated:\n');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    '\nAdd an exception to scripts/check-zero-deps.mjs, with its reason, or drop the dependency.',
  );
  process.exit(1);
}

console.log('Zero-dependency policy: every published package is clean.');
