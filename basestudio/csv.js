// =====================================================================
//  BaseStudio - import d'un fichier CSV (ou Excel enregistré en CSV)
//  dans une table : onglet « 📥 Import CSV » d'une table.
//  1. on choisit le fichier (séparateur et encodage devinés tout seuls)
//  2. on associe chaque colonne de la table à une colonne du fichier
//     (fait automatiquement quand les noms se ressemblent)
//  3. aperçu, puis import par paquets (MySQL refuse les envois > 1 Mo)
//  Les dates « 25/12/2026 » et les nombres « 3,50 » sont convertis.
// =====================================================================
(function () {
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.table, 'insert', ['csv', '📥 Import CSV']);

  const SEPS = [['auto', 'Automatique'], [';', 'Point-virgule ;'], [',', 'Virgule ,'], ['\t', 'Tabulation'], ['|', 'Barre |']];
  const CHUNK = 300000;   // taille max (environ) d'un paquet envoyé à MySQL

  // Lecture CSV : gère les "guillemets", les "" doublés et les retours à la ligne dans une case
  function parseCsv(text, sep) {
    const out = []; let row = [], cell = '', i = 0, quoted = false;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;   // BOM d'Excel
    for (; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += c;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') out.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return out;
  }
  // le séparateur le plus fréquent et le plus régulier sur les premières lignes
  function guessSep(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
    let best = ';', score = -1;
    [';', ',', '\t', '|'].forEach(s => {
      const counts = lines.map(l => l.split(s).length - 1);
      const min = Math.min(...counts);
      if (min > 0 && min * 10 - (Math.max(...counts) - min) > score) { score = min * 10 - (Math.max(...counts) - min); best = s; }
    });
    return best;
  }
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  // Conversions françaises -> MySQL
  function convert(v, col, fr) {
    if (!fr) return v;
    const t = col.type.toLowerCase();
    if (/^(tinyint|smallint|mediumint|int|bigint|decimal|float|double)/.test(t)) {
      const n = v.replace(/[\s  ]/g, '').replace(/€|%/g, '');
      if (/^-?\d+(,\d+)?$/.test(n)) return n.replace(',', '.');
      if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) return n.replace(/\./g, '').replace(',', '.');   // 1.234,50
      return n;
    }
    if (/^(date|datetime|timestamp)/.test(t)) {
      const m = v.trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (m) {
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        let d = y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
        if (t !== 'date') d += ' ' + (m[4] || '00').padStart(2, '0') + ':' + (m[5] || '00') + ':' + (m[6] || '00');
        return d;
      }
    }
    return v;
  }

  VIEWS['table:csv'] = async view => {
    if (tableType() === 'VIEW') { view.innerHTML = '<div class="alert info">On ne peut pas importer dans une vue : ouvre une vraie table.</div>'; return; }
    const db = state.db, table = state.table;
    const cols = await tableColumns(db, table);
    let file = null, text = '', data = [], header = [], map = [];

    view.innerHTML =
      '<div class="card"><div class="card-head"><h3>📥 Importer un fichier CSV dans « ' + h(table) + ' »</h3></div>' +
      '<p class="muted">Depuis Excel ou LibreOffice : <b>Fichier → Enregistrer sous → CSV</b>. Chaque ligne du fichier devient une ligne de la table. Tu peux aussi glisser le fichier sur cette page.</p>' +
      '<div class="field-row" style="flex-wrap:wrap;align-items:flex-end">' +
      '<button class="btn primary" id="cv-pick">📁 Choisir un fichier .csv</button>' +
      '<label class="field" style="margin:0"><span>Séparateur</span><select id="cv-sep">' + SEPS.map(s => '<option value="' + h(s[0]) + '">' + s[1] + '</option>').join('') + '</select></label>' +
      '<label class="field" style="margin:0"><span>Encodage</span><select id="cv-enc"><option value="utf-8">UTF-8</option><option value="windows-1252">Windows (Excel français)</option></select></label>' +
      '<label class="check"><input type="checkbox" id="cv-head" checked> 1re ligne = noms des colonnes</label></div>' +
      '<p class="muted small" id="cv-file" style="margin-top:10px"></p></div>' +
      '<div id="cv-step2"></div>';

    const step2 = $('#cv-step2', view);

    const read = enc => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(file, enc); });
    async function load(autoEnc) {
      text = await read($('#cv-enc', view).value);
      // caractères illisibles en UTF-8 : c'est sûrement un CSV d'Excel (Windows)
      if (autoEnc && text.includes('�')) { $('#cv-enc', view).value = 'windows-1252'; text = await read('windows-1252'); }
      parse(true);
    }
    function parse(remap) {
      let sep = $('#cv-sep', view).value;
      if (sep === 'auto') sep = guessSep(text);
      const all = parseCsv(text, sep);
      const width = Math.max(0, ...all.map(r => r.length));
      header = $('#cv-head', view).checked && all.length ? all[0].map((x, i) => x.trim() || 'colonne ' + (i + 1)) : Array.from({ length: width }, (_, i) => 'colonne ' + (i + 1));
      data = $('#cv-head', view).checked ? all.slice(1) : all;
      $('#cv-file', view).innerHTML = '📄 <b>' + h(file.name) + '</b> · ' + fmtNum(data.length) + ' ligne(s) · ' + header.length + ' colonne(s) · séparateur ' +
        (sep === '\t' ? 'tabulation' : '« ' + h(sep) + ' »');
      if (remap) autoMap();
      draw();
    }
    // associe les colonnes qui ont (presque) le même nom ; sans titres : dans l'ordre
    function autoMap() {
      const hn = header.map(norm);
      map = cols.map((c, i) => {
        const k = hn.indexOf(norm(c.name));
        if (k >= 0) return k;
        if (!$('#cv-head', view).checked) return /auto_increment/i.test(c.extra) ? -1 : (i < header.length ? i : -1);
        return -1;
      });
      // sans titres et avec un id automatique : on décale
      if (!$('#cv-head', view).checked && /auto_increment/i.test(cols[0].extra || '') && header.length < cols.length)
        map = cols.map((c, i) => i === 0 ? -1 : (i - 1 < header.length ? i - 1 : -1));
    }

    const valueOf = (row, ci, fr) => {
      const k = map[ci]; if (k < 0) return undefined;
      const v = row[k] === undefined ? '' : row[k];
      if (v === '') return '';
      return convert(v, cols[ci], fr);
    };

    function draw() {
      const used = cols.map((c, i) => i).filter(i => map[i] >= 0);
      const fr = $('#cv-fr', view) ? $('#cv-fr', view).checked : true;
      step2.innerHTML =
        '<div class="card"><div class="card-head"><h3>Associer les colonnes</h3><span class="muted small">À gauche la table, à droite la colonne du fichier</span></div>' +
        '<div class="cv-map">' + cols.map((c, i) => '<div class="cv-row"><div class="col-name">' + (c.key === 'PRI' ? '<span class="pk">🔑 </span>' : '') + h(c.name) +
          '<span class="col-type">' + h(c.type) + (/auto_increment/i.test(c.extra) ? ' · automatique' : '') + (c.nullable ? '' : ' · obligatoire') + '</span></div>' +
          '<span class="fk-arrow">←</span><select data-map="' + i + '"><option value="-1">— ne pas remplir (valeur par défaut) —</option>' +
          header.map((x, k) => '<option value="' + k + '"' + (map[i] === k ? ' selected' : '') + '>' + h(x) + (data[0] && data[0][k] !== undefined ? ' (ex : ' + h(String(data[0][k]).slice(0, 30)) + ')' : '') + '</option>').join('') +
          '</select></div>').join('') + '</div>' +
        '<div class="form-grid trg-grid" style="margin-top:12px">' +
        '<label class="field"><span>Si une ligne existe déjà (même clé)</span><select id="cv-mode">' +
        '<option value="INSERT">Arrêter avec une erreur (INSERT)</option><option value="INSERT IGNORE">Sauter la ligne (INSERT IGNORE)</option>' +
        '<option value="REPLACE">Remplacer la ligne (REPLACE)</option></select></label>' +
        '<label class="check"><input type="checkbox" id="cv-fr"' + (fr ? ' checked' : '') + '> Convertir les dates 25/12/2026 et les nombres 3,50</label>' +
        '<label class="check"><input type="checkbox" id="cv-empty"> Vider la table avant l\'import</label></div>' +
        '<h4 style="margin:14px 0 6px">Aperçu des 5 premières lignes, telles qu\'elles seront importées</h4>' +
        (used.length ? gridHtml({ columns: used.map(i => cols[i].name), rows: data.slice(0, 5).map(r => used.map(i => { const v = valueOf(r, i, fr); return v === '' ? (cols[i].nullable ? null : '(défaut)') : v; })) })
          : '<div class="alert info">Associe au moins une colonne.</div>') +
        '<div class="editor-bar"><div class="left"><span class="muted small" id="cv-progress"></span></div>' +
        '<div class="right"><button class="btn primary" id="cv-go"' + (used.length && data.length ? '' : ' disabled') + '>📥 Importer ' + fmtNum(data.length) + ' ligne(s)</button></div></div>' +
        '<div id="cv-out"></div></div>';

      $$('[data-map]', step2).forEach(s => s.onchange = () => { map[s.dataset.map] = Number(s.value); draw(); });
      $('#cv-fr', step2).onchange = draw;
      $('#cv-go', step2).onclick = doImport;
    }

    async function doImport() {
      const used = cols.map((c, i) => i).filter(i => map[i] >= 0);
      const fr = $('#cv-fr', step2).checked, mode = $('#cv-mode', step2).value, empty = $('#cv-empty', step2).checked;
      const btn = $('#cv-go', step2), prog = $('#cv-progress', step2), out = $('#cv-out', step2);
      if (empty && !(await confirmBox({ title: 'Vider « ' + table + ' » avant l\'import ?', text: 'Toutes les lignes actuelles seront supprimées.', okText: 'Vider et importer', danger: true }))) return;
      btn.disabled = true; out.innerHTML = '';
      const head = mode + ' INTO ' + q(table) + ' (' + used.map(i => q(cols[i].name)).join(', ') + ') VALUES ';
      let done = 0, t0 = Date.now();
      try {
        if (empty) await run('DELETE FROM ' + q(table), [], db);
        let i = 0;
        while (i < data.length) {
          // un paquet de lignes de moins de ~300 Ko
          const parts = [], params = []; let size = head.length, first = i;
          while (i < data.length && (size < CHUNK || !parts.length)) {
            const r = data[i++], ph = [];
            used.forEach(ci => {
              const v = valueOf(r, ci, fr);
              if (v === '') ph.push(cols[ci].nullable ? 'NULL' : 'DEFAULT');
              else { ph.push('?'); params.push(v); size += String(v).length * 2 + 4; }
            });
            parts.push('(' + ph.join(', ') + ')'); size += 6;
          }
          const res = await window.api.query(head + parts.join(',\n'), params, db);
          if (!res.ok) throw Object.assign(new Error(res.error), { from: first + 1, to: i });
          done = i;
          prog.textContent = '⏳ ' + fmtNum(done) + ' / ' + fmtNum(data.length) + ' lignes…';
        }
        addJournal('-- import CSV ' + file.name + ' dans ' + table, [], true, fmtNum(done) + ' lignes');
        prog.textContent = '';
        out.innerHTML = '<div class="alert success result-block">✔ Import terminé : ' + fmtNum(done) + ' ligne(s) lue(s) en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.' +
          (mode !== 'INSERT' ? ' Les doublons ont été ' + (mode === 'REPLACE' ? 'remplacés.' : 'sautés.') : '') +
          ' <button class="btn small" id="cv-see">👀 Voir les données</button></div>';
        $('#cv-see', out).onclick = () => go(db, table, 'browse');
        toast('Import terminé', 'success');
      } catch (e) {
        addJournal('-- import CSV ' + file.name + ' dans ' + table, [], false, e.message);
        prog.textContent = '';
        out.innerHTML = '<div class="alert danger result-block"><strong>Erreur MySQL' + (e.from ? ' (lignes ' + fmtNum(e.from) + ' à ' + fmtNum(e.to) + ' du fichier)' : '') + ' :</strong>\n' + h(e.message) +
          '\n\n' + fmtNum(done) + ' ligne(s) ont été importées avant l\'erreur. Corrige le fichier ou les associations, puis relance (« Sauter la ligne » évite les doublons).</div>';
      }
      btn.disabled = false;
    }

    $('#cv-pick', view).onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.csv,.txt,.tsv';
      input.onchange = () => { if (input.files[0]) { file = input.files[0]; $('#cv-enc', view).value = 'utf-8'; load(true); } };
      input.click();
    };
    $('#cv-sep', view).onchange = () => file && parse(true);
    $('#cv-head', view).onchange = () => file && parse(true);
    $('#cv-enc', view).onchange = () => file && load(false);

    // glisser-déposer : dropfile.js appelle view.csvFile(fichier)
    // (pas d'écouteur sur #view : cet élément sert à tous les onglets)
    view.csvFile = f => { file = f; $('#cv-enc', view).value = 'utf-8'; load(true); };
    if (state.pendingCsv) { const f = state.pendingCsv; state.pendingCsv = null; view.csvFile(f); }
  };

  // Dans l'onglet « Importer » d'une base : on indique où importer un CSV
  const origImport = VIEWS['import'];
  VIEWS['import'] = async view => {
    await origImport(view);
    if (!state.db || state.table || state.tab !== 'import') return;
    view.insertAdjacentHTML('beforeend', '<div class="alert info" style="margin-top:12px">📊 Un fichier <b>CSV</b> ou Excel ? Ouvre la table qui doit le recevoir, puis son onglet <b>📥 Import CSV</b>.</div>');
  };
})();
