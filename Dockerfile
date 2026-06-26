# Multi-stage: build dist with devDeps, ship a lean runtime with prod deps only.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY bin ./bin
COPY scripts/train_lora.py ./scripts/train_lora.py
ENV PATH="/app/bin:${PATH}"
# bin prefers dist (tsx not installed in the prod image) → node dist/cli/<cmd>.js
ENTRYPOINT ["probevane"]
CMD ["help"]
