// =====================================================================
//  BaseStudio - onglet « Vues » d'une base (CREATE VIEW)
//  - la liste des vues : parcourir, voir le code, modifier, supprimer
//  - un formulaire : nom + la requête SELECT (avec auto-complétion),
//    un assistant qui écrit le SELECT avec les jointures (clés étrangères),
//    « Tester » affiche les premières lignes avant de créer la vue
//  Ce fichier est chargé après app.js (rows, run, createEditor...).
// =====================================================================
(function () {
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.db, 'routines', ['views', '👁 Vues']);

  // enlève le nom de la base devant les tables : `ma_base`.`client` -> `client`
  const tidy = (sql, db) => String(sql || '').split('`' + db.replace(/`/g, '``') + '`.').join('');
  // remet un peu de retours à la ligne dans une définition stockée sur une ligne
  const pretty = sql => sql.replace(/\s+(from|where|left join|right join|inner join|join|group by|order by|having|limit|union)\s+/gi, (m, k) => '\n' + k.toUpperCase() + ' ');

  VIEWS['db:views'] = async view => {
    const db = state.db;
    if (!state.tables[db]) await loadTables(db);
    const tables = (state.tables[db] || []).filter(t => t.type !== 'VIEW').map(t => t.name);
    const list = await rows('SELECT TABLE_NAME, VIEW_DEFINITION, CHECK_OPTION, IS_UPDATABLE FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [db]);
    if (state.db !== db || state.tab !== 'views') return;

    view.innerHTML =
      '<div class="card"><div class="card-head"><h3>Vues de la base <span class="badge grey">' + list.length + '</span></h3></div>' +
      (list.length ? '<div class="trg-list">' + list.map((v, i) =>
        '<div class="trg-item"><div class="trg-main"><div class="trg-name">👁 ' + h(v[0]) +
        (v[3] === 'YES' ? ' <span class="badge grey" title="On peut faire INSERT / UPDATE à travers cette vue">modifiable</span>' : '') + '</div>' +
        '<code class="trg-code">' + h(tidy(v[1], db).replace(/\s+/g, ' ').slice(0, 200)) + '</code></div>' +
        '<div class="trg-actions"><button class="btn small primary" data-browse="' + i + '">👀 Parcourir</button>' +
        '<button class="btn small" data-see="' + i + '">Voir le code</button><button class="btn small" data-edit="' + i + '">Modifier</button>' +
        '<button class="btn small danger" data-del="' + i + '">Supprimer</button></div></div>').join('') + '</div>'
        : '<p class="muted">Aucune vue pour l\'instant. Crée la première avec le formulaire ci-dessous 👇</p>') + '</div>' +

      '<div class="card" id="vw-form"><div class="card-head"><h3 id="vw-title">Nouvelle vue</h3><button class="btn ghost small" id="vw-cancel" hidden>Annuler la modification</button></div>' +
      '<details class="trg-help"><summary>💡 C\'est quoi une vue ?</summary><p>Une <b>vue</b> est une requête <code>SELECT</code> enregistrée sous un nom. ' +
      'Elle s\'utilise comme une table (<code>SELECT * FROM ma_vue</code>) mais ne stocke rien : les données sont relues à chaque fois. ' +
      'Pratique pour cacher une jointure compliquée ou ne montrer que certaines colonnes.</p></details>' +
      '<div class="form-grid trg-grid"><label class="field"><span>Nom de la vue</span><input id="vw-name" placeholder="v_commandes_clients" spellcheck="false"></label>' +
      '<label class="check" style="align-self:center"><input type="checkbox" id="vw-check"> <span>WITH CHECK OPTION <em class="muted">(refuse les modifications qui sortiraient de la vue)</em></span></label></div>' +
      '<div class="field"><span>Assistant : écrire le SELECT à partir d\'une table</span><div class="field-row" style="flex-wrap:wrap">' +
      '<select id="vw-table" style="max-width:240px">' + tables.map(t => '<option>' + h(t) + '</option>').join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="vw-join" checked> avec les tables liées (jointures)</label>' +
      '<button class="btn small" id="vw-gen">✨ Écrire le SELECT</button></div><div class="trg-cols" id="vw-cols" style="margin-top:8px"></div></div>' +
      '<div class="field"><span>Requête SELECT de la vue</span><div id="vw-editor"></div></div>' +
      '<div id="vw-warn"></div>' +
      '<div class="field"><span>SQL qui sera exécuté</span><div class="sql-preview" id="vw-sql"></div></div>' +
      '<div class="editor-bar"><div class="left"><button class="btn" id="vw-test">▶ Tester (20 premières lignes)</button></div><div class="right">' +
      '<button class="btn" id="vw-to-sql">Ouvrir dans l\'éditeur SQL</button><button class="btn primary" id="vw-ok">👁 Créer la vue</button></div></div>' +
      '<div id="vw-out"></div></div>';

    let editing = null;
    const sql = () => {
      const sel = editor.get().trim().replace(/;\s*$/, '') || 'SELECT …';
      return (editing ? 'CREATE OR REPLACE VIEW ' : 'CREATE VIEW ') + q($('#vw-name', view).value.trim() || 'ma_vue') + ' AS\n' + sel +
        ($('#vw-check', view).checked ? '\nWITH CHECK OPTION' : '');
    };
    const upd = () => {
      $('#vw-sql', view).innerHTML = highlight(sql() + ';');
      const body = editor.get().trim(), w = [];
      if (body && !/^\s*(\(\s*)*(SELECT|WITH)\b/i.test(body)) w.push('La requête d\'une vue doit commencer par <code>SELECT</code>.');
      if (/;\s*\S/.test(body.replace(/;\s*$/, ''))) w.push('Une seule requête : pas de <code>;</code> au milieu.');
      $('#vw-warn', view).innerHTML = w.map(x => '<div class="alert danger">⚠ ' + x + '</div>').join('');
    };
    let ready = false;
    const editor = createEditor($('#vw-editor', view), '', () => $('#vw-ok', view).click(), () => { if (ready) upd(); });
    ready = true;

    // colonnes de la table choisie (à insérer d'un clic)
    const drawCols = async () => {
      const t = $('#vw-table', view).value; if (!t) return;
      const cols = await tableColumns(db, t);
      $('#vw-cols', view).innerHTML = '<div class="trg-col-row"><span class="badge grey">' + h(t) + '</span>' +
        cols.map(c => '<button class="chip-btn" data-ins="' + h(q(t) + '.' + q(c.name)) + '" title="' + h(c.type) + '">' + h(c.name) + '</button>').join('') + '</div>';
      $$('[data-ins]', view).forEach(b => b.onclick = () => editor.insert(b.dataset.ins));
    };
    // l'assistant : SELECT de la table + LEFT JOIN vers les tables référencées par ses clés étrangères
    $('#vw-gen', view).onclick = async () => {
      const t = $('#vw-table', view).value; if (!t) return;
      const cols = await tableColumns(db, t);
      const a = 't0';
      const sel = cols.map(c => a + '.' + q(c.name)), joins = [];
      if ($('#vw-join', view).checked && window.Relations) {
        const { out } = await Relations.fks(db, t);
        for (let i = 0; i < out.length; i++) {
          const f = out[i], b = 't' + (i + 1);
          const rc = await tableColumns(db, f.refTable);
          joins.push('LEFT JOIN ' + q(f.refTable) + ' ' + b + ' ON ' + f.cols.map((c, k) => b + '.' + q(f.refCols[k]) + ' = ' + a + '.' + q(c)).join(' AND '));
          rc.filter(c => !f.refCols.includes(c.name) && c.key !== 'PRI').slice(0, 3)
            .forEach(c => sel.push(b + '.' + q(c.name) + ' AS ' + q(f.refTable + '_' + c.name)));
        }
      }
      editor.set('SELECT\n    ' + sel.join(',\n    ') + '\nFROM ' + q(t) + ' ' + a + (joins.length ? '\n' + joins.join('\n') : ''));
      if (!$('#vw-name', view).value.trim()) $('#vw-name', view).value = 'v_' + t;
      upd();
    };
    $('#vw-table', view).onchange = drawCols;
    $('#vw-name', view).oninput = upd;
    $('#vw-check', view).onchange = upd;
    $('#vw-cancel', view).onclick = () => render();

    $('#vw-test', view).onclick = async () => {
      const out = $('#vw-out', view);
      const body = editor.get().trim().replace(/;\s*$/, '');
      if (!body) return;
      out.innerHTML = '<div class="muted">⏳ Test…</div>';
      try {
        const data = await run('SELECT * FROM (\n' + body + '\n) AS apercu LIMIT 20', [], db);
        out.innerHTML = '<div class="result-block"><p class="muted small">Aperçu : ' + data.results[0].rows.length + ' ligne(s) · ' + data.time + ' ms</p>' + gridHtml(data.results[0]) + '</div>';
      } catch (e) { out.innerHTML = '<div class="alert danger result-block"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>'; }
    };
    $('#vw-ok', view).onclick = async () => {
      const name = $('#vw-name', view).value.trim();
      if (!name) return toast('Donne un nom à la vue', 'error');
      if (!editor.get().trim()) return toast('Écris la requête SELECT de la vue', 'error');
      try {
        // renommée pendant la modification : on supprime l'ancienne après avoir créé la nouvelle
        await run(sql(), [], db);
        if (editing && editing !== name) await run('DROP VIEW ' + q(editing), [], db);
        toast('Vue « ' + name + ' » ' + (editing ? 'modifiée' : 'créée'), 'success');
        await loadTables(db); render();
      } catch (e) { $('#vw-warn', view).innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>'; }
    };
    $('#vw-to-sql', view).onclick = () => { state.sqlText[sqlKey()] = sql() + ';'; state.tab = 'sql'; render(); };

    // ---------- actions sur la liste ----------
    const code = i => pretty(tidy(list[i][1], db));
    $$('[data-browse]', view).forEach(b => b.onclick = () => go(db, list[b.dataset.browse][0], 'browse'));
    $$('[data-see]', view).forEach(b => b.onclick = () => {
      const v = list[b.dataset.see], c = 'CREATE VIEW ' + q(v[0]) + ' AS\n' + code(b.dataset.see) + (v[2] !== 'NONE' ? '\nWITH ' + v[2] + ' CHECK OPTION' : '');
      modal('<h3>👁 ' + h(v[0]) + '</h3><div class="sql-preview">' + highlight(c) + '</div>' +
        '<div class="modal-actions"><button class="btn" data-copy>Copier</button><button class="btn primary" data-x>Fermer</button></div>',
        (back, close) => {
          $('[data-x]', back).onclick = close;
          $('[data-copy]', back).onclick = () => { navigator.clipboard.writeText(c + ';'); toast('Copié !', 'success'); };
        });
    });
    $$('[data-edit]', view).forEach(b => b.onclick = () => {
      const v = list[b.dataset.edit];
      editing = v[0];
      $('#vw-name', view).value = v[0];
      $('#vw-check', view).checked = v[2] !== 'NONE';
      editor.set(code(b.dataset.edit));
      $('#vw-title', view).textContent = 'Modifier « ' + v[0] + ' »';
      $('#vw-ok', view).textContent = '💾 Enregistrer les modifications';
      $('#vw-cancel', view).hidden = false;
      upd();
      $('#vw-form', view).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $$('[data-del]', view).forEach(b => b.onclick = () => {
      const v = list[b.dataset.del];
      confirmAndRun({ title: 'Supprimer la vue « ' + v[0] + ' » ?', text: 'Seule la vue disparaît : les tables et leurs données ne sont pas touchées.', okText: 'Supprimer', danger: true, done: 'Vue supprimée' },
        'DROP VIEW ' + q(v[0]) + ';', db, async () => { await loadTables(db); render(); });
    });

    drawCols(); upd();
  };
})();
