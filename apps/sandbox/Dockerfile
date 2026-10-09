FROM oven/bun:1.4-slim AS server
WORKDIR /app
COPY src ./src
RUN bun build --compile --minify src/main.ts --outfile /regit-sandbox

FROM debian:trixie-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git ripgrep sudo debianutils \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=jdxcode/mise:2026.10.0 /usr/local/bin/mise /usr/local/bin/mise
COPY --from=server /regit-sandbox /usr/local/bin/regit-sandbox
RUN ln -s /usr/local/bin/regit-sandbox /usr/local/bin/regit
COPY mise-system.toml /etc/mise/config.toml
COPY start.sh /usr/local/bin/regit-start

ENV HOME=/root MISE_DATA_DIR=/opt/mise MISE_CACHE_DIR=/opt/mise/cache PATH=/opt/mise/shims:$PATH
RUN echo 'export PATH="/opt/mise/shims:$PATH"' > /etc/profile.d/mise.sh \
	&& mise install \
	&& agent-browser install --with-deps \
	&& rm -rf /var/lib/apt/lists/*

ENV SANDBOX_ROOT=/workspace PORT=8080
EXPOSE 8080
CMD ["regit-start"]
