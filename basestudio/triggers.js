// =====================================================================
//  BaseStudio - onglet « Triggers » (d'une base ou d'une table)
//  - la liste des triggers existants : voir le code, modifier, supprimer
//  - un formulaire pour en créer un : table, BEFORE / AFTER,
//    INSERT / UPDATE / DELETE, et le code entre BEGIN et END
//    (avec des modèles prêts et les colonnes NEW. / OLD. à un clic).
//  Le SQL généré s'affiche en direct, c'est exactement ce qui est exécuté.
//  Ce fichier est chargé après app.js et utilise ses outils (rows, run...).
// =====================================================================
(function () {
  const add = (list, after, tab) => list.splice(list.findIndex(t => t[0] === after) + 1, 0, tab);
  add(TABS.db, 'create', ['triggers', '⚡ Triggers']);
  add(TABS.table, 'insert', ['triggers', '⚡ Triggers']);

  const TIMING = { BEFORE: 'avant', AFTER: 'après' };
  const EVENTS = { INSERT: 'ajout', UPDATE: 'modification', DELETE: 'suppression' };

  // le code entre BEGIN et END (pour le remettre dans l'éditeur)
  function innerBody(stmt) {
    const m = String(stmt).match(/^\s*BEGIN\b([\s\S]*)\bEND\s*;?\s*$/i);
    if (!m) return String(stmt).trim();
    return m[1].replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n')
      .map(l => l.replace(/^ {4}/, '')).join('\n');
  }
  // le code de l'éditeur -> bloc BEGIN ... END
  function block(body) {
    body = body.trim();
    if (/^BEGIN\b[\s\S]*\bEND\s*;?$/i.test(body)) return body.replace(/;\s*$/, '');
    if (!body) body = '-- ton code ici';
    else if (!/;\s*$/.test(body) && !/--[^\n]*$/.test(body)) body += ';';
    return 'BEGIN\n' + body.split('\n').map(l => '    ' + l).join('\n') + '\nEND';
  }
  window.SqlBlock = { innerBody, block };   // aussi utilisé par procedures.js

  function createSql(f) {
    return 'CREATE TRIGGER ' + q(f.name || 'mon_trigger') + '\n' + f.timing + ' ' + f.event + ' ON ' + q(f.table || 'ma_table') +
      '\nFOR EACH ROW\n' + block(f.body);
  }

  // Modèles prêts à l'emploi, adaptés à la table et au moment choisis
  function templates(f, cols) {
    // de préférence une colonne « normale » (pas la clé primaire auto-incrémentée)
    const pick = re => (cols.find(c => re.test(c.type) && c.key !== 'PRI') || cols.find(c => re.test(c.type)) || cols[0] || { name: 'colonne' }).name;
    const txt = pick(/char|text/i), num = pick(/int|dec|float|double/i);
    const pk = (cols.find(c => c.key === 'PRI') || cols[0] || { name: 'id' }).name;
    const dateCol = (cols.find(c => /modif|maj|update/i.test(c.name) && /date|time/i.test(c.type)) ||
      cols.find(c => /date|time/i.test(c.type)) || { name: 'modifie_le' }).name;
    const row = f.event === 'DELETE' ? 'OLD' : 'NEW';
    const list = [];
    if (f.timing === 'BEFORE' && f.event !== 'DELETE') {
      list.push(['🔠 Mettre en majuscules', 'SET NEW.' + q(txt) + ' = UPPER(NEW.' + q(txt) + ');']);
      list.push(['🧹 Enlever les espaces', 'SET NEW.' + q(txt) + ' = TRIM(NEW.' + q(txt) + ');']);
      list.push(['🕒 Date automatique', 'SET NEW.' + q(dateCol) + ' = NOW();']);
      list.push(['↩ Valeur par défaut si vide', 'IF NEW.' + q(txt) + ' IS NULL OR NEW.' + q(txt) + " = '' THEN\n    SET NEW." + q(txt) + " = 'inconnu';\nEND IF;"]);
    }
    if (f.timing === 'BEFORE') {
      list.push(['⛔ Refuser avec un message', 'IF ' + row + '.' + q(num) + ' < 0 THEN\n    SIGNAL SQLSTATE \'45000\'\n        SET MESSAGE_TEXT = \'' +
        (f.event === 'DELETE' ? 'Suppression interdite' : 'La valeur de ' + num + ' ne peut pas être négative') + '\';\nEND IF;']);
    }
    if (f.event === 'UPDATE') {
      list.push(['🔍 Seulement si la valeur change', 'IF NOT (NEW.' + q(num) + ' <=> OLD.' + q(num) + ') THEN\n    -- ton code ici\nEND IF;']);
    }
    if (f.timing === 'AFTER') {
      list.push(['📜 Garder un historique', 'INSERT INTO `historique` (`nom_table`, `action`, `id_ligne`, `date_action`)\nVALUES (\'' +
        String(f.table).replace(/'/g, "''") + '\', \'' + f.event + '\', ' + row + '.' + q(pk) + ', NOW());']);
      list.push(['🧮 Mettre à jour une autre table', 'UPDATE `autre_table`\nSET `total` = `total` ' + (f.event === 'DELETE' ? '-' : '+') + ' ' + row + '.' + q(num) +
        '\nWHERE `id` = ' + row + '.`autre_table_id`;']);
    }
    return list;
  }

  VIEWS['triggers'] = async view => {
    const db = state.db, onTable = state.table;
    if (onTable && tableType() === 'VIEW') {
      view.innerHTML = '<div class="alert info">Une vue ne peut pas avoir de trigger : seulement une vraie table.</div>';
      return;
    }
    if (!state.tables[db]) await loadTables(db);
    const tables = (state.tables[db] || []).filter(t => t.type !== 'VIEW').map(t => t.name);

    const list = await rows(
      'SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT, CREATED ' +
      'FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?' + (onTable ? ' AND EVENT_OBJECT_TABLE = ?' : '') +
      ' ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING DESC, EVENT_MANIPULATION, ACTION_ORDER', onTable ? [db, onTable] : [db]);
    if (state.db !== db || state.table !== onTable || state.tab !== 'triggers') return;

    if (!tables.length) {
      view.innerHTML = '<div class="empty"><span class="big-ico">⚡</span>Il faut d\'abord une table : un trigger se déclenche quand on ajoute, modifie ou supprime une ligne d\'une table.</div>';
      return;
    }

    // ---------- la page ----------
    view.innerHTML =
      '<div class="card"><div class="card-head"><h3>Triggers ' + (onTable ? 'de la table « ' + h(onTable) + ' »' : 'de la base') +
      ' <span class="badge grey">' + list.length + '</span></h3></div>' +
      (list.length ? '<div class="trg-list">' + list.map((t, i) =>
        '<div class="trg-item">' +
        '<div class="trg-main"><div class="trg-name">⚡ ' + h(t[0]) + '</div>' +
        '<div class="trg-when"><span class="badge">' + t[2] + ' ' + t[3] + '</span>' +
        (onTable ? '' : ' sur <b>' + h(t[1]) + '</b>') +
        ' <span class="muted small">· ' + TIMING[t[2]] + ' chaque ' + EVENTS[t[3]] + ' de ligne</span></div>' +
        '<code class="trg-code">' + h(String(t[4]).replace(/\s+/g, ' ').slice(0, 160)) + '</code></div>' +
        '<div class="trg-actions"><button class="btn small" data-see="' + i + '">Voir le code</button>' +
        '<button class="btn small" data-edit="' + i + '">Modifier</button>' +
        '<button class="btn small danger" data-del="' + i + '">Supprimer</button></div></div>').join('') + '</div>'
        : '<p class="muted">Aucun trigger pour l\'instant. Crée le premier avec le formulaire ci-dessous 👇</p>') +
      '</div>' +

      '<div class="card" id="trg-form"><div class="card-head"><h3 id="trg-title">Nouveau trigger</h3>' +
      '<button class="btn ghost small" id="trg-cancel" hidden>Annuler la modification</button></div>' +
      '<details class="trg-help"><summary>💡 C\'est quoi un trigger ?</summary><p>Un <b>trigger</b> (déclencheur) est du code SQL que MySQL lance <b>tout seul</b> quand on ajoute (<code>INSERT</code>), ' +
      'modifie (<code>UPDATE</code>) ou supprime (<code>DELETE</code>) une ligne de la table.</p><ul>' +
      '<li><code>BEFORE</code> (avant) : tu peux encore changer les valeurs avec <code>SET NEW.colonne = …</code>, ou bloquer l\'action avec <code>SIGNAL</code>.</li>' +
      '<li><code>AFTER</code> (après) : la ligne est déjà enregistrée. Idéal pour remplir un historique ou mettre à jour une autre table.</li>' +
      '<li><code>NEW.colonne</code> = la nouvelle valeur (INSERT, UPDATE) · <code>OLD.colonne</code> = l\'ancienne valeur (UPDATE, DELETE).</li></ul></details>' +
      '<div class="form-grid trg-grid">' +
      '<label class="field"><span>Table</span><select id="trg-table">' + tables.map(t => '<option' + (t === onTable ? ' selected' : '') + '>' + h(t) + '</option>').join('') + '</select></label>' +
      '<div class="field"><span>Moment</span><div class="seg" id="trg-timing"><button data-v="BEFORE">BEFORE · avant</button><button data-v="AFTER">AFTER · après</button></div></div>' +
      '<div class="field"><span>Événement</span><div class="seg" id="trg-event"><button data-v="INSERT">INSERT</button><button data-v="UPDATE">UPDATE</button><button data-v="DELETE">DELETE</button></div></div>' +
      '<label class="field"><span>Nom du trigger</span><input id="trg-name" spellcheck="false"></label>' +
      '</div>' +
      '<div class="field"><span>Modèles prêts (cliquer pour insérer)</span><div class="snippets" id="trg-tpl"></div></div>' +
      '<div class="field"><span>Colonnes (cliquer pour insérer)</span><div class="trg-cols" id="trg-cols"></div></div>' +
      '<div class="field"><span>Ce que fait le trigger <em class="muted">(le code entre BEGIN et END, une instruction par ligne terminée par ;)</em></span><div id="trg-editor"></div></div>' +
      '<div id="trg-warn"></div>' +
      '<div class="field"><span>SQL qui sera exécuté</span><div class="sql-preview" id="trg-sql"></div></div>' +
      '<div class="editor-bar"><div class="left"><span class="muted small">Ctrl+Entrée dans l\'éditeur = créer</span></div><div class="right">' +
      '<button class="btn" id="trg-to-sql">Ouvrir dans l\'éditeur SQL</button>' +
      '<button class="btn primary" id="trg-ok">⚡ Créer le trigger</button></div></div></div>';

    // ---------- le formulaire ----------
    const f = { table: onTable || tables[0], timing: 'BEFORE', event: 'INSERT', name: '', body: '' };
    let nameTouched = false, editing = null, cols = [], ready = false;
    const colsCache = {};

    const autoName = () => (f.timing === 'BEFORE' ? 'avant' : 'apres') + '_' + f.event.toLowerCase() + '_' + f.table;
    const update = () => {
      if (!ready) return;
      $('#trg-sql', view).innerHTML = highlight(createSql(f) + ';');
      $$('#trg-timing button', view).forEach(b => b.classList.toggle('active', b.dataset.v === f.timing));
      $$('#trg-event button', view).forEach(b => b.classList.toggle('active', b.dataset.v === f.event));
      // avertissements simples avant que MySQL ne refuse
      const warns = [];
      if (f.timing === 'AFTER' && /\bSET\s+NEW\./i.test(f.body)) warns.push('En <code>AFTER</code>, on ne peut plus changer <code>NEW</code> : passe en <code>BEFORE</code>.');
      if (f.event === 'INSERT' && /\bOLD\./i.test(f.body)) warns.push('En <code>INSERT</code>, <code>OLD</code> n\'existe pas (la ligne est nouvelle) : utilise <code>NEW</code>.');
      if (f.event === 'DELETE' && /\bNEW\./i.test(f.body)) warns.push('En <code>DELETE</code>, <code>NEW</code> n\'existe pas (la ligne disparaît) : utilise <code>OLD</code>.');
      if (new RegExp('\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+`?' + f.table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`?\\s', 'i').test(f.body))
        warns.push('Le trigger modifie sa propre table « ' + h(f.table) + ' » : MySQL l\'interdit. Pour changer la ligne en cours, utilise <code>BEFORE</code> + <code>SET NEW.colonne = …</code>.');
      $('#trg-warn', view).innerHTML = warns.map(w => '<div class="alert danger">⚠ ' + w + '</div>').join('');
    };
    const drawHelpers = async () => {
      if (!colsCache[f.table]) { try { colsCache[f.table] = await tableColumns(db, f.table); } catch (e) { colsCache[f.table] = []; } }
      cols = colsCache[f.table];
      const tpl = templates(f, cols);
      $('#trg-tpl', view).innerHTML = tpl.map((t, i) => '<button class="btn small" data-tpl="' + i + '" title="' + h(t[1]) + '">' + h(t[0]) + '</button>').join('');
      $$('[data-tpl]', view).forEach(b => b.onclick = () => insert(tpl[b.dataset.tpl][1]));
      const prefixes = f.event === 'INSERT' ? ['NEW'] : f.event === 'DELETE' ? ['OLD'] : ['NEW', 'OLD'];
      $('#trg-cols', view).innerHTML = prefixes.map(p => '<div class="trg-col-row"><span class="badge grey">' + p + '</span>' +
        cols.map(c => '<button class="chip-btn" data-col="' + h(p + '.' + q(c.name)) + '" title="' + h(c.type) + '">' + h(c.name) + '</button>').join('') + '</div>').join('');
      $$('[data-col]', view).forEach(b => b.onclick = () => editor.insert(b.dataset.col));
    };
    const insert = code => {
      const cur = editor.get();
      if (!cur.trim()) editor.set(code);
      else editor.set(cur.replace(/\s+$/, '') + '\n' + code);   // ajouté à la fin
    };
    const setField = (k, v) => {
      f[k] = v;
      if (!nameTouched && !editing) $('#trg-name', view).value = f.name = autoName();
      update(); drawHelpers();
    };

    const exec = async () => {
      f.name = $('#trg-name', view).value.trim();
      if (!f.name) return toast('Donne un nom au trigger', 'error');
      const sql = createSql(f);
      try {
        if (editing) {
          // on remplace : suppression puis création ; si la création échoue, on remet l'ancien
          const old = (await rows('SHOW CREATE TRIGGER ' + q(editing.name), [], db))[0][2];
          await run('DROP TRIGGER ' + q(editing.name), [], db);
          try { await run(sql, [], db); }
          catch (e) { await run(old, [], db).catch(() => {}); throw e; }
          toast('Trigger « ' + f.name + ' » modifié', 'success');
        } else {
          await run(sql, [], db);
          toast('Trigger « ' + f.name + ' » créé', 'success');
        }
        render();
      } catch (e) {
        toast(e.message, 'error');
        $('#trg-warn', view).innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>';
      }
    };

    const editor = createEditor($('#trg-editor', view), '', exec, v => { f.body = v; update(); });
    $('#trg-table', view).onchange = e => setField('table', e.target.value);
    $('#trg-timing', view).onclick = e => { const b = e.target.closest('[data-v]'); if (b) setField('timing', b.dataset.v); };
    $('#trg-event', view).onclick = e => { const b = e.target.closest('[data-v]'); if (b) setField('event', b.dataset.v); };
    $('#trg-name', view).oninput = e => { nameTouched = true; f.name = e.target.value.trim(); update(); };
    $('#trg-ok', view).onclick = exec;
    $('#trg-to-sql', view).onclick = () => {
      f.name = $('#trg-name', view).value.trim();
      state.sqlText[sqlKey()] = 'DELIMITER //\n\n' + (editing ? 'DROP TRIGGER IF EXISTS ' + q(editing.name) + ' //\n\n' : '') + createSql(f) + ' //\n\nDELIMITER ;';
      state.tab = 'sql'; render();
    };
    $('#trg-cancel', view).onclick = () => render();

    // ---------- actions sur la liste ----------
    const showCode = async i => {
      const t = list[i];
      const code = (await rows('SHOW CREATE TRIGGER ' + q(t[0]), [], db))[0][2].replace(/\sDEFINER=`[^`]*`@`[^`]*`/, '');
      modal('<h3>⚡ ' + h(t[0]) + '</h3><div class="sql-preview">' + highlight(code) + '</div>' +
        '<div class="modal-actions"><button class="btn" data-copy>Copier</button><button class="btn primary" data-x>Fermer</button></div>',
        (back, close) => {
          $('[data-x]', back).onclick = close;
          $('[data-copy]', back).onclick = () => { navigator.clipboard.writeText(code + ';'); toast('Copié !', 'success'); };
        });
    };
    view.querySelectorAll('[data-see]').forEach(b => b.onclick = () => showCode(b.dataset.see).catch(e => toast(e.message, 'error')));
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const t = list[b.dataset.del];
      confirmAndRun({ title: 'Supprimer le trigger « ' + t[0] + ' » ?', text: 'Il ne se déclenchera plus. Les données de la table ne sont pas touchées.', okText: 'Supprimer', danger: true, done: 'Trigger supprimé' },
        'DROP TRIGGER ' + q(t[0]) + ';', db, () => render());
    });
    view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const t = list[b.dataset.edit];
      editing = { name: t[0] };
      Object.assign(f, { table: t[1], timing: t[2], event: t[3], name: t[0] });
      $('#trg-table', view).value = t[1];
      $('#trg-name', view).value = t[0];
      editor.set(innerBody(t[4]));
      $('#trg-title', view).textContent = 'Modifier « ' + t[0] + ' »';
      $('#trg-ok', view).textContent = '💾 Enregistrer les modifications';
      $('#trg-cancel', view).hidden = false;
      update(); drawHelpers();
      $('#trg-form', view).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#trg-name', view).value = f.name = autoName();
    ready = true;
    update(); drawHelpers();
  };
})();
