# Utiliser l'image Node.js officielle
FROM node:20-alpine AS base

# Étape de construction
FROM base AS builder

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm ci --frozen-lockfile

# Copier le reste du code
COPY . .

# Construire l'application frontend
RUN npm run build

# Étape de production
FROM base AS runner

WORKDIR /app

# Créer un utilisateur non-root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 lounaflow

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer seulement les dépendances de production
RUN npm ci --frozen-lockfile --production

# Copier le build frontend depuis l'étape builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

# Changer la propriété des fichiers
RUN chown -R lounaflow:nodejs /app

# Passer à l'utilisateur non-root
USER lounaflow

# Exposer le port
EXPOSE 3001

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3001

# Commande de démarrage
CMD ["npx", "tsx", "server.ts"]
