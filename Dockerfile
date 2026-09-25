FROM node:18-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run prisma:generate && npm run build

FROM node:18-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --silent
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
RUN npm run prisma:generate

EXPOSE 3000
CMD ["npm", "start"]
