FROM node:18-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run prisma:generate && npm run build

FROM node:18-alpine AS runtime
WORKDIR /app

COPY package*.json ./
RUN npm ci --silent
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
RUN npm run prisma:generate

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy || echo 'Prisma migrations failed; continuing so /health remains available'; node dist/main.js"]
