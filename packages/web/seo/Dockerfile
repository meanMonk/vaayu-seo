# Multi-stage: build with node, serve static with nginx.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
# npm (not pnpm): runs postinstall scripts non-interactively on any version.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
