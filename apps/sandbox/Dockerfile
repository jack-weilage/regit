FROM oven/bun:1.4-slim AS server
WORKDIR /app
COPY src ./src
RUN bun build --compile --minify src/main.ts --outfile /regit-sandbox

FROM debian:trixie-slim

# Downloaded packages stay in BuildKit caches, so rebuilding a layer below doesn't fetch them again.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt,sharing=locked \
	rm -f /etc/apt/apt.conf.d/docker-clean \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git ripgrep sudo debianutils

COPY --from=jdxcode/mise:2026.10.0 /usr/local/bin/mise /usr/local/bin/mise
COPY mise-system.toml /etc/mise/config.toml

ENV HOME=/root MISE_DATA_DIR=/opt/mise MISE_CACHE_DIR=/opt/mise/cache PATH=/opt/mise/shims:$PATH
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt,sharing=locked \
	--mount=type=cache,target=/opt/mise/cache \
	echo 'export PATH="/opt/mise/shims:$PATH"' > /etc/profile.d/mise.sh \
	&& mise install \
	&& agent-browser install --with-deps

# The server changes most often, so it comes last: a change to it rebuilds only these layers.
RUN ln -s /usr/local/bin/regit-sandbox /usr/local/bin/regit
COPY start.sh /usr/local/bin/regit-start
COPY --from=server /regit-sandbox /usr/local/bin/regit-sandbox

ENV SANDBOX_ROOT=/workspace PORT=8080
EXPOSE 8080
CMD ["regit-start"]
