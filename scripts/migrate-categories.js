/**
 * Migration ponctuelle (serveur arrêté) : reclasse les fiches existantes dans les nouvelles catégories.
 *  - rachat / business / Shopify / tag « ecosystem »… → Écosystème / Frameworks
 *  - IA / AI (ou tag ia/ai)                          → Intelligence Artificielle (prioritaire)
 * Sauvegarde préalable dans data.backup-<timestamp>.json.
 * Usage : node scripts/migrate-categories.js [--dry-run]
 */
const fs = require('node:fs');
const path = require('node:path');
const { CATEGORIES } = require('../veille');

const FILE = path.resolve(process.env.DATA_PATH || path.join(__dirname, '..', 'data', 'data.json'));
const ECO = 'Écosystème / Frameworks';
const AI = 'Intelligence Artificielle';
if (![ECO, AI].every((c) => CATEGORIES.includes(c))) throw new Error('Catégories cibles absentes de veille.js');

const RULES = [
  [ECO, /\b(rachats?|rach[eè]te|acquisition|acquiert|rejoint|business|Shopify|lev[ée]e de fonds)\b/i, ['ecosystem', 'ecosysteme']],
  [AI, /\b(IA|AI)\b/, ['ia', 'ai']], // sensible à la casse : évite « ai » (verbe avoir)
];

const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let changed = 0;
for (const it of items) {
  const text = `${it.title} ${it.summary}`;
  const target = RULES.reduce((cat, [c, re, tags]) => (re.test(text) || it.tags.some((t) => tags.includes(t)) ? c : cat), it.category);
  if (target === it.category) continue;
  console.log(`${it.category} → ${target} : ${it.title}`);
  it.category = target;
  changed++;
}

if (process.argv.includes('--dry-run')) return console.log(`\n${changed} fiche(s) à reclasser (dry-run, aucune écriture).`);
if (changed) {
  fs.copyFileSync(FILE, FILE.replace(/\.json$/, `.backup-${Date.now()}.json`));
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}
console.log(`\n${changed} fiche(s) reclassée(s).`);
