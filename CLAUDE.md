# LounaFlow Ops — Mémo projet

## Méthode de travail (OBLIGATOIRE)
Avant toute tâche sur ce projet, suivre le skill `lounaflow-workflow`
(`.claude/skills/lounaflow-workflow/SKILL.md`) : challenge avant code,
règles données/calculs, déploiement selon risque, compte-rendu en 5 lignes.

## Stack
- Frontend : Vite + React + TypeScript (dossier `src/`)
- Backend : Express + TypeScript, lancé via `tsx server.ts`
- Base de données : PostgreSQL (Railway, variable `DATABASE_URL`)

## Déploiement (IMPORTANT)
- Déployer avec : `railway up --service lounaflowops`
- ⚠️ PAS via git — Railway build le Dockerfile en local et pousse en prod.
- Prod : https://lounaflowops-production.up.railway.app
- Les migrations DB tournent TOUTES SEULES au démarrage du serveur
  (via `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

## Vérifier avant de déployer
- `npm run build` (vérifie le frontend)
- `npx esbuild server.ts --bundle --platform=node --outfile=/dev/null`
  (vérifie la syntaxe du serveur ; l'avertissement `import.meta` est normal)

## Vérifier après déploiement
- Comparer le hash du bundle local (`dist/index.html` → `index-XXXX.js`)
  avec celui servi en prod, + vérifier que la prod répond HTTP 200.
- Après `railway up`, attendre ~1 min (fenêtre de redémarrage = HTTP 000 normal).

## Fichiers clés
- `src/views/VentesView.tsx` — module Forecast Ventes (grille + Scénario)
- `server.ts` — API + init des tables au démarrage

## Règles
- Rester simple (Abdel n'est pas technique). Expliquer en français.
- Changements chirurgicaux : ne toucher que ce qui est demandé.

## Autres copies (ne pas confondre)
- Ce dépôt (`~/Projects/lounaflow-v2-ref`) est LE dépôt actif.
- `~/Projects/Lounaflow-ops`, `~/lounaflow-ops`, `~/Projects/lounaflow-prod-data` : anciennes versions ou données — ne pas y toucher sans demande explicite.
