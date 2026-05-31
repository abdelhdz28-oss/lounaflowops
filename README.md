# LounaFlow v2 - Gestion de Production

Application web de gestion de production multi-utilisateurs pour Louna Aesthetics.

## Fonctionnalités v2

### 👥 Multi-utilisateurs & Rôles

| Rôle | Permissions |
|------|-------------|
| **Viewer** | Lecture seule de toutes les données |
| **Editor** | Créer/modifier/supprimer lots & livraisons |
| **Admin** | Tous les droits + gestion des utilisateurs |

### ⚡ Temps réel

- Socket.IO pour les mises à jour instantanées
- Quand un utilisateur modifie un lot, tous les autres voient la modification immédiatement

### 🔐 Sécurité

- Authentification JWT (JSON Web Token)
- Mots de passe hashés avec bcrypt
- Middleware de permissions sur tous les endpoints
- Sessions expirent après 24h (configurable)

### 🗄️ Base de données

- **PostgreSQL** (pour production et collaboration)
- Compatible avec SQLite en développement (optionnel)

---

## Stack Technique

| Couche | Technologie |
|--------|-------------|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS |
| Backend | Express.js + TypeScript |
| Base de données | PostgreSQL |
| Temps réel | Socket.IO |
| Auth | JWT + bcryptjs |
| Hébergement | Fly.io (recommandé) |

---

## Installation locale

### Prérequis

- Node.js 20+
- PostgreSQL (pour la version complète)
- OU SQLite (pour développement rapide sans PostgreSQL)

### Étapes

1. **Installer les dépendances**

```bash
npm install
```

2. **Configurer l'environnement**

```bash
cp .env.example .env.local
```

Éditez `.env.local` :

```env
# Base de données PostgreSQL
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lounaflow"

# JWT Secret - Générez un secret unique:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET="votre_secret_unique_ici"
JWT_EXPIRES_IN="24h"

# Compte admin par défaut (créé automatiquement)
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="louna2026"

# Origines autorisées pour CORS
CORS_ORIGINS="http://localhost:5173"
```

3. **Créer la base de données PostgreSQL**

```sql
-- Dans psql ou votre client PostgreSQL
CREATE DATABASE lounaflow;
```

4. **Démarrer l'application**

```bash
# Mode développement complet (frontend + backend)
npm run dev:full
```

Ou séparément :

```bash
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend
npm run dev
```

5. **Accéder à l'application**

- Frontend : http://localhost:5173
- Identifiants par défaut : `admin` / `louna2026`

---

## Rôles & Permissions

### Gestion des utilisateurs

1. Connectez-vous en tant qu'`admin`
2. Cliquez sur **"Utilisateurs"** dans la barre latérale
3. Vous pouvez :
   - Créer de nouveaux utilisateurs
   - Modifier leur rôle et/ou mot de passe
   - Supprimer des utilisateurs (sauf vous-même)

### Matrice des permissions

| Action | Viewer | Editor | Admin |
|--------|:------:|:------:|:-----:|
| Voir les lots | ✅ | ✅ | ✅ |
| Créer un lot | ❌ | ✅ | ✅ |
| Modifier un lot | ❌ | ✅ | ✅ |
| Supprimer un lot | ❌ | ⚠️ | ✅ |
| Voir les livraisons | ✅ | ✅ | ✅ |
| Gérer les utilisateurs | ❌ | ❌ | ✅ |
| Réinitialiser les données | ❌ | ❌ | ✅ |

⚠️ *Les éditeurs ne peuvent pas supprimer via l'interface actuelle (seulement admin)*

---

## Déploiement sur Fly.io

Fly.io est recommandé pour son :
- Simplicité de déploiement
- PostgreSQL managé intégré
- SSL automatique
- Prix ~€2-5/mois pour une petite app

### Prérequis

1. Installer `flyctl` : https://fly.io/docs/hands-on/install-flyctl/

2. Se connecter :

```bash
fly auth login
```

### Étapes de déploiement

1. **Initialiser l'application**

```bash
fly launch
```

Répondez aux questions :
- Nom de l'app : `lounaflow-ops` (ou autre)
- Région : `cdg` (Paris) ou `lhr` (Londres)
- Voulez-vous une base de données PostgreSQL ? → **Oui**
  - Configuration : `Development` - Single node
  - Nom : `lounaflow-ops-db`
- Voulez-vous déployer maintenant ? → **Non** pour l'instant

2. **Configurer les secrets**

Récupérez d'abord la chaîne de connexion PostgreSQL :

```bash
fly secrets list -a lounaflow-ops-db
```

Ou créez un nouveau superutilisateur pour votre app :

```bash
fly postgres connect -a lounaflow-ops-db
```

Puis dans psql :
```sql
CREATE USER lounaflow WITH PASSWORD 'votre_mot_de_passe_securise';
CREATE DATABASE lounaflow OWNER lounaflow;
GRANT ALL PRIVILEGES ON DATABASE lounaflow TO lounaflow;
\q
```

Maintenant configurez les secrets de votre app :

```bash
fly secrets set \
  DATABASE_URL="postgresql://lounaflow:votre_mot_de_passe_securise@lounaflow-ops-db.flycast:5432/lounaflow" \
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")" \
  ADMIN_PASSWORD="votre_mot_de_passe_admin" \
  NODE_ENV="production"
```

3. **Configurer CORS**

Ajoutez aussi l'URL de votre app :

```bash
fly secrets set \
  CORS_ORIGINS="https://lounaflow-ops.fly.dev"
```

*(Remplacez `lounaflow-ops.fly.dev` par votre URL)*

4. **Vérifier le fichier `fly.toml`**

Il devrait ressembler à ça :

```toml
app = "lounaflow-ops"
primary_region = "cdg"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "3001"

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

  [[http_service.concurrency]]
    type = "requests"
    hard_limit = 25
    soft_limit = 20

  [http_service.tls_check]
    alpn = ["h2", "http/1.1"]
    enabled = true
    versions = ["TLSv1.2", "TLSv1.3"]
```

⚠️ **Important pour Socket.IO** :

Désactivez `auto_stop_machines` si vous avez besoin de connexions WebSocket persistantes :

```toml
auto_stop_machines = false
```

Ou utilisez un volume et `min_machines_running = 1`.

5. **Déployer**

```bash
fly deploy
```

6. **Ouvrir l'application**

```bash
fly open
```

---

## Variables d'environnement

| Variable | Description | Défaut | Requis |
|----------|-------------|--------|--------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL | - | ✅ |
| `JWT_SECRET` | Secret pour signer les tokens JWT | `dev-secret` | ✅ (prod) |
| `JWT_EXPIRES_IN` | Durée de validité des tokens | `24h` | - |
| `ADMIN_USERNAME` | Nom d'utilisateur admin par défaut | `admin` | - |
| `ADMIN_PASSWORD` | Mot de passe admin par défaut | `louna2026` | - |
| `PORT` | Port du serveur | `3001` | - |
| `NODE_ENV` | Environnement | `development` | - |
| `CORS_ORIGINS` | Origines autorisées (séparées par virgule) | `http://localhost:5173` | - |
| `GEMINI_API_KEY` | Clé API Gemini pour fonctionnalités AI | - | - |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client (Navigateur)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │   React     │  │  Socket.IO  │  │   JWT (localStorage) │   │
│  │  (Vite)     │  │  (Client)   │  │                      │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
└───────────────────────────────┬─────────────────────────────┘
                                │ HTTPS / WebSocket
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Fly.io / Serveur Node.js                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Express.js + TypeScript            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │   │
│  │  │  Routes API │  │ Socket.IO   │  │  Middleware │ │   │
│  │  │             │  │  (Serveur)  │  │ Auth/Perms  │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL (Fly Postgres)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │    users     │  │   batches    │  │    deliveries    │ │
│  │ (id, role,   │  │  (production │  │   (clients,      │ │
│  │  password)   │  │    lots)     │  │     statuts)     │ │
│  └──────────────┘  └──────────────┘  └──────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    settings (fluxConfig)              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Flux d'authentification

```
1. Utilisateur soumet username + password
                              │
                              ▼
2. Serveur vérifie bcrypt.compare(password, hash)
                              │
                              ▼
3. Si OK → jwt.sign({ userId, role }, JWT_SECRET)
                              │
                              ▼
4. Token renvoyé au client → localStorage
                              │
                              ▼
5. Requêtes suivantes: Header "Authorization: Bearer <token>"
                              │
                              ▼
6. Middleware vérifie jwt.verify() et les permissions
```

---

## Commandes utiles

| Commande | Description |
|----------|-------------|
| `npm run dev:full` | Dév complet (frontend + backend) |
| `npm run server` | Seulement le backend |
| `npm run dev` | Seulement le frontend |
| `npm run build` | Build frontend pour production |
| `npm start` | Démarrer en production |
| `npm run lint` | Vérifier les types TypeScript |
| `fly deploy` | Déployer sur Fly.io |
| `fly logs` | Voir les logs |
| `fly ssh console` | SSH dans la machine |

---

## Sécurité en production

### Checklist

- [ ] **JWT_SECRET** : Long et aléatoire (64+ caractères hex)
- [ ] **ADMIN_PASSWORD** : Fort et unique
- [ ] **DATABASE_URL** : Utilisateur dédié avec droits minimaux
- [ ] **CORS_ORIGINS** : Seulement vos domaines
- [ ] **SSL/TLS** : Activé (Fly.io le fait automatiquement)
- [ ] **Headers de sécurité** : À ajouter dans Express (Helmet)

### Ajouter Helmet (recommandé)

```bash
npm install helmet
npm install -D @types/helmet
```

Puis dans `server.ts` :

```typescript
import helmet from 'helmet';

// Après app.use(cors(...))
app.use(helmet());
```

---

## Sauvegardes

### Sur Fly.io

Fly Postgres fait des sauvegardes automatiques. Pour restaurer :

```bash
fly postgres backups list -a lounaflow-ops-db
fly postgres backups restore <backup-id> -a lounaflow-ops-db
```

### Manuellement

```bash
# Créer un dump
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restaurer
psql $DATABASE_URL < backup_20260531.sql
```

---

## Licence

Propriétaire - Louna Aesthetics SAS

---

## Support

Pour toute question :
1. Vérifiez les logs : `fly logs`
2. Vérifiez l'état des machines : `fly status`
3. Testez en local d'abord
# lounaflowops
