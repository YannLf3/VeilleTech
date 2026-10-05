/**
 * TechVeille Hub — serveur Express.
 *  - API publique en lecture seule (GET), routes d'écriture protégées par JWT.
 *  - Stockage : data.json (écriture atomique), initialisé depuis data.seed.json.
 *  - Veille automatisée (cron hebdo) et manuelle (POST /api/force-fetch) via rss-parser.
 *
 * Générer le hash du mot de passe admin : npm run hash-password -- 'mon-mot-de-passe'
 */
require('dotenv').config({ quiet: true });
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const Parser = require('rss-parser');
const veille = require('./veille');
const { createStore } = require('./storage');

if (process.argv[2] === 'hash') {
  if (!process.argv[3]) throw new Error('Usage : npm run hash-password -- <mot-de-passe>');
  console.log(bcrypt.hashSync(process.argv[3], 12));
  process.exit(0);
}

const {
  PORT = 3000,
  JWT_SECRET,
  ADMIN_USERNAME = 'admin',
  ADMIN_PASSWORD_HASH,
  CRON_SCHEDULE = '0 8 * * 1', // lundi 8h
  CRON_TZ = 'Europe/Paris',
  FEED_URLS = [
    'https://developer.chrome.com/blog/feed.xml',
    'https://webkit.org/feed/',
    'https://developer.mozilla.org/en-US/blog/rss.xml',
    'https://tailwindcss.com/feeds/feed.xml',
    'https://www.smashingmagazine.com/feed/',
    'https://thenewstack.io/feed/',
    'https://openai.com/news/rss.xml',
    'https://huggingface.co/blog/feed.xml',
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    'https://techcrunch.com/category/artificial-intelligence/feed/',
    ...['html', 'css', 'javascript', 'tailwindcss', 'opensource'].map((t) => `https://dev.to/feed/tag/${t}`),
  ].join(','),
  FEED_LIMIT = '5',
  CORS_ORIGIN,
  TRUST_PROXY,
  CRON_SECRET,
} = process.env;
// Vercel définit VERCEL=1 : fonction serverless (pas de listen ni de node-cron, disque en lecture seule sauf /tmp).
const IS_VERCEL = Boolean(process.env.VERCEL);

if (!JWT_SECRET || JWT_SECRET.length < 32) exit('JWT_SECRET manquant ou trop court (≥ 32 caractères).');
if (!ADMIN_PASSWORD_HASH?.startsWith('$2')) exit('ADMIN_PASSWORD_HASH manquant (hash bcrypt, voir .env.example).');
if (!cron.validate(CRON_SCHEDULE)) exit(`CRON_SCHEDULE invalide : ${CRON_SCHEDULE}`);

function exit(msg) {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

/* ---------------------------------- Données --------------------------------- */

// Stockage (storage.js) : Vercel Blob privé si BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID est défini, sinon fichier.
// Fichier : dossier data/ (volume Docker) ; sur Vercel sans Blob, /tmp ÉPHÉMÈRE (propre à chaque instance).
const DATA_FILE = path.resolve(
  process.env.DATA_PATH || (IS_VERCEL ? '/tmp/techveille/data.json' : path.join(__dirname, 'data', 'data.json'))
);
const SEED_FILE = path.join(__dirname, 'data.seed.json');
const store = createStore({ dataFile: DATA_FILE, seedFile: SEED_FILE });
let items = []; // dernière version connue (rafraîchie avant chaque lecture/écriture)

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Modifie les fiches de façon sûre : relit la version la plus récente, applique `fn` (qui modifie le tableau
 * en place et peut lever une httpError), puis enregistre. En cas d'écriture concurrente d'une autre instance
 * (Vercel Blob), l'opération est rejouée sur les données à jour.
 */
const MUTATE_ATTEMPTS = 6;
async function mutate(fn) {
  for (let attempt = 1; ; attempt++) {
    // Copie de travail : un essai raté ne pollue pas la copie partagée du store.
    const draft = structuredClone(await store.load(true));
    const result = fn(draft);
    try {
      await store.save(draft);
      items = draft;
      return result;
    } catch (err) {
      if (err.code !== 'CONFLICT' || attempt >= MUTATE_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt + Math.random() * 150)); // backoff + jitter
    }
  }
}

const { CATEGORIES } = veille;
const STATUSES = ['emergent', 'experimental', 'recommended'];
const STATUS_LABELS = { emergent: '🔥 Émergent', experimental: '🧪 Expérimental', recommended: '✅ Recommandé' };
const LANGS = ['css', 'html', 'js', 'ts', 'json', 'bash', 'text'];
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const safeUrl = (u) => {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

/** Valide et normalise une fiche ; null si titre/résumé absents. */
function sanitize(raw, id) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const title = str(raw?.title, 120);
  const summary = str(raw?.summary, 600);
  if (!title || !summary) return null;
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags ?? '').split(',');
  return {
    id,
    title,
    summary,
    category: CATEGORIES.includes(raw.category) ? raw.category : 'Outils',
    status: STATUSES.includes(raw.status) ? raw.status : 'emergent',
    tags: [...new Set(tags.map(slug).filter(Boolean))].slice(0, 8),
    url: safeUrl(str(raw.url, 2048)),
    code: typeof raw.code === 'string' ? raw.code.slice(0, 10_000) : '',
    lang: LANGS.includes(raw.lang) ? raw.lang : 'text',
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : today(),
    content: str(raw.content, 20_000),
    source: str(raw.source, 80),
  };
}

const validId = (id) => (typeof id === 'string' && /^[\w-]{1,80}$/.test(id) ? id : crypto.randomUUID());

/* ------------------------------ Veille (RSS) ------------------------------- */

const parser = new Parser({ timeout: 10_000 });
const FEEDS = FEED_URLS.split(',').map((u) => safeUrl(u.trim())).filter(Boolean);
let running = null;

/**
 * Récupère les flux RSS/Atom (FEED_URLS), écarte les doublons (URL + titre) et le hors-périmètre,
 * puis traduit/synthétise en français (veille.js). Un article dont la traduction échoue n'est pas
 * enregistré : son URL restant inconnue, il sera retenté au prochain passage.
 */
async function fetchVeille() {
  const current = await store.load(true); // lecture initiale des articles existants
  const known = new Set(current.map((it) => it.url));
  const results = await Promise.allSettled(
    FEEDS.map(async (url) => ({ url, feed: await parser.parseURL(url) }))
  );
  const candidates = [];
  for (const r of results) {
    if (r.status === 'rejected') {
      console.warn('[veille] flux en échec :', r.reason?.message);
      continue;
    }
    for (const e of r.value.feed.items.slice(0, Number(FEED_LIMIT))) {
      const url = safeUrl(e.link);
      if (!url || known.has(url)) continue;
      known.add(url);
      candidates.push({ ...veille.fromFeedItem(e, r.value.url), url });
    }
  }
  const fresh = [];
  let untranslated = 0;
  for (const c of candidates.filter(veille.isRelevant).sort(veille.bySourceLang)) {
    try {
      const fiche = await veille.toFiche(c);
      if (veille.isDuplicate(fiche.title, [...current, ...fresh])) continue;
      const it = sanitize(fiche, `auto-${crypto.createHash('sha1').update(c.url).digest('hex').slice(0, 12)}`);
      if (it) fresh.push(it);
    } catch (err) {
      untranslated++;
      console.warn('[veille] traduction échouée, article reporté :', c.url, err.message);
    }
  }
  // Sauvegarde directe, sans vérification de version (forceOverwrite) : pas d'erreur CONFLICT possible.
  let added = 0;
  if (fresh.length) {
    const merged = [...fresh, ...current];
    await store.save(merged, { forceOverwrite: true });
    items = merged;
    added = fresh.length;
  }
  return {
    added,
    rejected: candidates.length - fresh.length - untranslated,
    untranslated,
    failedFeeds: results.filter((r) => r.status === 'rejected').length,
  };
}

// Une seule exécution à la fois : un appel concurrent réutilise la promesse en cours.
const runVeille = () => (running ??= fetchVeille().finally(() => (running = null)));

/* ---------------------------------- Auth ---------------------------------- */

const requireAuth = (req, res, next) => {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  try {
    if (scheme !== 'Bearer' || !token) throw new Error();
    req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Authentification requise.' });
  }
};

const attempts = new Map(); // ip -> { n, until } : 5 échecs max / 15 min
const LOCK_MS = 15 * 60_000;

/* ---------------------------------- App ----------------------------------- */

const ready = store.load().then((list) => (items = list));

const app = express();
app.disable('x-powered-by');
app.use(async (req, res, next) => {
  await ready; // première requête d'une instance : attend le chargement des données
  if (req.method === 'GET' && req.path.startsWith('/api/')) items = await store.load(); // Blob : revalidé ≤ 15 s
  next();
});
if (TRUST_PROXY) app.set('trust proxy', 1);
if (CORS_ORIGIN) app.use('/api', cors({ origin: CORS_ORIGIN.split(',') }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' });
  next();
});
app.use(express.json({ limit: '2mb' }));

app.post('/api/login', async (req, res) => {
  const now = Date.now();
  const a = attempts.get(req.ip);
  if (a && a.until > now && a.n >= 5) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 min.' });

  const { username, password } = req.body ?? {};
  // bcrypt.compare toujours exécuté : temps de réponse constant quel que soit l'identifiant.
  const ok = (await bcrypt.compare(String(password ?? ''), ADMIN_PASSWORD_HASH)) && username === ADMIN_USERNAME;
  if (!ok) {
    attempts.set(req.ip, { n: (a && a.until > now ? a.n : 0) + 1, until: now + LOCK_MS });
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }
  attempts.delete(req.ip);
  res.json({ token: jwt.sign({ sub: username, role: 'admin' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '8h' }) });
});

// Liste allégée : le texte complet (Mode Lecture) est servi à la demande par /content.
const publicItem = ({ content, ...it }) => ({ ...it, hasContent: Boolean(content) });
const findById = (id) => items.find((it) => it.id === id);

app.get('/api/items', (req, res) => res.json(items.map(publicItem)));
app.get('/api/items/:id/content', (req, res) => {
  const it = findById(req.params.id);
  if (!it?.content) return res.status(404).json({ error: 'Contenu introuvable.' });
  res.json({ id: it.id, content: it.content });
});
app.get('/api/categories', (req, res) => res.json(CATEGORIES));
app.get('/api/me', requireAuth, (req, res) => res.json({ username: req.user.sub }));

app.post('/api/items', requireAuth, async (req, res) => {
  const it = sanitize(req.body, crypto.randomUUID());
  if (!it) return res.status(400).json({ error: 'Titre et résumé requis.' });
  await mutate((list) => list.unshift(it));
  res.status(201).json(publicItem(it));
});

// /api/fiches/:id : alias utilisé par le Kanban (changement de statut).
app.put(['/api/items/:id', '/api/fiches/:id'], requireAuth, async (req, res) => {
  const it = await mutate((list) => {
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) throw httpError(404, 'Fiche introuvable.');
    const next = sanitize({ ...list[i], ...req.body }, list[i].id);
    if (!next) throw httpError(400, 'Titre et résumé requis.');
    return (list[i] = next);
  });
  res.json(publicItem(it));
});

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  await mutate((list) => {
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) throw httpError(404, 'Fiche introuvable.');
    list.splice(i, 1);
  });
  res.status(204).end();
});

app.post('/api/import', requireAuth, async (req, res) => {
  const raw = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'Tableau « items » attendu.' });
  const incoming = raw.map((r) => sanitize(r, validId(r?.id))).filter(Boolean);
  const added = await mutate((list) => {
    const byId = new Map(list.map((it) => [it.id, it]));
    const count = incoming.filter((it) => !byId.has(it.id)).length;
    incoming.forEach((it) => byId.set(it.id, it));
    list.splice(0, list.length, ...byId.values());
    return count;
  });
  res.json({ added, total: items.length });
});

app.post('/api/force-fetch', requireAuth, async (req, res) => res.json(await runVeille()));

/** Veille planifiée par Vercel Cron (GET + en-tête « Authorization: Bearer <CRON_SECRET> »). */
app.get('/api/cron', async (req, res) => {
  const expected = Buffer.from(`Bearer ${CRON_SECRET ?? ''}`);
  const received = Buffer.from(req.get('authorization') ?? '');
  const valid = Boolean(CRON_SECRET) && received.length === expected.length && crypto.timingSafeEqual(received, expected);
  if (!valid) return res.status(401).json({ error: 'Non autorisé.' });
  res.json(await runVeille());
});

/** Récapitulatif Markdown des fiches datées des 7 derniers jours, groupées par catégorie. */
app.get('/api/admin/digest', requireAuth, (req, res) => {
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const recent = items.filter((it) => it.date >= from).sort((a, b) => b.date.localeCompare(a.date));
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const md = (s) => s.replace(/([\\[\]*_`])/g, '\\$1');
  const lines = [`# Digest TechVeille — du ${fmt(from)} au ${fmt(today())}`, '', `**${recent.length} fiche(s)** cette semaine.`];
  for (const cat of CATEGORIES) {
    const group = recent.filter((it) => it.category === cat);
    if (!group.length) continue;
    lines.push('', `## ${cat} (${group.length})`, '');
    for (const it of group) {
      const title = it.url ? `[${md(it.title)}](${it.url.replace(/\)/g, '%29')})` : md(it.title);
      const meta = [STATUS_LABELS[it.status], it.source, it.tags.filter((t) => t !== 'auto').map((t) => `\`#${t}\``).join(' ')].filter(Boolean).join(' · ');
      lines.push(`- **${title}**  `, `  ${md(it.summary)}  `, `  ${meta}`);
    }
  }
  lines.push('', '---', '', '*Généré par TechVeille Hub.*', '');
  res.json({ from, to: today(), count: recent.length, markdown: lines.join('\n') });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, _next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Erreur serveur.' });
});

/* --------------------------------- Démarrage -------------------------------- */

// Local / Docker : serveur HTTP + planification interne. Sur Vercel, la plateforme appelle `app`
// et la planification passe par vercel.json → GET /api/cron.
if (!IS_VERCEL) {
  cron.schedule(
    CRON_SCHEDULE,
    () => runVeille().then((r) => console.log('[veille] cron :', r)).catch((e) => console.error('[veille] cron :', e)),
    { timezone: CRON_TZ }
  );
  ready.then(() =>
    app.listen(PORT, () =>
      console.log(`TechVeille Hub → http://localhost:${PORT} (stockage : ${store.kind} · veille : "${CRON_SCHEDULE}" ${CRON_TZ})`)
    )
  );
}

module.exports = app;
