# TechVeille Hub — image de production (Node 20 Alpine, dépendances de prod uniquement, utilisateur non root)
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_PATH=/app/data/data.json

WORKDIR /app

# Couche de dépendances mise en cache tant que package*.json ne change pas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js veille.js storage.js data.seed.json ./
COPY public ./public
COPY scripts ./scripts

# data/ est remplacé par le volume ./data au runtime ; créé ici pour un lancement sans volume
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/categories > /dev/null || exit 1

CMD ["node", "server.js"]
