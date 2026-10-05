FROM node:22-alpine
RUN corepack enable

WORKDIR /app
COPY package.json ./
RUN pnpm install
COPY . .

EXPOSE 3400
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
