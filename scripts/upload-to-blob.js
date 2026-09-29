/**
 * Envoie les fiches locales (data/data.json, contenu du mode lecture compris) dans le Vercel Blob privé
 * utilisé par le déploiement Vercel.
 * Usage : BLOB_READ_WRITE_TOKEN=… node scripts/upload-to-blob.js [--force]
 *   --force : écrase un Blob qui contient déjà des fiches autres que les données de départ.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../storage');

const ROOT = path.join(__dirname, '..');
const FILE = path.resolve(process.env.DATA_PATH || path.join(ROOT, 'data', 'data.json'));
const SEED_FILE = path.join(ROOT, 'data.seed.json');

(async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    throw new Error('BLOB_READ_WRITE_TOKEN manquant (Vercel → Storage → Blob → .env.local).');
  }
  const local = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const store = createStore({ dataFile: FILE, seedFile: SEED_FILE });
  const remote = await store.load(true);
  const seedIds = new Set(JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')).map((it) => it.id));
  const remoteHasData = remote.some((it) => !seedIds.has(it.id));
  if (remoteHasData && !process.argv.includes('--force')) {
    throw new Error(`Le Blob contient déjà ${remote.length} fiches. Relancez avec --force pour les remplacer.`);
  }
  await store.save(local);
  console.log(`${local.length} fiches envoyées dans Vercel Blob (${local.filter((it) => it.content).length} avec contenu de lecture).`);
})().catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});
