// =====================================================================
//  BaseStudio - annuler la dernière modification
//  Après une modification ou une suppression de ligne (Parcourir ou
//  formulaire), une barre « ↩ Annuler » reste affichée 20 secondes.
//  Un clic (ou Ctrl+Z hors d'un champ) remet l'ancienne valeur / la ligne.
// =====================================================================
(function () {
  const DELAY = 20000;
  let pending = null, timer = null;

  const bar = document.createElement('div');
  bar.className = 'undo-bar'; bar.hidden = true;
  bar.innerHTML = '<span id="undo-label"></span><button class="btn small primary" id="undo-do">↩ Annuler</button><button class="icon-btn" id="undo-x" title="Fermer">✕</button><i class="undo-time"></i>';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));

  function hide() { bar.hidden = true; pending = null; clearTimeout(timer); }

  // propose d'annuler : action = { label, sql, params, db, table }
  function offer(action) {
    pending = action;
    $('#undo-label', bar).textContent = action.label;
    const t = $('.undo-time', bar);
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    bar.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(hide, DELAY);
  }

  async function undo() {
    if (!pending) return;
    const a = pending; hide();
    try {
      const d = await run(a.sql, a.params, a.db);
      const n = d.results.reduce((x, r) => x + (r.affectedRows || 0), 0);
      if (!n) return toast('Rien à annuler : la ligne a changé entre-temps', 'error');
      toast('Annulé ✔', 'success');
      if (state.db === a.db && state.table === a.table) render();
    } catch (e) { toast('Impossible d\'annuler : ' + e.message, 'error'); }
  }

  bar.addEventListener('click', e => {
    if (e.target.closest('#undo-do')) undo();
    else if (e.target.closest('#undo-x')) hide();
  });
  document.addEventListener('keydown', e => {
    if (!pending || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]') || $('.modal')) return;
    e.preventDefault(); undo();
  });

  // condition WHERE qui retrouve la ligne : la clé primaire, sinon toutes les colonnes
  function where(pk, columns, row) {
    const use = pk && pk.length ? pk : columns;
    return { sql: use.map(c => q(c) + ' <=> ?').join(' AND ') + (pk && pk.length ? '' : ' LIMIT 1'), vals: use.map(c => row[columns.indexOf(c)]) };
  }
  const short = v => v === null ? 'NULL' : String(v).length > 30 ? String(v).slice(0, 29) + '…' : String(v);

  // après un UPDATE : changes = { colonne: nouvelleValeur }
  function afterUpdate(db, table, pk, columns, oldRow, changes) {
    const names = Object.keys(changes);
    const newRow = columns.map((c, i) => c in changes ? changes[c] : oldRow[i]);
    const w = where(pk, columns, newRow);
    offer({
      label: names.length === 1 ? '« ' + names[0] + ' » modifié (avant : ' + short(oldRow[columns.indexOf(names[0])]) + ')' : names.length + ' colonnes modifiées',
      sql: 'UPDATE ' + q(table) + ' SET ' + names.map(c => q(c) + ' = ?').join(', ') + ' WHERE ' + w.sql,
      params: [...names.map(c => oldRow[columns.indexOf(c)]), ...w.vals], db, table
    });
  }

  // après un DELETE : on remet la ligne telle qu'elle était (sauf colonnes calculées)
  function afterDelete(db, table, cols, columns, oldRow) {
    const info = name => (cols || []).find(c => c.name === name) || {};
    const keep = columns.map((c, i) => [c, oldRow[i]]).filter(([c]) => !/GENERATED/i.test(info(c).extra || ''));
    offer({
      label: 'Ligne supprimée de « ' + table + ' »',
      sql: 'INSERT INTO ' + q(table) + ' (' + keep.map(x => q(x[0])).join(', ') + ') VALUES (' + keep.map(() => '?').join(', ') + ')',
      params: keep.map(x => x[1]), db, table
    });
  }

  // après un INSERT (ligne dupliquée) : on la supprime avec son id auto
  function afterInsert(db, table, idCol, id) {
    if (!idCol || !id) return;
    offer({ label: 'Ligne ajoutée (id ' + id + ')', sql: 'DELETE FROM ' + q(table) + ' WHERE ' + q(idCol) + ' = ? LIMIT 1', params: [id], db, table });
  }

  window.Undo = { offer, afterUpdate, afterDelete, afterInsert, undo, hide };
})();
