/**
 * Couche IndexedDB partagée page ↔ service worker (script classique : importScripts() dans sw.js,
 * <script> dans index.html) → expose globalThis.TVHDB.
 *  - store « kv »      : préférences et caches (favoris, jeton, vue, liste des fiches, catégories…)
 *  - store « content » : texte complet des articles (Mode Lecture hors-ligne), clé = id de fiche
 */
(function (g) {
  let dbPromise;
  const open = () =>
    (dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('techveille', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('content', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  /** Exécute `fn(store)` dans une transaction ; résout avec le résultat de la requête retournée. */
  async function tx(name, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, mode);
      const req = fn(t.objectStore(name));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }

  const TVHDB = {
    get: (key) => tx('kv', 'readonly', (s) => s.get(key)),
    set: (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key)),
    del: (key) => tx('kv', 'readwrite', (s) => s.delete(key)),
    getContent: (id) => tx('content', 'readonly', (s) => s.get(id)).then((r) => r?.content ?? null),
    putContent: (id, content) => tx('content', 'readwrite', (s) => s.put({ id, content, cachedAt: Date.now() })),
    contentIds: () => tx('content', 'readonly', (s) => s.getAllKeys()),

    /**
     * Met en cache le texte complet des fiches des 7 derniers jours (celles qui en ont un).
     * @param {string} base URL de base de l'app (se termine par « / »)
     * @returns {Promise<{ cached: number, total: number }>}
     */
    async cacheWeek(base) {
      const res = await fetch(new URL('api/items', base));
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const week = (await res.json()).filter((it) => it.hasContent && it.date >= since);
      const known = new Set(await TVHDB.contentIds());
      let cached = 0;
      for (const it of week) {
        if (!known.has(it.id)) {
          const r = await fetch(new URL(`api/items/${encodeURIComponent(it.id)}/content`, base));
          if (!r.ok) continue;
          await TVHDB.putContent(it.id, (await r.json()).content);
        }
        cached++;
      }
      return { cached, total: week.length };
    },
  };

  g.TVHDB = TVHDB;
})(globalThis);
