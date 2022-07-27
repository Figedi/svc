ARG NODE_VERSION=16
FROM node:${NODE_VERSION}-alpine
LABEL build="builder"

WORKDIR /opt/app

ARG NPM_REGISTRY_TOKEN
ARG CI

COPY package*.json ./

RUN echo "//registry.npmjs.org/:_authToken=${NPM_REGISTRY_TOKEN}" > ~/.npmrc; \
  npm ci && \
  rm -rf ~/.npm;

COPY src src
COPY resources resources
COPY .prettierrc tsconfig.json .eslintrc.js ./
RUN npm run build


ENTRYPOINT ["echo", "This is a builder-image, there is no point in running it"]
CMD [""]
