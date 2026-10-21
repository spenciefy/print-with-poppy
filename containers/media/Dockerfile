FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY .cloudflare/containers/media.cjs ./server.cjs
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
