// =====================================================================
//  BaseStudio - recherche dans toute une base (onglet « 🔍 Rechercher »)
//  On tape un texte ou un nombre : BaseStudio cherche dans toutes les
//  colonnes de toutes les tables choisies, affiche le nombre de lignes
//  trouvées par table, puis les lignes elles-mêmes (texte surligné).
// =====================================================================
(function () {
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.db, 'tables', ['search', '🔍 Rechercher']);

  const MODES = [['contains', 'contient'], ['exact', 'est exactement'], ['starts', 'commence par'], ['regexp', 'expression régulière (REGEXP)']];
  const likeEsc = s => s.replace(/[\\%_]/g, c => '\\' + c);
  const last = {};   // dernière recherche par base (on la retrouve en revenant sur l'onglet)

  // Les colonnes où chercher, selon ce qui est tapé
  function searchable(type, term, mode) {
    const t = type.toLowerCase();
    if (/blob|binary|geometry|point|polygon|linestring/.test(t)) return false;
    if (/char|text|enum|set|json/.test(t)) return true;
    if (/int|decimal|float|double|bit/.test(t)) return /^-?\d+([.,]\d+)?$/.test(term.trim()) || mode === 'regexp';
    if (/date|time|year/.test(t)) return /\d/.test(term);
    return false;
  }
  function condition(col, mode) {
    if (mode === 'exact') return q(col) + ' = ?';
    if (mode === 'regexp') return q(col) + ' REGEXP ?';
    return q(col) + ' LIKE ?';
  }
  function param(term, mode) {
    if (mode === 'contains') return '%' + likeEsc(term) + '%';
    if (mode === 'starts') return likeEsc(term) + '%';
    if (mode === 'exact' && /^-?\d+,\d+$/.test(term.trim())) return term.trim().replace(',', '.');
    return term;
  }

  // surligne le texte trouvé dans les cases d'un tableau
  function mark(root, term, mode) {
    if (mode === 'regexp' || !term) return;
    const t = term.toLowerCase();
    $$('td', root).forEach(td => {
      const txt = td.textContent, k = txt.toLowerCase().indexOf(t);
      if (k < 0) return;
      td.innerHTML = h(txt.slice(0, k)) + '<mark>' + h(txt.slice(k, k + t.length)) + '</mark>' + h(txt.slice(k + t.length));
    });
  }

  VIEWS['db:search'] = async view => {
    const db = state.db;
    const cols = await rows('SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS c ' +
      'JOIN information_schema.TABLES t USING (TABLE_SCHEMA, TABLE_NAME) WHERE c.TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [db]);
    if (state.db !== db || state.tab !== 'search') return;
    const byTable = {};
    cols.forEach(([t, c, type]) => (byTable[t] = byTable[t] || []).push({ name: c, type }));
    const tables = Object.keys(byTable);
    const prev = last[db] || { term: '', mode: 'contains', skip: [] };

    view.innerHTML =
      '<div class="card"><div class="card-head"><h3>🔍 Rechercher dans toute la base « ' + h(db) + ' »</h3></div>' +
      '<div class="field-row" style="flex-wrap:wrap;align-items:flex-end">' +
      '<label class="field grow" style="margin:0;min-width:240px"><span>Texte ou nombre à chercher</span><input id="se-term" value="' + h(prev.term) + '" placeholder="ex : Dupont, 06 12, 2026-11…" spellcheck="false"></label>' +
      '<label class="field" style="margin:0"><span>La valeur</span><select id="se-mode">' + MODES.map(m => '<option value="' + m[0] + '"' + (m[0] === prev.mode ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select></label>' +
      '<button class="btn primary" id="se-go">🔍 Rechercher</button></div>' +
      '<details class="trg-help" style="margin-top:12px"><summary>Tables où chercher (' + tables.length + ')</summary>' +
      '<div style="margin:6px 0"><button class="btn small" id="se-all">Toutes</button> <button class="btn small" id="se-none">Aucune</button></div>' +
      '<div class="se-tables">' + tables.map(t => '<label class="check"><input type="checkbox" data-t="' + h(t) + '"' + (prev.skip.includes(t) ? '' : ' checked') + '> ' + h(t) + '</label>').join('') + '</div></details>' +
      '<p class="muted small">Majuscules et accents : la recherche suit l\'interclassement des colonnes (en général « Dupont » = « dupont »).</p></div>' +
      '<div id="se-out"></div>';

    const out = $('#se-out', view);
    async function search() {
      const term = $('#se-term', view).value, mode = $('#se-mode', view).value;
      if (!term.trim()) return toast('Tape quelque chose à chercher', 'error');
      const chosen = $$('[data-t]', view).filter(c => c.checked).map(c => c.dataset.t);
      last[db] = { term, mode, skip: tables.filter(t => !chosen.includes(t)) };
      const plan = chosen.map(t => ({ t, cols: byTable[t].filter(c => searchable(c.type, term, mode)).map(c => c.name) })).filter(p => p.cols.length);
      if (!plan.length) { out.innerHTML = '<div class="alert info">Aucune colonne ne peut contenir ce genre de valeur dans les tables choisies.</div>'; return; }
      out.innerHTML = '<div class="empty">⏳ Recherche dans ' + plan.length + ' table(s)…</div>';
      const p = param(term, mode);
      // une seule requête par table, toutes envoyées d'un coup
      const sql = plan.map(x => 'SELECT COUNT(*) FROM ' + q(x.t) + ' WHERE ' + x.cols.map(c => condition(c, mode)).join(' OR ')).join(';\n') + ';';
      const params = plan.flatMap(x => x.cols.map(() => p));
      try {
        const data = await run(sql, params, db);
        const found = plan.map((x, i) => Object.assign(x, { n: Number(data.results[i].rows[0][0]) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
        const total = found.reduce((a, x) => a + x.n, 0);
        out.innerHTML = '<div class="card"><div class="card-head"><h3>' + (total ? fmtNum(total) + ' ligne(s) trouvée(s) dans ' + found.length + ' table(s)' : 'Rien trouvé 🤷') +
          '</h3><span class="muted small">' + plan.length + ' table(s) parcourue(s) · ' + data.time + ' ms</span></div>' +
          (found.length ? '<div class="trg-list">' + found.map((x, i) =>
            '<div class="se-item"><div class="trg-item"><div class="trg-main"><div class="trg-name">▦ ' + h(x.t) + ' <span class="badge">' + fmtNum(x.n) + ' ligne(s)</span></div>' +
            '<span class="muted small">cherché dans : ' + x.cols.map(h).join(', ') + '</span></div>' +
            '<div class="trg-actions"><button class="btn small primary" data-show="' + i + '">Voir les lignes</button>' +
            '<button class="btn small" data-open="' + i + '">Ouvrir la table</button></div></div><div class="se-rows" id="se-r' + i + '"></div></div>').join('') + '</div>' : '') + '</div>';
        $$('[data-show]', out).forEach(b => b.onclick = async () => {
          const x = found[b.dataset.show], box = $('#se-r' + b.dataset.show, out);
          if (box.innerHTML) { box.innerHTML = ''; b.textContent = 'Voir les lignes'; return; }
          try {
            const r = await run('SELECT * FROM ' + q(x.t) + ' WHERE ' + x.cols.map(c => condition(c, mode)).join(' OR ') + ' LIMIT 50', x.cols.map(() => p), db);
            box.innerHTML = gridHtml(r.results[0]) + (x.n > 50 ? '<p class="muted small">Les 50 premières lignes sont affichées : « Ouvrir la table » pour tout voir.</p>' : '');
            mark(box, term, mode);
            b.textContent = 'Masquer';
          } catch (e) { box.innerHTML = '<div class="alert danger">' + h(e.message) + '</div>'; }
        });
        $$('[data-open]', out).forEach(b => b.onclick = () => {
          const x = found[b.dataset.open];
          go(db, x.t, 'browse');
          // la recherche de « Parcourir » cherche le texte dans toutes les colonnes
          if (mode !== 'regexp') { state.browse.search = term; render(); }
        });
      } catch (e) { out.innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>'; }
    }

    $('#se-go', view).onclick = search;
    $('#se-term', view).onkeydown = e => { if (e.key === 'Enter') search(); };
    $('#se-all', view).onclick = () => $$('[data-t]', view).forEach(c => c.checked = true);
    $('#se-none', view).onclick = () => $$('[data-t]', view).forEach(c => c.checked = false);
    $('#se-term', view).focus();
    if (prev.term) search();
  };
})();
