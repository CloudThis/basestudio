// =====================================================================
//  BaseStudio - formulaire d'édition d'une ligne (onglet « Parcourir »)
//  Le bouton ✏ au début de chaque ligne ouvre une fenêtre avec toutes
//  les colonnes l'une sous l'autre (grands champs pour les textes,
//  listes pour les ENUM et les clés étrangères, case NULL).
//  On peut enregistrer, dupliquer la ligne, la supprimer, et passer à la
//  ligne précédente / suivante de la page.
// =====================================================================
(function () {
  const browse = VIEWS['table:browse'];
  VIEWS['table:browse'] = async view => {
    await browse(view);
    const b = view.browse;
    if (!b || b.isView) return;
    $$('td.row-actions', view).forEach(td => {
      const ri = Number(td.parentElement.dataset.r);
      const btn = document.createElement('button');
      btn.className = 'icon-btn'; btn.title = 'Modifier la ligne (formulaire)'; btn.textContent = '✏';
      btn.onclick = () => edit(b, ri);
      td.prepend(btn);
    });
  };

  const isLong = t => /text|blob|json/i.test(t);
  const enumValues = t => { const m = /^(enum|set)\((.*)\)$/i.exec(t); return m ? [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map(x => x[1].replace(/''/g, "'")) : null; };

  async function edit(b, ri) {
    const { result, cols, pk, whereRow } = b;
    const db = state.db, table = state.table;
    const r = result.rows[ri];
    const fkc = window.Relations ? await Relations.fkColumns(db, table).catch(() => ({})) : {};
    const info = name => cols.find(c => c.name === name) || { type: '', nullable: true, extra: '' };

    const field = (name, i) => {
      const c = info(name), v = r[i], ev = enumValues(c.type);
      const val = v === null ? '' : String(v);
      let input;
      if (ev && /^enum/i.test(c.type)) input = '<select data-i="' + i + '">' + (ev.includes(val) ? '' : '<option value="' + h(val) + '">' + h(val) + '</option>') +
        ev.map(x => '<option' + (x === val ? ' selected' : '') + '>' + h(x) + '</option>').join('') + '</select>';
      else if (isLong(c.type) || val.length > 80 || val.includes('\n')) input = '<textarea data-i="' + i + '" rows="' + Math.min(8, Math.max(2, val.split('\n').length)) + '">' + h(val) + '</textarea>';
      else input = '<input data-i="' + i + '" value="' + h(val) + '">';
      return '<div class="insert-row"><div class="col-name">' + (pk.includes(name) ? '<span class="pk">🔑 </span>' : '') + h(name) +
        '<span class="col-type">' + h(c.type) + (fkc[name] ? ' · 🔗 ' + h(fkc[name].table) : '') + '</span></div>' +
        '<div class="rf-input" data-box="' + i + '">' + input + '</div>' +
        '<label class="check small">' + (c.nullable ? '<input type="checkbox" data-null="' + i + '"' + (v === null ? ' checked' : '') + '> NULL' : '') + '</label></div>';
    };

    modal('<h3>✏ Ligne ' + (ri + 1) + ' / ' + result.rows.length + ' de « ' + h(table) + ' »</h3>' +
      '<div class="rf-body">' + result.columns.map(field).join('') + '</div>' +
      '<div class="sql-preview" id="rf-sql"></div>' +
      '<div class="modal-actions" style="justify-content:space-between;flex-wrap:wrap">' +
      '<div style="display:flex;gap:6px"><button class="btn small" data-nav="-1"' + (ri ? '' : ' disabled') + ' title="Ligne précédente">‹</button>' +
      '<button class="btn small" data-nav="1"' + (ri < result.rows.length - 1 ? '' : ' disabled') + ' title="Ligne suivante">›</button>' +
      '<button class="btn small" data-dup title="Ajoute une copie de cette ligne (avec les modifications)">⧉ Dupliquer</button>' +
      '<button class="btn small danger" data-del>🗑 Supprimer</button></div>' +
      '<div style="display:flex;gap:6px"><button class="btn ghost" data-x>Annuler</button><button class="btn primary" data-ok>💾 Enregistrer</button></div></div>',
      (back, close) => {
        back.firstChild.style.maxWidth = '760px'; back.firstChild.style.width = '94vw';
        const value = i => {
          const n = $('[data-null="' + i + '"]', back);
          if (n && n.checked) return null;
          const el = $('[data-i="' + i + '"]', back);
          return el.value === '\u0000' ? null : el.value;
        };
        const same = (a, b) => (a === null ? null : String(a)) === (b === null ? null : String(b));
        const changes = () => result.columns.map((c, i) => [c, value(i), i]).filter(([c, v, i]) => !same(v, r[i]));
        const update = () => {
          const ch = changes(), w = whereRow(r);
          if (!ch.length) return null;
          return { sql: 'UPDATE ' + q(table) + ' SET ' + ch.map(x => q(x[0]) + ' = ?').join(', ') + ' WHERE ' + w.sql, vals: [...ch.map(x => x[1]), ...w.vals] };
        };
        const show = () => {
          const u = update();
          $('#rf-sql', back).innerHTML = u ? highlight(preview(u.sql, u.vals) + ';') : '<span class="muted">Rien n\'a changé pour l\'instant.</span>';
          $('[data-ok]', back).disabled = !u;
        };
        back.addEventListener('input', show); back.addEventListener('change', show);
        show();

        // clés étrangères : liste des valeurs possibles
        result.columns.forEach((name, i) => {
          const ref = fkc[name];
          if (!ref) return;
          Relations.options(db, ref.table, ref.col).then(o => {
            if (o.more || !back.isConnected) return;
            const cur = r[i] === null ? null : String(r[i]);
            $('[data-box="' + i + '"]', back).innerHTML = '<select data-i="' + i + '">' + (cur !== null && !o.list.some(x => String(x[0]) === cur) ? '<option value="' + h(cur) + '">' + h(cur) + ' (introuvable)</option>' : '') +
              (cur === null ? '<option value="\u0000" selected>—</option>' : '') +
              o.list.map(x => '<option value="' + h(x[0]) + '"' + (String(x[0]) === cur ? ' selected' : '') + '>' + h(Relations.optLabel(x)) + '</option>').join('') + '</select>';
          }).catch(() => {});
        });

        const after = async (msg, reopen) => {
          toast(msg, 'success'); close(); render();
          if (reopen !== undefined) {
            // on attend que « Parcourir » soit redessiné puis on rouvre la ligne
            let n = 0; const wait = () => { const v = $('#view'); if (v.browse && v.browse !== b) edit(v.browse, Math.min(reopen, v.browse.result.rows.length - 1)); else if (n++ < 40) setTimeout(wait, 100); };
            setTimeout(wait, 100);
          }
        };
        $('[data-x]', back).onclick = close;
        $$('[data-nav]', back).forEach(btn => btn.onclick = () => {
          const go2 = () => { close(); edit(b, ri + Number(btn.dataset.nav)); };
          if (!update()) return go2();
          confirmBox({ title: 'Changer de ligne sans enregistrer ?', text: 'Tes modifications de cette ligne seront perdues.', okText: 'Changer de ligne' }).then(ok => ok && go2());
        });
        $('[data-ok]', back).onclick = async () => {
          const u = update(); if (!u) return;
          const ch = Object.fromEntries(changes().map(x => [x[0], x[1]]));
          try { await run(u.sql, u.vals, db); if (window.Undo) Undo.afterUpdate(db, table, pk, result.columns, r, ch); after('Ligne enregistrée', ri); }
          catch (e) { toast(e.message, 'error'); }
        };
        $('[data-dup]', back).onclick = async () => {
          // copie sans la clé auto-incrémentée (MySQL en donne une nouvelle)
          const keep = result.columns.map((c, i) => [c, value(i)]).filter(([c]) => !/auto_increment/i.test(info(c).extra));
          const sql = 'INSERT INTO ' + q(table) + ' (' + keep.map(x => q(x[0])).join(', ') + ') VALUES (' + keep.map(() => '?').join(', ') + ')';
          try {
            const d = await run(sql, keep.map(x => x[1]), db);
            const auto = cols.find(c => /auto_increment/i.test(c.extra));
            if (window.Undo && auto) Undo.afterInsert(db, table, auto.name, d.results[0].insertId);
            after('Ligne dupliquée' + (d.results[0].insertId ? ' (id ' + d.results[0].insertId + ')' : '')); }
          catch (e) { toast(e.message, 'error'); }
        };
        $('[data-del]', back).onclick = async () => {
          const w = whereRow(r), sql = 'DELETE FROM ' + q(table) + ' WHERE ' + w.sql;
          if (!(await confirmBox({ title: 'Supprimer cette ligne ?', sql: preview(sql, w.vals) + ';', okText: 'Supprimer', danger: true }))) return;
          try { await run(sql, w.vals, db); if (window.Undo) Undo.afterDelete(db, table, cols, result.columns, r); after('Ligne supprimée'); }
          catch (e) { toast(e.message, 'error'); }
        };
      });
  }

  window.RowForm = { edit };
})();
