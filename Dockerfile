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
# Démarre en root le temps de rendre data/ à l'utilisateur node (uid 1000), puis abandonne ses droits
# (server.js). RUN_AS= (vide) dans compose.yaml : rester en root, comme avant 0.33.
ENV RUN_AS=1000:1000
CMD ["node", "server.js"]
