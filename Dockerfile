FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js config.js system.js history.js notify.js checks.js ./
COPY integrations ./integrations
COPY agent ./agent
COPY public ./public
VOLUME /app/data
EXPOSE 7575
CMD ["node", "server.js"]
