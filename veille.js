/**
 * Pipeline de veille : entrée RSS → filtre qualité/périmètre → synthèse + traduction FR → catégorie → tags.
 * Règle : tout le contenu provient des flux (nettoyé, résumé par extraction, traduit) — rien n'est inventé.
 * Partagé par server.js (scraping) et scripts/clean-data.js (nettoyage ponctuel).
 * Traduction : moteur Google du paquet `translate` (sans clé, non officiel → peut être limité en débit).
 */
const CATEGORIES = ['Standards Web', 'CSS', 'Design', 'Méthodologies', 'Outils', 'Intelligence Artificielle', 'Écosystème / Frameworks'];

const TAG_ALIASES = {
  tailwindcss: 'tailwind', js: 'javascript', reactjs: 'react', reactnative: 'react-native', ts: 'typescript', nodejs: 'node',
  accessibility: 'a11y', accesibilidad: 'a11y', arquitectura: 'architecture', rendimiento: 'performance', debugging: 'debogage',
  testing: 'tests', security: 'securite', webperf: 'performance', perf: 'performance', 'artificial-intelligence': 'ia', ai: 'ia',
  'ai-agents': 'agents-ia', 'ai-models': 'modeles-ia', machinelearning: 'machine-learning', 'open-source': 'opensource',
};
const NOISE_TAGS = new Set(['webdev', 'programming', 'beginners', 'tutorial', 'discuss', 'frontend', 'showdev', 'softwareengineering',
  'career', 'codenewbie', 'productivity', 'desarrolloweb', 'webdevelopment', 'coding', 'learning', 'news', 'auto', 'uncategorized']);
// Sources éditoriales officielles : contenu fiable mais souvent réduit à un court extrait → pas de filtre de qualité
// textuelle (seul le filtre de périmètre s'applique). Les sources communautaires/généralistes restent filtrées.
const TRUSTED_HOSTS = new Set(['developer.chrome.com', 'webkit.org', 'developer.mozilla.org', 'tailwindcss.com', 'smashingmagazine.com', 'openai.com', 'huggingface.co']);
// Anti-spam (titre + résumé, langue source) : contenu promotionnel ou campagnes sponsorisées.
const SPAM_KEYWORDS = [/\bhindsight\b/i, /\bsponsor(ed|ship|s)?\b/i, /(?<!\bof )\bcourses?\b/i, /\b(promo|coupon|discount) codes?\b/i,
  /\baffiliate\b/i, /\b(bootcamp|masterclass)\b/i, /\bgiveaway\b/i, /\blimited[- ]time offer\b/i, /\bpartner content\b/i];
const isSpam = (text) => SPAM_KEYWORDS.some((re) => re.test(text));
const OFF_TOPIC_TAGS = new Set(['career', 'blockchain', 'web3', 'crypto', 'gaming', 'hiring', 'jobs']);
const LOW_QUALITY_TITLES = [/\bI (built|made|created)\b/i, /\bfree\b.*\btemplates?\b/i, /analogy|for (absolute )?beginners|explained (simply|like)/i,
  /^day \d+|100daysofcode/i, /\b(hiring|giveaway|sponsored|webinar)\b/i];

// Mots-clés (texte normalisé sans accents). Ordre = priorité en cas d'égalité.
const CATEGORY_KEYWORDS = {
  'Intelligence Artificielle': ['ai', 'llms?', 'gpt(-?\\d)?', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'copilot', 'machine learning',
    'genai', 'mcp', 'webmcp', 'rag', 'agents?', 'agentic', 'prompts?', 'intelligence artificielle', 'ia'],
  CSS: ['css', 'flexbox', 'grid', 'layout', 'sass', 'scss', 'animations?', 'responsive', 'rtl', 'selectors?', 'container queries', 'anchor positioning', 'view transitions?'],
  'Standards Web': ['html', 'javascript', 'ecmascript', 'es20\\d\\d', 'a11y', 'accessibility', 'popovers?', 'dom', 'json-ld', 'pwa', 'web components?',
    'w3c', 'whatwg', 'browsers?', 'safari', 'chrome', 'firefox', 'webkit', 'baseline', 'interop', 'web apis?', 'webassembly', 'wasm', 'webgpu', 'origin trials?'],
  Design: ['ux', 'ui', 'design', 'figma', 'design-system', 'colou?rs?', 'typography', 'fonts?', 'onboarding', 'usability'],
  Méthodologies: ['testing', 'tests', 'architecture', 'agile', 'debugging', 'best practices', 'checklist', 'seo', 'refactoring', 'performance', 'code review'],
  'Écosystème / Frameworks': ['frameworks?', 'react', 'next(\\.?js)?', 'vue', 'nuxt', 'svelte(kit)?', 'angular', 'astro', 'remix', 'solid(js)?', 'qwik',
    'node(\\.?js)?', 'deno', 'bun', 'typescript', 'rust', 'golang', 'python', 'acqui(res?|red|sition)', 'rachat', 'joins', 'is joining', 'funding', 'raises',
    'open[- ]?source', 'licen[cs]e', 'vercel', 'netlify', 'shopify', 'cloudflare', 'state of', 'survey'],
  Outils: ['tailwind(css)?', 'vite', 'webpack', 'turbopack', 'rollup', 'esbuild', 'npm', 'pnpm', 'yarn', 'postcss', 'eslint', 'prettier', 'biome',
    'git(hub)?', 'devtools', 'vs ?code', 'cli'],
};
const KEYWORD_RES = Object.entries(CATEGORY_KEYWORDS).map(([cat, kws]) => [cat, kws.map((k) => new RegExp(`(^|[^a-z])(${k})([^a-z]|$)`))]);

// Corrections des contresens fréquents de la traduction automatique (vocabulaire dev).
const FR_FIXES = [
  // Frameworks, langages & outils traduits à tort
  [/\bVent arrière\b/g, 'Tailwind'], [/\bRéagir\b/g, 'React'], [/\bAngulaire\b/g, 'Angular'], [/\bRouille\b/g, 'Rust'],
  [/\bNœud(\.js)?\b/g, 'Node.js'], [/\bScript de type\b/gi, 'TypeScript'], [/\bpavé gauche\b/gi, 'left-pad'],
  [/\b(Le Nouveau Stack|La Nouvelle Pile)\b/gi, 'The New Stack'], [/\bMagazine (Smashing|fracassant)\b/gi, 'Smashing Magazine'],
  [/\bVisage (étreignant|câlin)\b/gi, 'Hugging Face'], [/\baperçu technologique (de )?Safari\b/gi, 'Safari Technology Preview'],
  [/\bOutils de développement Chrome\b/gi, 'Chrome DevTools'], [/\bcadriciels?\b/gi, 'framework'], [/\bcadre\b/g, 'framework'],
  // JavaScript & React
  [/\baccessoires\b/gi, 'props'], [/\bcrochets?\b/gi, 'hooks'], [/\b(l')?attente de niveau supérieur\b/gi, 'top-level await'],
  [/\battente asynchrone\b/gi, 'async/await'], [/\btravailleurs? de service\b/gi, 'service worker'], [/\btravailleurs? Web\b/gi, 'Web Worker'],
  [/\b(DOM fantôme|ombre DOM)\b/gi, 'Shadow DOM'], [/\bcomposants Web\b/g, 'Web Components'], [/\bchargement paresseux\b/gi, 'lazy loading'],
  [/\b(secouage d'arbres?|secouer les arbres|arbre à secousses)\b/gi, 'tree-shaking'], [/\bcode (de )?(colle|glue|syndical)\b/gi, 'code de liaison'],
  [/\bcode passe-partout\b/gi, 'code boilerplate'], [/\brouteur d'application\b/gi, 'App Router'], [/\ble App Router\b/g, "l'App Router"],
  // CSS & plateforme web
  [/\bcouches en cascade\b/gi, 'Cascade Layers'], [/\brequêtes (de )?conteneurs?\b/gi, 'container queries'],
  [/\brequêtes (multimédias|de médias|média)\b/gi, 'media queries'], [/\bsous-grille\b/gi, 'subgrid'],
  [/\b(afficher|voir) les transitions\b/gi, 'les View Transitions'], [/\btransitions de vue\b/gi, 'View Transitions'],
  [/\bpositionnement (d'ancrage|des ancres|d'ancre)\b/gi, 'anchor positioning'], [/\bessais? d'origine\b/gi, 'origin trial'],
  [/\b(éléments vitaux|signes vitaux) Web( essentiels)?\b/gi, 'Core Web Vitals'], [/\bVitaux Web essentiels\b/gi, 'Core Web Vitals'],
  [/\bplus grande peinture (de|du) contenu\b/gi, 'Largest Contentful Paint (LCP)'], [/\binteraction avec la (prochaine|peinture suivante)( peinture)?\b/gi, 'Interaction to Next Paint (INP)'],
  [/\bdécalage (de mise en page )?cumulatif( de la mise en page)?\b/gi, 'Cumulative Layout Shift (CLS)'], [/\bhéros\b/gi, 'hero'],
  // Git & open source
  [/\bdemandes? (de tirage|d'extraction)\b/gi, 'pull requests'], [/\bréférentiels?\b/gi, 'dépôt'], [/\b(code )?source ouvert(e)?\b/gi, 'open source'],
  // IA
  [/\bgrands? modèles? de langage\b/gi, 'LLM'], [/\b(ingénierie (des invites|rapide))\b/gi, 'prompt engineering'], [/\bd'invites\b/gi, 'de prompts'], [/\binvites\b/gi, 'prompts'],
  [/\bjetons\b/gi, 'tokens'], [/\bréglage fin\b/gi, 'fine-tuning'], [/\bpoids ouverts\b/gi, 'open-weight'], [/\bchiffon\b/gi, 'RAG'],
];
const fixFr = (s) => FR_FIXES.reduce((out, [re, rep]) => out.replace(re, rep), s);

const STOPWORDS = {
  en: ['the', 'and', 'is', 'are', 'with', 'for', 'to', 'of', 'you', 'your', 'this', 'that', 'how', 'what', 'it'],
  fr: ['le', 'la', 'les', 'des', 'est', 'avec', 'pour', 'une', 'dans', 'que', 'et', 'vous'],
  es: ['el', 'los', 'las', 'del', 'es', 'con', 'para', 'una', 'como', 'que', 'por', 'y'],
  pt: ['o', 'os', 'da', 'do', 'com', 'para', 'uma', 'nao', 'voce', 'em'],
  de: ['der', 'die', 'das', 'und', 'ist', 'mit', 'fur', 'nicht', 'ein', 'eine'],
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clean = (s) => String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();

/** Langue source probable (défaut : en). */
function detectLang(text) {
  const words = norm(text).split(/[^a-z]+/);
  const score = (lang) => words.filter((w) => STOPWORDS[lang].includes(w)).length;
  return Object.keys(STOPWORDS).reduce((best, l) => (score(l) > score(best) ? l : best), 'en');
}

const harmonizeTags = (tags) =>
  [...new Set(tags.map((t) => slug(t)).map((t) => TAG_ALIASES[t] ?? t).filter((t) => t && t.length <= 30 && !NOISE_TAGS.has(t)))].slice(0, 6);

/** Catégorie la mieux notée sur titre + tags (texte source), sinon sur le résumé ; null si hors périmètre. */
function categorize(title, tags, summary = '') {
  const best = (text) =>
    KEYWORD_RES.map(([cat, res]) => [cat, res.filter((re) => re.test(text)).length]).reduce((a, b) => (b[1] > a[1] ? b : a), [null, 0])[0];
  return best(norm(` ${title} ${tags.join(' ')} `)) ?? best(norm(summary));
}

/** Rejette hors-périmètre ; pour les sources non officielles, aussi le promotionnel, le trop court ou sans vrai résumé. */
function isRelevant({ title, summary, tags, trusted = false }) {
  const t = clean(title);
  const s = clean(summary);
  if (isSpam(`${t} ${s}`)) return false;
  if (trusted) return t.length > 0 && s.length > 0 && categorize(t, tags, s) !== null;
  return (
    t.split(' ').length >= 4 &&
    s.length >= 80 &&
    norm(s) !== norm(t) &&
    /[.!?](\s|$)/.test(s.slice(0, 280)) &&
    !/^\d+[).]/.test(s) &&
    !tags.some((x) => OFF_TOPIC_TAGS.has(slug(x))) &&
    !LOW_QUALITY_TITLES.some((re) => re.test(t)) &&
    categorize(t, tags, s) !== null
  );
}

/** Résumé extractif : phrases complètes jusqu'à ~240 caractères, sans « TL;DR » ni titre répété en tête. */
function synthesize(text, title = '', max = 240) {
  let body = clean(text).replace(/^TL;?DR:?\s*/i, '');
  if (title && norm(body).startsWith(norm(title))) body = body.slice(title.length).replace(/^[\s.:!?–-]+/, '');
  const sentences = body.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const s of sentences) {
    if (!/[.!?]$/.test(s) || (out && out.length + s.length > max)) break;
    out += (out ? ' ' : '') + s;
  }
  out ||= sentences[0];
  return out.length > max ? `${out.slice(0, out.lastIndexOf(' ', max - 1))}…` : out;
}

/* ------------------------- Contenu (Reader View) ------------------------- */

const CONTENT_MIN = 600; // en dessous : simple extrait, pas de mode lecture
const CONTENT_MAX = 6000;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

/** HTML → texte structuré minimal (## titres, - listes, ``` code) ; aucun HTML n'est conservé. */
function htmlToText(html) {
  const code = [];
  const text = String(html ?? '')
    .replace(/<(script|style|iframe|svg|noscript|form|button|figure)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\n\u0000${code.push(decode(c.replace(/<[^>]+>/g, '')).replace(/^\n+|\s+$/g, '')) - 1}\u0000\n\n`)
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n## ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|ul|ol|blockquote|section|article|table|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/^## *$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `\`\`\`\n${code[i]}\n\`\`\``);
}

const shorten = (s, max) => (s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max - 1))}…`);

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n\n', max);
  return `${text.slice(0, cut > 0 ? cut : max)}\n\n[…]`;
}

/* ------------------------------ Traduction ------------------------------- */

let translator;
async function tr(text, from) {
  if (from === 'fr') return fixFr(text);
  translator ??= import('translate').then(({ default: t }) => ((t.engine = 'google'), t));
  await new Promise((r) => setTimeout(r, 100)); // ménage le débit du moteur gratuit
  return fixFr(await (await translator)(text, { from, to: 'fr' }));
}

/** Traduit un texte long par paquets de paragraphes (~1800 car.), sans toucher aux blocs de code. */
async function translateLong(text, from) {
  const out = [];
  for (const part of text.split(/(```\n[\s\S]*?\n```)/)) {
    if (part.startsWith('```')) {
      out.push(part);
      continue;
    }
    let chunk = '';
    for (const para of part.split(/\n{2,}/).filter((p) => p.trim())) {
      if (chunk && chunk.length + para.length > 1800) {
        out.push(await tr(chunk, from));
        chunk = '';
      }
      chunk += (chunk ? '\n\n' : '') + para;
    }
    if (chunk) out.push(await tr(chunk, from));
  }
  return out.join('\n\n');
}

/* ------------------------------- Pipeline -------------------------------- */

/** Entrée rss-parser (RSS/Atom) → candidat brut (texte nettoyé, non traduit). */
const BOILERPLATE = /\s*(The post .{1,300}? appeared first on [^.\n]+\.?|Continue reading.*$|Read more.*$)\s*$/is; // pieds de flux WordPress & co.

function fromFeedItem(e, feedUrl) {
  const text = htmlToText(e['content:encoded'] || e.content || e.summary || '').replace(BOILERPLATE, '');
  const summary = clean(e.contentSnippet).replace(BOILERPLATE, '') || clean(text);
  return {
    title: clean(e.title),
    summary,
    content: text.length >= Math.max(CONTENT_MIN, summary.length + 200) ? truncate(text, CONTENT_MAX) : '',
    tags: [feedUrl.match(/dev\.to\/feed\/tag\/([\w-]+)/)?.[1], ...(e.categories ?? []).map((c) => (typeof c === 'string' ? c : c?._))].filter(Boolean),
    source: new URL(feedUrl).hostname.replace(/^www\./, ''),
    trusted: TRUSTED_HOSTS.has(new URL(feedUrl).hostname.replace(/^www\./, '')),
    url: e.link,
    date: e.isoDate?.slice(0, 10),
  };
}

/** Candidat → fiche FR prête pour sanitize(). Lève une erreur si une traduction échoue. */
async function toFiche(raw) {
  const tags = raw.tags.filter((t) => t !== 'auto');
  const title = clean(raw.title).replace(/[:\s]+$/, '');
  const summary = synthesize(raw.summary, title);
  const from = detectLang(`${title} ${summary}`);
  const [t, ...rest] = (await tr(`${title}\n${summary}`, from)).split('\n');
  if (!rest.length) throw new Error('Réponse de traduction inattendue');
  return {
    ...raw,
    title: shorten(t.trim().charAt(0).toUpperCase() + t.trim().slice(1), 120),
    summary: rest.join(' ').trim(),
    content: raw.content ? await translateLong(raw.content, from) : '',
    category: categorize(raw.title, tags, raw.summary) ?? 'Outils',
    status: 'experimental',
    tags: ['auto', ...harmonizeTags(tags)],
  };
}

/** Doublon si le titre partage ≥ 60 % de ses mots significatifs avec une fiche existante (ex. article traduit republié). */
function isDuplicate(title, items) {
  const words = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const a = words(title);
  return items.some((it) => {
    const b = words(it.title);
    const inter = [...a].filter((w) => b.has(w)).length;
    return inter / (new Set([...a, ...b]).size || 1) >= 0.6;
  });
}

/** Trie les sources anglaises en premier : meilleure traduction conservée en cas de doublon. */
const bySourceLang = (a, b) => (detectLang(`${b.title} ${b.summary}`) === 'en') - (detectLang(`${a.title} ${a.summary}`) === 'en');

module.exports = { CATEGORIES, fromFeedItem, isRelevant, toFiche, isDuplicate, harmonizeTags, categorize, bySourceLang, detectLang, htmlToText };
