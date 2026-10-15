FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi
COPY src ./src
ENV NODE_ENV=production
# El comando concreto (simulador, proyector, etc.) lo define docker-compose.yml.
CMD ["node", "src/simulador/index.js"]
