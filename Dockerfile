FROM oven/bun:1.2

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bunx --bun prisma generate

EXPOSE 3000
CMD ["sh", "-c", "bunx --bun prisma migrate deploy && bun prisma/seed.ts && bun src/server.ts"]
