// =====================================================================
//  BaseStudio - comparer deux bases (onglet « ⚖ Comparer »)
//  On choisit une autre base du serveur : BaseStudio montre les tables
//  qui manquent d'un côté ou de l'autre, les colonnes et index différents,
//  et peut écrire le script SQL qui rend la 2e base identique à la 1re
//  (structure seulement : les données ne sont pas touchées).
// =====================================================================
(function () {
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.db, 'search', ['compare', '⚖ Comparer']);
  const last = {};   // base choisie la dernière fois, par base

  // ---------- lecture de la structure d'une base ----------
  async function structure(db) {
    const [cols, idx, tbls] = (await run(
      'SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION;' +
      'SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX), MAX(INDEX_TYPE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE;' +
      'SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [db, db, db])).results.map(r => r.rows);
    const t = {};
    tbls.forEach(([name, type, engine, n]) => t[name] = { name, view: type === 'VIEW', engine, rows: n, cols: [], idx: {} });
    cols.forEach(([tb, name, pos, type, nul, def, extra, comment, coll]) => t[tb] && t[tb].cols.push({ name, pos: Number(pos), type, nul: nul === 'YES', def, extra: extra.replace(/DEFAULT_GENERATED\s*/i, '').trim(), comment, coll }));
    idx.forEach(([tb, name, nonUnique, list, kind]) => t[tb] && (t[tb].idx[name] = { name, unique: nonUnique === '0' || nonUnique === 0, cols: list, kind }));
    return t;
  }

  // ---------- texte SQL d'une colonne (pour ADD / MODIFY) ----------
  const maria = () => /mariadb/i.test((state.server && state.server.version) || '');
  function colDef(c) {
    let s = q(c.name) + ' ' + c.type + (c.nul ? ' NULL' : ' NOT NULL');
    if (c.def !== null && c.def !== undefined && !/GENERATED/i.test(c.extra)) {
      // MariaDB écrit déjà le défaut en SQL ('texte', NULL, current_timestamp()) ; MySQL 8 donne la valeur brute
      if (maria()) s += ' DEFAULT ' + c.def;
      else s += ' DEFAULT ' + (/^(-?\d+(\.\d+)?|CURRENT_TIMESTAMP(\(\d*\))?|NULL)$/i.test(c.def) ? c.def : "'" + String(c.def).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'");
    }
    if (c.extra && !/GENERATED/i.test(c.extra)) s += ' ' + c.extra.toUpperCase();
    if (c.comment) s += " COMMENT '" + c.comment.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
    return s;
  }
  const sameCol = (a, b) => a.type === b.type && a.nul === b.nul && String(a.def) === String(b.def) && a.extra.toLowerCase() === b.extra.toLowerCase() && a.comment === b.comment;
  const colDiff = (a, b) => [a.type !== b.type && 'type ' + a.type + ' → ' + b.type, a.nul !== b.nul && (a.nul ? 'NULL' : 'NOT NULL') + ' → ' + (b.nul ? 'NULL' : 'NOT NULL'),
    String(a.def) !== String(b.def) && 'défaut ' + (a.def ?? 'aucun') + ' → ' + (b.def ?? 'aucun'), a.extra.toLowerCase() !== b.extra.toLowerCase() && 'extra « ' + (a.extra || '—') + ' » → « ' + (b.extra || '—') + ' »',
    a.comment !== b.comment && 'commentaire'].filter(Boolean).join(', ');
  const sameIdx = (a, b) => a.unique === b.unique && a.cols === b.cols && a.kind === b.kind;
  const idxDesc = i => (i.name === 'PRIMARY' ? 'clé primaire' : i.unique ? 'unique' : i.kind === 'FULLTEXT' ? 'texte intégral' : 'index') + ' (' + i.cols.split(',').join(', ') + ')';
  function idxAdd(i) {
    const cols = i.cols.split(',').map(q).join(', ');
    if (i.name === 'PRIMARY') return 'ADD PRIMARY KEY (' + cols + ')';
    return 'ADD ' + (i.kind === 'FULLTEXT' ? 'FULLTEXT ' : i.kind === 'SPATIAL' ? 'SPATIAL ' : i.unique ? 'UNIQUE ' : '') + 'INDEX ' + q(i.name) + ' (' + cols + ')';
  }
  const idxDrop = i => i.name === 'PRIMARY' ? 'DROP PRIMARY KEY' : 'DROP INDEX ' + q(i.name);

  // ---------- comparaison ----------
  function compare(A, B) {
    const names = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
    return names.map(name => {
      const a = A[name], b = B[name];
      if (!b) return { name, status: 'onlyA', a };
      if (!a) return { name, status: 'onlyB', b };
      if (a.view || b.view) return { name, status: a.view === b.view ? 'same' : 'diff', a, b, kindDiff: a.view !== b.view, cols: [], idx: [] };
      const cols = [], idx = [];
      const bc = Object.fromEntries(b.cols.map(c => [c.name, c])), ac = Object.fromEntries(a.cols.map(c => [c.name, c]));
      a.cols.forEach((c, i) => {
        if (!bc[c.name]) cols.push({ kind: 'missing', c, after: i ? a.cols[i - 1].name : null });
        else if (!sameCol(c, bc[c.name])) cols.push({ kind: 'changed', c, other: bc[c.name], txt: colDiff(bc[c.name], c) });
      });
      b.cols.forEach(c => { if (!ac[c.name]) cols.push({ kind: 'extra', c }); });
      Object.values(a.idx).forEach(i => {
        const o = b.idx[i.name];
        if (!o) idx.push({ kind: 'missing', i }); else if (!sameIdx(i, o)) idx.push({ kind: 'changed', i, other: o });
      });
      Object.values(b.idx).forEach(i => { if (!a.idx[i.name]) idx.push({ kind: 'extra', i }); });
      return { name, status: cols.length || idx.length ? 'diff' : 'same', a, b, cols, idx };
    });
  }

  // ---------- script pour rendre B identique à A ----------
  async function script(dbA, list, opts) {
    const out = ['-- Rend « ' + opts.target + ' » identique à « ' + dbA + ' » (structure)', 'SET FOREIGN_KEY_CHECKS = 0;'];
    for (const t of list) {
      if (t.status === 'onlyA') {
        const r = await rows((t.a.view ? 'SHOW CREATE VIEW ' : 'SHOW CREATE TABLE ') + q(t.name), [], dbA);
        let ddl = r[0][1];
        if (t.a.view) ddl = ddl.replace(/\sDEFINER=`[^`]*`@`[^`]*`/, '').replace(new RegExp('`' + dbA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\.', 'g'), '');
        else ddl = ddl.replace(/\sAUTO_INCREMENT=\d+/, '');
        out.push('', '-- nouvelle ' + (t.a.view ? 'vue' : 'table') + ' ' + t.name, ddl + ';');
      } else if (t.status === 'onlyB') {
        if (opts.drop) out.push('', 'DROP ' + (t.b.view ? 'VIEW ' : 'TABLE ') + q(t.name) + ';');
      } else if (t.status === 'diff') {
        if (t.kindDiff) { out.push('', '-- « ' + t.name + ' » est une table d\'un côté et une vue de l\'autre : à corriger à la main'); continue; }
        if (t.a.view) continue;
        const parts = [];
        t.idx.filter(x => x.kind === 'changed' || (x.kind === 'extra' && opts.drop)).forEach(x => parts.push(idxDrop(x.kind === 'changed' ? x.other : x.i)));
        t.cols.forEach(x => {
          if (x.kind === 'missing') parts.push('ADD COLUMN ' + colDef(x.c) + (x.after ? ' AFTER ' + q(x.after) : ' FIRST'));
          else if (x.kind === 'changed') parts.push('MODIFY COLUMN ' + colDef(x.c));
          else if (opts.drop) parts.push('DROP COLUMN ' + q(x.c.name));
        });
        t.idx.filter(x => x.kind !== 'extra').forEach(x => parts.push(idxAdd(x.i)));
        if (parts.length) out.push('', 'ALTER TABLE ' + q(t.name) + '\n  ' + parts.join(',\n  ') + ';');
      }
    }
    out.push('', 'SET FOREIGN_KEY_CHECKS = 1;');
    return out.join('\n');
  }

  const LABEL = { same: ['identique', 'grey'], diff: ['différente', ''], onlyA: ['seulement dans A', ''], onlyB: ['seulement dans B', ''] };

  VIEWS['db:compare'] = async view => {
    const dbA = state.db;
    const others = state.dbs.filter(d => d !== dbA && !SYSTEM_DBS.includes(d));
    view.innerHTML = '<div class="card"><div class="card-head"><h3>⚖ Comparer « ' + h(dbA) + ' » avec une autre base</h3></div>' +
      (others.length ? '<div class="field-row" style="flex-wrap:wrap;align-items:flex-end">' +
        '<label class="field" style="margin:0"><span>A (modèle)</span><input value="' + h(dbA) + '" disabled></label>' +
        '<label class="field" style="margin:0;min-width:220px"><span>B (à comparer)</span><select id="cp-b">' + others.map(d => '<option' + (d === last[dbA] ? ' selected' : '') + '>' + h(d) + '</option>').join('') + '</select></label>' +
        '<label class="check small" style="margin-bottom:8px"><input type="checkbox" id="cp-count"> compter aussi les lignes</label>' +
        '<button class="btn primary" id="cp-go">⚖ Comparer</button></div>' +
        '<p class="muted small">Pratique pour vérifier qu\'une base de test a la même structure que la vraie, ou qu\'un import s\'est bien passé.</p>'
        : '<div class="alert info">Il n\'y a pas d\'autre base sur ce serveur à comparer.</div>') + '</div><div id="cp-out"></div>';
    if (!others.length) return;
    const out = $('#cp-out', view);

    async function go2() {
      const dbB = $('#cp-b', view).value; last[dbA] = dbB;
      out.innerHTML = '<div class="empty">⏳ Comparaison…</div>';
      try {
        const [A, B] = await Promise.all([structure(dbA), structure(dbB)]);
        const list = compare(A, B);
        if ($('#cp-count', view).checked) {
          const common = list.filter(t => t.a && t.b && !t.a.view);
          if (common.length) {
            const sel = (db, t) => 'SELECT COUNT(*) FROM ' + q(db) + '.' + q(t.name);
            const r = await run(common.map(t => sel(dbA, t) + ';' + sel(dbB, t)).join(';'), [], dbA);
            common.forEach((t, i) => { t.na = Number(r.results[i * 2].rows[0][0]); t.nb = Number(r.results[i * 2 + 1].rows[0][0]); });
          }
        }
        const n = k => list.filter(t => t.status === k).length;
        const rowsDiff = list.filter(t => t.na !== undefined && t.na !== t.nb).length;
        const allSame = !n('diff') && !n('onlyA') && !n('onlyB');
        out.innerHTML = '<div class="card"><div class="card-head"><h3>' + (allSame ? '✅ Même structure' + (rowsDiff ? ' (mais ' + rowsDiff + ' table(s) n\'ont pas le même nombre de lignes)' : '') : 'Résultat') + '</h3>' +
          '<span class="muted small">A = ' + h(dbA) + ' · B = ' + h(dbB) + '</span></div>' +
          '<div class="cp-sum">' + [['same', '✅'], ['diff', '✏'], ['onlyA', '⬅'], ['onlyB', '➡']].map(([k, ico]) => '<span class="badge' + (k === 'same' ? ' grey' : '') + '">' + ico + ' ' + n(k) + ' ' + LABEL[k][0] + '</span>').join(' ') + '</div>' +
          '<label class="check small" style="margin:10px 0"><input type="checkbox" id="cp-same"> montrer aussi les tables identiques</label>' +
          '<div class="trg-list" id="cp-list"></div></div>' +
          (allSame ? '' : '<div class="card"><div class="card-head"><h3>🛠 Rendre B identique à A</h3>' +
            '<label class="check small"><input type="checkbox" id="cp-drop"> supprimer aussi ce qui est en trop dans B (tables, colonnes, index)</label></div>' +
            '<p class="muted small">Seule la structure change : les lignes déjà dans B restent. Lis le script avant de l\'exécuter (une colonne modifiée peut couper des valeurs).</p>' +
            '<div class="sql-preview" id="cp-sql">⏳</div><div class="editor-bar"><div class="left"></div><div class="right">' +
            '<button class="btn small" id="cp-copy">⌨️ Ouvrir dans l\'éditeur SQL</button><button class="btn danger" id="cp-run">▶ Exécuter dans « ' + h(dbB) + ' »</button></div></div></div>');

        const draw = () => {
          const showSame = $('#cp-same', out).checked;
          $('#cp-list', out).innerHTML = list.filter(t => showSame || t.status !== 'same' || (t.na !== undefined && t.na !== t.nb)).map(t => {
            const det = [];
            if (t.kindDiff) det.push('table d\'un côté, vue de l\'autre');
            (t.cols || []).forEach(x => det.push(x.kind === 'missing' ? '⬅ colonne <b>' + h(x.c.name) + '</b> manque dans B (' + h(x.c.type) + ')' :
              x.kind === 'extra' ? '➡ colonne <b>' + h(x.c.name) + '</b> en plus dans B' : '✏ colonne <b>' + h(x.c.name) + '</b> : ' + h(x.txt)));
            (t.idx || []).forEach(x => det.push(x.kind === 'missing' ? '⬅ ' + h(idxDesc(x.i)) + ' manque dans B' : x.kind === 'extra' ? '➡ ' + h(idxDesc(x.i)) + ' en plus dans B' : '✏ ' + h(idxDesc(x.other)) + ' → ' + h(idxDesc(x.i))));
            if (t.na !== undefined && t.na !== t.nb) det.push('lignes : ' + fmtNum(t.na) + ' dans A, ' + fmtNum(t.nb) + ' dans B');
            return '<div class="trg-item cp-' + t.status + '"><div class="trg-main"><div class="trg-name">' + ((t.a || t.b).view ? '👁 ' : '▦ ') + h(t.name) +
              ' <span class="badge' + (LABEL[t.status][1] ? ' ' + LABEL[t.status][1] : '') + '">' + LABEL[t.status][0] + '</span>' +
              (t.na !== undefined ? ' <span class="muted small">' + fmtNum(t.na) + (t.na === t.nb ? '' : ' / ' + fmtNum(t.nb)) + ' lignes</span>' : '') + '</div>' +
              (det.length ? '<div class="cp-det">' + det.join('<br>') + '</div>' : '') + '</div></div>';
          }).join('') || '<p class="muted">Aucune différence 🎉</p>';
        };
        $('#cp-same', out).onchange = draw;
        draw();
        if (allSame) return;
        let sql = '';
        const build = async () => {
          sql = await script(dbA, list, { target: dbB, drop: $('#cp-drop', out).checked });
          $('#cp-sql', out).innerHTML = highlight(sql);
        };
        $('#cp-drop', out).onchange = build;
        await build();
        $('#cp-copy', out).onclick = () => window.SqlTabs ? SqlTabs.open(dbB, null, 'Comparaison ' + dbA, sql) : (state.sqlText['db:' + dbB] = sql, go(dbB, null, 'sql'));
        $('#cp-run', out).onclick = () => confirmAndRun({ title: 'Modifier la structure de « ' + dbB + ' » ?', okText: '▶ Exécuter', danger: true, done: '« ' + dbB + ' » a maintenant la structure de « ' + dbA + ' »',
          text: 'Conseil : fais d\'abord une sauvegarde de « ' + h(dbB) + ' » (onglet 💾 Sauvegardes).' }, sql, dbB, async () => { state.tables = {}; await loadTree(); go2(); });
      } catch (e) { out.innerHTML = '<div class="alert danger">' + h(e.message) + '</div>'; }
    }
    $('#cp-go', view).onclick = go2;
  };

  PALETTE_HOOKS.push((items, match) => {
    if (state.db && match('Comparer ' + state.db, 'comparer diff différences')) {
      const db = state.db;
      items.push({ group: 'Actions', ico: '⚖', label: 'Comparer « ' + db + ' » avec une autre base', sub: 'onglet', run: () => go(db, null, 'compare') });
    }
  });
})();
