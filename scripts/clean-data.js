/**
 * Nettoyage ponctuel de data.json (serveur arrêté) :
 *  - fiches #auto : filtre qualité/hors-sujet, dédoublonnage, traduction FR, recatégorisation, tags harmonisés ;
 *  - fiches éditoriales : tags harmonisés uniquement (catégories choisies à la main conservées).
 * Sauvegarde préalable dans data.backup-<timestamp>.json. Aucune écriture si une traduction échoue.
 * Usage : node scripts/clean-data.js [--dry-run]
 * Déjà exécuté le 2026-09-29 : conçu pour des fiches sources en anglais, ne pas relancer sur des fiches déjà traduites.
 */
const fs = require('node:fs');
const path = require('node:path');
const veille = require('../veille');

const FILE = path.resolve(process.env.DATA_PATH || path.join(__dirname, '..', 'data', 'data.json'));
const dryRun = process.argv.includes('--dry-run');

(async () => {
  const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const manual = items.filter((it) => !it.tags.includes('auto')).map((it) => ({ ...it, tags: veille.harmonizeTags(it.tags) }));
  const kept = [];
  const log = (label, it) => console.log(`${label.padEnd(9)} ${it.title}`);

  for (const it of items.filter((i) => i.tags.includes('auto')).sort(veille.bySourceLang)) {
    if (!veille.isRelevant(it)) {
      log('✗ rejet', it);
      continue;
    }
    if (dryRun) {
      log('✓ garde', it);
      continue;
    }
    const fiche = await veille.toFiche(it); // erreur → arrêt sans écriture
    if (veille.isDuplicate(fiche.title, [...manual, ...kept])) {
      log('✗ doublon', it);
      continue;
    }
    kept.push(fiche);
    console.log(`✓ [${fiche.category}] ${fiche.title}  #${fiche.tags.join(' #')}`);
  }

  if (dryRun) return console.log('\n(dry-run : aucune écriture)');
  fs.copyFileSync(FILE, FILE.replace(/\.json$/, `.backup-${Date.now()}.json`));
  fs.writeFileSync(FILE, JSON.stringify([...kept, ...manual], null, 2));
  console.log(`\n${items.length} → ${kept.length + manual.length} fiches (${kept.length} auto conservées).`);
})().catch((err) => {
  console.error('Nettoyage interrompu, data.json inchangé :', err.message);
  process.exit(1);
});
