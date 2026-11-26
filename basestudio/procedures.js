// =====================================================================
//  BaseStudio - onglet « Procédures » d'une base
//  Procédures stockées (CREATE PROCEDURE) et fonctions (CREATE FUNCTION) :
//  - la liste : voir le code, ▶ exécuter (on demande les paramètres),
//    modifier, supprimer
//  - un formulaire pour en créer : nom, paramètres (IN / OUT / INOUT),
//    type de retour pour une fonction, et le code entre BEGIN et END
//  Le SQL généré s'affiche en direct, c'est exactement ce qui est exécuté.
//  Ce fichier est chargé après app.js et triggers.js (SqlBlock).
// =====================================================================
(function () {
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.db, 'triggers', ['routines', '🧩 Procédures']);

  const { innerBody, block } = window.SqlBlock;
  const PTYPES = ['INT', 'BIGINT', 'TINYINT', 'DECIMAL(10,2)', 'FLOAT', 'DOUBLE', 'BOOLEAN', 'VARCHAR(50)', 'VARCHAR(255)',
    'CHAR(1)', 'TEXT', 'DATE', 'DATETIME', 'TIME', 'YEAR', 'JSON'];
  const ACCESS = [['', 'par défaut (CONTAINS SQL)'], ['READS SQL DATA', 'READS SQL DATA · lit des tables'],
    ['MODIFIES SQL DATA', 'MODIFIES SQL DATA · modifie des tables'], ['NO SQL', 'NO SQL · aucun accès aux tables']];
  const sqlStr = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";

  function createSql(f) {
    const isF = f.kind === 'FUNCTION';
    const params = f.params.filter(p => p.name.trim()).map(p =>
      (isF ? '' : p.mode + ' ') + q(p.name.trim()) + ' ' + (p.type.trim() || 'INT')).join(', ');
    let sql = 'CREATE ' + f.kind + ' ' + q(f.name || 'ma_' + (isF ? 'fonction' : 'procedure')) + '(' + params + ')';
    if (isF) sql += '\nRETURNS ' + (f.returns.trim() || 'INT') + '\n' + (f.deterministic ? 'DETERMINISTIC' : 'NOT DETERMINISTIC');
    if (f.access) sql += '\n' + f.access;
    if (f.comment.trim()) sql += '\nCOMMENT ' + sqlStr(f.comment.trim());
    return sql + '\n' + block(f.body);
  }

  // Modèles prêts, adaptés à la table d'aide et aux paramètres
  function templates(f, table, cols) {
    const t = q(table || 'ma_table');
    const pk = (cols.find(c => c.key === 'PRI') || cols[0] || { name: 'id' }).name;
    const others = cols.filter(c => c.key !== 'PRI' && !/auto_increment/i.test(c.extra || '')).slice(0, 2);
    const ins = others.length ? others : [{ name: 'colonne1' }, { name: 'colonne2' }];
    const num = (cols.find(c => /int|dec|float|double/i.test(c.type) && c.key !== 'PRI') || { name: 'quantite' }).name;
    const pIn = f.params.filter(p => p.name.trim() && (f.kind === 'FUNCTION' || p.mode !== 'OUT')).map(p => p.name.trim());
    const pOut = f.params.filter(p => p.name.trim() && f.kind !== 'FUNCTION' && p.mode !== 'IN').map(p => p.name.trim());
    const a = pIn[0] || 'p_id';
    if (f.kind === 'FUNCTION') return [
      ['🔢 Compter des lignes', 'DECLARE v_nb INT DEFAULT 0;\nSELECT COUNT(*) INTO v_nb FROM ' + t + ' WHERE ' + q(pk) + ' = ' + a + ';\nRETURN v_nb;'],
      ['🧮 Calcul', 'RETURN ' + a + ' * 1.2;'],
      ['🔀 IF / ELSE', 'IF ' + a + ' > 0 THEN\n    RETURN \'positif\';\nELSE\n    RETURN \'négatif ou zéro\';\nEND IF;'],
      ['📦 Lire une valeur', 'DECLARE v_resultat ' + (f.returns.trim() || 'INT') + ';\nSELECT ' + q(num) + ' INTO v_resultat FROM ' + t + ' WHERE ' + q(pk) + ' = ' + a + ';\nRETURN v_resultat;']
    ];
    return [
      ['🔎 SELECT', 'SELECT *\nFROM ' + t + '\nWHERE ' + q(pk) + ' = ' + a + ';'],
      ['➕ INSERT', 'INSERT INTO ' + t + ' (' + ins.map(c => q(c.name)).join(', ') + ')\nVALUES (' + ins.map((c, i) => pIn[i] || "'valeur'").join(', ') + ');'],
      ['✏ UPDATE', 'UPDATE ' + t + '\nSET ' + q(ins[0].name) + ' = ' + (pIn[1] || "'valeur'") + '\nWHERE ' + q(pk) + ' = ' + a + ';'],
      ['🗑 DELETE', 'DELETE FROM ' + t + '\nWHERE ' + q(pk) + ' = ' + a + ';'],
      ['📤 Remplir un OUT', 'SELECT COUNT(*) INTO ' + (pOut[0] || 'p_total') + '\nFROM ' + t + ';'],
      ['📦 Variable', 'DECLARE v_total INT DEFAULT 0;\nSET v_total = v_total + 1;'],
      ['🔀 IF / ELSE', 'IF ' + a + ' IS NULL THEN\n    SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT = \'Paramètre obligatoire\';\nELSE\n    SELECT ' + a + ';\nEND IF;'],
      ['🔁 Boucle WHILE', 'DECLARE i INT DEFAULT 1;\nWHILE i <= 10 DO\n    -- ton code ici\n    SET i = i + 1;\nEND WHILE;'],
      ['🔒 Transaction', 'START TRANSACTION;\n    UPDATE ' + t + ' SET ' + q(num) + ' = ' + q(num) + ' - 1 WHERE ' + q(pk) + ' = ' + a + ';\nCOMMIT;']
    ];
  }

  async function loadRoutines(db) {
    const list = await rows(
      'SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION, IS_DETERMINISTIC, SQL_DATA_ACCESS, ROUTINE_COMMENT ' +
      'FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE DESC, ROUTINE_NAME', [db]);
    const params = await rows(
      'SELECT SPECIFIC_NAME, ROUTINE_TYPE, PARAMETER_MODE, PARAMETER_NAME, DTD_IDENTIFIER FROM information_schema.PARAMETERS ' +
      'WHERE SPECIFIC_SCHEMA = ? AND ORDINAL_POSITION > 0 ORDER BY SPECIFIC_NAME, ORDINAL_POSITION', [db]);
    return list.map(r => ({
      name: r[0], kind: r[1], returns: r[2] || '', body: r[3] || '', deterministic: r[4] === 'YES',
      access: r[5] === 'CONTAINS SQL' ? '' : r[5] || '', comment: r[6] || '',
      params: params.filter(p => p[0] === r[0] && p[1] === r[1]).map(p => ({ mode: p[2] || 'IN', name: p[3], type: p[4] }))
    }));
  }
  const showCreate = async (db, r) => (await rows('SHOW CREATE ' + r.kind + ' ' + q(r.name), [], db))[0][2];
  const signature = r => r.name + '(' + r.params.map(p => (r.kind === 'PROCEDURE' ? p.mode + ' ' : '') + p.name + ' ' + p.type).join(', ') + ')' +
    (r.kind === 'FUNCTION' ? ' → ' + r.returns : '');

  // ---------- ▶ Exécuter : demande les paramètres, lance CALL / SELECT ----------
  function runModal(db, r) {
    const ins = r.params.filter(p => r.kind === 'FUNCTION' || p.mode !== 'OUT');
    const varName = p => '@' + p.name.replace(/\W/g, '_');
    modal('<h3>▶ ' + h(r.name) + '</h3>' +
      (ins.length ? '<p class="muted small">Laisse une case vide pour envoyer <code>NULL</code>.</p>' +
        ins.map((p, i) => '<label class="field"><span>' + (r.kind === 'PROCEDURE' ? '<span class="badge grey">' + p.mode + '</span> ' : '') +
          h(p.name) + ' <em class="muted">' + h(p.type) + '</em></span><input data-p="' + i + '" spellcheck="false"></label>').join('')
        : '<p class="muted">Pas de paramètre à remplir.</p>') +
      '<div class="sql-preview" id="rn-sql"></div><div id="rn-out"></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-x>Fermer</button><button class="btn primary" data-ok>▶ Exécuter</button></div>',
      (back, close) => {
        const values = () => $$('[data-p]', back).map(i => i.value === '' ? null : i.value);
        const build = () => {
          const v = values(); let k = 0;
          if (r.kind === 'FUNCTION') return { sql: 'SELECT ' + q(r.name) + '(' + ins.map(() => '?').join(', ') + ') AS ' + q('résultat') + ';', params: v };
          // IN -> ? dans le CALL ; OUT -> variable @nom lue après ; INOUT -> SET @nom = ? avant le CALL
          const pre = [], post = [], args = [], setVals = [], callVals = [];
          r.params.forEach(p => {
            if (p.mode === 'IN') { args.push('?'); callVals.push(v[k++]); return; }
            if (p.mode === 'INOUT') { pre.push('SET ' + varName(p) + ' = ?;'); setVals.push(v[k++]); }
            args.push(varName(p)); post.push(varName(p) + ' AS ' + q(p.name));
          });
          return {
            sql: pre.join('\n') + (pre.length ? '\n' : '') + 'CALL ' + q(r.name) + '(' + args.join(', ') + ');' + (post.length ? '\nSELECT ' + post.join(', ') + ';' : ''),
            params: setVals.concat(callVals)
          };
        };
        const upd = () => { const b = build(); $('#rn-sql', back).innerHTML = highlight(preview(b.sql, b.params)); };
        $$('[data-p]', back).forEach(i => i.oninput = upd); upd();
        const exec = async () => {
          const b = build(), out = $('#rn-out', back);
          out.innerHTML = '<div class="muted">⏳ Exécution…</div>';
          try {
            const data = await run(b.sql, b.params, db);
            const res = data.results.filter(x => x.type === 'rows');
            const aff = data.results.filter(x => x.type === 'info').reduce((s, x) => s + x.affectedRows, 0);
            out.innerHTML = res.map(x => gridHtml(x, { max: 200 })).join('') +
              '<div class="alert success">✔ Exécuté en ' + data.time + ' ms' + (aff && !res.length ? ' · ' + fmtNum(aff) + ' ligne(s) modifiée(s)' : '') + '</div>';
          } catch (e) { out.innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>'; }
        };
        $('[data-ok]', back).onclick = exec;
        $$('[data-p]', back).forEach(i => i.onkeydown = e => { if (e.key === 'Enter') exec(); });
        $('[data-x]', back).onclick = close;
      });
  }

  VIEWS['db:routines'] = async view => {
    const db = state.db;
    if (!state.tables[db]) await loadTables(db);
    const tables = (state.tables[db] || []).map(t => t.name);
    const list = await loadRoutines(db);
    if (state.db !== db || state.tab !== 'routines') return;
    const nbP = list.filter(r => r.kind === 'PROCEDURE').length, nbF = list.length - nbP;

    view.innerHTML =
      '<div class="card"><div class="card-head"><h3>Procédures et fonctions de la base <span class="badge grey">' + nbP + ' procédure' + (nbP > 1 ? 's' : '') +
      '</span> <span class="badge grey">' + nbF + ' fonction' + (nbF > 1 ? 's' : '') + '</span></h3></div>' +
      (list.length ? '<div class="trg-list">' + list.map((r, i) =>
        '<div class="trg-item">' +
        '<div class="trg-main"><div class="trg-name">' + (r.kind === 'FUNCTION' ? 'ƒ ' : '🧩 ') + h(r.name) +
        ' <span class="badge' + (r.kind === 'FUNCTION' ? '' : ' grey') + '">' + r.kind + '</span></div>' +
        '<code class="trg-code" title="' + h(signature(r)) + '">' + h(signature(r)) + '</code>' +
        (r.comment ? '<span class="muted small">' + h(r.comment) + '</span>' : '') + '</div>' +
        '<div class="trg-actions"><button class="btn small primary" data-run="' + i + '">▶ Exécuter</button>' +
        '<button class="btn small" data-see="' + i + '">Voir le code</button>' +
        '<button class="btn small" data-edit="' + i + '">Modifier</button>' +
        '<button class="btn small danger" data-del="' + i + '">Supprimer</button></div></div>').join('') + '</div>'
        : '<p class="muted">Aucune procédure ni fonction pour l\'instant. Crée la première avec le formulaire ci-dessous 👇</p>') +
      '</div>' +

      '<div class="card" id="pr-form"><div class="card-head"><h3 id="pr-title">Nouvelle procédure</h3>' +
      '<button class="btn ghost small" id="pr-cancel" hidden>Annuler la modification</button></div>' +
      '<details class="trg-help"><summary>💡 Procédure ou fonction ?</summary><ul>' +
      '<li>Une <b>procédure</b> regroupe plusieurs requêtes sous un nom. On la lance avec <code>CALL ma_procedure(…)</code>. ' +
      'Elle peut renvoyer des lignes (un <code>SELECT</code>) et remplir des paramètres <code>OUT</code>.</li>' +
      '<li><code>IN</code> = valeur donnée à la procédure · <code>OUT</code> = valeur rendue par la procédure · <code>INOUT</code> = les deux.</li>' +
      '<li>Une <b>fonction</b> calcule et renvoie <b>une seule valeur</b> avec <code>RETURN</code>. On l\'utilise dans une requête : <code>SELECT ma_fonction(…)</code>.</li>' +
      '<li><code>DECLARE</code> (variables locales) doit être écrit au tout début, avant les autres instructions.</li></ul></details>' +
      '<div class="form-grid trg-grid">' +
      '<div class="field"><span>Type</span><div class="seg" id="pr-kind"><button data-v="PROCEDURE">🧩 Procédure</button><button data-v="FUNCTION">ƒ Fonction</button></div></div>' +
      '<label class="field"><span>Nom</span><input id="pr-name" spellcheck="false" placeholder="ma_procedure"></label>' +
      '<label class="field" id="pr-returns-f"><span>Type renvoyé (RETURNS)</span><input id="pr-returns" list="pr-types" spellcheck="false"></label>' +
      '</div>' +
      '<div class="field"><span>Paramètres</span><table class="col-table"><thead><tr><th class="pr-mode-col">Sens</th><th>Nom</th><th>Type</th><th></th></tr></thead><tbody id="pr-params"></tbody></table>' +
      '<div style="margin-top:6px"><button class="btn small" id="pr-add">＋ Ajouter un paramètre</button></div></div>' +
      '<datalist id="pr-types">' + PTYPES.map(t => '<option value="' + t + '">').join('') + '</datalist>' +
      '<div class="form-grid trg-grid">' +
      '<label class="field"><span>Accès aux données <em class="muted">(facultatif)</em></span><select id="pr-access">' + ACCESS.map(a => '<option value="' + a[0] + '">' + a[1] + '</option>').join('') + '</select></label>' +
      '<label class="check" id="pr-det-f" style="align-self:center"><input type="checkbox" id="pr-det"> <span>DETERMINISTIC <em class="muted">(mêmes paramètres = même résultat)</em></span></label>' +
      '<label class="field"><span>Commentaire <em class="muted">(facultatif)</em></span><input id="pr-comment"></label>' +
      '</div>' +
      '<div class="field"><span>Aide pour les modèles : table</span><div class="field-row"><select id="pr-helper" style="max-width:260px">' +
      (tables.length ? tables.map(t => '<option>' + h(t) + '</option>').join('') : '<option value="">(aucune table)</option>') + '</select></div></div>' +
      '<div class="field"><span>Modèles prêts (cliquer pour ajouter)</span><div class="snippets" id="pr-tpl"></div></div>' +
      '<div class="field"><span>À insérer (cliquer)</span><div class="trg-cols" id="pr-chips"></div></div>' +
      '<div class="field"><span>Ce que fait la procédure <em class="muted">(le code entre BEGIN et END, une instruction par ligne terminée par ;)</em></span><div id="pr-editor"></div></div>' +
      '<div id="pr-warn"></div>' +
      '<div class="field"><span>SQL qui sera exécuté</span><div class="sql-preview" id="pr-sql"></div></div>' +
      '<div class="editor-bar"><div class="left"><span class="muted small">Ctrl+Entrée dans l\'éditeur = créer</span></div><div class="right">' +
      '<button class="btn" id="pr-to-sql">Ouvrir dans l\'éditeur SQL</button>' +
      '<button class="btn primary" id="pr-ok">🧩 Créer la procédure</button></div></div></div>';

    // ---------- le formulaire ----------
    const f = { kind: 'PROCEDURE', name: '', params: [{ mode: 'IN', name: 'p_id', type: 'INT' }], returns: 'INT', deterministic: false, access: '', comment: '', body: '' };
    let editing = null, ready = false, helperCols = [];
    const colsCache = {};
    const word = () => f.kind === 'FUNCTION' ? 'la fonction' : 'la procédure';

    const drawParams = () => {
      $('#pr-params', view).innerHTML = f.params.map((p, i) => '<tr data-i="' + i + '">' +
        '<td class="pr-mode-col"><select data-f="mode">' + ['IN', 'OUT', 'INOUT'].map(m => '<option' + (m === p.mode ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></td>' +
        '<td><input data-f="name" value="' + h(p.name) + '" placeholder="p_nom" spellcheck="false"></td>' +
        '<td><input data-f="type" value="' + h(p.type) + '" list="pr-types" spellcheck="false" style="width:170px"></td>' +
        '<td><button class="icon-btn" data-rm="' + i + '" title="Retirer">✕</button></td></tr>').join('') ||
        '<tr><td colspan="4" class="muted small">Aucun paramètre.</td></tr>';
    };
    const update = () => {
      if (!ready) return;
      const isF = f.kind === 'FUNCTION';
      $$('#pr-kind button', view).forEach(b => b.classList.toggle('active', b.dataset.v === f.kind));
      $('#pr-returns-f', view).hidden = !isF;
      $('#pr-det-f', view).hidden = !isF;
      $$('.pr-mode-col', view).forEach(el => el.hidden = isF);
      $('#pr-sql', view).innerHTML = highlight(createSql(f) + ';');
      const warns = [], body = f.body;
      if (isF && !/\bRETURN\b/i.test(body)) warns.push('Une fonction doit renvoyer une valeur avec <code>RETURN …;</code>');
      if (!isF && /\bRETURN\b/i.test(body)) warns.push('<code>RETURN</code> n\'est pas permis dans une procédure : utilise un paramètre <code>OUT</code> ou un <code>SELECT</code>.');
      const names = f.params.map(p => p.name.trim()).filter(Boolean);
      if (new Set(names.map(n => n.toLowerCase())).size !== names.length) warns.push('Deux paramètres ont le même nom.');
      const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'));
      const firstOther = lines.findIndex(l => !/^DECLARE\b/i.test(l));
      if (firstOther >= 0 && lines.slice(firstOther).some(l => /^DECLARE\b/i.test(l)) && !/^BEGIN\b/i.test(body.trim()))
        warns.push('Les <code>DECLARE</code> doivent être au tout début du code, avant les autres instructions.');
      $('#pr-warn', view).innerHTML = warns.map(w => '<div class="alert danger">⚠ ' + w + '</div>').join('');
    };
    const drawHelpers = async () => {
      const t = $('#pr-helper', view).value;
      if (t && !colsCache[t]) { try { colsCache[t] = await tableColumns(db, t); } catch (e) { colsCache[t] = []; } }
      helperCols = colsCache[t] || [];
      const tpl = templates(f, t, helperCols);
      $('#pr-tpl', view).innerHTML = tpl.map((x, i) => '<button class="btn small" data-tpl="' + i + '" title="' + h(x[1]) + '">' + h(x[0]) + '</button>').join('');
      $$('[data-tpl]', view).forEach(b => b.onclick = () => append(tpl[b.dataset.tpl][1]));
      const chips = (label, items) => items.length ? '<div class="trg-col-row"><span class="badge grey">' + label + '</span>' +
        items.map(x => '<button class="chip-btn" data-ins="' + h(x[0]) + '" title="' + h(x[1] || '') + '">' + h(x[2] || x[0]) + '</button>').join('') + '</div>' : '';
      $('#pr-chips', view).innerHTML =
        chips('Paramètres', f.params.filter(p => p.name.trim()).map(p => [p.name.trim(), p.type])) +
        chips('Tables', tables.map(x => [q(x), '', x])) +
        chips(t ? 'Colonnes de ' + t : 'Colonnes', helperCols.map(c => [q(c.name), c.type, c.name]));
      $$('[data-ins]', view).forEach(b => b.onclick = () => editor.insert(b.dataset.ins));
    };
    const append = code => {
      const cur = editor.get();
      editor.set(cur.trim() ? cur.replace(/\s+$/, '') + '\n' + code : code);
    };

    const exec = async () => {
      f.name = $('#pr-name', view).value.trim();
      if (!f.name) return toast('Donne un nom à ' + word(), 'error');
      const sql = createSql(f);
      try {
        if (editing) {
          // on remplace : suppression puis création ; si la création échoue, on remet l'ancienne
          const old = await showCreate(db, editing);
          await run('DROP ' + editing.kind + ' ' + q(editing.name), [], db);
          try { await run(sql, [], db); }
          catch (e) { await run(old, [], db).catch(() => {}); throw e; }
          toast((f.kind === 'FUNCTION' ? 'Fonction' : 'Procédure') + ' « ' + f.name + ' » modifiée', 'success');
        } else {
          await run(sql, [], db);
          toast((f.kind === 'FUNCTION' ? 'Fonction' : 'Procédure') + ' « ' + f.name + ' » créée', 'success');
        }
        render();
      } catch (e) {
        toast(e.message, 'error');
        $('#pr-warn', view).innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>';
      }
    };

    const editor = createEditor($('#pr-editor', view), '', exec, v => { f.body = v; update(); });
    const setKind = k => {
      f.kind = k;
      $('#pr-title', view).textContent = editing ? 'Modifier « ' + editing.name + ' »' : k === 'FUNCTION' ? 'Nouvelle fonction' : 'Nouvelle procédure';
      $('#pr-ok', view).textContent = editing ? '💾 Enregistrer les modifications' : k === 'FUNCTION' ? 'ƒ Créer la fonction' : '🧩 Créer la procédure';
      $('#pr-name', view).placeholder = k === 'FUNCTION' ? 'ma_fonction' : 'ma_procedure';
      update(); drawHelpers();
    };
    $('#pr-kind', view).onclick = e => { const b = e.target.closest('[data-v]'); if (b) setKind(b.dataset.v); };
    $('#pr-name', view).oninput = e => { f.name = e.target.value.trim(); update(); };
    $('#pr-returns', view).oninput = e => { f.returns = e.target.value; update(); };
    $('#pr-det', view).onchange = e => { f.deterministic = e.target.checked; update(); };
    $('#pr-access', view).onchange = e => { f.access = e.target.value; update(); };
    $('#pr-comment', view).oninput = e => { f.comment = e.target.value; update(); };
    $('#pr-helper', view).onchange = drawHelpers;
    const tbody = $('#pr-params', view);
    tbody.addEventListener('input', e => {
      const tr = e.target.closest('tr[data-i]'), k = e.target.dataset.f;
      if (!tr || !k) return;
      f.params[tr.dataset.i][k] = e.target.value;
      update(); if (k === 'name') drawHelpers();
    });
    tbody.addEventListener('click', e => {
      if (e.target.dataset.rm === undefined) return;
      f.params.splice(Number(e.target.dataset.rm), 1); drawParams(); update(); drawHelpers();
    });
    $('#pr-add', view).onclick = () => {
      f.params.push({ mode: 'IN', name: '', type: 'INT' }); drawParams(); update();
      $$('#pr-params tr:last-child input', view)[0].focus();
    };
    $('#pr-ok', view).onclick = exec;
    $('#pr-cancel', view).onclick = () => render();
    $('#pr-to-sql', view).onclick = () => {
      f.name = $('#pr-name', view).value.trim();
      state.sqlText[sqlKey()] = 'DELIMITER //\n\n' + (editing ? 'DROP ' + editing.kind + ' IF EXISTS ' + q(editing.name) + ' //\n\n' : '') + createSql(f) + ' //\n\nDELIMITER ;';
      state.tab = 'sql'; render();
    };

    // ---------- actions sur la liste ----------
    $$('[data-run]', view).forEach(b => b.onclick = () => runModal(db, list[b.dataset.run]));
    $$('[data-see]', view).forEach(b => b.onclick = async () => {
      try {
        const r = list[b.dataset.see];
        const code = (await showCreate(db, r)).replace(/\sDEFINER=`[^`]*`@`[^`]*`/, '');
        modal('<h3>' + (r.kind === 'FUNCTION' ? 'ƒ ' : '🧩 ') + h(r.name) + '</h3><div class="sql-preview">' + highlight(code) + '</div>' +
          '<div class="modal-actions"><button class="btn" data-copy>Copier</button><button class="btn primary" data-x>Fermer</button></div>',
          (back, close) => {
            $('[data-x]', back).onclick = close;
            $('[data-copy]', back).onclick = () => { navigator.clipboard.writeText(code + ';'); toast('Copié !', 'success'); };
          });
      } catch (e) { toast(e.message, 'error'); }
    });
    $$('[data-del]', view).forEach(b => b.onclick = () => {
      const r = list[b.dataset.del];
      confirmAndRun({ title: 'Supprimer ' + (r.kind === 'FUNCTION' ? 'la fonction' : 'la procédure') + ' « ' + r.name + ' » ?',
        text: 'Son code sera perdu. Les données des tables ne sont pas touchées.', okText: 'Supprimer', danger: true, done: 'Supprimée' },
        'DROP ' + r.kind + ' ' + q(r.name) + ';', db, () => render());
    });
    $$('[data-edit]', view).forEach(b => b.onclick = () => {
      const r = list[b.dataset.edit];
      editing = { name: r.name, kind: r.kind };
      Object.assign(f, { name: r.name, params: r.params.map(p => Object.assign({}, p)), returns: r.returns || 'INT',
        deterministic: r.deterministic, access: r.access, comment: r.comment });
      $('#pr-name', view).value = r.name;
      $('#pr-returns', view).value = f.returns;
      $('#pr-det', view).checked = f.deterministic;
      $('#pr-access', view).value = f.access;
      $('#pr-comment', view).value = f.comment;
      $('#pr-cancel', view).hidden = false;
      drawParams();
      editor.set(innerBody(r.body));
      setKind(r.kind);
      $('#pr-form', view).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#pr-returns', view).value = f.returns;
    drawParams();
    ready = true;
    setKind('PROCEDURE');
  };
})();
