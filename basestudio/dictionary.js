// =====================================================================
//  BaseStudio - dictionnaire de données d'une base
//  Un document propre qui décrit toute la base : sommaire, MCD et MLD
//  (dessinés par schema.js), puis chaque table avec ses colonnes, types,
//  clés, index, clés étrangères et triggers, les vues, les procédures et
//  fonctions. On peut l'imprimer / l'enregistrer en PDF ou le télécharger
//  en .html. Ouvert depuis le Schéma, l'onglet Exporter ou Ctrl+K.
// =====================================================================
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function collect(db) {
    const P = [db];
    const [tables, cols, fkr, idx, trg, rts, prm, views] = await Promise.all([
      rows('SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, TABLE_COMMENT, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', P),
      rows('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', P),
      rows('SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE ' +
        'FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA ' +
        'AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ' +
        'ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION', P),
      rows('SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX', P),
      rows('SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME', P),
      rows('SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION, ROUTINE_COMMENT FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE DESC, ROUTINE_NAME', P),
      rows('SELECT SPECIFIC_NAME, ROUTINE_TYPE, PARAMETER_MODE, PARAMETER_NAME, DTD_IDENTIFIER FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA = ? AND ORDINAL_POSITION > 0 ORDER BY SPECIFIC_NAME, ORDINAL_POSITION', P),
      rows('SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', P)
    ]);
    const T = {};
    tables.forEach(([name, type, engine, nb, comment, coll]) => { T[name] = { name, view: type === 'VIEW', engine, nb, comment, coll, cols: [], fks: [], idx: {}, trg: [] }; });
    cols.forEach(([t, name, type, nul, def, key, extra, comment]) => T[t] && T[t].cols.push({ name, type, nullable: nul === 'YES', def, key, extra, comment }));
    const fkMap = {};
    fkr.forEach(([t, cn, c, rt, rc, del, upd]) => {
      const id = t + '.' + cn;
      if (!fkMap[id]) { fkMap[id] = { name: cn, cols: [], refTable: rt, refCols: [], del, upd }; if (T[t]) T[t].fks.push(fkMap[id]); }
      fkMap[id].cols.push(c); fkMap[id].refCols.push(rc);
    });
    idx.forEach(([t, name, nonUnique, c]) => {
      if (!T[t]) return;
      (T[t].idx[name] = T[t].idx[name] || { name, unique: String(nonUnique) === '0', cols: [] }).cols.push(c);
    });
    trg.forEach(([name, t, timing, ev, body]) => T[t] && T[t].trg.push({ name, timing, ev, body }));
    const routines = rts.map(([name, kind, ret, body, comment]) => ({
      name, kind, ret, body, comment,
      params: prm.filter(p => p[0] === name && p[1] === kind).map(p => ({ mode: p[2], name: p[3], type: p[4] }))
    }));
    const viewDefs = Object.fromEntries(views);
    return { T, routines, viewDefs };
  }

  async function build(db, opt) {
    const { T, routines, viewDefs } = await collect(db);
    const all = Object.values(T), tables = all.filter(t => !t.view), views = all.filter(t => t.view);
    const cs = getComputedStyle(document.documentElement);
    const palette = {
      '--bg': '#ffffff', '--panel': '#ffffff', '--surface': '#ffffff', '--surface-2': '#eef2ff',
      '--border': '#94a3b8', '--text': '#0f172a', '--muted': '#64748b', '--accent': '#1e3a8a',
      '--font-ui': cs.getPropertyValue('--font-ui').trim() || 'Segoe UI, Arial, sans-serif',
      '--font-code': cs.getPropertyValue('--font-code').trim() || 'Consolas, monospace'
    };
    const mcd = opt.mcd && window.SchemaDraw ? await SchemaDraw.svg(db, 'mcd', palette) : '';
    const mld = opt.mld && window.SchemaDraw ? await SchemaDraw.svg(db, 'mld', palette) : '';
    const date = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
    const anchor = n => 't-' + String(n).replace(/[^\w-]/g, '_');
    const keyOf = (t, c) => {
      const k = [];
      if (c.key === 'PRI') k.push('<b>PK</b>');
      t.fks.filter(f => f.cols.includes(c.name)).forEach(f => k.push('FK → <a href="#' + anchor(f.refTable) + '">' + esc(f.refTable) + '</a>.' + esc(f.refCols[f.cols.indexOf(c.name)])));
      if (c.key === 'UNI') k.push('UNIQUE');
      else if (c.key === 'MUL' && !k.length) k.push('INDEX');
      return k.join('<br>') || '';
    };
    const defOf = c => c.def === null ? (c.nullable ? '<i>NULL</i>' : '') : esc(c.def);
    const sig = r => esc(r.name) + '(' + r.params.map(p => (r.kind === 'PROCEDURE' ? p.mode + ' ' : '') + esc(p.name) + ' ' + esc(p.type)).join(', ') + ')' +
      (r.kind === 'FUNCTION' ? ' → ' + esc(r.ret) : '');

    const tableHtml = t => {
      let s = '<section class="tbl" id="' + anchor(t.name) + '"><h2>' + (t.view ? 'Vue' : 'Table') + ' <span class="n">' + esc(t.name) + '</span></h2>';
      if (t.comment) s += '<p class="comment">' + esc(t.comment) + '</p>';
      if (!t.view) s += '<p class="meta">Moteur ' + esc(t.engine || '—') + ' · environ ' + Number(t.nb || 0).toLocaleString('fr-FR') + ' ligne(s) · ' + esc(t.coll || '') + '</p>';
      s += '<table><thead><tr><th>Colonne</th><th>Type</th><th>Null</th><th>Défaut</th><th>Clé</th><th>Extra</th><th>Description</th></tr></thead><tbody>' +
        t.cols.map(c => '<tr><td class="col' + (c.key === 'PRI' ? ' pk' : '') + '">' + esc(c.name) + '</td><td class="code">' + esc(c.type) + '</td>' +
          '<td class="c">' + (c.nullable ? 'oui' : 'non') + '</td><td class="code">' + defOf(c) + '</td><td>' + keyOf(t, c) + '</td>' +
          '<td class="small">' + esc(c.extra) + '</td><td>' + esc(c.comment) + '</td></tr>').join('') + '</tbody></table>';
      if (t.fks.length) s += '<h3>Clés étrangères</h3><ul>' + t.fks.map(f => '<li><code>' + f.cols.map(esc).join(', ') + '</code> → <a href="#' + anchor(f.refTable) + '">' +
        esc(f.refTable) + '</a>.<code>' + f.refCols.map(esc).join(', ') + '</code> <span class="small">(' + esc(f.name) + ' · ON DELETE ' + esc(f.del) + ' · ON UPDATE ' + esc(f.upd) + ')</span></li>').join('') + '</ul>';
      const ix = Object.values(t.idx).filter(i => i.name !== 'PRIMARY');
      if (ix.length) s += '<h3>Index</h3><ul>' + ix.map(i => '<li><code>' + esc(i.name) + '</code> : ' + i.cols.map(esc).join(', ') + (i.unique ? ' <b>(unique)</b>' : '') + '</li>').join('') + '</ul>';
      if (t.trg.length) s += '<h3>Triggers</h3>' + t.trg.map(g => '<p><b>' + esc(g.name) + '</b> — ' + g.timing + ' ' + g.ev + '</p>' +
        (opt.code ? '<pre>' + esc(g.body) + '</pre>' : '')).join('');
      if (t.view && opt.code && viewDefs[t.name]) s += '<h3>Définition</h3><pre>' + esc(viewDefs[t.name]) + '</pre>';
      return s + '</section>';
    };

    const nbFk = tables.reduce((a, t) => a + t.fks.length, 0);
    let html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Dictionnaire de données — ' + esc(db) + '</title><style>' +
      '@page{size:A4;margin:14mm 12mm}*{box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;color:#0f172a;font-size:10.5pt;line-height:1.4;margin:0;padding:24px;max-width:1100px;margin:auto}' +
      'header{border-bottom:3px solid #1e3a8a;padding-bottom:10px;margin-bottom:18px}h1{color:#1e3a8a;margin:0 0 4px;font-size:22pt}' +
      '.sub{color:#64748b;margin:0}h2{color:#1e3a8a;font-size:14pt;margin:22px 0 4px;border-left:5px solid #1e3a8a;padding-left:8px}h2 .n{font-family:Consolas,monospace}' +
      'h3{font-size:11pt;color:#334155;margin:12px 0 4px}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.stats div{background:#eef2ff;border-radius:6px;padding:6px 12px}' +
      'table{width:100%;border-collapse:collapse;margin:6px 0;font-size:9.5pt}th{background:#1e3a8a;color:#fff;text-align:left;padding:5px 6px;font-weight:600}' +
      'td{border-bottom:1px solid #cbd5e1;padding:4px 6px;vertical-align:top}tr:nth-child(even) td{background:#f8fafc}.code,code,pre{font-family:Consolas,monospace;font-size:9pt}' +
      '.col{font-weight:600}.pk{text-decoration:underline}.c{text-align:center}.small{color:#64748b;font-size:8.5pt}.comment{font-style:italic;margin:2px 0}.meta{color:#64748b;font-size:9pt;margin:0 0 4px}' +
      'pre{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:8px;white-space:pre-wrap;word-break:break-word}a{color:#1e3a8a}' +
      '.toc{columns:3;font-size:10pt}.toc a{text-decoration:none}.fig{page-break-inside:avoid;text-align:center;margin:10px 0}.fig svg{max-width:100%;height:auto;border:1px solid #cbd5e1;border-radius:6px}' +
      '.break{page-break-before:always}section.tbl{page-break-inside:avoid}ul{margin:4px 0;padding-left:20px}' +
      '.legend{color:#64748b;font-size:9pt;text-align:left}@media print{body{padding:0}a{color:inherit;text-decoration:none}}' +
      '</style></head><body>' +
      '<header><h1>Dictionnaire de données</h1><p class="sub">Base <b>' + esc(db) + '</b> · ' + esc(state.server ? state.server.version : '') + ' · généré le ' + esc(date) + ' avec BaseStudio</p></header>' +
      '<div class="stats"><div><b>' + tables.length + '</b> table(s)</div><div><b>' + views.length + '</b> vue(s)</div><div><b>' + nbFk + '</b> clé(s) étrangère(s)</div>' +
      '<div><b>' + tables.reduce((a, t) => a + t.trg.length, 0) + '</b> trigger(s)</div><div><b>' + routines.length + '</b> procédure(s) / fonction(s)</div></div>' +
      '<h3>Sommaire</h3><div class="toc">' + all.map(t => '<div><a href="#' + anchor(t.name) + '">' + (t.view ? '👁 ' : '▦ ') + esc(t.name) + '</a></div>').join('') + '</div>' +
      '<p class="legend">PK = clé primaire (identifiant) · FK = clé étrangère (lien vers une autre table) · Null « oui » = la valeur peut être vide.</p>';
    if (mcd) html += '<div class="break"></div><h2>Modèle conceptuel (MCD)</h2><div class="fig">' + mcd + '</div>' +
      '<p class="legend">Cardinalités (min,max) : 0,1 zéro ou un · 1,1 exactement un · 0,n zéro ou plusieurs. Les ovales sont les associations, souligné = identifiant.</p>';
    if (mld) html += '<div class="break"></div><h2>Modèle logique (MLD)</h2><div class="fig">' + mld + '</div>' +
      '<p class="legend">Souligné = clé primaire · #colonne = clé étrangère · la flèche va vers la table référencée.</p>';
    html += '<div class="break"></div>' + tables.map(tableHtml).join('');
    if (opt.views && views.length) html += views.map(tableHtml).join('');
    if (routines.length) html += '<div class="break"></div><h2>Procédures et fonctions</h2>' + routines.map(r =>
      '<section class="tbl"><h3>' + (r.kind === 'FUNCTION' ? 'Fonction' : 'Procédure') + ' <code>' + sig(r) + '</code></h3>' +
      (r.comment ? '<p class="comment">' + esc(r.comment) + '</p>' : '') + (opt.code ? '<pre>' + esc(r.body) + '</pre>' : '') + '</section>').join('');
    return html + '</body></html>';
  }

  function printHtml(html) {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    fr.srcdoc = html;
    fr.onload = () => { setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); }, 200); setTimeout(() => fr.remove(), 60000); };
    document.body.appendChild(fr);
  }

  function open(db) {
    modal('<h3>📖 Dictionnaire de données de « ' + h(db) + ' »</h3>' +
      '<p>Un document qui décrit toute la base : chaque table avec ses colonnes, types, clés et commentaires. Pratique pour un dossier ou un rendu.</p>' +
      '<label class="check"><input type="checkbox" id="dc-mcd" checked> Inclure le schéma MCD</label><br>' +
      '<label class="check"><input type="checkbox" id="dc-mld" checked> Inclure le schéma MLD</label><br>' +
      '<label class="check"><input type="checkbox" id="dc-views" checked> Inclure les vues</label><br>' +
      '<label class="check"><input type="checkbox" id="dc-code" checked> Inclure le code SQL (triggers, procédures, vues)</label>' +
      '<p class="muted small" style="margin-top:12px">💡 Pour un PDF : clique sur « Imprimer / PDF » puis choisis l\'imprimante « Enregistrer au format PDF ». ' +
      'Astuce : écris des commentaires sur tes colonnes (Structure → Modifier) pour remplir la colonne « Description ».</p>' +
      '<div class="modal-actions"><button class="btn ghost" data-x>Fermer</button><button class="btn" data-html>⬇ Télécharger (.html)</button>' +
      '<button class="btn primary" data-print>🖨 Imprimer / PDF</button></div>',
      (back, close) => {
        const opt = () => ({ mcd: $('#dc-mcd', back).checked, mld: $('#dc-mld', back).checked, views: $('#dc-views', back).checked, code: $('#dc-code', back).checked });
        const make = async (btn, then) => {
          const label = btn.textContent;
          btn.disabled = true; btn.textContent = '⏳ Préparation…';
          try { then(await build(db, opt())); close(); }
          catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = label; }
        };
        $('[data-x]', back).onclick = close;
        $('[data-print]', back).onclick = e => make(e.currentTarget, printHtml);
        $('[data-html]', back).onclick = e => make(e.currentTarget, html => saveText(db + '_dictionnaire.html', html, 'html'));
      });
  }

  // Bouton aussi dans l'onglet « Exporter » d'une base
  const origExport = VIEWS['export'];
  VIEWS['export'] = async view => {
    const db = state.db, table = state.table;
    await origExport(view);
    if (table || state.db !== db || state.tab !== 'export') return;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h3>📖 Dictionnaire de données</h3></div>' +
      '<p class="muted">Un document à imprimer ou à enregistrer en PDF qui décrit toute la base : tables, colonnes, types, clés, schémas MCD / MLD, triggers et procédures.</p>' +
      '<button class="btn primary" data-dico>📖 Créer le dictionnaire</button>';
    view.appendChild(card);
    $('[data-dico]', card).onclick = () => open(db);
  };

  window.Dictionary = { open, build };
})();
