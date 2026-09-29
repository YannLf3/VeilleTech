/**
 * Vue Kanban / Radar Tech : 3 colonnes indexées par statut + glisser-déposer HTML5 natif.
 * Les cartes ne sont `draggable` que pour l'admin ; le déplacement est délégué à `onMove`.
 */
export const COLUMNS = [
  ['emergent', 'À surveiller'],
  ['experimental', 'À tester'],
  ['recommended', 'Prêt pour Prod'],
];

/**
 * @param {HTMLElement} root
 * @param {Array<{ id: string, status: string }>} items
 * @param {(item: object, column: number) => string} cardHtml HTML d'une carte (déjà échappé)
 */
export function renderKanban(root, items, cardHtml) {
  root.innerHTML = COLUMNS.map(([status, label], i) => {
    const cards = items.filter((it) => it.status === status);
    return `<section data-column="${status}" aria-label="${label}"
        class="flex w-[85%] shrink-0 snap-start flex-col rounded-xl border border-neutral-800 bg-neutral-950/60 p-3 transition sm:w-auto">
      <h2 class="mb-3 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        ${label} <span class="font-mono text-neutral-600">${cards.length}</span>
      </h2>
      <div class="flex min-h-24 flex-1 flex-col gap-2">
        ${cards.map((it) => cardHtml(it, i)).join('') || '<p class="px-1 py-6 text-center text-xs text-neutral-600">Aucune fiche</p>'}
      </div>
    </section>`;
  }).join('');
}

/** Branche le glisser-déposer une seule fois (délégation d'événements sur `root`). */
export function bindKanbanDnD(root, onMove) {
  const highlight = (col, on) => col?.classList.toggle('!border-sky-500/60', on);
  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('[data-kanban-id]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.kanbanId);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('opacity-40');
  });
  root.addEventListener('dragend', (e) => {
    e.target.closest?.('[data-kanban-id]')?.classList.remove('opacity-40');
    root.querySelectorAll('[data-column]').forEach((c) => highlight(c, false));
  });
  root.addEventListener('dragover', (e) => {
    const col = e.target.closest('[data-column]');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    highlight(col, true);
  });
  root.addEventListener('dragleave', (e) => {
    const col = e.target.closest('[data-column]');
    if (col && !col.contains(e.relatedTarget)) highlight(col, false);
  });
  root.addEventListener('drop', (e) => {
    const col = e.target.closest('[data-column]');
    if (!col) return;
    e.preventDefault();
    highlight(col, false);
    const id = e.dataTransfer.getData('text/plain');
    if (id) onMove(id, col.dataset.column);
  });
}
