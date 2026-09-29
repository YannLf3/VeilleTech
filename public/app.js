/**
 * TechVeille Hub — application principale (ESModule, sans framework).
 * Les fiches viennent de l'API Express (/api/items) ; lecture publique, écriture admin (JWT).
 *
 * Sections :
 *   1. Données & référentiels
 *   2. Stockage local, API & authentification
 *   3. État & filtrage
 *   4. Rendu
 *   5. Générateur Markdown
 *   6. Modales (détail / ajout)
 *   7. Import / Export JSON
 *   8. PWA (service worker, installation, réseau)
 *   9. Initialisation
 */

import { fuzzyIncludes, toWords } from './search.js';
import { annotate } from './glossary.js';
import { COLUMNS, renderKanban, bindKanbanDnD } from './kanban.js';

/* -------------------------------------------------------------------------- */
/* 1. Données & référentiels                                                  */
/* -------------------------------------------------------------------------- */

/** Catégories officielles, chargées depuis GET /api/categories (source unique : veille.js). */
let categories = [];
const PERIODS = [['all', 'Toutes les fiches'], ['7', 'Cette semaine'], ['30', 'Ce mois-ci']]; // tableau : ordre garanti

export const STATUSES = {
  emergent: { label: 'Émergent', emoji: '🔥', badge: 'bg-orange-500/10 text-orange-300 ring-orange-500/25' },
  experimental: { label: 'Expérimental', emoji: '🧪', badge: 'bg-violet-500/10 text-violet-300 ring-violet-500/25' },
  recommended: { label: 'Recommandé', emoji: '✅', badge: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25' },
};

/** @typedef {{ id: string, title: string, summary: string, category: string, status: keyof typeof STATUSES,
 *              tags: string[], url: string, code: string, lang: string, date: string }} Item */

/* -------------------------------------------------------------------------- */
/* 2. Stockage local, API & authentification                                  */
/* -------------------------------------------------------------------------- */

const db = globalThis.TVHDB; // public/db.js (IndexedDB, partagé avec le service worker)

/** Accès IndexedDB tolérant aux pannes (navigation privée, quota…) : l'app continue en mémoire. */
const store = {
  async get(key, fallback) {
    try {
      return (await db.get(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  async set(key, value) {
    try {
      await db.set(key, value);
    } catch {
      toast('Stockage local indisponible : modification non sauvegardée.');
    }
  },
  async del(key) {
    try {
      await db.del(key);
    } catch {
      /* stockage indisponible : rien à supprimer */
    }
  },
};
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('techveille') : null; // synchro entre onglets

/** @type {Item[]} */
let items = [];
let itemsLoaded = false; // évite d'afficher « Aucune fiche » avant la réponse de l'API
let view = 'list'; // 'list' | 'kanban'
const favorites = new Set();
const saveFavorites = () => {
  store.set('favs', [...favorites]);
  channel?.postMessage('favs');
};

const allItems = () => items;
const findItem = (id) => items.find((it) => it.id === id);

const auth = { token: null, isAdmin: false };

/** Charge l'état persistant ; migre une seule fois les anciennes clés localStorage vers IndexedDB. */
async function loadPrefs() {
  try {
    for (const [legacy, key] of [['tvh:favs', 'favs'], ['tvh:token', 'token'], ['tvh:ios-hint-dismissed', 'iosHint']]) {
      const raw = localStorage.getItem(legacy);
      if (raw === null) continue;
      await store.set(key, JSON.parse(raw));
      localStorage.removeItem(legacy);
    }
  } catch {
    /* localStorage indisponible : rien à migrer */
  }
  const favs = await store.get('favs', []);
  (Array.isArray(favs) ? favs : []).forEach((id) => favorites.add(id));
  auth.token = await store.get('token', null);
  view = await store.get('view', 'list');
}

/** Appel JSON à l'API ; ajoute le JWT si présent. Lève une Error avec le message serveur. */
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(`./api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && auth.token && path !== '/login') {
    setAdmin(null);
    toast('Session expirée : reconnectez-vous.');
  }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

/** Charge les catégories ; hors-ligne sans cache, repli sur celles présentes dans les fiches. */
async function loadCategories(itemsReady) {
  try {
    categories = await api('/categories');
    store.set('categories', categories);
  } catch {
    await itemsReady;
    categories = (await store.get('categories', null)) ?? [...new Set(items.map((it) => it.category))];
  }
  $('#f-category').innerHTML = categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  render();
}

async function loadItems() {
  try {
    items = await api('/items');
    store.set('items', items);
  } catch {
    items = await store.get('items', []);
    toast(items.length ? 'Hors-ligne : dernière version enregistrée affichée.' : 'Impossible de charger les fiches.');
  }
  itemsLoaded = true;
  render();
  refreshDetail();
}

/** @param {boolean} persist false quand l'info vient d'un autre onglet (évite l'écho). */
function setAdmin(token, persist = true) {
  auth.token = token;
  auth.isAdmin = Boolean(token);
  if (persist) {
    if (token) store.set('token', token);
    else store.del('token');
    channel?.postMessage('token');
  }
  document.body.classList.toggle('is-admin', auth.isAdmin);
  render();
  refreshDetail();
}

/* -------------------------------------------------------------------------- */
/* 3. État & filtrage                                                         */
/* -------------------------------------------------------------------------- */

const state = {
  query: '',
  category: 'all',
  status: 'all',
  tag: null,
  favsOnly: false,
  period: 'all', // 'all' | '7' | '30' (jours)
  sort: 'desc', // 'desc' = plus récents d'abord
};
const DEFAULT_FILTERS = { query: '', category: 'all', status: 'all', tag: null, favsOnly: false, period: 'all' };

const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function getFilteredItems() {
  const terms = normalize(state.query).split(/\s+/).filter(Boolean);
  const since = state.period === 'all' ? '' : new Date(Date.now() - Number(state.period) * 864e5).toISOString().slice(0, 10);
  return allItems()
    .filter((it) => {
      if (state.category !== 'all' && it.category !== state.category) return false;
      if (view === 'list' && state.status !== 'all' && it.status !== state.status) return false;
      if (state.tag && !it.tags.includes(state.tag)) return false;
      if (state.favsOnly && !favorites.has(it.id)) return false;
      if (since && it.date < since) return false;
      if (terms.length) {
        const text = normalize([it.title, it.summary, it.category, it.source ?? '', ...it.tags].join(' '));
        const words = toWords(text);
        return terms.every((t) => fuzzyIncludes(t, text, words));
      }
      return true;
    })
    .sort((a, b) => (state.sort === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
}

const hasActiveFilters = () =>
  Object.entries(DEFAULT_FILTERS).some(([key, value]) => state[key] !== value);

function setState(patch) {
  Object.assign(state, patch);
  render();
}

/* -------------------------------------------------------------------------- */
/* 4. Rendu                                                                   */
/* -------------------------------------------------------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** N'autorise que les URL http(s) — bloque javascript:, data:, etc. */
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

const formatDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

const statusBadge = (status) => {
  const s = STATUSES[status];
  return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.badge}">
    <span aria-hidden="true">${s.emoji}</span>${s.label}</span>`;
};

const chipClass = (active) =>
  `shrink-0 h-8 rounded-full border px-3.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
    active ? 'border-white bg-white text-black' : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-white'
  }`;

function renderCategoryFilters() {
  const items = allItems();
  const counts = items.reduce((acc, it) => ((acc[it.category] = (acc[it.category] || 0) + 1), acc), {});
  const chips = [['all', 'Toutes', items.length], ...categories.map((c) => [c, c, counts[c] || 0])];
  $('#category-filters').innerHTML = chips
    .map(
      ([value, label, n]) => `<button type="button" class="${chipClass(state.category === value)}"
        data-filter="category" data-value="${esc(value)}" aria-pressed="${state.category === value}">
        ${esc(label)} <span class="ml-0.5 font-mono text-[11px] opacity-60">${n}</span></button>`
    )
    .join('');
}

function renderStatusFilters() {
  const options = [['all', 'Tous'], ...Object.entries(STATUSES).map(([k, s]) => [k, `${s.emoji} ${s.label}`])];
  $('#status-filters').innerHTML = options
    .map(([value, label]) => {
      const active = state.status === value;
      return `<button type="button" data-filter="status" data-value="${value}" aria-pressed="${active}"
        class="h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
          active ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-200'
        }">${label}</button>`;
    })
    .join('');
}

function renderActiveTag() {
  $('#active-tag').innerHTML = state.tag
    ? `<button type="button" data-action="clear-tag" aria-label="Retirer le filtre tag ${esc(state.tag)}"
        class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 font-mono text-xs text-sky-300 hover:bg-sky-500/20">
        #${esc(state.tag)} <span aria-hidden="true">✕</span></button>`
    : '';
}

function cardTemplate(it) {
  const fav = favorites.has(it.id);
  return `
  <article class="group relative flex flex-col rounded-xl border border-neutral-800 bg-neutral-950 p-5 transition hover:border-neutral-600 hover:bg-neutral-900/60">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        ${statusBadge(it.status)}
        <span class="text-[11px] font-medium uppercase tracking-wider text-neutral-500">${esc(it.category)}</span>
      </div>
      <button type="button" data-action="toggle-fav" data-id="${esc(it.id)}" aria-pressed="${fav}"
        aria-label="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'} : ${esc(it.title)}"
        class="relative z-10 -m-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-lg transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
          fav ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-300'
        }">${fav ? '★' : '☆'}</button>
    </div>
    <h2 class="text-base font-semibold tracking-tight text-white">
      <button type="button" data-action="open-detail" data-id="${esc(it.id)}"
        class="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-white/60">
        ${esc(it.title)}
      </button>
    </h2>
    <p class="mt-1.5 line-clamp-3 text-sm leading-relaxed text-neutral-400">${annotate(esc(it.summary))}</p>
    <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
      ${it.tags
        .map(
          (t) => `<button type="button" data-action="filter-tag" data-tag="${esc(t)}"
            class="relative z-10 rounded-md bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400 ring-1 ring-inset ring-neutral-800 transition hover:text-white hover:ring-neutral-600">#${esc(t)}</button>`
        )
        .join('')}
      ${
        it.hasContent
          ? `<button type="button" data-action="open-reader" data-id="${esc(it.id)}"
              class="relative z-10 ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-sky-400 transition hover:bg-sky-500/10 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
              Lire sur l'app <span aria-hidden="true">→</span></button>`
          : ''
      }
    </div>
  </article>`;
}

/** Carte compacte Kanban ; pour l'admin : glissable + flèches (alternative clavier/tactile au drag & drop). */
function kanbanCardTemplate(it, column) {
  const move = (dir, arrow) => {
    const target = COLUMNS[column + dir];
    return target
      ? `<button type="button" data-action="move-item" data-id="${esc(it.id)}" data-status="${target[0]}" aria-label="Déplacer « ${esc(it.title)} » vers ${target[1]}"
          class="grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">${arrow}</button>`
      : '';
  };
  return `<article data-kanban-id="${esc(it.id)}" ${auth.isAdmin ? 'draggable="true"' : ''}
      class="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 ${auth.isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}">
    <p class="text-[11px] uppercase tracking-wider text-neutral-500">${esc(it.category)} · ${esc(formatDate(it.date))}</p>
    <button type="button" data-action="open-detail" data-id="${esc(it.id)}" class="mt-1 text-left text-sm font-medium leading-snug text-white hover:underline">${esc(it.title)}</button>
    ${auth.isAdmin ? `<div class="mt-2 flex justify-end gap-1">${move(-1, '←')}${move(1, '→')}</div>` : ''}
  </article>`;
}

/** Changement de statut (drag & drop ou flèches) : mise à jour optimiste, annulée si l'API échoue. */
async function moveItem(id, status) {
  const it = findItem(id);
  if (!auth.isAdmin || !it || it.status === status) return;
  const previous = it.status;
  it.status = status;
  render();
  try {
    Object.assign(it, await api(`/fiches/${encodeURIComponent(id)}`, { method: 'PUT', body: { status } }));
    store.set('items', items);
    toast(`Déplacée vers « ${COLUMNS.find(([s]) => s === status)[1]} »`);
  } catch (err) {
    it.status = previous;
    render();
    toast(err.message);
  }
}

function setView(next) {
  view = next;
  store.set('view', next);
  render();
}

function render() {
  renderCategoryFilters();
  renderStatusFilters();
  renderActiveTag();
  $('#favs-toggle').setAttribute('aria-pressed', String(state.favsOnly));
  $('#period').value = state.period;
  $('#sort').value = state.sort;

  const items = getFilteredItems();
  const kanban = view === 'kanban';
  document.querySelectorAll('[data-action="set-view"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#list-view').hidden = kanban;
  $('#kanban-view').hidden = !kanban;
  $('#status-filters').classList.toggle('hidden', kanban); // les colonnes remplacent le filtre de statut
  if (kanban) renderKanban($('#kanban'), items, kanbanCardTemplate);
  else $('#results').innerHTML = items.map(cardTemplate).join('');
  $('#results-count').textContent = `${items.length} fiche${items.length > 1 ? 's' : ''}`;
  $('#empty-state').hidden = kanban || items.length > 0 || !itemsLoaded;
  $('#btn-reset').hidden = !hasActiveFilters();
}

/* -------------------------------------------------------------------------- */
/* 5. Générateur Markdown                                                     */
/* -------------------------------------------------------------------------- */

/** Clôture de bloc de code assez longue pour ne jamais entrer en conflit avec le contenu. */
function codeFence(code) {
  const longest = Math.max(0, ...(code.match(/`+/g) || []).map((m) => m.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

export function toMarkdown(it, level = 1) {
  const h = '#'.repeat(level);
  const s = STATUSES[it.status];
  const url = safeUrl(it.url);
  const lines = [
    `${h} ${it.title}`,
    '',
    `> ${it.summary.replace(/\s*\n+\s*/g, ' ')}`,
    '',
    `- **Catégorie** : ${it.category}`,
    `- **Statut** : ${s.emoji} ${s.label}`,
    it.tags.length ? `- **Tags** : ${it.tags.map((t) => `\`${t}\``).join(', ')}` : null,
    url ? `- **Lien officiel** : <${url}>` : null,
    `- **Date** : ${it.date}`,
  ].filter((l) => l !== null);

  if (it.code.trim()) {
    const fence = codeFence(it.code);
    lines.push('', `${h}# Exemple`, '', `${fence}${it.lang === 'text' ? '' : it.lang}`, it.code, fence);
  }
  if (level === 1) lines.push('', '---', '', '*Fiche générée par TechVeille Hub.*');
  lines.push('');
  return lines.join('\n');
}

function collectionToMarkdown(items) {
  const header = `# Veille technologique — ${new Date().toLocaleDateString('fr-FR')}\n\n${items.length} fiche(s)\n`;
  return [header, ...items.map((it) => toMarkdown(it, 2))].join('\n');
}

const slugify = (s) =>
  normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Repli pour les contextes non sécurisés / anciens navigateurs
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Modales (détail / ajout-édition / connexion)                            */
/* -------------------------------------------------------------------------- */

const detailDialog = $('#detail-dialog');
const addDialog = $('#add-dialog');
const loginDialog = $('#login-dialog');
const readerDialog = $('#reader-dialog');
const digestDialog = $('#digest-dialog');
let digestMarkdown = '';
let currentDetailId = null;
let editingId = null;

function detailTemplate(it) {
  const fav = favorites.has(it.id);
  const url = safeUrl(it.url);
  const btn =
    'inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-800 px-3 text-sm text-neutral-300 transition hover:border-neutral-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

  return `
  <div class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-5 py-3 backdrop-blur">
    <div class="flex flex-wrap items-center gap-2">
      ${statusBadge(it.status)}
      <span class="text-[11px] font-medium uppercase tracking-wider text-neutral-500">${esc(it.category)}</span>
    </div>
    <button type="button" data-action="close-dialog" aria-label="Fermer"
      class="grid h-8 w-8 place-items-center rounded-md text-neutral-400 hover:bg-neutral-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
  </div>

  <div class="space-y-5 px-5 py-5">
    <div>
      <h2 id="detail-title" class="text-2xl font-semibold tracking-tight text-white">${esc(it.title)}</h2>
      <p class="mt-1 text-xs text-neutral-500">Mis à jour le ${esc(formatDate(it.date))}${it.source ? ` · ${esc(it.source)}` : ''}</p>
    </div>

    <p class="leading-relaxed text-neutral-300">${annotate(esc(it.summary))}</p>

    ${
      it.tags.length
        ? `<div class="flex flex-wrap gap-1.5">${it.tags
            .map(
              (t) => `<button type="button" data-action="filter-tag" data-tag="${esc(t)}"
                class="rounded-md bg-neutral-900 px-1.5 py-0.5 font-mono text-xs text-neutral-400 ring-1 ring-inset ring-neutral-800 hover:text-white">#${esc(t)}</button>`
            )
            .join('')}</div>`
        : ''
    }

    ${
      it.code.trim()
        ? `<figure class="overflow-hidden rounded-lg border border-neutral-800 bg-black">
            <figcaption class="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
              <span class="font-mono text-[11px] uppercase tracking-wider text-neutral-500">${esc(it.lang)}</span>
              <button type="button" data-action="copy-code" class="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-white">Copier</button>
            </figcaption>
            <pre class="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-neutral-200"><code>${esc(it.code)}</code></pre>
          </figure>`
        : ''
    }

    ${
      url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"
            class="group inline-flex items-center gap-1.5 text-sm text-sky-400 hover:text-sky-300">
            Documentation officielle
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>
            <span class="sr-only">(nouvel onglet)</span>
          </a>`
        : ''
    }

    <details class="group rounded-lg border border-neutral-800">
      <summary class="cursor-pointer list-none px-3 py-2 text-sm text-neutral-400 hover:text-white">
        <span class="inline-block transition group-open:rotate-90" aria-hidden="true">›</span> Aperçu Markdown
      </summary>
      <pre class="max-h-64 overflow-auto border-t border-neutral-800 bg-black p-3 font-mono text-xs leading-relaxed text-neutral-400">${esc(toMarkdown(it))}</pre>
    </details>
  </div>

  <div class="sticky bottom-0 flex flex-wrap gap-2 border-t border-neutral-800 bg-neutral-950/95 px-5 py-4 backdrop-blur" style="padding-bottom: max(1rem, env(safe-area-inset-bottom))">
    <button type="button" data-action="copy-md" class="inline-flex h-9 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium text-black hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950">
      Copier en Markdown
    </button>
    <button type="button" data-action="download-md" class="${btn}">Télécharger .md</button>
    ${it.hasContent ? `<button type="button" data-action="open-reader" data-id="${esc(it.id)}" class="${btn}">Lire sur l'app</button>` : ''}
    <button type="button" data-action="toggle-fav" data-id="${esc(it.id)}" aria-pressed="${fav}" class="${btn} ${fav ? '!text-amber-400' : ''}">
      <span aria-hidden="true">${fav ? '★' : '☆'}</span> ${fav ? 'Favori' : 'Ajouter aux favoris'}
    </button>
    ${
      auth.isAdmin
        ? `<button type="button" data-action="edit-item" data-id="${esc(it.id)}" class="${btn} sm:ml-auto">Modifier</button>
           <button type="button" data-action="delete-item" data-id="${esc(it.id)}" class="${btn} hover:!border-red-500/50 hover:!text-red-400">Supprimer</button>`
        : ''
    }
  </div>`;
}

function openDetail(id) {
  const it = findItem(id);
  if (!it) return;
  currentDetailId = id;
  $('#detail-content').innerHTML = detailTemplate(it);
  if (!detailDialog.open) detailDialog.showModal();
  $('#detail-content').scrollTop = 0;
}

function refreshDetail() {
  if (!detailDialog.open || !currentDetailId) return;
  const it = findItem(currentDetailId);
  if (!it) return detailDialog.close();
  const content = $('#detail-content');
  const scroll = content.scrollTop;
  content.innerHTML = detailTemplate(it);
  content.scrollTop = scroll;
}

/** Contenu stocké (## titres, - listes, ``` code, paragraphes) → HTML échappé. */
function renderContent(text) {
  return text
    .split(/(```\n[\s\S]*?\n```)/)
    .map((part) =>
      part.startsWith('```')
        ? `<pre class="overflow-x-auto rounded-lg border border-neutral-800 bg-black p-4 font-mono text-[13px] leading-relaxed text-neutral-200"><code>${esc(part.slice(4, -4))}</code></pre>`
        : part
            .split(/\n{2,}/)
            .map((b) => b.trim())
            .filter(Boolean)
            .map((b) => {
              if (b.startsWith('## ')) return `<h2 class="pt-2 text-lg font-semibold text-white">${esc(b.slice(3))}</h2>`;
              if (b.startsWith('- ')) return `<ul class="list-disc space-y-1 pl-5">${b.split(/\n?^- /m).filter(Boolean).map((li) => `<li>${esc(li)}</li>`).join('')}</ul>`;
              return `<p>${esc(b).replace(/\n/g, '<br>')}</p>`;
            })
            .join('')
    )
    .join('');
}

async function openReader(id) {
  const it = findItem(id);
  if (!it?.hasContent) return;
  let content = await db.getContent(id).catch(() => null);
  if (!content) {
    try {
      ({ content } = await api(`/items/${encodeURIComponent(id)}/content`));
      db.putContent(id, content).catch(() => {}); // article lu = disponible hors-ligne ensuite
    } catch {
      return toast('Article indisponible hors-ligne — utilisez « Rendre disponible hors-ligne » quand vous êtes connecté.');
    }
  }
  const url = safeUrl(it.url);
  $('#reader-content').innerHTML = `
    <p class="text-xs font-medium uppercase tracking-wider text-neutral-500">${esc(it.source || it.category)} · ${esc(formatDate(it.date))}</p>
    <h2 id="reader-title" class="mt-2 text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">${esc(it.title)}</h2>
    <p class="mt-3 text-neutral-400">${annotate(esc(it.summary))}</p>
    <div class="mt-6 space-y-4 border-t border-neutral-800 pt-6 text-[17px] leading-relaxed text-neutral-300">${renderContent(content)}</div>
    <p class="mt-8 border-t border-neutral-800 pt-4 text-xs text-neutral-500">Traduction automatique du flux de ${esc(it.source || 'la source')}.
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:text-sky-300">Lire l'article original ↗</a>` : ''}</p>`;
  if (detailDialog.open) detailDialog.close();
  readerDialog.showModal();
  readerDialog.querySelector('.overflow-y-auto').scrollTop = 0;
}

/** Demande au service worker (ou, à défaut, à la page) de stocker les articles de la semaine dans IndexedDB. */
async function makeOffline() {
  toast('Mise en cache des articles de la semaine…');
  try {
    const sw = navigator.serviceWorker?.controller;
    const { cached, total } = sw
      ? await new Promise((resolve, reject) => {
          const { port1, port2 } = new MessageChannel();
          port1.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data));
          sw.postMessage({ type: 'CACHE_WEEK' }, [port2]);
        })
      : await db.cacheWeek(new URL('./', location.href).href);
    toast(total ? `${cached}/${total} article(s) de la semaine disponibles hors-ligne ✓` : 'Aucun article complet publié cette semaine.');
  } catch (err) {
    toast(`Mise en cache impossible : ${err.message}`);
  }
}

async function openDigest() {
  try {
    const { markdown, count } = await api('/admin/digest');
    digestMarkdown = markdown;
    $('#digest-count').textContent = `${count} fiche${count > 1 ? 's' : ''} sur 7 jours`;
    $('#digest-output').textContent = markdown;
    digestDialog.showModal();
  } catch (err) {
    toast(err.message);
  }
}

/** Ouvre le formulaire en création (sans id) ou en édition. */
function openEditor(id = null) {
  const form = $('#add-form');
  const it = id && findItem(id);
  form.reset();
  editingId = it ? id : null;
  $('#form-error').classList.add('hidden');
  $('#add-title').textContent = it ? 'Modifier la ressource' : 'Nouvelle ressource';
  if (it) {
    for (const key of ['title', 'summary', 'category', 'status', 'url', 'code', 'lang']) form.elements[key].value = it[key];
    form.elements.tags.value = it.tags.join(', ');
  } else if (state.category !== 'all') form.elements.category.value = state.category;
  if (detailDialog.open) detailDialog.close();
  addDialog.showModal();
  form.elements.title.focus();
}

function populateFormSelects() {
  $('#period').innerHTML = PERIODS.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  $('#f-status').innerHTML = Object.entries(STATUSES)
    .map(([k, s]) => `<option value="${k}">${s.emoji} ${s.label}</option>`)
    .join('');
}

async function handleAddSubmit(e) {
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.currentTarget);
  const data = Object.fromEntries(new FormData(form));
  const { title, summary, url } = form.elements;

  let invalidField = null;
  let message = '';
  if (!data.title.trim()) [invalidField, message] = [title, 'Le titre est requis.'];
  else if (!data.summary.trim()) [invalidField, message] = [summary, 'Le résumé est requis.'];
  else if (data.url.trim() && !safeUrl(data.url.trim())) [invalidField, message] = [url, 'Le lien doit commencer par http:// ou https://.'];

  const errBox = $('#form-error');
  if (invalidField) {
    errBox.textContent = message;
    errBox.classList.remove('hidden');
    invalidField.focus();
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const saved = editingId
      ? await api(`/items/${encodeURIComponent(editingId)}`, { method: 'PUT', body: data })
      : await api('/items', { method: 'POST', body: data });
    addDialog.close();
    if (!editingId) {
      $('#search').value = '';
      Object.assign(state, DEFAULT_FILTERS);
    }
    await loadItems();
    toast(editingId ? 'Ressource modifiée ✓' : 'Ressource ajoutée ✓');
    if (editingId) openDetail(saved.id);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    submit.disabled = false;
  }
}

async function deleteItem(id) {
  const it = findItem(id);
  if (!it || !confirm(`Supprimer « ${it.title} » ?`)) return;
  try {
    await api(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
    favorites.delete(id);
    saveFavorites();
    detailDialog.close();
    await loadItems();
    toast('Ressource supprimée');
  } catch (err) {
    toast(err.message);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.currentTarget);
  const errBox = $('#login-error');
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const { token } = await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    loginDialog.close();
    setAdmin(token);
    toast('Connecté en administrateur ✓');
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
    form.elements.password.select();
  } finally {
    submit.disabled = false;
  }
}

/** Déclenche la veille web côté serveur (POST /api/force-fetch) avec loader sur le bouton. */
async function forceFetch(btn) {
  const label = btn.querySelector('[data-label]');
  const icon = btn.querySelector('svg');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  icon.classList.add('animate-spin');
  label.textContent = 'Veille en cours…';
  try {
    const { added, failedFeeds } = await api('/force-fetch', { method: 'POST' });
    await loadItems();
    if (added) setState({ tag: 'auto' });
    toast(`${added} nouvelle(s) fiche(s)${failedFeeds ? ` · ${failedFeeds} flux en échec` : ''}`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    icon.classList.remove('animate-spin');
    label.textContent = 'Lancer la veille web';
  }
}

function toggleFavorite(id) {
  const added = !favorites.has(id);
  if (added) favorites.add(id);
  else favorites.delete(id);
  saveFavorites();
  render();
  refreshDetail();
  toast(added ? 'Ajouté aux favoris ★' : 'Retiré des favoris');
}

/* -------------------------------------------------------------------------- */
/* 7. Import / Export JSON                                                    */
/* -------------------------------------------------------------------------- */

function exportJSON() {
  const payload = {
    app: 'techveille-hub',
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
    favorites: [...favorites],
  };
  downloadFile(`techveille-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast(`Export : ${items.length} fiche(s), ${favorites.size} favori(s)`);
}

async function importJSON(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux (max 5 Mo).');
    const data = JSON.parse(await file.text());
    const rawItems = Array.isArray(data) ? data : data?.items;
    if (!Array.isArray(rawItems)) throw new Error('Format invalide : tableau « items » introuvable.');

    const { added } = await api('/import', { method: 'POST', body: { items: rawItems } });
    await loadItems();
    if (Array.isArray(data?.favorites)) {
      data.favorites.filter((id) => findItem(id)).forEach((id) => favorites.add(id));
      saveFavorites();
      render();
    }
    toast(`Import réussi : ${added} nouvelle(s) fiche(s)`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'Fichier JSON invalide.' : err.message);
  }
}

/* -------------------------------------------------------------------------- */
/* 8. PWA (service worker, installation, réseau)                              */
/* -------------------------------------------------------------------------- */

let deferredInstallPrompt = null;

function initPWA() {
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[SW] enregistrement échoué', err));
    });
  }

  const installBtn = $('#btn-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    toast('TechVeille Hub installée ✓');
  });

  // iOS Safari ne supporte pas beforeinstallprompt : afficher une aide manuelle.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  store.get('iosHint', false).then((dismissed) => {
    if (isIOS && !standalone && !dismissed) setTimeout(() => ($('#ios-hint').hidden = false), 2500);
  });

  const updateNet = () => $('#net-status').classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();
}

/* -------------------------------------------------------------------------- */
/* 9. Initialisation & événements                                             */
/* -------------------------------------------------------------------------- */

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('opacity-0', 'translate-y-2');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('opacity-0', 'translate-y-2'), 2400);
}

function setMenu(open) {
  $('#menu').hidden = !open;
  $('#btn-menu').setAttribute('aria-expanded', String(open));
  if (open) $('#menu [role="menuitem"]').focus();
}

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const actions = {
  'open-add': () => openEditor(),
  'set-view': (el) => setView(el.dataset.view),
  'move-item': (el) => moveItem(el.dataset.id, el.dataset.status),
  'make-offline': makeOffline,
  'open-reader': (el) => openReader(el.dataset.id),
  'open-digest': openDigest,
  'copy-digest': async () => {
    try {
      await copyText(digestMarkdown);
      toast('Digest copié ✓');
    } catch {
      toast('Copie impossible — utilisez « Télécharger .md ».');
    }
  },
  'download-digest': () => downloadFile(`digest-${new Date().toISOString().slice(0, 10)}.md`, digestMarkdown, 'text/markdown;charset=utf-8'),
  'edit-item': (el) => openEditor(el.dataset.id),
  'force-fetch': forceFetch,
  'open-login': () => {
    $('#login-form').reset();
    $('#login-error').classList.add('hidden');
    loginDialog.showModal();
  },
  logout: () => {
    setAdmin(null);
    toast('Déconnecté');
  },
  'open-detail': (el) => openDetail(el.dataset.id),
  'toggle-fav': (el) => toggleFavorite(el.dataset.id),
  'filter-tag': (el) => {
    if (detailDialog.open) detailDialog.close();
    setState({ tag: state.tag === el.dataset.tag ? null : el.dataset.tag });
  },
  'clear-tag': () => setState({ tag: null }),
  'close-dialog': (el) => el.closest('dialog')?.close(),
  'copy-md': async () => {
    try {
      await copyText(toMarkdown(findItem(currentDetailId)));
      toast('Markdown copié dans le presse-papiers ✓');
    } catch {
      toast('Copie impossible — utilisez « Télécharger .md ».');
    }
  },
  'download-md': () => {
    const it = findItem(currentDetailId);
    downloadFile(`${slugify(it.title) || 'fiche'}.md`, toMarkdown(it), 'text/markdown;charset=utf-8');
  },
  'copy-code': async () => {
    try {
      await copyText(findItem(currentDetailId).code);
      toast('Code copié ✓');
    } catch {
      toast('Copie impossible.');
    }
  },
  'delete-item': (el) => deleteItem(el.dataset.id),
  'export-json': exportJSON,
  'import-json': () => $('#import-input').click(),
  'export-md': () => {
    const items = getFilteredItems();
    if (!items.length) return toast('Aucune fiche à exporter.');
    downloadFile(`veille-${new Date().toISOString().slice(0, 10)}.md`, collectionToMarkdown(items), 'text/markdown;charset=utf-8');
  },
  'dismiss-ios-hint': () => {
    store.set('iosHint', true);
    $('#ios-hint').hidden = true;
  },
};

function bindEvents() {
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!target.closest('#menu, #btn-menu')) setMenu(false);

    const filterBtn = target.closest('[data-filter]');
    if (filterBtn) return setState({ [filterBtn.dataset.filter]: filterBtn.dataset.value });

    const actionEl = target.closest('[data-action]');
    if (!actionEl) return;
    if (actionEl.closest('#menu')) setMenu(false);
    actions[actionEl.dataset.action]?.(actionEl);
  });

  $('#btn-menu').addEventListener('click', () => setMenu($('#menu').hidden));
  $('#menu').addEventListener('keydown', (e) => {
    const items = [...$('#menu').querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else if (e.key === 'Escape') {
      setMenu(false);
      $('#btn-menu').focus();
    } else return;
    e.preventDefault();
  });

  $('#favs-toggle').addEventListener('click', () => setState({ favsOnly: !state.favsOnly }));
  $('#btn-reset').addEventListener('click', () => {
    $('#search').value = '';
    setState({ ...DEFAULT_FILTERS, sort: 'desc' });
  });

  const search = $('#search');
  search.addEventListener('input', debounce(() => setState({ query: search.value.trim() }), 120));

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      search.focus();
    }
  });

  // Fermer les modales en cliquant sur le fond
  $('#period').addEventListener('change', (e) => setState({ period: e.target.value }));
  $('#sort').addEventListener('change', (e) => setState({ sort: e.target.value }));

  for (const dialog of [detailDialog, addDialog, loginDialog, readerDialog, digestDialog]) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
  detailDialog.addEventListener('close', () => (currentDetailId = null));

  $('#add-form').addEventListener('submit', handleAddSubmit);
  $('#login-form').addEventListener('submit', handleLogin);

  $('#import-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = '';
  });

  // Synchronisation entre onglets (IndexedDB n'émet pas d'événement « storage »)
  channel?.addEventListener('message', async ({ data }) => {
    if (data === 'token') return setAdmin(await store.get('token', null), false);
    if (data !== 'favs') return;
    favorites.clear();
    (await store.get('favs', [])).forEach((id) => favorites.add(id));
    render();
    refreshDetail();
  });

  bindKanbanDnD($('#kanban'), moveItem);
}

populateFormSelects();
bindEvents();
initPWA();
(async () => {
  await loadPrefs();
  // Raccourci PWA « Mes favoris » (manifest.json → shortcuts)
  if (new URLSearchParams(location.search).get('favs') === '1') state.favsOnly = true;
  render();
  loadCategories(loadItems());
  // Jeton mémorisé : vérifié auprès du serveur (un 401 déconnecte via api()).
  if (auth.token) api('/me').then(() => setAdmin(auth.token), () => {});
})();
