FROM node:24.16.0-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git libxml2-utils mkcert sudo \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.34.3 \
    && printf 'node ALL=(root) NOPASSWD:ALL\n' > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

USER node
