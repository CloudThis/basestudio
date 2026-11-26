// =====================================================================
//  BaseStudio - glisser-déposer un fichier sur la fenêtre
//  - un .sql : import dans la base ouverte (ou sur le serveur)
//  - un .csv / .tsv / .txt : import dans la table ouverte ; si aucune
//    table n'est ouverte, BaseStudio demande laquelle
// =====================================================================
(function () {
  const kind = name => /\.sql$/i.test(name) ? 'sql' : /\.(csv|tsv|txt)$/i.test(name) ? 'csv' : null;
  const size = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  // ---------- le voile « Lâche ton fichier » ----------
  const veil = document.createElement('div');
  veil.className = 'drop-veil'; veil.hidden = true;
  veil.innerHTML = '<div class="drop-box"><span class="big-ico">📥</span><strong>Lâche ton fichier ici</strong><span class="muted" id="drop-hint"></span></div>';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(veil));
  let depth = 0;
  const hint = () => !state.server ? 'Connecte-toi d\'abord'
    : '.sql → importé ' + (state.db ? 'dans « ' + state.db + ' »' : 'sur le serveur') + ' · .csv → ' + (state.table ? 'dans la table « ' + state.table + ' »' : 'dans la table de ton choix');

  document.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) { $('#drop-hint', veil).textContent = hint(); veil.hidden = false; }
  });
  document.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; veil.hidden = true; } });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; veil.hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) handle(f);
  });

  async function handle(f) {
    if (!state.server) return toast('Connecte-toi d\'abord, puis lâche le fichier à nouveau', 'error');
    const k = kind(f.name);
    if (!k) return toast('« ' + f.name + ' » : seuls les fichiers .sql et .csv peuvent être importés', 'error');
    const view = $('#view');

    if (k === 'sql') {
      const where = state.db ? 'dans la base <b>' + h(state.db) + '</b>' : '<b>sur le serveur</b> (aucune base ouverte : le fichier doit contenir ses <code>CREATE DATABASE</code> / <code>USE</code>)';
      if (!(await confirmBox({ title: 'Importer « ' + f.name + ' » ?', text: h(size(f.size)) + ' · toutes les requêtes du fichier seront exécutées ' + where + '.', okText: '📥 Importer' }))) return;
      if (state.tab === 'import' && !state.table && view.importFile) return view.importFile(f);
      state.pendingSql = f;
      go(state.db, null, 'import');
      return;
    }

    // CSV
    if (state.table && tableType() !== 'VIEW') {
      if (state.tab === 'csv' && view.csvFile) return view.csvFile(f);
      state.pendingCsv = f;
      go(state.db, state.table, 'csv');
      return;
    }
    if (!state.db) return toast('Ouvre d\'abord la base (ou la table) qui doit recevoir « ' + f.name + ' »', 'error');
    if (!state.tables[state.db]) await loadTables(state.db);
    const tables = (state.tables[state.db] || []).filter(t => t.type !== 'VIEW').map(t => t.name);
    if (!tables.length) return toast('La base « ' + state.db + ' » n\'a pas de table : crée-la d\'abord', 'error');
    // on propose la table dont le nom ressemble à celui du fichier
    const base = f.name.replace(/\.[^.]+$/, '').toLowerCase();
    const guess = tables.find(t => t.toLowerCase() === base) || tables.find(t => base.includes(t.toLowerCase()) || t.toLowerCase().includes(base)) || tables[0];
    modal('<h3>📊 Importer « ' + h(f.name) + ' »</h3><p class="muted">' + h(size(f.size)) + ' · dans quelle table de « ' + h(state.db) + ' » ?</p>' +
      '<label class="field"><span>Table</span><select id="dp-table">' + tables.map(t => '<option' + (t === guess ? ' selected' : '') + '>' + h(t) + '</option>').join('') + '</select></label>' +
      '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button><button class="btn primary" data-ok>Continuer</button></div>', (back, close) => {
      $('[data-x]', back).onclick = close;
      $('[data-ok]', back).onclick = () => { const t = $('#dp-table', back).value; close(); state.pendingCsv = f; go(state.db, t, 'csv'); };
    });
  }
})();
