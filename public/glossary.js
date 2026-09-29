/**
 * Mini-dictionnaire de concepts techniques : dans les résumés, la 1re occurrence de chaque concept
 * est enveloppée dans <abbr title="…"> (infobulle native au survol).
 */
const CONCEPTS = [
  [['View Transitions', 'View Transition'], 'API qui anime le passage entre deux états du DOM ou deux pages, sans librairie.'],
  [['CSS Nesting', 'imbrication CSS'], 'Imbrication native des règles CSS (comme Sass), sans préprocesseur.'],
  [['Hydration', 'hydratation'], "Étape où le JavaScript « réactive » côté navigateur un HTML rendu par le serveur."],
  [['container queries', 'container query'], "Styles qui s'adaptent à la taille du conteneur plutôt qu'à celle de l'écran."],
  [['media queries', 'media query'], "Règles CSS conditionnées par les caractéristiques de l'écran (largeur, préférences…)."],
  [['Cascade Layers', '@layer'], 'Couches CSS qui ordonnent explicitement la priorité des styles, indépendamment de la spécificité.'],
  [['anchor positioning'], 'Positionne un élément (tooltip, menu) relativement à un autre, en pur CSS.'],
  [['subgrid'], 'Permet à une grille enfant de réutiliser les pistes de sa grille parente.'],
  [[':has()'], 'Sélecteur « parent » : cible un élément selon ce qu’il contient.'],
  [['Popover', 'popovers'], 'Attribut/API HTML pour des éléments flottants (menus, bulles) gérés nativement par le navigateur.'],
  [['Shadow DOM'], "Arbre DOM encapsulé d'un composant, isolé des styles et scripts de la page."],
  [['Web Components'], 'Composants réutilisables natifs (Custom Elements, Shadow DOM, templates).'],
  [['service worker', 'service workers'], "Script d'arrière-plan qui intercepte le réseau : cache, hors-ligne, notifications."],
  [['Core Web Vitals'], 'Métriques Google de qualité perçue : LCP (chargement), INP (réactivité), CLS (stabilité).'],
  [['LCP'], "Largest Contentful Paint : temps d'affichage du plus grand élément visible."],
  [['INP'], "Interaction to Next Paint : délai entre une interaction et la mise à jour visuelle."],
  [['CLS'], 'Cumulative Layout Shift : ampleur des décalages de mise en page inattendus.'],
  [['SSR'], 'Server-Side Rendering : HTML généré côté serveur à chaque requête.'],
  [['SSG'], 'Static Site Generation : HTML généré à la compilation.'],
  [['tree-shaking'], 'Suppression du code non utilisé lors du build.'],
  [['lazy loading'], "Chargement différé d'une ressource jusqu'à ce qu'elle soit nécessaire."],
  [['top-level await'], "Utiliser await directement au niveau d'un module ES, hors fonction async."],
  [['WebGPU'], 'API web moderne pour le calcul et le rendu graphique sur GPU.'],
  [['WebAssembly', 'Wasm'], 'Format binaire exécuté à vitesse quasi native dans le navigateur.'],
  [['Baseline'], 'Label indiquant qu’une fonctionnalité web est disponible dans tous les navigateurs majeurs.'],
  [['origin trial'], 'Essai d’une fonctionnalité expérimentale de Chrome, activée par jeton sur un domaine.'],
  [['Interop'], 'Initiative commune des navigateurs pour aligner le support des fonctionnalités web.'],
  [['PWA'], 'Progressive Web App : site installable, fonctionnant hors-ligne.'],
  [['hooks'], 'Fonctions React (useState, useEffect…) pour gérer état et effets dans les composants.'],
  [['props'], 'Paramètres transmis à un composant par son parent.'],
  [['App Router'], 'Système de routage de Next.js basé sur le dossier app/ et les React Server Components.'],
  [['LLM', 'LLMs'], 'Large Language Model : modèle de langage entraîné sur de grands corpus de texte.'],
  [['RAG'], 'Retrieval-Augmented Generation : le modèle s’appuie sur des documents récupérés pour répondre.'],
  [['MCP'], 'Model Context Protocol : protocole ouvert reliant les agents IA à des outils et données.'],
  [['fine-tuning'], 'Réentraînement ciblé d’un modèle existant sur des données spécifiques.'],
  [['tokens'], 'Unités de texte traitées par un modèle de langage (base de la facturation et des limites).'],
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const lookup = new Map(CONCEPTS.flatMap(([forms, def]) => forms.map((f) => [f.toLowerCase(), def])));
const forms = [...lookup.keys()].sort((a, b) => b.length - a.length);
const RE = new RegExp(`(?<![\\p{L}\\d-])(${forms.map(escRe).join('|')})(?![\\p{L}\\d-])`, 'giu');

/**
 * Annote un texte DÉJÀ échappé : les termes du dictionnaire (sans &, < ni >) ne peuvent pas
 * correspondre à l'intérieur d'une entité HTML.
 */
export function annotate(escapedHtml) {
  const seen = new Set();
  return escapedHtml.replace(RE, (match) => {
    const def = lookup.get(match.toLowerCase());
    if (seen.has(def)) return match;
    seen.add(def);
    return `<abbr title="${escAttr(def)}" class="relative z-10 cursor-help underline decoration-neutral-500 decoration-dotted underline-offset-2">${match}</abbr>`;
  });
}
