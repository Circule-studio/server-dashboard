FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY integrations ./integrations
COPY public ./public
VOLUME /app/data
EXPOSE 7575
CMD ["node", "server.js"]
