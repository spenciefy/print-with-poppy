FROM node:22-bookworm-slim
WORKDIR /app
COPY .cloudflare/containers/protocol.cjs ./server.cjs
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
