# TechVeille Hub (PWA client-serveur)

## Tech Stack & Architecture
- **Front (vanilla)** : HTML5 sémantique, Tailwind CSS (CDN), JS ESModules sans framework — tout dans `public/`. Modules : `app.js` (orchestration), `search.js` (recherche floue Damerau-Levenshtein, 1–2 fautes selon la longueur), `glossary.js` (dictionnaire → `<abbr title>` dans les résumés), `kanban.js` (colonnes + drag & drop HTML5), `db.js` (IndexedDB, **script classique** partagé avec le SW via `importScripts`).
- **Back** : Node.js ≥ 20.12 + Express 5 (`server.js`, CommonJS) qui sert `public/` et l'API `/api`.
- **Stockage serveur** : `data/data.json` (ou `DATA_PATH`, écriture atomique, dossier `data/` git-ignoré et monté en volume Docker), initialisé depuis `data.seed.json`. Champs : `id, title, summary, category, status, tags, url, code, lang, date` + `content` (texte du flux pour le mode lecture) et `source` (hôte du flux). `GET /api/items` renvoie la liste **sans `content`** (+ `hasContent`) ; le texte est servi à la demande.
- **Stockage client** : IndexedDB `techveille` (`db.js`) — store `kv` (favoris, jeton, vue, dernière liste de fiches, catégories) et store `content` (articles pour la lecture hors-ligne). Plus de `localStorage` (anciennes clés `tvh:*` migrées au 1er chargement). Synchro entre onglets par `BroadcastChannel`.
- **Auth** : JWT HS256 (8 h) via `POST /api/login` ; admin unique (`ADMIN_USERNAME`, hash bcrypt `ADMIN_PASSWORD_HASH` dans `.env`). Rate-limit : 5 échecs / 15 min / IP.
- **Veille** : `fetchVeille()` (rss-parser, flux RSS/Atom `FEED_URLS` : Chrome, WebKit, MDN, Tailwind, Smashing, OpenAI, Hugging Face, The New Stack, The Verge IA, TechCrunch IA, Dev.to) lancée par node-cron (`CRON_SCHEDULE`, défaut lundi 8h Europe/Paris) et par `POST /api/force-fetch`. Trouvailles : tag `auto`, statut `experimental`, dédoublonnées par URL puis par titre.
- **Règle absolue** : on ingère, nettoie, résume par extraction et traduit les flux réels — aucun contenu inventé.
- **Pipeline `veille.js`** (partagé serveur + scripts, **source unique des `CATEGORIES`**, exposées au front par `GET /api/categories`) : `fromFeedItem` (HTML → texte structuré, pieds de flux retirés) → anti-spam `SPAM_KEYWORDS` (texte source) → filtre de périmètre (mots-clés de catégorie ; sources `TRUSTED_HOSTS` exemptées du filtre qualité textuel) → synthèse (≤ 240 car.) → traduction FR (paquet `translate`, moteur Google sans clé, langue source détectée ; `content` traduit par paquets, blocs de code intacts) → glossaire `FR_FIXES` (vocabulaire dev) → catégorie par mots-clés (sur le titre source) → tags harmonisés (`TAG_ALIASES`, `NOISE_TAGS`). Traduction échouée = article non enregistré, retenté au passage suivant.
- **Nettoyage ponctuel** : `node scripts/clean-data.js [--dry-run]` (serveur arrêté ; sauvegarde `data.backup-*.json`). `node scripts/migrate-categories.js [--dry-run]` : reclassement vers IA / Écosystème. Tous deux exécutés le 2026-09-29 ; clean-data est conçu pour des fiches sources en anglais (ne pas relancer sur des fiches déjà traduites).
- **PWA / hors-ligne** : `public/sw.js` ne met en cache que l'app shell (Cache API) et n'intercepte jamais `/api` ; les données hors-ligne vivent dans IndexedDB. Le bouton « Rendre disponible hors-ligne » envoie `CACHE_WEEK` au SW (repli : la page le fait elle-même) → `TVHDB.cacheWeek()` stocke le texte des fiches des 7 derniers jours. Tout article ouvert en mode lecture est aussi conservé. Incrémenter `VERSION` dans `sw.js` à chaque déploiement.
- **Docker** : `Dockerfile` (node:20-alpine, `npm ci --omit=dev`, utilisateur `node`, healthcheck `/api/categories`) + `docker-compose.yml` (port 3000, `env_file: .env`, volume `./data:/app/data`). Créer `./data` avant le 1er `docker compose up` (sinon dossier root non inscriptible).

## API
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/items` | public |
| GET | `/api/items/:id/content` | public → `{ id, content }` |
| GET | `/api/categories` | public |
| POST | `/api/login` | public → `{ token }` |
| GET | `/api/me` | JWT |
| POST / PUT / DELETE | `/api/items[/:id]` (PUT aussi via `/api/fiches/:id`, utilisé par le Kanban) | JWT |
| POST | `/api/import` | JWT |
| POST | `/api/force-fetch` | JWT |
| GET | `/api/admin/digest` | JWT → `{ markdown, count, from, to }` (fiches datées des 7 derniers jours) |

La validation fait foi côté serveur (`sanitize()` dans `server.js`) ; le front échappe tout rendu HTML (`esc()`).

## Commandes
- `cp .env.example .env` puis `npm run hash-password -- '<mdp>'` → coller le hash dans `.env`.
- `npm run dev` (watch) / `npm start` → http://localhost:3000
- Docker : `mkdir -p data && docker compose up -d --build`

## Fonctionnalités Clés
1. **Dashboard de Veille** : cartes filtrables par catégorie (Standards Web, CSS, Design, Méthodologies, Outils, Intelligence Artificielle, Écosystème / Frameworks — chargées dynamiquement depuis l'API), statut, tags, recherche, favoris, période (toutes / 7 j / 30 j) et tri (récents / anciens).
2. **Fiche & Démo** : nouveautés, exemples de code, liens officiels.
3. **Générateur Markdown** : export 1-clic d'une fiche ou de la sélection.
4. **Visiteur vs admin** : lecture seule pour tous ; UI CRUD, import JSON et « Lancer la veille web » visibles uniquement avec un JWT valide (`body.is-admin` + attributs `data-admin` / `data-guest`).
5. **Mode lecture** : bouton « Lire sur l'app » quand le flux fournit l'article (`content` ≥ 600 car.) ; rendu texte échappé, lien vers l'original.
6. **Digest hebdo** (admin, menu ⋯) : Markdown groupé par catégorie, copiable / téléchargeable.
7. **Vue Kanban / Radar Tech** (bascule dans le header, mémorisée) : colonnes À surveiller (`emergent`) / À tester (`experimental`) / Prêt pour Prod (`recommended`). Admin : drag & drop HTML5 + flèches ← → (alternative clavier/tactile) ; mise à jour optimiste, annulée si le PUT échoue.
8. **Recherche tolérante & infobulles** : fautes de frappe et transpositions tolérées ; concepts du glossaire soulignés en pointillé avec définition au survol.
9. **Installabilité** : PWA « Ajouter à l'écran d'accueil » (Android + aide iOS).
