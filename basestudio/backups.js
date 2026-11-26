// =====================================================================
//  BaseStudio - sauvegardes (menu « 💾 Sauvegardes » et onglet d'une base)
//  - sauvegarder une base en un clic (fichier .sql.gz)
//  - sauvegardes automatiques : à chaque lancement, chaque jour ou chaque
//    semaine, tant que BaseStudio est ouvert ; on garde les N dernières
//  - restaurer, télécharger ou supprimer une sauvegarde
//  Les fichiers sont rangés hors du dossier web (Documents\BaseStudio\Sauvegardes).
// =====================================================================
(function () {
  const FREQ = [['', 'Jamais'], ['launch', 'À chaque lancement'], ['day', 'Chaque jour'], ['week', 'Chaque semaine']];
  const DELAY = { day: 24 * 3600e3, week: 7 * 24 * 3600e3 };

  TABS.server.push(['backups', 'Sauvegardes']);
  SERVER_TITLES.backups = ['💾', 'Sauvegardes'];
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.db, 'import', ['backups', '💾 Sauvegardes']);

  const fmtSize = n => n < 1024 ? n + ' o' : n < 1048576 ? (n / 1024).toFixed(1).replace('.', ',') + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  const fmtDate = d => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const ago = d => {
    const m = Math.round((Date.now() - new Date(d)) / 60000);
    return m < 1 ? 'à l\'instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : 'il y a ' + Math.round(m / 1440) + ' j';
  };

  async function list() {
    const res = await window.api.backupList();
    if (!res.ok) throw new Error(res.error);
    const d = res.data;
    d.config = d.config && d.config.dbs ? d.config : { dbs: {} };
    if (Array.isArray(d.config.dbs)) d.config.dbs = {};   // PHP renvoie [] pour un objet vide
    return d;
  }

  async function backupNow(db, auto, keep) {
    const res = await window.api.backupRun(db, auto, keep);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  // ---------- restauration ----------
  async function restore(b, after) {
    if (!(await confirmBox({
      title: 'Restaurer « ' + b.db + ' » ?', danger: true, okText: '↩ Restaurer',
      text: 'Les tables de <b>' + h(b.db) + '</b> seront remplacées par celles de la sauvegarde du <b>' + h(fmtDate(b.date)) + '</b>.<br>' +
        'Par sécurité, BaseStudio sauvegarde d\'abord l\'état actuel de la base.'
    }))) return;
    try {
      if (state.dbs.includes(b.db)) { toast('Sauvegarde de sécurité de « ' + b.db + ' »…'); await backupNow(b.db, false); }
      const res = await window.api.backupGet(b.file);
      if (!res.ok) throw new Error(res.error);
      toast('Restauration en cours…');
      const r = await SqlImport.importText(null, b.file, res.data, null);
      if (!r.ok) throw new Error(r.error);
      toast('« ' + b.db + ' » est restaurée (' + fmtNum(r.data.count) + ' requêtes)', 'success');
      state.tables = {};
      await loadTree();
    } catch (e) { toast(e.message, 'error'); }
    if (after) after();
  }

  // ---------- écran ----------
  async function screen(view, only) {
    const d = await list();
    const dbs = only ? [only] : state.dbs.filter(x => !SYSTEM_DBS.includes(x));
    const items = d.list.filter(b => !only || b.db === only);
    const lastOf = db => d.list.find(b => b.db === db);
    const cfg = d.config.dbs;

    view.innerHTML =
      '<div class="card"><div class="card-head"><h3>💾 ' + (only ? 'Sauvegardes de « ' + h(only) + ' »' : 'Sauvegardes des bases') + '</h3>' +
      '<div class="actions"><button class="btn small" id="bk-open">📂 Ouvrir le dossier</button></div></div>' +
      '<p class="muted small">Dossier : <code>' + h(d.dir) + '</code> (hors du dossier web : personne ne peut les télécharger depuis le navigateur). ' +
      'Les sauvegardes automatiques se font tant que BaseStudio est ouvert : si le PC était éteint, elle est faite au lancement suivant.</p>' +
      '<div class="grid-wrap"><table class="grid bk-table"><thead><tr><th>Base</th><th>Sauvegarde automatique</th><th>En garder</th><th>Dernière sauvegarde</th><th></th></tr></thead><tbody>' +
      (dbs.length ? dbs.map(db => {
        const c = cfg[db] || {}, l = lastOf(db);
        return '<tr data-db="' + h(db) + '"><td><strong>' + h(db) + '</strong></td>' +
          '<td><select data-freq>' + FREQ.map(f => '<option value="' + f[0] + '"' + ((c.freq || '') === f[0] ? ' selected' : '') + '>' + f[1] + '</option>').join('') + '</select></td>' +
          '<td><input type="number" min="1" max="100" value="' + (c.keep || 7) + '" data-keep style="width:70px"' + (c.freq ? '' : ' disabled') + '> <span class="muted small">dernières</span></td>' +
          '<td>' + (l ? h(ago(l.date)) + ' <span class="muted small">(' + h(fmtSize(l.size)) + ')</span>' : '<span class="muted">jamais</span>') + '</td>' +
          '<td style="text-align:right"><button class="btn small primary" data-now>💾 Sauvegarder maintenant</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted" style="text-align:center">Aucune base à sauvegarder</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-head"><h3>Sauvegardes enregistrées (' + items.length + ')</h3></div>' +
      (items.length ? '<div class="trg-list">' + items.map((b, i) =>
        '<div class="trg-item"><div class="trg-main"><div class="trg-name">' + (only ? '' : h(b.db) + ' · ') + h(fmtDate(b.date)) +
        ' <span class="badge' + (b.auto ? ' grey' : '') + '">' + (b.auto ? 'automatique' : 'manuelle') + '</span></div>' +
        '<span class="muted small">' + h(fmtSize(b.size)) + ' compressé · ' + h(ago(b.date)) + '</span></div>' +
        '<div class="trg-actions"><button class="btn small" data-restore="' + i + '">↩ Restaurer</button>' +
        '<button class="btn small" data-dl="' + i + '">⬇ Télécharger .sql</button>' +
        '<button class="btn small danger" data-rm="' + i + '">🗑</button></div></div>').join('') + '</div>'
        : '<p class="muted">Aucune sauvegarde pour l\'instant. Clique sur « 💾 Sauvegarder maintenant ».</p>') + '</div>';

    const again = () => screen(view, only).catch(e => toast(e.message, 'error'));
    $('#bk-open', view).onclick = () => window.api.backupOpen();

    // réglages : enregistrés tout de suite
    const save = async () => {
      const dbsCfg = Object.assign({}, cfg);
      $$('tr[data-db]', view).forEach(tr => {
        const freq = $('[data-freq]', tr).value, keep = Number($('[data-keep]', tr).value) || 7;
        $('[data-keep]', tr).disabled = !freq;
        if (freq) dbsCfg[tr.dataset.db] = { freq, keep }; else delete dbsCfg[tr.dataset.db];
      });
      const res = await window.api.backupConfig({ dbs: dbsCfg });
      if (!res.ok) return toast(res.error, 'error');
      Object.keys(cfg).forEach(k => delete cfg[k]); Object.assign(cfg, Array.isArray(res.data.dbs) ? {} : res.data.dbs);
      toast('Réglage enregistré', 'success');
      autoRun();
    };
    $$('[data-freq], [data-keep]', view).forEach(el => el.onchange = save);

    $$('[data-now]', view).forEach(btn => btn.onclick = async () => {
      const db = btn.closest('tr').dataset.db;
      btn.disabled = true; btn.textContent = '⏳ Sauvegarde…';
      try { const r = await backupNow(db, false); toast('Sauvegarde de « ' + db + ' » faite (' + fmtSize(r.size) + ')', 'success'); }
      catch (e) { toast(e.message, 'error'); }
      again();
    });
    $$('[data-restore]', view).forEach(b => b.onclick = () => restore(items[b.dataset.restore], again));
    $$('[data-dl]', view).forEach(b => b.onclick = async () => {
      const x = items[b.dataset.dl];
      const res = await window.api.backupGet(x.file);
      if (!res.ok) return toast(res.error, 'error');
      const name = x.file.replace(/\.gz$/, '');
      window.api.download(name, res.data, 'application/sql;charset=utf-8');
      toast('Fichier enregistré : Téléchargements\\' + name, 'success');
    });
    $$('[data-rm]', view).forEach(b => b.onclick = async () => {
      const x = items[b.dataset.rm];
      if (!(await confirmBox({ title: 'Supprimer cette sauvegarde ?', text: h(x.db) + ' du ' + h(fmtDate(x.date)) + '. Le fichier sera supprimé définitivement.', okText: 'Supprimer', danger: true }))) return;
      const res = await window.api.backupDelete(x.file);
      if (!res.ok) toast(res.error, 'error'); else toast('Sauvegarde supprimée', 'success');
      again();
    });
  }

  VIEWS['server:backups'] = view => screen(view, null);
  VIEWS['db:backups'] = view => screen(view, state.db);

  // ---------- sauvegardes automatiques ----------
  let running = false;
  // « à chaque lancement » : une fois par ouverture de la fenêtre BaseStudio (sessionStorage survit à F5)
  const launched = () => { try { return JSON.parse(sessionStorage.getItem('bs.bkLaunch')) || []; } catch (e) { return []; } };
  const doneThisLaunch = {
    has: db => launched().includes(db),
    add: db => sessionStorage.setItem('bs.bkLaunch', JSON.stringify([...launched(), db]))
  };
  async function autoRun() {
    if (running || !state.server || !window.api.backupList) return;
    running = true;
    try {
      const d = await list();
      for (const [db, c] of Object.entries(d.config.dbs)) {
        if (!state.dbs.includes(db)) continue;
        const last = d.list.find(b => b.db === db);
        const due = c.freq === 'launch' ? !doneThisLaunch.has(db) : !last || Date.now() - new Date(last.date) >= DELAY[c.freq];
        if (!due) continue;
        try {
          await backupNow(db, true, c.keep);
          doneThisLaunch.add(db);
          toast('💾 Sauvegarde automatique de « ' + db + ' » faite', 'success');
        } catch (e) { toast('Sauvegarde automatique de « ' + db + ' » impossible : ' + e.message, 'error'); }
      }
    } catch (e) { /* dossier inaccessible : on réessaiera */ }
    running = false;
  }
  // juste après la connexion, puis toutes les 10 minutes
  let wasConnected = false;
  setInterval(() => {
    const on = !!(state.server && state.dbs.length);
    if (on && !wasConnected) setTimeout(autoRun, 4000);
    wasConnected = on;
  }, 1000);
  setInterval(autoRun, 10 * 60e3);

  PALETTE_HOOKS.push((items, match) => {
    if (match('Sauvegardes sauvegarder backup restaurer')) items.push({ group: 'Actions', ico: '💾', label: 'Sauvegardes', sub: 'sauvegarder / restaurer', run: () => go(null, null, 'backups') });
  });

  window.Backups = { autoRun, backupNow };
})();
