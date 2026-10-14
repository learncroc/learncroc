# learncroc in a container (multi-arch: build with `docker buildx build --platform linux/amd64,linux/arm64`).
#
#   docker build -f docker/Dockerfile -t learncroc .
#   docker run --rm -p 127.0.0.1:4747:4747 -p 127.0.0.1:4748:4748 -v learncroc:/data learncroc
#
# Publish both ports to the host's loopback only: the server trusts 127.0.0.1/localhost Host headers,
# and 4748 is the sandbox origin for pack interactives. Learner data lives in the /data volume.

FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json biome.json ./
COPY apps ./apps
COPY packages ./packages
COPY packs ./packs
COPY registry ./registry
COPY templates ./templates
COPY scripts ./scripts
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    LEARNCROC_HOME=/data \
    LEARNCROC_BIND=0.0.0.0 \
    LEARNCROC_PORT=4747
COPY --from=build /app /app
RUN mkdir -p /data && chown -R bun:bun /data
USER bun
VOLUME ["/data"]
EXPOSE 4747 4748
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD bun -e "const r = await fetch('http://127.0.0.1:4747/api/health', { headers: { host: '127.0.0.1:4747' } }); process.exit(r.ok ? 0 : 1)"
ENTRYPOINT ["bun", "packages/cli/src/index.ts"]
CMD ["serve", "--no-open"]
