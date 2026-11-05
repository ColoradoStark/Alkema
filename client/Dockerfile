# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
# Each file timed by what's in it, so one unchanged by a deploy comes back to a browser as a 304 (stamp.mjs)
RUN npm run build && node stamp.mjs dist

FROM nginx:alpine AS prod

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
