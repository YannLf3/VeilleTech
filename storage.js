/**
 * Stockage des fiches — deux pilotes interchangeables, même interface :
 *   load(force?) → Promise<Item[]>   (tableau partagé ; force = relire la source)
 *   save(items)  → Promise<void>     (lève une erreur `code: 'CONFLICT'` si une autre instance a écrit entre-temps)
 *
 *  - « blob » : Vercel Blob privé (choisi si BLOB_READ_WRITE_TOKEN ou BLOB_STORE_ID est défini).
 *               Persistant et partagé entre instances serverless ; écritures conditionnelles par ETag.
 *  - « file » : fichier JSON local, écriture atomique (local, Docker ; /tmp éphémère sur Vercel sans Blob).
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const readSeed = async (seedFile) => JSON.parse(await fs.readFile(seedFile, 'utf8'));

function conflict() {
  return Object.assign(new Error('Les données ont été modifiées par une autre instance.'), { code: 'CONFLICT' });
}

/** Fichier JSON local : la mémoire du processus fait foi, pas de concurrence possible. */
function fileStore({ dataFile, seedFile }) {
  let cache = null;
  let queue = Promise.resolve();
  return {
    kind: 'file',
    async load() {
      if (cache) return cache;
      await fs.mkdir(path.dirname(dataFile), { recursive: true });
      try {
        cache = JSON.parse(await fs.readFile(dataFile, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        cache = await readSeed(seedFile);
        await this.save(cache);
      }
      return cache;
    },
    // Écritures sérialisées + atomiques (fichier temporaire puis rename).
    save(items, _opts) { // pas de concurrence possible : forceOverwrite sans objet ici
      cache = items;
      return (queue = queue.then(async () => {
        await fs.writeFile(`${dataFile}.tmp`, JSON.stringify(items, null, 2));
        await fs.rename(`${dataFile}.tmp`, dataFile);
      }));
    },
  };
}

/** Vercel Blob privé : copie en mémoire revalidée (304 si inchangée), écriture conditionnelle `ifMatch`. */
function blobStore({ seedFile, pathname = 'techveille/data.json', ttl = 15_000 }) {
  const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');
  let cache = null;
  let etag = null; // null tant que le blob n'existe pas (1re écriture sans condition)
  let fetchedAt = 0;
  return {
    kind: 'blob',
    async load(force = false) {
      if (cache && !force && Date.now() - fetchedAt < ttl) return cache;
      const res = await get(pathname, { access: 'private', useCache: false, ...(cache && etag ? { ifNoneMatch: etag } : {}) });
      fetchedAt = Date.now();
      if (!res) return (cache ??= await readSeed(seedFile)); // store vide : données de départ
      if (res.statusCode === 304) return cache;
      cache = JSON.parse(await new Response(res.stream).text());
      etag = res.blob.etag;
      return cache;
    },
    // forceOverwrite : écriture inconditionnelle (sans ifMatch), écrase la version distante.
    async save(items, { forceOverwrite = false } = {}) {
      try {
        const result = await put(pathname, JSON.stringify(items), {
          access: 'private',
          allowOverwrite: true,
          addRandomSuffix: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
          ...(etag && !forceOverwrite ? { ifMatch: etag } : {}),
        });
        etag = result.etag;
        cache = items;
        fetchedAt = Date.now();
      } catch (err) {
        if (err instanceof BlobPreconditionFailedError) {
          cache = null; // ETag périmé : la prochaine lecture refait un GET complet, sans ifNoneMatch
          etag = null;
          throw conflict();
        }
        throw err;
      }
    },
  };
}

const createStore = (options) =>
  process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? blobStore(options) : fileStore(options);

module.exports = { createStore };
