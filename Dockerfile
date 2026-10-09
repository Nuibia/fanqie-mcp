FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
WORKDIR /app
ENV NODE_ENV=production DISPLAY=:99 FANQIE_HOST=0.0.0.0 FANQIE_PORT=18062 FANQIE_DATA_DIR=/data FANQIE_PROFILE_DIR=/data/profile FANQIE_RUNTIME_DIR=/data/runtime FANQIE_HEADLESS=false FANQIE_TOKEN_FILE=/run/fanqie/api-token FANQIE_RECOVER_PROFILE_LOCKS=true
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox gosu tini && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
RUN corepack enable && corepack prepare yarn@1.22.22 --activate \
    && yarn install --frozen-lockfile --production=false --ignore-scripts --non-interactive
COPY tsconfig*.json ./
COPY eslint.config.mjs commitlint.config.mjs .prettierrc.json .prettierignore ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN yarn test:prepare && yarn run check && yarn build \
    && yarn install --frozen-lockfile --production=true --ignore-scripts --non-interactive \
    && rm -f test/fixtures/short-native-submission-public-sources-20261007.json.gz \
        test/fixtures/short-native-submission-public-sources-20261007.manifest.json \
        test/fixtures/short-native-submission-terms-4c89ddd6.txt
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY scripts/container-entrypoint.sh /usr/local/bin/fanqie-entrypoint
# Public build contexts may preserve 0600 files; the service runs as pwuser.
RUN chmod -R a+rX /app/scripts /app/package.json /app/yarn.lock /app/LICENSE /app/THIRD_PARTY_NOTICES.md \
    && chmod 755 /usr/local/bin/fanqie-entrypoint
EXPOSE 18062 6080
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:18062/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/fanqie-entrypoint"]
