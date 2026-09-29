# TechVeille Hub

> **Veille technologique front-end, sans le bruit.**
> Une Progressive Web App (PWA) qui agrège automatiquement les nouveautés du web (standards, CSS, design, outils, IA, écosystème), les traduit en français, les classe, et permet de les lire, filtrer, organiser et partager — y compris hors-ligne.

---

## 🧪 À propos de ce projet : un test de Claude

**Ce projet est avant tout une expérience.** Je n'avais jamais utilisé Claude auparavant ; TechVeille Hub a été construit pour **tester Claude Code** (l'assistant de développement d'Anthropic, ici avec le modèle *Claude Opus 5.5*) sur un projet réel, de bout en bout.

Concrètement :

- **Tout le code a été écrit par Claude**, à partir de mes consignes successives rédigées en langage naturel (en français), sans que j'écrive de code moi-même.
- Le projet a évolué par **étapes itératives**, chacune correspondant à une demande :
  1. squelette PWA statique (HTML/Tailwind/JS vanilla, `localStorage`) ;
  2. passage en client-serveur Node.js/Express avec authentification admin (JWT) et veille RSS automatisée ;
  3. traduction automatique en français et nettoyage des données ;
  4. élargissement du périmètre (IA, écosystème), digest hebdomadaire, mode lecture, filtres temporels ;
  5. anti-spam, source unique des catégories, migration des données ;
  6. vue Kanban, recherche tolérante aux fautes, infobulles, hors-ligne IndexedDB, Docker ;
  7. corrections (cache du service worker, `.gitignore`) et ce README.
- À chaque étape, Claude a **testé son propre travail** (requêtes HTTP, navigateur piloté, tests hors-ligne, build Docker), signalé les limites et demandé confirmation avant les actions destructrices (ex. suppression de fiches).

L'objectif n'était donc pas de livrer un produit commercial, mais d'**évaluer ce qu'un assistant IA peut produire** en termes d'architecture, de qualité de code, de rigueur et de communication. Le résultat reste une application fonctionnelle et utilisable au quotidien.

---

## Sommaire

1. [Fonctionnalités](#1-fonctionnalités)
2. [Stack technique](#2-stack-technique)
3. [Installation et lancement](#3-installation-et-lancement)
4. [Configuration (`.env`)](#4-configuration-env)
5. [Architecture générale](#5-architecture-générale)
6. [Arborescence et rôle de chaque fichier](#6-arborescence-et-rôle-de-chaque-fichier)
7. [Modèle de données](#7-modèle-de-données)
8. [API REST](#8-api-rest)
9. [Authentification et sécurité](#9-authentification-et-sécurité)
10. [Le pipeline de veille automatisée](#10-le-pipeline-de-veille-automatisée)
11. [Le front-end en détail](#11-le-front-end-en-détail)
12. [PWA et fonctionnement hors-ligne](#12-pwa-et-fonctionnement-hors-ligne)
13. [Déploiement Docker](#13-déploiement-docker)
14. [Déploiement Vercel (serverless)](#14-déploiement-vercel-serverless)
15. [Scripts de maintenance](#15-scripts-de-maintenance)
16. [Limites connues et pistes d'amélioration](#16-limites-connues-et-pistes-damélioration)

---

## 1. Fonctionnalités

### Pour tous les visiteurs (lecture seule)

| Fonctionnalité | Description |
|---|---|
| **Dashboard de veille** | Cartes de « fiches » (une fiche = une nouveauté technique) avec statut, catégorie, résumé et tags. |
| **Filtres** | Par catégorie (7), statut (🔥 Émergent, 🧪 Expérimental, ✅ Recommandé), tag (clic sur un `#tag`), favoris, période (toutes / cette semaine / ce mois-ci) et tri (plus récents / plus anciens). |
| **Recherche tolérante** | Accepte les fautes de frappe (« tailwnd » trouve « Tailwind », « trnasitions » trouve « transitions »). Raccourci clavier `/`. |
| **Infobulles** | Les concepts techniques connus (View Transitions, hydratation, Core Web Vitals, LLM, MCP…) sont soulignés en pointillé dans les résumés, avec une définition au survol. |
| **Vue Liste / Vue Kanban** | Bascule dans le header. La vue Kanban (« Radar Tech ») répartit les fiches en 3 colonnes : *À surveiller*, *À tester*, *Prêt pour Prod*. |
| **Fiche détaillée** | Résumé, exemple de code avec bouton « Copier », lien vers la documentation officielle, aperçu Markdown. |
| **Mode lecture** | « Lire sur l'app » ouvre l'article complet (traduit) dans une vue épurée, sans quitter la PWA. |
| **Export Markdown** | Copie ou téléchargement `.md` d'une fiche, ou de toute la sélection filtrée. |
| **Favoris** | Étoile sur chaque fiche, conservés localement (IndexedDB), synchronisés entre onglets. |
| **Hors-ligne** | La dernière liste consultée reste disponible sans réseau ; le bouton « Rendre disponible hors-ligne » précharge les articles complets de la semaine. |
| **Installable** | « Ajouter à l'écran d'accueil » sur Android/desktop (bouton *Installer*) et aide dédiée sur iOS. |

### Pour l'administrateur (connexion via le cadenas 🔒)

| Fonctionnalité | Description |
|---|---|
| **CRUD des fiches** | Ajouter, modifier, supprimer une fiche via un formulaire. |
| **Kanban interactif** | Glisser-déposer une fiche d'une colonne à l'autre (ou flèches ← → au clavier/tactile) pour changer son statut. |
| **Lancer la veille web** | Déclenche immédiatement la récupération des flux RSS (sinon automatique chaque lundi 8 h). |
| **Digest hebdomadaire** | Génère un récapitulatif Markdown des fiches des 7 derniers jours, prêt à copier pour un partage rapide. |
| **Import JSON** | Import en masse de fiches depuis un fichier JSON. |

---

## 2. Stack technique

| Couche | Technologies | Pourquoi |
|---|---|---|
| **Front-end** | HTML5 sémantique, **Tailwind CSS (CDN)**, **JavaScript vanilla en ESModules** | Aucun framework ni étape de build : l'application est légère et directement lisible. |
| **Back-end** | **Node.js ≥ 20.12**, **Express 5** (CommonJS) | Serveur minimal qui sert à la fois l'API et les fichiers statiques. |
| **Stockage serveur** | Fichier **JSON** (`data/data.json`) avec écriture atomique | Pas de base de données à installer ; suffisant pour quelques milliers de fiches. |
| **Stockage client** | **IndexedDB** | Plus de capacité que `localStorage`, accessible au service worker. |
| **Authentification** | **JWT** (`jsonwebtoken`, HS256) + mot de passe haché **bcrypt** (`bcryptjs`) | Standard, sans état côté serveur. |
| **Veille** | `rss-parser` (flux RSS/Atom), `node-cron` (planification), `translate` (traduction gratuite, sans clé) | Uniquement des sources réelles, traduites automatiquement. |
| **PWA** | Service Worker, Web App Manifest | Installation et fonctionnement hors-ligne. |
| **Déploiement** | **Docker** (`node:20-alpine`) + **Docker Compose** | Image légère, données persistées dans un volume. |

Dépendances npm (production uniquement) : `express`, `jsonwebtoken`, `bcryptjs`, `rss-parser`, `node-cron`, `translate`, `dotenv`, `cors`.

---

## 3. Installation et lancement

### Prérequis

- **Node.js 20.12 ou plus récent** (pour une installation locale), **ou** **Docker Desktop** (pour le déploiement conteneurisé).
- Git.

### 3.1 Récupérer le projet

```bash
git clone https://github.com/YannLf3/VeilleTech.git
cd VeilleTech
```

### 3.2 Configurer l'environnement

```bash
cp .env.example .env
```

Puis remplir `.env` (voir [section 4](#4-configuration-env)) :

1. **Générer un secret JWT** (au moins 32 caractères) :
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   → coller le résultat dans `JWT_SECRET=`.
2. **Générer le hash du mot de passe administrateur** (le mot de passe n'est **jamais** stocké en clair) :
   ```bash
   npm install
   npm run hash-password -- 'votre-mot-de-passe'
   ```
   → coller le hash dans `ADMIN_PASSWORD_HASH='…'` **entre apostrophes** (le hash contient des `$`).

> Sans `JWT_SECRET` valide ni `ADMIN_PASSWORD_HASH`, le serveur refuse volontairement de démarrer et affiche la cause.

### 3.3 Lancement en local

```bash
npm install        # si ce n'est pas déjà fait
npm run dev        # mode développement : redémarre à chaque modification
# ou
npm start          # mode normal
```

Ouvrir **http://localhost:3000**. Au premier lancement, `data/data.json` est créé automatiquement à partir de `data.seed.json` (15 fiches de départ).

### 3.4 Lancement avec Docker

```bash
mkdir -p data                    # important : à créer soi-même (voir section 13)
docker compose up -d --build
```

Ouvrir **http://localhost:3000**. Commandes utiles :

```bash
docker compose logs -f           # suivre les logs (dont la veille planifiée)
docker compose up -d --build     # reconstruire après une modification du code
docker compose down              # arrêter
```

> ⚠️ Ne lancez pas `npm run dev` et Docker en même temps : ils utilisent le même port (3000) et le même fichier de données.

### 3.5 Première utilisation

1. Cliquer sur le **cadenas** 🔒 en haut à droite et se connecter (identifiant défini par `ADMIN_USERNAME` dans votre `.env`).
2. Cliquer sur **« Lancer la veille web »** : la première récupération prend 2 à 3 minutes (traduction de tous les articles).
3. Explorer les fiches, basculer en vue Kanban, générer le digest depuis le menu **⋯**.

---

## 4. Configuration (`.env`)

Toutes les variables sont lues par `server.js` (via `dotenv`). Le fichier `.env` n'est **jamais** versionné ni copié dans l'image Docker.

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `PORT` | non | `3000` | Port HTTP du serveur. |
| `JWT_SECRET` | **oui** | — | Secret de signature des jetons (≥ 32 caractères). |
| `ADMIN_USERNAME` | non | `admin` | Identifiant de l'administrateur unique (à personnaliser). |
| `ADMIN_PASSWORD_HASH` | **oui** | — | Hash bcrypt du mot de passe (`npm run hash-password`). |
| `CRON_SCHEDULE` | non | `0 8 * * 1` | Planification de la veille (syntaxe cron ; défaut : lundi 8 h). |
| `CRON_TZ` | non | `Europe/Paris` | Fuseau horaire du cron. |
| `FEED_URLS` | non | 15 flux (voir §10) | Liste des flux RSS/Atom, séparés par des virgules. |
| `FEED_LIMIT` | non | `5` | Nombre d'articles lus par flux à chaque passage. |
| `DATA_PATH` | non | `data/data.json` | Emplacement du fichier de données. |
| `CORS_ORIGIN` | non | — | Origines autorisées si le front est servi depuis un autre domaine. |
| `TRUST_PROXY` | non | — | À définir (`1`) derrière un reverse proxy, pour que la limitation des tentatives de connexion voie la vraie IP. |
| `CRON_SECRET` | Vercel | — | Secret du Cron Job Vercel, vérifié par `GET /api/cron` (voir §14). |

---

## 5. Architecture générale

```
┌─────────────────────────── Navigateur (PWA) ───────────────────────────┐
│                                                                         │
│  index.html ── app.js (orchestration, rendu, actions)                   │
│                  ├── search.js    recherche floue                       │
│                  ├── glossary.js  infobulles                            │
│                  ├── kanban.js    colonnes + drag & drop                │
│                  └── db.js        IndexedDB (partagé avec le SW)        │
│                                                                         │
│  sw.js (Service Worker) ── Cache API : fichiers de l'app                │
│                         └─ db.js : articles hors-ligne (IndexedDB)       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTP (fetch JSON, JWT dans l'en-tête)
┌──────────────────────────────▼──────────────── Serveur Node.js ────────┐
│  server.js (Express 5)                                                  │
│   ├── /api/*          API REST (lecture publique, écriture JWT)         │
│   ├── fichiers statiques de public/                                     │
│   ├── node-cron       veille planifiée (lundi 8 h)                      │
│   └── data/data.json  stockage (écriture atomique)                      │
│                                                                         │
│  veille.js  pipeline : RSS → filtres → traduction FR → catégorie → tags │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTPS
          Flux RSS/Atom (Chrome, WebKit, MDN, Tailwind, Smashing, OpenAI,
          Hugging Face, The New Stack, The Verge, TechCrunch, Dev.to…)
          + moteur de traduction Google (gratuit, sans clé)
```

**Principes directeurs :**

- **Un seul processus** Node sert l'API et le front : pas de CORS à gérer, déploiement simple.
- **Lecture publique, écriture protégée** : tout le monde peut consulter, seul l'administrateur modifie.
- **Validation côté serveur** (fonction `sanitize()`), **échappement systématique côté client** (fonction `esc()`) : aucune donnée n'est injectée en HTML sans être échappée.
- **Aucun contenu inventé** : la veille ne fait qu'ingérer, nettoyer, résumer par extraction (phrases d'origine) et traduire des flux réels.
- **Modularité** : chaque fichier a une responsabilité claire (voir section suivante).

---

## 6. Arborescence et rôle de chaque fichier

```
VeilleTech/
├── server.js                 # Serveur Express : API, auth, stockage, cron, digest
├── veille.js                 # Pipeline de veille (partagé serveur + scripts)
├── data.seed.json            # 15 fiches de départ (copiées au 1er lancement)
├── package.json              # Dépendances et scripts npm
├── package-lock.json         # Versions exactes des dépendances
├── .env.example              # Modèle de configuration (à copier en .env)
├── Dockerfile                # Image de production
├── docker-compose.yml        # Orchestration Docker (port 3000, volume ./data)
├── vercel.json               # Déploiement Vercel : Cron Job hebdomadaire → /api/cron
├── .dockerignore             # Fichiers exclus de l'image Docker
├── .gitignore                # Fichiers exclus de Git (.env, data/, node_modules…)
├── CLAUDE.md                 # Mémo technique destiné à Claude Code
├── README.md                 # Ce document
├── scripts/
│   ├── clean-data.js         # Nettoyage ponctuel (déjà exécuté)
│   └── migrate-categories.js # Migration ponctuelle des catégories (déjà exécutée)
├── public/                   # Tout le front-end, servi tel quel
│   ├── index.html            # Structure de la page, modales, styles de base
│   ├── app.js                # Application principale (module ES)
│   ├── db.js                 # Couche IndexedDB (script classique)
│   ├── search.js             # Recherche tolérante aux fautes
│   ├── glossary.js           # Dictionnaire des infobulles
│   ├── kanban.js             # Vue Kanban + glisser-déposer
│   ├── sw.js                 # Service worker
│   ├── manifest.json         # Manifeste PWA
│   └── icons/                # Icônes (SVG, PNG 192/512, maskable, Apple)
└── data/                     # ⚠️ Non versionné : données d'exécution
    ├── data.json             # Toutes les fiches
    └── data.backup-*.json    # Sauvegardes créées par les scripts
```

### 6.1 `server.js` — le serveur

Organisé en sections :

1. **Chargement de la configuration** (`dotenv`) et **vérifications au démarrage** : secret JWT, hash du mot de passe et expression cron doivent être valides, sinon arrêt avec un message explicite.
2. **Mode utilitaire** : `node server.js hash <mdp>` affiche un hash bcrypt puis s'arrête (utilisé par `npm run hash-password`).
3. **Données** :
   - `load()` crée le dossier de données si besoin, lit `data.json` ou, à défaut, l'initialise depuis `data.seed.json`.
   - `save()` écrit dans un fichier temporaire puis le **renomme** (opération atomique : pas de fichier corrompu en cas de coupure). Les écritures sont **sérialisées** dans une file de promesses pour éviter les écritures concurrentes.
   - `sanitize(raw, id)` valide et normalise toute fiche entrante : longueurs maximales, catégorie et statut limités aux valeurs autorisées, tags normalisés (minuscules, sans accents), URL limitée à `http(s)` (bloque `javascript:`), date au format `AAAA-MM-JJ`.
4. **Veille** : `fetchVeille()` récupère tous les flux en parallèle (`Promise.allSettled` : un flux en panne n'empêche pas les autres), écarte les URL déjà connues, puis confie chaque article au pipeline de `veille.js`. `runVeille()` garantit **une seule exécution à la fois** : un deuxième déclenchement pendant une veille en cours réutilise la même promesse.
5. **Authentification** : middleware `requireAuth` (vérifie l'en-tête `Authorization: Bearer <jwt>`) et limitation des tentatives de connexion.
6. **Routes de l'API** (voir [section 8](#8-api-rest)), dont le **digest** Markdown.
7. **Fichiers statiques** : `express.static('public')`.
8. **Gestionnaire d'erreurs** : renvoie un JSON propre, sans fuite de détails internes pour les erreurs 500.
9. **Démarrage** : hors Vercel, planification `node-cron` puis écoute HTTP ; dans tous les cas, `module.exports = app` (utilisé par Vercel). Chaque requête attend la fin du chargement initial des données (`ready`), indispensable en serverless où il n'y a pas de phase de démarrage.

### 6.2 `veille.js` — le pipeline de veille

Module sans dépendance au serveur, réutilisé par `server.js` et les scripts. Il contient :

- `CATEGORIES` : **la liste officielle des 7 catégories** (source unique, exposée au front via `GET /api/categories`).
- `fromFeedItem()` : convertit un article RSS/Atom en « candidat » (titre, résumé, contenu texte, tags, source).
- `htmlToText()` : convertit le HTML des flux en **texte structuré minimal** (`## titres`, `- listes`, blocs de code ```` ``` ````), en supprimant scripts, iframes, images et balises. **Aucun HTML n'est stocké.**
- `isRelevant()` : filtres anti-spam, qualité et périmètre.
- `synthesize()` : résumé **extractif** (phrases complètes d'origine jusqu'à ~240 caractères).
- `detectLang()` / `tr()` / `translateLong()` : détection de la langue, traduction française, glossaire de corrections.
- `categorize()` : attribution de la catégorie par mots-clés.
- `harmonizeTags()` : normalisation des tags.
- `isDuplicate()` : détection des doublons par similarité de titre.

Détails dans la [section 10](#10-le-pipeline-de-veille-automatisée).

### 6.3 `public/index.html` — la structure

- **`<head>`** : métadonnées PWA (manifest, `theme-color`, icônes Apple), polices Geist (Google Fonts), Tailwind CDN et sa configuration, quelques styles de base (grille de fond, animations des modales, respect de `prefers-reduced-motion`).
- **Règle CSS clé** : `body:not(.is-admin) [data-admin]` et `body.is-admin [data-guest]` sont masqués. Il suffit donc d'ajouter l'attribut `data-admin` à un élément pour le réserver à l'administrateur.
- **Header** : logo, badge *Admin*, bascule Liste/Kanban, bouton de veille (admin), cadenas de connexion (visiteur), menu **⋯** (exports, import, hors-ligne, digest, déconnexion), bouton *Ajouter*.
- **Zone de filtres** : recherche, catégories (générées dynamiquement), statuts, favoris, période, tri.
- **Deux conteneurs de résultats** : `#list-view` (grille de cartes) et `#kanban-view` (colonnes). Ils sont enveloppés dans des `<div>` sans classe d'affichage pour que l'attribut `hidden` reste efficace face aux classes Tailwind.
- **Modales natives `<dialog>`** : détail, mode lecture, digest, connexion, ajout/édition. `<dialog>` gère nativement le focus, la touche Échap et le fond (`::backdrop`).
- **Scripts** : `db.js` (classique) puis `app.js` (module).

### 6.4 `public/app.js` — l'application

Point d'entrée du front, organisé en sections :

1. **Référentiels** : statuts et périodes (les catégories sont chargées depuis l'API).
2. **Stockage, API, authentification** :
   - `store` : accès IndexedDB tolérant aux pannes (si IndexedDB est indisponible, l'app continue en mémoire).
   - `loadPrefs()` : charge favoris, jeton et vue ; **migre une fois** les anciennes clés `localStorage` vers IndexedDB.
   - `api()` : appel JSON centralisé, ajoute le JWT, déconnecte automatiquement sur une réponse 401.
   - `loadItems()` / `loadCategories()` : chargement depuis l'API, avec **repli sur IndexedDB** hors-ligne.
   - `setAdmin()` : active ou désactive l'interface d'administration (classe `is-admin` sur `<body>`).
3. **État et filtrage** : un objet `state` unique (recherche, catégorie, statut, tag, favoris, période, tri) ; `getFilteredItems()` applique tous les filtres et le tri ; `setState()` modifie l'état puis relance le rendu.
4. **Rendu** : fonctions de templates (`cardTemplate`, `kanbanCardTemplate`, `detailTemplate`…) qui produisent du HTML **systématiquement échappé** ; `render()` redessine l'ensemble.
5. **Générateur Markdown** : `toMarkdown()` et `collectionToMarkdown()` (avec des clôtures de blocs de code qui s'allongent automatiquement si le code contient lui-même des ```` ``` ````).
6. **Modales** : détail, édition, connexion, mode lecture (chargement du contenu depuis IndexedDB puis l'API), digest.
7. **Import/export JSON**.
8. **PWA** : enregistrement du service worker, bouton d'installation (`beforeinstallprompt`), aide iOS, indicateur hors-ligne.
9. **Événements** : **délégation d'événements** sur `document`. Tout bouton porte un attribut `data-action="…"` associé à une fonction de l'objet `actions`, ce qui évite d'attacher un écouteur par bouton. La synchronisation entre onglets passe par `BroadcastChannel`.

### 6.5 Modules front secondaires

| Fichier | Type | Rôle |
|---|---|---|
| `db.js` | script **classique** | Expose `globalThis.TVHDB` : accès IndexedDB (`get`, `set`, `del`, `getContent`, `putContent`) et `cacheWeek()` (préchargement des articles de la semaine). Classique et non « module » pour être chargé à la fois par la page (`<script>`) et par le service worker (`importScripts`), les service workers en module n'étant pas supportés partout. |
| `search.js` | module ES | Recherche floue : distance de **Damerau-Levenshtein restreinte** (insertion, suppression, substitution, **inversion de deux lettres**) avec arrêt anticipé. Tolérance : 0 faute sous 4 lettres, 1 faute de 4 à 7, 2 fautes au-delà. Compare aux mots entiers **et** à leurs préfixes (recherche pendant la frappe). |
| `glossary.js` | module ES | Dictionnaire d'environ 35 concepts (formes françaises et anglaises) ; `annotate()` entoure la **première** occurrence de chaque concept d'un `<abbr title="définition">`. Travaille sur du texte déjà échappé, sans risque d'injection. |
| `kanban.js` | module ES | `renderKanban()` génère les 3 colonnes ; `bindKanbanDnD()` branche **une seule fois** le glisser-déposer HTML5 natif (`dragstart`, `dragover`, `drop`…) par délégation. |

### 6.6 Autres fichiers

- **`public/sw.js`** : service worker (voir [section 12](#12-pwa-et-fonctionnement-hors-ligne)).
- **`public/manifest.json`** : nom, couleurs, mode `standalone`, icônes (dont une version *maskable* pour Android), raccourci « Mes favoris » (`?favs=1`).
- **`data.seed.json`** : les 15 fiches éditoriales initiales (View Transitions, Popover API, `:has()`, Container Queries, OKLCH, Vite, Biome…).
- **`CLAUDE.md`** : mémo technique concis lu automatiquement par Claude Code au début de chaque session (conventions, architecture, commandes).

---

## 7. Modèle de données

Chaque fiche de `data/data.json` a cette forme :

```jsonc
{
  "id": "auto-3b22b9bdd50b",          // UUID (manuel) ou "auto-" + hash SHA-1 de l'URL (veille)
  "title": "Notes de version pour Safari Technology Preview 253",
  "summary": "Safari Technology Preview Release 253 est désormais disponible…", // ≤ 600 car.
  "category": "Standards Web",        // une des 7 catégories officielles
  "status": "experimental",           // emergent | experimental | recommended
  "tags": ["auto", "safari"],         // normalisés : minuscules, sans accents, ≤ 8
  "url": "https://webkit.org/blog/…", // http(s) uniquement
  "code": "",                         // exemple de code (fiches éditoriales)
  "lang": "text",                     // css | html | js | ts | json | bash | text
  "date": "2026-09-29",               // AAAA-MM-JJ (publication de l'article)
  "content": "## Accessibilité\n\n- Correction…", // texte complet traduit (mode lecture)
  "source": "webkit.org"              // hôte du flux d'origine
}
```

| Statut | Libellé | Colonne Kanban |
|---|---|---|
| `emergent` | 🔥 Émergent | À surveiller |
| `experimental` | 🧪 Expérimental | À tester |
| `recommended` | ✅ Recommandé | Prêt pour Prod |

**Catégories** : Standards Web, CSS, Design, Méthodologies, Outils, Intelligence Artificielle, Écosystème / Frameworks.

**Tag `auto`** : présent sur toutes les fiches issues de la veille automatique.

---

## 8. API REST

Toutes les réponses sont en JSON. Les routes marquées **JWT** exigent l'en-tête `Authorization: Bearer <jeton>`.

| Méthode | Route | Accès | Description |
|---|---|---|---|
| `GET` | `/api/items` | public | Liste des fiches **sans** le champ `content` (+ `hasContent: true/false`), pour alléger la réponse (~56 Ko au lieu de ~410 Ko). |
| `GET` | `/api/items/:id/content` | public | Texte complet d'une fiche (`{ id, content }`), chargé à la demande par le mode lecture. |
| `GET` | `/api/categories` | public | Liste officielle des catégories. |
| `POST` | `/api/login` | public | `{ username, password }` → `{ token }` (valable 8 h). |
| `GET` | `/api/me` | JWT | Vérifie la validité du jeton. |
| `POST` | `/api/items` | JWT | Crée une fiche. |
| `PUT` | `/api/items/:id` ou `/api/fiches/:id` | JWT | Modifie une fiche (fusion avec l'existant). `/api/fiches/:id` est l'alias utilisé par le Kanban. |
| `DELETE` | `/api/items/:id` | JWT | Supprime une fiche. |
| `POST` | `/api/import` | JWT | Import en masse (`{ items: [...] }` ou tableau). |
| `POST` | `/api/force-fetch` | JWT | Lance la veille immédiatement → `{ added, rejected, untranslated, failedFeeds }`. |
| `GET` | `/api/admin/digest` | JWT | Digest Markdown des 7 derniers jours → `{ markdown, count, from, to }`. |
| `GET` | `/api/cron` | `CRON_SECRET` | Veille planifiée par Vercel Cron (en-tête `Authorization: Bearer <CRON_SECRET>`). |

Exemple :

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<identifiant>","password":"<mot-de-passe>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -X POST http://localhost:3000/api/force-fetch -H "Authorization: Bearer $TOKEN"
```

---

## 9. Authentification et sécurité

- **Mot de passe** : seul son **hash bcrypt** (coût 12) figure dans `.env`. À la connexion, `bcrypt.compare` est **toujours** exécuté, même si l'identifiant est faux, pour que le temps de réponse ne révèle pas si l'identifiant existe.
- **Limitation des tentatives** : 5 échecs maximum par IP sur 15 minutes (réponse `429`).
- **JWT** : signé en HS256 avec `JWT_SECRET`, valable 8 h ; l'algorithme est imposé à la vérification (bloque les jetons non signés `alg: none`). Côté client, le jeton est conservé dans IndexedDB et envoyé dans l'en-tête `Authorization`.
- **Validation serveur** : `sanitize()` s'applique à toute donnée entrante (création, modification, import, veille).
- **Protection contre l'injection HTML (XSS)** : tout texte est échappé avant affichage (`esc()`) ; le contenu des articles est stocké en texte pur (aucun HTML) ; les liens n'acceptent que `http(s)`.
- **En-têtes HTTP** : `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` ; en-tête `X-Powered-By` supprimé.
- **Fichiers sensibles** : `.env`, `data/`, `server.js` et `veille.js` ne sont jamais servis au navigateur (seul `public/` l'est).
- **Docker** : le processus tourne sous l'utilisateur non-root `node`.

---

## 10. Le pipeline de veille automatisée

### Déclenchement

- **Automatique** : `node-cron`, par défaut chaque **lundi à 8 h** (heure de Paris) en local et sous Docker ; sur Vercel, Cron Job de `vercel.json` → `GET /api/cron` (voir §14).
- **Manuel** : bouton « Lancer la veille web » (admin) → `POST /api/force-fetch`, avec indicateur de chargement.

### Sources par défaut (`FEED_URLS`)

| Type | Sources |
|---|---|
| **Officielles** (*de confiance*) | Chrome Developers, WebKit, MDN Blog, Tailwind CSS Blog, Smashing Magazine, OpenAI, Hugging Face |
| **Généralistes / communautaires** | The New Stack, The Verge (IA), TechCrunch (IA), Dev.to (`#html`, `#css`, `#javascript`, `#tailwindcss`, `#opensource`) |

### Les étapes, dans l'ordre

```
Flux RSS/Atom
  │  1. Ingestion      rss-parser → fromFeedItem() : texte nettoyé, pieds de flux WordPress retirés
  │  2. Dédoublonnage  URL déjà présente ? → ignorée
  │  3. Anti-spam      SPAM_KEYWORDS (Hindsight, sponsor, course, promo…) sur le texte d'origine
  │  4. Qualité        sources non officielles : titre ≥ 4 mots, vrai résumé, pas d'auto-promotion
  │                    (« I built… », templates gratuits…), pas de tags hors-sujet (crypto, emploi…)
  │  5. Périmètre      l'article doit correspondre aux mots-clés d'au moins une catégorie
  │  6. Synthèse       résumé extractif : phrases complètes d'origine, ~240 caractères
  │  7. Traduction     langue détectée (en/fr/es/pt/de) → français ; contenu long traduit par
  │                    paquets de ~1 800 caractères, blocs de code laissés intacts
  │  8. Glossaire      ~50 corrections de contresens techniques (« Réagir » → React,
  │                    « travailleur de service » → service worker, « jetons » → tokens…)
  │  9. Catégorie      mots-clés appliqués au titre d'origine (+ tags, puis résumé si besoin)
  │ 10. Tags           harmonisés (tailwindcss → tailwind, ai → ia…), tags génériques supprimés
  │ 11. Doublon titre  ≥ 60 % de mots communs avec une fiche existante → ignoré
  ▼                    (ex. le même article republié dans une autre langue)
Fiche enregistrée : tag #auto, statut 🧪 Expérimental
```

**Robustesse :**

- Si la traduction d'un article échoue, il **n'est pas enregistré** : son URL restant inconnue, il sera retenté au passage suivant. Aucune fiche en anglais n'entre donc dans la base.
- Un flux en panne n'interrompt pas les autres.
- Les sources de confiance publient souvent de courts extraits : elles sont dispensées des contrôles de qualité du texte (étape 4), mais pas du filtre de périmètre.
- Le **mode lecture** n'est proposé que si le flux fournit réellement l'article (≥ 600 caractères) : certaines sources (Chrome, MDN, Tailwind) ne publient qu'un extrait.

---

## 11. Le front-end en détail

### Cycle de vie au chargement

1. `db.js` expose `TVHDB` ; `app.js` démarre (module ES).
2. Branchement des événements, enregistrement du service worker.
3. `loadPrefs()` : favoris, jeton et vue depuis IndexedDB (migration `localStorage` si besoin).
4. Premier rendu, puis chargement **en parallèle** des fiches et des catégories depuis l'API (repli sur IndexedDB si hors-ligne).
5. Si un jeton existe, vérification via `GET /api/me` : s'il est valide, l'interface admin apparaît ; sinon, déconnexion automatique.

### Rendu

Pas de DOM virtuel : `render()` régénère les zones concernées via des templates HTML. C'est simple, prévisible et suffisamment rapide pour quelques centaines de fiches.

### Vue Kanban

- Le statut de chaque fiche détermine sa colonne.
- **Admin** : cartes déplaçables (`draggable="true"`). Au dépôt, **mise à jour optimiste** (la carte change de colonne immédiatement) puis `PUT /api/fiches/:id` ; en cas d'échec, la carte **revient** à sa place et un message s'affiche.
- Les flèches ← → offrent une alternative au glisser-déposer, qui n'est utilisable ni au clavier ni sur la plupart des écrans tactiles.
- En vue Kanban, le filtre par statut est masqué (les colonnes le remplacent).

### Accessibilité

- Modales `<dialog>` natives (focus piégé, Échap), lien d'évitement « Aller aux résultats ».
- Attributs `aria-pressed` sur les filtres et bascules, `aria-live` sur le compteur et les notifications, menu navigable aux flèches.
- `prefers-reduced-motion` respecté ; mise en page mobile d'abord, sans défilement horizontal dès 320 px.

---

## 12. PWA et fonctionnement hors-ligne

### Deux espaces de stockage, deux rôles

| Stockage | Géré par | Contenu |
|---|---|---|
| **Cache API** (`tvh-shell-vX`, `tvh-runtime-vX`) | `sw.js` | Fichiers de l'application (HTML, JS, icônes, manifest), Tailwind et polices. |
| **IndexedDB** (`techveille`) | `db.js` (page + SW) | Store `kv` : favoris, jeton, vue, dernière liste de fiches, catégories. Store `content` : articles complets pour la lecture hors-ligne. |

### Stratégies du service worker (`sw.js`)

- **Fichiers de l'app (même origine)** : *network-first* — le réseau d'abord, le cache seulement hors-ligne. Ainsi, la page et son JavaScript viennent **toujours de la même version**. (Une première version en *stale-while-revalidate* servait parfois un ancien `app.js` avec un nouvel `index.html` après une mise à jour, ce qui rendait inactifs les nouveaux boutons.)
- **CDN (Tailwind, Google Fonts)** : *stale-while-revalidate*.
- **Routes `/api`** : jamais interceptées ; les données hors-ligne vivent dans IndexedDB.
- **Mises à jour** : chaque déploiement doit incrémenter `VERSION` dans `sw.js` ; les anciens caches sont supprimés à l'activation.

### « Rendre disponible hors-ligne »

1. Le bouton (menu **⋯**) envoie un message `CACHE_WEEK` au service worker via un `MessageChannel`.
2. Le service worker appelle `TVHDB.cacheWeek()` : il récupère la liste, sélectionne les fiches des 7 derniers jours qui ont un contenu, télécharge chaque article manquant et l'enregistre dans IndexedDB.
3. Le résultat (`23/23 articles…`) est renvoyé à la page et affiché.
4. Si aucun service worker ne contrôle la page, la page exécute elle-même `cacheWeek()`.

Tout article ouvert une fois en mode lecture est également conservé et reste lisible hors-ligne.

---

## 13. Déploiement Docker

### `Dockerfile`

```dockerfile
FROM node:20-alpine                     # image légère
ENV NODE_ENV=production PORT=3000 DATA_PATH=/app/data/data.json
COPY package*.json → npm ci --omit=dev  # dépendances de prod, couche mise en cache
COPY server.js veille.js data.seed.json public/ scripts/
USER node                               # utilisateur non-root
HEALTHCHECK → GET /api/categories       # Docker sait si l'app répond
```

Image finale : environ 200 Mo. Le `.dockerignore` exclut `.env`, `data/`, `node_modules`, `.git`…

### `docker-compose.yml`

- Port **3000** exposé.
- `env_file: .env` : secrets lus au démarrage, jamais intégrés à l'image.
- Volume **`./data:/app/data`** : `data.json` et les sauvegardes restent sur la machine hôte et **survivent** aux redémarrages et reconstructions du conteneur.
- `restart: unless-stopped`.

> **Pourquoi `mkdir -p data` avant le premier lancement ?** Si Docker crée lui-même le dossier monté, il appartient à `root`, et l'utilisateur `node` du conteneur ne peut pas y écrire (problème fréquent sous Linux).

---

## 14. Déploiement Vercel (serverless)

L'application peut aussi être déployée sur [Vercel](https://vercel.com), qui détecte Express **sans configuration** :

- `server.js` (à la racine) importe `express` et exporte l'application (`module.exports = app`) : toute l'API devient **une seule fonction serverless** (Node.js, *Fluid compute*).
- Le dossier `public/` est servi directement par le **CDN** de Vercel (`express.static()` y est ignoré, mais reste utilisé en local et sous Docker).
- Sur Vercel (variable `VERCEL` définie automatiquement), `server.js` **n'ouvre pas de port** et **ne lance pas `node-cron`** : c'est la plateforme qui appelle l'application et qui planifie la veille.

### `vercel.json` et la veille planifiée

```json
{ "crons": [{ "path": "/api/cron", "schedule": "0 6 * * 1" }] }
```

- Vercel appelle `GET /api/cron` chaque **lundi à 6 h UTC**, soit **8 h à Paris en heure d'été** (7 h en hiver) : les crons Vercel sont **toujours en UTC**.
- Sur l'offre gratuite (Hobby), l'appel peut avoir lieu **à n'importe quel moment dans l'heure** (entre 6 h 00 et 6 h 59 UTC).
- La route est protégée : Vercel envoie `Authorization: Bearer <CRON_SECRET>` ; `server.js` compare cette valeur en temps constant et répond `401` si elle est absente ou fausse (ou si `CRON_SECRET` n'est pas configuré).
- Aucune règle de redirection n'est nécessaire dans `vercel.json` : Vercel envoie automatiquement vers la fonction Express toute requête qui ne correspond pas à un fichier de `public/`.
- Durée maximale d'une fonction : 300 s par défaut, suffisant pour une veille (environ 2 à 3 minutes au premier passage).

### Mise en ligne

1. Sur [vercel.com/new](https://vercel.com/new), importer le dépôt GitHub (ou lancer `npx vercel` dans le dossier).
2. Dans **Settings → Environment Variables**, définir :
   - `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (coller le hash **sans apostrophes** : l'interface Vercel prend la valeur telle quelle) ;
   - `CRON_SECRET` : une chaîne aléatoire d'au moins 16 caractères ;
   - facultatif : `FEED_URLS`, `FEED_LIMIT`.
3. Déployer. Le cron apparaît dans **Settings → Cron Jobs**, d'où il peut aussi être déclenché manuellement.

### ⚠️ Limite importante : stockage non persistant

Le disque des fonctions Vercel est **en lecture seule**, à l'exception de `/tmp`, qui est **éphémère** et propre à chaque instance. Sur Vercel, les fiches sont donc stockées dans `/tmp/techveille/data.json`, initialisé depuis `data.seed.json` (15 fiches) :

- les fiches ajoutées, modifiées ou récupérées par la veille **disparaissent** quand l'instance est recyclée ;
- deux instances simultanées peuvent afficher des données différentes ;
- la limitation des tentatives de connexion est, elle aussi, propre à chaque instance.

Le déploiement Vercel convient donc à une **démonstration**. Pour un usage réel, il faut un stockage externe (par exemple **Vercel Blob**, **Upstash Redis** ou **Neon Postgres**, disponibles via le Marketplace Vercel) ; le déploiement **Docker**, lui, persiste les données dans `./data`.

---

## 15. Scripts de maintenance

| Commande | Rôle |
|---|---|
| `npm run hash-password -- '<mdp>'` | Génère le hash bcrypt du mot de passe admin. |
| `node scripts/clean-data.js [--dry-run]` | Nettoyage ponctuel : filtre, dédoublonne, traduit et reclasse les fiches `#auto`. **Déjà exécuté** ; conçu pour des fiches en anglais, à ne pas relancer sur des fiches déjà traduites. |
| `node scripts/migrate-categories.js [--dry-run]` | Reclasse les anciennes fiches vers « Intelligence Artificielle » / « Écosystème / Frameworks ». **Déjà exécuté.** |

Tous deux créent une sauvegarde `data.backup-<horodatage>.json` avant d'écrire, et doivent être lancés **serveur arrêté** (le serveur garde les fiches en mémoire et pourrait écraser les modifications à sa prochaine sauvegarde).

---

## 16. Limites connues et pistes d'amélioration

- **Traduction littérale** : le moteur gratuit traduit mot à mot ; le glossaire corrige les erreurs récurrentes mais pas tous les contresens. Une vraie reformulation nécessiterait un LLM (payant).
- **Moteur de traduction non officiel** : il peut limiter le débit ou changer ; les articles concernés sont alors simplement reportés.
- **Tailwind via CDN** : pratique mais déconseillé en production (poids, dépendance réseau) ; passer à Tailwind CLI serait plus propre.
- **Infobulles natives** (`title`) : invisibles au clavier et au toucher.
- **Vercel** : stockage éphémère (`/tmp`), voir §14 — un stockage externe serait nécessaire pour un usage réel.
- **Stockage JSON** : adapté à un usage personnel ; au-delà de quelques milliers de fiches ou avec plusieurs éditeurs, SQLite serait préférable.
- **Un seul administrateur**, jeton conservé côté client (un cookie `httpOnly` serait plus sûr, au prix d'une protection CSRF).
- **Catégorisation par mots-clés** : simple et prévisible, mais imparfaite sur les articles ambigus.
- **Export JSON** : n'inclut pas le texte complet des articles (`content`).

---

*Projet réalisé avec [Claude Code](https://claude.com/claude-code) dans le cadre d'un premier test de Claude.*
