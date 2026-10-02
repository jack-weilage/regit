FROM oven/bun:1.4-slim

# TODO: install the toolchains target repositories need (Node, Python, …) once the demo repo is chosen

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git ripgrep \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src ./src

ENV SANDBOX_ROOT=/workspace PORT=8080
EXPOSE 8080
CMD ["bun", "src/main.ts"]
