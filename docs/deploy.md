# Deployment

Build with `pnpm docker:build` and start with `pnpm docker:up`. The image builds from source and
runs as the unprivileged `node` user. Compose mounts `config.yaml` read-only, enables init,
graceful stop, health checks, log rotation and a memory limit. Supply secrets through environment
variables referenced by `config.yaml`; never write them into the YAML file or image.
