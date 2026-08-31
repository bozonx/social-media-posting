#!/usr/bin/env node
/**
 * Keep root TypeScript source resolution aligned with workspace packages.
 *
 * Root typechecking runs before package builds, so it must resolve every
 * workspace package to source rather than to its unbuilt dist declaration.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const packagesDir = 'packages';
const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
const paths = tsconfig.compilerOptions?.paths ?? {};
const workspacePackages = new Map();

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const manifestPath = join(packagesDir, entry.name, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  workspacePackages.set(manifest.name, `./packages/${entry.name}/src/index.ts`);
}

const failures = [];

for (const [name, sourcePath] of workspacePackages) {
  const configured = paths[name];
  if (configured?.length !== 1 || configured[0] !== sourcePath) {
    failures.push(`${name} must map to ${sourcePath}`);
  }
}

for (const name of Object.keys(paths)) {
  if (name !== '@bozonx/social-posting/platform' && !workspacePackages.has(name)) {
    failures.push(`${name} is not a workspace package`);
  }
}

if (failures.length > 0) {
  console.error('Workspace TypeScript path configuration is inconsistent:\n');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log('Workspace TypeScript paths: every package resolves to source.');
