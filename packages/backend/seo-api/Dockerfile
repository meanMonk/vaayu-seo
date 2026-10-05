FROM node:22-alpine

WORKDIR /app
COPY package.json ./
# npm (not pnpm): runs postinstall scripts non-interactively on any version.
# (Corepack pulls latest pnpm, which hard-blocks esbuild builds in Docker.)
RUN npm install --no-audit --no-fund
COPY . .

EXPOSE 3400
CMD ["npx", "tsx", "src/index.ts"]
