# Multi-stage: build with node, serve static with nginx.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json ./
RUN pnpm install
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
