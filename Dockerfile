# Build stage
FROM node:23 AS builder

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build --if-present

# Production stage
FROM node:23-alpine

WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/package*.json ./
RUN npm install --only=production
COPY --from=builder /usr/src/app ./

EXPOSE 3000
CMD ["node", "index.js"]
