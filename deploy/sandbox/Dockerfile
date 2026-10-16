FROM node:24-alpine

RUN apk add --no-cache git python3 \
    && mkdir -p /workspace /run/barlas-sandbox /tmp/npm-cache \
    && chown -R node:node /workspace /run/barlas-sandbox /tmp/npm-cache

COPY deploy/sandbox/server.mjs /opt/barlas-sandbox/server.mjs

ENTRYPOINT ["node", "/opt/barlas-sandbox/server.mjs"]
