# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) to automate package versioning, changelogs, and releases.

## Adding a changeset

Whenever you make changes to one or more packages, run:

```bash
pnpm changeset
```

1. Select the packages affected by your changes.
2. Choose the semver bump type (`patch`, `minor`, `major`).
3. Enter a summary of the change for the changelog.
4. Commit the generated markdown file in `.changeset/` along with your code.

## Release Process

1. When changes are merged to `main`, GitHub Actions automatically creates or updates a **Version Packages** pull request.
2. Merging the **Version Packages** PR triggers the release workflow, which publishes packages to npm with provenance, creates git tags, and builds/pushes multi-arch Docker images.
