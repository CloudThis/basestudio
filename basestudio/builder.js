// =====================================================================
//  BaseStudio - constructeur de requêtes visuel (onglet « 🎛 Requête visuelle »)
//  On coche des tables et des colonnes, on ajoute des filtres et un tri :
//  BaseStudio écrit le SELECT tout seul. Les jointures sont trouvées
//  grâce aux clés étrangères. Une colonne peut être comptée / additionnée
//  (COUNT, SUM…) : le GROUP BY est alors ajouté automatiquement.
// =====================================================================
(function () {
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.db, 'sql', ['builder', '🎛 Requête visuelle']);

  const AGG = [['', '—'], ['COUNT', 'nombre (COUNT)'], ['COUNT DISTINCT', 'nombre de différents'], ['SUM', 'somme'], ['AVG', 'moyenne'], ['MIN', 'minimum'], ['MAX', 'maximum']];
  const OPS = [['=', '='], ['<>', '≠'], ['>', '>'], ['>=', '≥'], ['<', '<'], ['<=', '≤'], ['contains', 'contient'], ['starts', 'commence par'], ['in', 'est dans la liste (a, b, c)'],
    ['null', 'est vide (NULL)'], ['notnull', 'n\'est pas vide']];
  const saved = {};   // la requête en cours, par base (on la retrouve en revenant)

  // une valeur tapée -> littéral SQL
  const lit = v => /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  const likeLit = (v, pre, post) => "'" + pre + v.replace(/\\/g, '\\\\\\\\').replace(/'/g, "''").replace(/[%_]/g, c => '\\' + c) + post + "'";

  // jointures : on relie les tables choisies avec les clés étrangères (de proche en proche)
  function joins(tables, fks) {
    if (!tables.length) return { from: '', missing: [] };
    const done = [tables[0]], parts = [], missing = [];
    let rest = tables.slice(1), progress = true;
    while (rest.length && progress) {
      progress = false;
      for (const t of rest) {
        const links = fks.filter(f => (f.t === t && done.includes(f.rt)) || (f.rt === t && done.includes(f.t)));
        if (!links.length) continue;
        const on = links.map(f => q(f.t) + '.' + q(f.c) + ' = ' + q(f.rt) + '.' + q(f.rc)).join(' AND ');
        parts.push({ t, on });
        done.push(t); rest = rest.filter(x => x !== t); progress = true;
        break;
      }
    }
    rest.forEach(t => { parts.push({ t, on: null }); missing.push(t); });
    return { first: tables[0], parts, missing };
  }

  function build(s, fks) {
    const j = joins(s.tables, fks);
    if (!s.tables.length) return { sql: '', missing: [] };
    const multi = s.tables.length > 1;
    const ref = (t, c) => multi ? q(t) + '.' + q(c) : q(c);
    const chosen = s.cols.filter(c => s.tables.includes(c.t));
    const hasAgg = chosen.some(c => c.agg);
    const sel = chosen.map(c => {
      const r = ref(c.t, c.c);
      if (!c.agg) return r + (multi && chosen.filter(x => x.c === c.c).length > 1 ? ' AS ' + q(c.t + '_' + c.c) : '');
      const e = c.agg === 'COUNT DISTINCT' ? 'COUNT(DISTINCT ' + r + ')' : c.agg + '(' + r + ')';
      return e + ' AS ' + q((c.agg === 'COUNT DISTINCT' ? 'nb_differents' : c.agg.toLowerCase()) + '_' + c.c);
    });
    let sql = 'SELECT ' + (s.distinct ? 'DISTINCT ' : '') + (sel.length ? sel.join(',\n       ') : '*') + '\nFROM ' + q(j.first);
    j.parts.forEach(p => sql += p.on ? '\n' + s.joinType + ' JOIN ' + q(p.t) + ' ON ' + p.on : '\nCROSS JOIN ' + q(p.t));
    const conds = s.where.filter(w => s.tables.includes(w.t) && (w.op === 'null' || w.op === 'notnull' || w.v !== '')).map(w => {
      const r = ref(w.t, w.c);
      switch (w.op) {
        case 'null': return r + ' IS NULL';
        case 'notnull': return r + ' IS NOT NULL';
        case 'contains': return r + ' LIKE ' + likeLit(w.v, '%', '%');
        case 'starts': return r + ' LIKE ' + likeLit(w.v, '', '%');
        case 'in': return r + ' IN (' + w.v.split(',').map(x => x.trim()).filter(Boolean).map(lit).join(', ') + ')';
        default: return r + ' ' + w.op + ' ' + lit(w.v);
      }
    });
    if (conds.length) sql += '\nWHERE ' + conds.join('\n  ' + s.logic + ' ');
    if (hasAgg) {
      const g = chosen.filter(c => !c.agg).map(c => ref(c.t, c.c));
      if (g.length) sql += '\nGROUP BY ' + g.join(', ');
    }
    const ord = s.order.filter(o => s.tables.includes(o.t));
    if (ord.length) sql += '\nORDER BY ' + ord.map(o => ref(o.t, o.c) + ' ' + o.dir).join(', ');
    if (s.limit) sql += '\nLIMIT ' + Math.max(1, Number(s.limit) || 100);
    return { sql: sql + ';', missing: j.missing };
  }

  VIEWS['db:builder'] = async view => {
    const db = state.db;
    const [colRows, fkRows] = (await run(
      'SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.COLUMN_KEY FROM information_schema.COLUMNS c JOIN information_schema.TABLES t USING (TABLE_SCHEMA, TABLE_NAME) WHERE c.TABLE_SCHEMA = ? ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;' +
      'SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL', [db, db])).results.map(r => r.rows);
    if (state.db !== db || state.tab !== 'builder') return;
    const byT = {};
    colRows.forEach(([t, c, type, key]) => (byT[t] = byT[t] || []).push({ c, type, key }));
    const fks = fkRows.map(([t, c, rt, rc]) => ({ t, c, rt, rc }));
    const tables = Object.keys(byT);
    if (!tables.length) { view.innerHTML = '<div class="empty">Cette base n\'a pas encore de table.</div>'; return; }
    const s = saved[db] || (saved[db] = { tables: [], cols: [], where: [], order: [], limit: 100, distinct: false, joinType: 'INNER', logic: 'AND' });
    s.tables = s.tables.filter(t => byT[t]);
    const linked = t => fks.some(f => (f.t === t && s.tables.includes(f.rt)) || (f.rt === t && s.tables.includes(f.t)));

    view.innerHTML = '<div class="qb"><div class="card qb-tables"><div class="card-head"><h3>1. Tables</h3></div><div id="qb-tlist"></div></div>' +
      '<div class="qb-main"><div class="card"><div class="card-head"><h3>2. Colonnes à afficher</h3><span class="muted small">rien de coché = toutes (*)</span></div><div id="qb-cols" class="qb-cols"></div></div>' +
      '<div class="card"><div class="card-head"><h3>3. Filtres</h3><div class="actions"><select id="qb-logic"><option value="AND">toutes les conditions (ET)</option><option value="OR">au moins une (OU)</option></select>' +
      '<button class="btn small" id="qb-addw">＋ Filtre</button></div></div><div id="qb-where"></div></div>' +
      '<div class="card"><div class="card-head"><h3>4. Tri et options</h3><button class="btn small" id="qb-addo">＋ Tri</button></div><div id="qb-order"></div>' +
      '<div class="field-row" style="flex-wrap:wrap;align-items:center;margin-top:8px">' +
      '<label class="check small"><input type="checkbox" id="qb-distinct"> sans doublons (DISTINCT)</label>' +
      '<label class="check small">Jointure <select id="qb-join"><option value="INNER">lignes liées seulement (INNER)</option><option value="LEFT">garder les lignes sans lien (LEFT)</option></select></label>' +
      '<label class="check small">Maximum <input type="number" id="qb-limit" min="0" style="width:90px"> lignes (vide = toutes)</label></div></div>' +
      '<div class="card"><div class="card-head"><h3>SQL</h3><div class="actions"><button class="btn small" id="qb-reset">Tout effacer</button>' +
      '<button class="btn small" id="qb-edit">⌨️ Ouvrir dans l\'éditeur SQL</button><button class="btn primary" id="qb-run">▶ Exécuter</button></div></div>' +
      '<div id="qb-warn"></div><div class="sql-preview" id="qb-sql"></div></div><div id="qb-out"></div></div></div>';

    const colOptions = (t, c) => s.tables.map(tb => '<optgroup label="' + h(tb) + '">' + byT[tb].map(x => '<option value="' + h(tb + '\u0001' + x.c) + '"' + (tb === t && x.c === c ? ' selected' : '') + '>' + h(x.c) + '</option>').join('') + '</optgroup>').join('');
    const pick = v => { const [t, c] = v.split('\u0001'); return { t, c }; };

    function drawTables() {
      $('#qb-tlist', view).innerHTML = tables.map(t => '<label class="check qb-t' + (s.tables.length && !s.tables.includes(t) && linked(t) ? ' linked' : '') + '"><input type="checkbox" data-t="' + h(t) + '"' + (s.tables.includes(t) ? ' checked' : '') + '> ' + h(t) +
        (s.tables.length && !s.tables.includes(t) && linked(t) ? ' <span class="muted small" title="Reliée par une clé étrangère">🔗</span>' : '') + '</label>').join('');
    }
    function drawCols() {
      $('#qb-cols', view).innerHTML = s.tables.length ? s.tables.map(t => '<div class="qb-box"><div class="qb-box-head">▦ ' + h(t) +
        ' <button class="link-btn small" data-allc="' + h(t) + '">tout</button></div>' + byT[t].map(x => {
          const c = s.cols.find(k => k.t === t && k.c === x.c);
          return '<div class="qb-col"><label class="check"><input type="checkbox" data-c="' + h(t + '\u0001' + x.c) + '"' + (c ? ' checked' : '') + '> ' + (x.key === 'PRI' ? '🔑 ' : '') + h(x.c) +
            ' <span class="muted small">' + h(x.type) + '</span></label>' +
            (c ? '<select data-agg="' + h(t + '\u0001' + x.c) + '" title="Calcul">' + AGG.map(a => '<option value="' + a[0] + '"' + (a[0] === c.agg ? ' selected' : '') + '>' + a[1] + '</option>').join('') + '</select>' : '') + '</div>';
        }).join('') + '</div>').join('') : '<p class="muted">Coche une table à gauche pour commencer.</p>';
    }
    function drawWhere() {
      $('#qb-where', view).innerHTML = s.where.length ? s.where.map((w, i) => '<div class="trg-col-row"><select data-wc="' + i + '">' + colOptions(w.t, w.c) + '</select>' +
        '<select data-wo="' + i + '">' + OPS.map(o => '<option value="' + o[0] + '"' + (o[0] === w.op ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
        (w.op === 'null' || w.op === 'notnull' ? '' : '<input data-wv="' + i + '" value="' + h(w.v) + '" placeholder="valeur" style="flex:1;min-width:120px">') +
        '<button class="icon-btn" data-wd="' + i + '" title="Retirer">✕</button></div>').join('') : '<p class="muted small">Aucun filtre : toutes les lignes.</p>';
    }
    function drawOrder() {
      $('#qb-order', view).innerHTML = s.order.map((o, i) => '<div class="trg-col-row"><select data-oc="' + i + '">' + colOptions(o.t, o.c) + '</select>' +
        '<select data-od="' + i + '"><option value="ASC"' + (o.dir === 'ASC' ? ' selected' : '') + '>croissant (A → Z, 1 → 9)</option><option value="DESC"' + (o.dir === 'DESC' ? ' selected' : '') + '>décroissant (Z → A, 9 → 1)</option></select>' +
        '<button class="icon-btn" data-odel="' + i + '" title="Retirer">✕</button></div>').join('');
    }
    let current = '';
    function drawSql() {
      const b = build(s, fks);
      current = b.sql;
      $('#qb-sql', view).innerHTML = b.sql ? highlight(b.sql) : '<span class="muted">Le SELECT apparaîtra ici.</span>';
      $('#qb-warn', view).innerHTML = b.missing.length ? '<div class="alert info">⚠ Aucune clé étrangère ne relie <b>' + b.missing.map(h).join(', ') + '</b> aux autres tables : elles sont combinées avec CROSS JOIN (toutes les combinaisons de lignes). Crée la clé étrangère (onglet Structure ou Schéma) ou ajoute un filtre qui les relie.</div>' : '';
      $('#qb-run', view).disabled = $('#qb-edit', view).disabled = !b.sql;
    }
    const all = () => { drawTables(); drawCols(); drawWhere(); drawOrder(); drawSql(); };

    $('#qb-distinct', view).checked = s.distinct;
    $('#qb-join', view).value = s.joinType;
    $('#qb-logic', view).value = s.logic;
    $('#qb-limit', view).value = s.limit || '';
    all();

    // ---------- événements (sur .qb : #view sert aussi aux autres onglets) ----------
    const root = $('.qb', view);
    root.onchange = e => {
      const el = e.target, d = el.dataset;
      if (d.t !== undefined) {
        s.tables = el.checked ? [...s.tables, d.t] : s.tables.filter(t => t !== d.t);
        if (!el.checked) { s.cols = s.cols.filter(c => c.t !== d.t); s.where = s.where.filter(w => w.t !== d.t); s.order = s.order.filter(o => o.t !== d.t); }
        return all();
      }
      if (d.c !== undefined) { const p = pick(d.c); if (el.checked) s.cols.push(Object.assign(p, { agg: '' })); else s.cols = s.cols.filter(c => !(c.t === p.t && c.c === p.c)); drawCols(); return drawSql(); }
      if (d.agg !== undefined) { const p = pick(d.agg); s.cols.find(c => c.t === p.t && c.c === p.c).agg = el.value; return drawSql(); }
      if (d.wc !== undefined) { Object.assign(s.where[d.wc], pick(el.value)); return drawSql(); }
      if (d.wo !== undefined) { s.where[d.wo].op = el.value; drawWhere(); return drawSql(); }
      if (d.oc !== undefined) { Object.assign(s.order[d.oc], pick(el.value)); return drawSql(); }
      if (d.od !== undefined) { s.order[d.od].dir = el.value; return drawSql(); }
      if (el.id === 'qb-distinct') s.distinct = el.checked;
      if (el.id === 'qb-join') s.joinType = el.value;
      if (el.id === 'qb-logic') s.logic = el.value;
      if (el.id === 'qb-limit') s.limit = el.value === '' ? 0 : Number(el.value);
      drawSql();
    };
    root.oninput = e => {
      if (e.target.dataset.wv !== undefined) { s.where[e.target.dataset.wv].v = e.target.value; drawSql(); }
      if (e.target.id === 'qb-limit') { s.limit = e.target.value === '' ? 0 : Number(e.target.value); drawSql(); }
    };
    root.onclick = e => {
      const el = e.target.closest('button'); if (!el) return;
      const d = el.dataset;
      const first = () => ({ t: s.tables[0], c: byT[s.tables[0]][0].c });
      if (d.allc !== undefined) {
        const t = d.allc, has = byT[t].every(x => s.cols.some(c => c.t === t && c.c === x.c));
        s.cols = s.cols.filter(c => c.t !== t);
        if (!has) byT[t].forEach(x => s.cols.push({ t, c: x.c, agg: '' }));
        drawCols(); drawSql();
      } else if (el.id === 'qb-addw') {
        if (!s.tables.length) return toast('Choisis d\'abord une table', 'error');
        s.where.push(Object.assign(first(), { op: '=', v: '' })); drawWhere(); drawSql();
        const inp = $$('[data-wv]', view).pop(); if (inp) inp.focus();
      } else if (d.wd !== undefined) { s.where.splice(d.wd, 1); drawWhere(); drawSql(); }
      else if (el.id === 'qb-addo') {
        if (!s.tables.length) return toast('Choisis d\'abord une table', 'error');
        // par défaut : la première colonne affichée (sinon la première de la table)
        const c0 = s.cols.find(c => s.tables.includes(c.t) && !c.agg);
        s.order.push(Object.assign(c0 ? { t: c0.t, c: c0.c } : first(), { dir: 'ASC' })); drawOrder(); drawSql();
      } else if (d.odel !== undefined) { s.order.splice(d.odel, 1); drawOrder(); drawSql(); }
      else if (el.id === 'qb-reset') { delete saved[db]; render(); }
      else if (el.id === 'qb-edit') { if (window.SqlTabs) SqlTabs.open(db, null, 'Requête visuelle', current); else { state.sqlText['db:' + db] = current; go(db, null, 'sql'); } }
      else if (el.id === 'qb-run') exec();
    };

    async function exec() {
      if (!current) return;
      const out = $('#qb-out', view);
      out.innerHTML = '<div class="empty">⏳ Exécution…</div>';
      try {
        const data = await run(current, [], db);
        const r = data.results[0];
        out.innerHTML = '<div class="card result-block"><div class="result-head"><strong>Résultat</strong><span class="muted small">' + fmtNum(r.rows.length) + ' ligne(s) · ' + data.time + ' ms ' +
          '<button class="btn small" id="qb-csv">⬇ CSV</button></span></div>' + gridHtml(r) + '</div>';
        $('#qb-csv', out).onclick = () => saveText('requete.csv', toCsv(r), 'csv');
        if (window.Charts) Charts.decorate(out, data.results);
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { out.innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>'; }
    }
  };

  PALETTE_HOOKS.push((items, match) => {
    if (state.db && match('Requête visuelle ' + state.db, 'constructeur builder requete visuelle')) {
      const db = state.db;
      items.push({ group: 'Actions', ico: '🎛', label: 'Requête visuelle sur « ' + db + ' »', sub: 'constructeur de requêtes', run: () => go(db, null, 'builder') });
    }
  });
})();
