// =====================================================================
//  BaseStudio - clés étrangères (FOREIGN KEY)
//  - Structure d'une table : la liste de ses clés étrangères, en ajouter
//    (fenêtre avec le SQL en direct), en supprimer
//  - Insérer / Parcourir : une colonne qui est une clé étrangère devient
//    une liste déroulante (« 3 – Dupont ») au lieu d'un numéro à taper
//  - schema.js utilise fkModal() pour créer un lien en reliant 2 boîtes
//  Ce fichier est chargé après app.js et utilise ses outils (rows, run...).
// =====================================================================
(function () {
  const RULES = {
    RESTRICT: ['interdit si des lignes sont liées (par défaut)', 'interdit si des lignes sont liées (par défaut)'],
    CASCADE: ['supprime aussi les lignes liées', 'met aussi à jour les lignes liées'],
    'SET NULL': ['met la colonne à NULL dans les lignes liées', 'met la colonne à NULL dans les lignes liées'],
    'NO ACTION': ['comme RESTRICT', 'comme RESTRICT']
  };
  const MAX_OPTIONS = 2000;

  // ---------- Lecture ----------
  // Les clés étrangères de la table (out) et celles qui pointent vers elle (inc)
  async function fks(db, table) {
    const r = await rows(
      'SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, rc.UPDATE_RULE, rc.DELETE_RULE ' +
      'FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ' +
      'ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME ' +
      'WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL AND (k.TABLE_NAME = ? OR k.REFERENCED_TABLE_NAME = ?) ' +
      'ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION', [db, table, table]);
    const map = {};
    r.forEach(([name, t, c, rt, rcol, upd, del]) => {
      const id = t + '.' + name;
      if (!map[id]) map[id] = { name, table: t, cols: [], refTable: rt, refCols: [], onUpdate: upd, onDelete: del };
      map[id].cols.push(c); map[id].refCols.push(rcol);
    });
    const all = Object.values(map);
    return { out: all.filter(f => f.table === table), inc: all.filter(f => f.refTable === table && f.table !== table) };
  }

  // { colonne: { table, col } } pour les clés étrangères sur une seule colonne
  async function fkColumns(db, table) {
    const { out } = await fks(db, table);
    const m = {};
    out.filter(f => f.cols.length === 1).forEach(f => { m[f.cols[0]] = { table: f.refTable, col: f.refCols[0] }; });
    return m;
  }

  // Les valeurs possibles d'une clé étrangère, avec un libellé lisible
  // ex : [[3, 'Dupont Marie'], ...] ; more = true s'il y en a trop pour une liste
  async function options(db, refTable, refCol) {
    const cols = await tableColumns(db, refTable);
    const labels = cols.filter(c => c.name !== refCol && /char|text|enum/i.test(c.type)).slice(0, 2).map(c => c.name);
    const sql = 'SELECT ??' + (labels.length ? ', CONCAT_WS(\' \', ' + labels.map(() => '??').join(', ') + ')' : '') +
      ' FROM ?? ORDER BY ' + (labels.length ? '2' : '1') + ' LIMIT ' + (MAX_OPTIONS + 1);
    const r = await rows(sql, [refCol, ...labels, refTable], db);
    return { list: r.slice(0, MAX_OPTIONS).map(x => [x[0], x[1] == null ? '' : x[1]]), more: r.length > MAX_OPTIONS };
  }
  const optLabel = o => o[0] + (o[1] !== '' ? ' – ' + o[1] : '');

  // ---------- Fenêtre « Nouvelle clé étrangère » ----------
  async function fkModal({ db, table, refTable, onDone }) {
    if (!state.tables[db]) await loadTables(db);
    const tables = (state.tables[db] || []).filter(t => t.type !== 'VIEW').map(t => t.name);
    if (!tables.length) return toast('Il faut au moins une table', 'error');
    const engines = Object.fromEntries(await rows('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [db]));
    const taken = new Set((await rows('SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?', [db])).map(r => r[0]));
    const cache = {};
    const colsOf = async t => cache[t] || (cache[t] = await tableColumns(db, t));

    const ruleSel = (id, i) => '<select id="' + id + '">' + Object.keys(RULES).map(k => '<option value="' + k + '">' + k + ' · ' + RULES[k][i] + '</option>').join('') + '</select>';
    modal(
      '<h3>🔗 Nouvelle clé étrangère</h3>' +
      '<p class="muted small">La table de gauche reçoit une colonne qui pointe vers la clé de la table de droite. Exemple : <code>commande.id_client → client.id</code> (une commande appartient à un client).</p>' +
      '<div class="field-row"><label class="field grow"><span>Table qui reçoit la clé</span><select id="fk-child">' + tables.map(t => '<option>' + h(t) + '</option>').join('') + '</select></label>' +
      '<span class="fk-arrow">→</span>' +
      '<label class="field grow"><span>Table référencée</span><select id="fk-ref">' + tables.map(t => '<option>' + h(t) + '</option>').join('') + '</select></label></div>' +
      '<div class="field-row"><label class="field grow"><span>Colonne</span><select id="fk-col"></select></label>' +
      '<span class="fk-arrow">→</span>' +
      '<label class="field grow"><span>Colonne référencée</span><select id="fk-refcol"></select></label></div>' +
      '<div id="fk-newbox" class="fk-newbox" hidden><label class="field"><span>Nom de la nouvelle colonne <em class="muted">(même type que la colonne référencée)</em></span><input id="fk-newname" spellcheck="false"></label>' +
      '<label class="check"><input type="checkbox" id="fk-nn"> Obligatoire (NOT NULL) <em class="muted small">— laisse décoché si la table contient déjà des lignes</em></label></div>' +
      '<div class="field-row"><label class="field grow"><span>Si on supprime la ligne référencée (ON DELETE)</span>' + ruleSel('fk-del', 0) + '</label>' +
      '<label class="field grow"><span>Si on change sa clé (ON UPDATE)</span>' + ruleSel('fk-upd', 1) + '</label></div>' +
      '<label class="field"><span>Nom de la contrainte</span><input id="fk-name" spellcheck="false"></label>' +
      '<div id="fk-warn"></div><div class="sql-preview" id="fk-sql"></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button><button class="btn" data-editor>Ouvrir dans l\'éditeur SQL</button>' +
      '<button class="btn primary" data-ok>Créer la clé étrangère</button></div>',
      async (back, close) => {
        const $b = s => $(s, back);
        const box = back.querySelector('.modal'); box.classList.add('wide');
        $b('#fk-child').value = table && tables.includes(table) ? table : tables[0];
        $b('#fk-ref').value = refTable && tables.includes(refTable) ? refTable : tables.find(t => t !== $b('#fk-child').value) || tables[0];
        let nameTouched = false, newTouched = false;

        const autoName = () => {
          let n = 'fk_' + $b('#fk-child').value + '_' + $b('#fk-ref').value, k = 2;
          while (taken.has(n)) n = 'fk_' + $b('#fk-child').value + '_' + $b('#fk-ref').value + '_' + k++;
          return n;
        };
        // on remplit les colonnes, en devinant la bonne (id_client, client_id…)
        const fillCols = async (guess) => {
          const child = $b('#fk-child').value, ref = $b('#fk-ref').value;
          const [cc, rc] = await Promise.all([colsOf(child), colsOf(ref)]);
          const rpk = (rc.find(c => c.key === 'PRI') || rc[0] || {}).name;
          $b('#fk-refcol').innerHTML = rc.map(c => '<option value="' + h(c.name) + '"' + (c.name === rpk ? ' selected' : '') + '>' + h(c.name) +
            ' (' + h(c.type) + (c.key === 'PRI' ? ', clé primaire' : c.key === 'UNI' ? ', unique' : '') + ')</option>').join('');
          const lower = ref.toLowerCase(), cands = ['id_' + lower, lower + '_id', 'id' + lower, lower + 'id', 'num_' + lower, 'code_' + lower];
          const found = cc.find(c => cands.includes(c.name.toLowerCase()) && !(c.key === 'PRI' && cc.filter(x => x.key === 'PRI').length === 1));
          $b('#fk-col').innerHTML = cc.map(c => '<option value="' + h(c.name) + '">' + h(c.name) + ' (' + h(c.type) + ')</option>').join('') +
            '<option value="__new__">＋ Nouvelle colonne…</option>';
          if (guess) $b('#fk-col').value = found ? found.name : '__new__';
          if (!newTouched) $b('#fk-newname').value = 'id_' + ref;
          if (!nameTouched) $b('#fk-name').value = autoName();
          upd();
        };

        const sql = () => {
          const child = $b('#fk-child').value, ref = $b('#fk-ref').value, refcol = $b('#fk-refcol').value;
          const isNew = $b('#fk-col').value === '__new__';
          const col = isNew ? ($b('#fk-newname').value.trim() || 'id_' + ref) : $b('#fk-col').value;
          const rcType = ((cache[ref] || []).find(c => c.name === refcol) || { type: 'INT' }).type;
          const parts = [];
          if (isNew) parts.push('ADD COLUMN ' + q(col) + ' ' + rcType.toUpperCase() + ($b('#fk-nn').checked ? ' NOT NULL' : ' NULL'));
          parts.push('ADD CONSTRAINT ' + q($b('#fk-name').value.trim() || autoName()) + '\n    FOREIGN KEY (' + q(col) + ') REFERENCES ' + q(ref) + ' (' + q(refcol) + ')' +
            '\n    ON DELETE ' + $b('#fk-del').value + ' ON UPDATE ' + $b('#fk-upd').value);
          return 'ALTER TABLE ' + q(child) + '\n  ' + parts.join(',\n  ') + ';';
        };
        function upd() {
          const child = $b('#fk-child').value, ref = $b('#fk-ref').value;
          const isNew = $b('#fk-col').value === '__new__';
          $b('#fk-newbox').hidden = !isNew;
          $b('#fk-sql').innerHTML = highlight(sql());
          // avertissements avant que MySQL ne refuse
          const w = [], cc = cache[child] || [], rc = cache[ref] || [];
          const col = cc.find(c => c.name === $b('#fk-col').value), rcol = rc.find(c => c.name === $b('#fk-refcol').value);
          const base = t => String(t || '').toLowerCase().replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1').trim();
          if (col && rcol && base(col.type) !== base(rcol.type))
            w.push('Les types sont différents (<code>' + h(col.type) + '</code> et <code>' + h(rcol.type) + '</code>) : ils doivent être identiques, sinon MySQL refusera.');
          if (rcol && rcol.key !== 'PRI' && rcol.key !== 'UNI')
            w.push('La colonne référencée devrait être une clé primaire ou unique.');
          [child, ref].forEach(t => { if (engines[t] && engines[t] !== 'InnoDB') w.push('La table « ' + h(t) + ' » utilise ' + h(engines[t]) + ' : les clés étrangères ne marchent qu\'avec InnoDB.'); });
          const nn = isNew ? $b('#fk-nn').checked : col && !col.nullable;
          if (nn && ($b('#fk-del').value === 'SET NULL' || $b('#fk-upd').value === 'SET NULL'))
            w.push('<code>SET NULL</code> est impossible : la colonne est obligatoire (NOT NULL).');
          if (isNew && cc.some(c => c.name.toLowerCase() === $b('#fk-newname').value.trim().toLowerCase()))
            w.push('Une colonne porte déjà ce nom dans « ' + h(child) + ' ».');
          $b('#fk-warn').innerHTML = w.map(x => '<div class="alert danger">⚠ ' + x + '</div>').join('');
        }

        $b('#fk-child').onchange = () => fillCols(true);
        $b('#fk-ref').onchange = () => fillCols(true);
        $b('#fk-name').oninput = () => { nameTouched = true; upd(); };
        $b('#fk-newname').oninput = () => { newTouched = true; upd(); };
        ['#fk-col', '#fk-refcol', '#fk-del', '#fk-upd', '#fk-nn'].forEach(s => $b(s).addEventListener('change', upd));
        $b('[data-x]').onclick = close;
        $b('[data-editor]').onclick = () => { const s = sql(); close(); state.sqlText['db:' + db] = s; go(db, null, 'sql'); };
        $b('[data-ok]').onclick = async () => {
          try {
            await run(sql(), [], db);
            close(); toast('Clé étrangère créée', 'success');
            if (onDone) onDone();
          } catch (e) { $b('#fk-warn').innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>'; }
        };
        await fillCols(true);
      });
  }

  // ---------- Structure : la carte « Clés étrangères » ----------
  const origStructure = VIEWS['table:structure'];
  VIEWS['table:structure'] = async view => {
    const db = state.db, table = state.table;
    await origStructure(view);
    if (state.db !== db || state.table !== table || state.tab !== 'structure' || tableType() === 'VIEW') return;
    const { out, inc } = await fks(db, table);
    if (state.db !== db || state.table !== table || state.tab !== 'structure') return;

    const link = (t, cols) => '<span class="chip-btn" data-go-t="' + h(t) + '">' + h(t) + '</span>.<span class="mono">' + cols.map(h).join(', ') + '</span>';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h3>🔗 Clés étrangères</h3><button class="btn small primary" data-fk-add>＋ Ajouter une clé étrangère</button></div>' +
      (out.length ? '<div class="grid-wrap"><table class="grid"><thead><tr><th>Nom</th><th>Colonne</th><th>Pointe vers</th><th>ON DELETE</th><th>ON UPDATE</th><th></th></tr></thead><tbody>' +
        out.map((f, i) => '<tr><td><strong>' + h(f.name) + '</strong></td><td class="mono">' + f.cols.map(h).join(', ') + '</td>' +
          '<td>' + link(f.refTable, f.refCols) + '</td><td class="muted">' + h(f.onDelete) + '</td><td class="muted">' + h(f.onUpdate) + '</td>' +
          '<td class="row-actions"><button class="btn small danger" data-fk-drop="' + i + '">Supprimer</button></td></tr>').join('') +
        '</tbody></table></div>'
        : '<p class="muted">Cette table n\'a pas de clé étrangère. Une clé étrangère relie une colonne à la clé d\'une autre table (ex : <code>commande.id_client → client.id</code>).</p>') +
      (inc.length ? '<p class="muted small" style="margin-top:10px">Tables qui pointent vers « ' + h(table) + ' » : ' +
        inc.map(f => link(f.table, f.cols)).join(' · ') + '</p>' : '');
    view.appendChild(card);

    $('[data-fk-add]', card).onclick = () => fkModal({ db, table, onDone: () => render() });
    $$('[data-fk-drop]', card).forEach(b => b.onclick = () => {
      const f = out[b.dataset.fkDrop];
      confirmAndRun({ title: 'Supprimer la clé étrangère « ' + f.name + ' » ?', text: 'Le lien avec « ' + h(f.refTable) + ' » disparaît. La colonne et ses valeurs sont gardées.',
        okText: 'Supprimer', danger: true, done: 'Clé étrangère supprimée' },
        'ALTER TABLE ' + q(table) + ' DROP FOREIGN KEY ' + q(f.name) + ';', db, () => render());
    });
    $$('[data-go-t]', card).forEach(b => b.onclick = () => go(db, b.dataset.goT, 'structure'));
  };

  // ---------- Insérer : listes déroulantes pour les clés étrangères ----------
  const origInsert = VIEWS['table:insert'];
  VIEWS['table:insert'] = async view => {
    const db = state.db, table = state.table;
    await origInsert(view);
    if (state.db !== db || state.table !== table || state.tab !== 'insert' || tableType() === 'VIEW') return;
    const [fkc, cols] = await Promise.all([fkColumns(db, table), tableColumns(db, table)]);
    for (let i = 0; i < cols.length; i++) {
      const ref = fkc[cols[i].name];
      const el = $('[data-i="' + i + '"]', view);
      if (!ref || !el) continue;
      let o;
      try { o = await options(db, ref.table, ref.col); } catch (e) { continue; }
      if (state.table !== table || state.tab !== 'insert') return;
      // petit rappel sous le nom de la colonne : vers quelle table elle pointe
      const nameBox = el.closest('.insert-row') && el.closest('.insert-row').querySelector('.col-name');
      if (nameBox) nameBox.insertAdjacentHTML('beforeend', '<span class="fk-hint">🔗 ' + h(ref.table) + '.' + h(ref.col) + '</span>');
      if (o.more) continue;   // trop de valeurs : on garde la case à taper
      const sel = document.createElement('select');
      sel.dataset.i = i;
      sel.innerHTML = '<option value="">— ' + (cols[i].def !== null ? 'défaut : ' + h(cols[i].def) : 'choisir') + ' —</option>' +
        o.list.map(x => '<option value="' + h(x[0]) + '">' + h(optLabel(x)) + '</option>').join('');
      el.replaceWith(sel);
    }
    $('.card', view).dispatchEvent(new Event('input'));   // remet à jour l'aperçu SQL
  };

  window.Relations = { fks, fkColumns, options, optLabel, fkModal };
})();
