FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "backend/src/server.js"]
