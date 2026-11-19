FROM node:26.13.1-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git libxml2-utils mkcert sudo \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@12.21.0 \
    && printf 'node ALL=(root) NOPASSWD:ALL\n' > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

USER node
