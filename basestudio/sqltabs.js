// =====================================================================
//  BaseStudio - onglets et favoris de l'éditeur SQL
//  - plusieurs requêtes ouvertes en même temps, dans des onglets
//    (par endroit : serveur, chaque base, chaque table), gardés même
//    après avoir fermé BaseStudio ; double-clic pour renommer
//  - ⭐ favoris : on enregistre une requête avec un nom, on la retrouve
//    dans la colonne de droite et dans Ctrl+K
// =====================================================================
(function () {
  const TKEY = 'bs.sqlTabs', FKEY = 'bs.favorites';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const all = load(TKEY, {});
  const persist = () => { try { localStorage.setItem(TKEY, JSON.stringify(all)); } catch (e) {} };
  const favs = () => load(FKEY, []);
  const saveFavs = list => localStorage.setItem(FKEY, JSON.stringify(list));
  const keyOf = (db, table) => table ? 't:' + db + '.' + table : db ? 'db:' + db : 'server';
  const autoName = sql => (sql.replace(/\s+/g, ' ').trim().slice(0, 40) || 'Requête');

  // range le texte de l'éditeur dans l'onglet actif
  function sync(key) {
    const T = all[key];
    if (T && state.sqlText[key] !== undefined) { T.list[T.cur].text = state.sqlText[key]; persist(); }
  }

  // ouvre une requête dans un nouvel onglet (favoris, constructeur de requêtes…)
  function open(db, table, name, text) {
    const key = keyOf(db, table);
    if (state.sqlText[key] !== undefined) sync(key);
    const T = all[key] || (all[key] = { list: [], cur: 0 });
    const empty = T.list.findIndex(t => !t.text.trim());
    if (empty >= 0) { T.list[empty] = { name, text }; T.cur = empty; }
    else { T.list.push({ name, text }); T.cur = T.list.length - 1; }
    state.sqlText[key] = text;
    persist();
    go(db || null, table || null, 'sql');
  }

  const orig = VIEWS['sql'];
  VIEWS['sql'] = async view => {
    const key = sqlKey();
    let T = all[key];
    if (T) state.sqlText[key] = T.list[T.cur].text;
    await orig(view);
    if (!T) { T = all[key] = { list: [{ name: 'Requête 1', text: state.sqlText[key] || '' }], cur: 0 }; persist(); }

    const ta = $('#sql-editor textarea', view);
    const setText = sql => { ta.value = sql; ta.dispatchEvent(new Event('input')); ta.focus(); };
    let timer;
    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => sync(key), 400); });
    $('.sql-split', view).addEventListener('click', () => setTimeout(() => sync(key), 0));   // extraits, historique…

    // ---------- barre d'onglets ----------
    const bar = document.createElement('div');
    bar.className = 'sqt-bar';
    const drawBar = () => {
      bar.innerHTML = T.list.map((t, i) => '<div class="sqt-tab' + (i === T.cur ? ' active' : '') + '" data-t="' + i + '" title="Double-clic pour renommer">' +
        '<span>' + h(t.name) + '</span>' + (T.list.length > 1 ? '<button class="sqt-x" data-close="' + i + '" title="Fermer l\'onglet">✕</button>' : '') + '</div>').join('') +
        '<button class="sqt-add" title="Nouvel onglet">＋</button>';
    };
    drawBar();
    const editorBox = $('#sql-editor', view);
    editorBox.parentElement.insertBefore(bar, $('.snippets', view) || editorBox);
    const switchTo = i => { sync(key); T.cur = i; state.sqlText[key] = T.list[i].text; persist(); VIEWS['sql'](view); };
    bar.onclick = e => {
      const x = e.target.closest('[data-close]');
      if (x) {
        e.stopPropagation();
        const i = Number(x.dataset.close);
        sync(key);
        const close = () => { T.list.splice(i, 1); if (T.cur >= i && T.cur > 0) T.cur--; state.sqlText[key] = T.list[T.cur].text; persist(); VIEWS['sql'](view); };
        if (T.list[i].text.trim() && !favs().some(f => f.sql === T.list[i].text))
          confirmBox({ title: 'Fermer « ' + T.list[i].name + ' » ?', text: 'La requête de cet onglet sera perdue (elle n\'est pas dans tes favoris).', okText: 'Fermer' }).then(ok => ok && close());
        else close();
        return;
      }
      if (e.target.closest('.sqt-add')) {
        sync(key);
        let n = T.list.length + 1; while (T.list.some(t => t.name === 'Requête ' + n)) n++;
        T.list.push({ name: 'Requête ' + n, text: '' }); switchTo(T.list.length - 1);
        return;
      }
      const t = e.target.closest('[data-t]');
      if (t && Number(t.dataset.t) !== T.cur) switchTo(Number(t.dataset.t));
    };
    bar.ondblclick = e => {
      const t = e.target.closest('[data-t]');
      if (!t) return;
      const i = Number(t.dataset.t), span = $('span', t);
      span.innerHTML = '<input value="' + h(T.list[i].name) + '" maxlength="40">';
      const inp = $('input', span); inp.focus(); inp.select();
      const done = ok => { if (ok && inp.value.trim()) T.list[i].name = inp.value.trim(); persist(); drawBar(); };
      inp.onkeydown = ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
      inp.onclick = ev => ev.stopPropagation();
    };

    // ---------- favoris ----------
    const star = document.createElement('button');
    star.className = 'btn small'; star.textContent = '⭐ Favori'; star.title = 'Enregistrer cette requête dans les favoris';
    $('#sql-clear', view).before(star);
    star.onclick = () => {
      const sql = ta.value.trim();
      if (!sql) return toast('Écris d\'abord une requête', 'error');
      const tabName = T.list[T.cur].name;
      modal('<h3>⭐ Ajouter aux favoris</h3><label class="field"><span>Nom du favori</span><input id="fv-name" maxlength="60" value="' + h(/^Requête \d+$/.test(tabName) ? autoName(sql) : tabName) + '"></label>' +
        '<label class="check small"><input type="checkbox" id="fv-db"' + (state.db ? ' checked' : ' disabled') + '> ' + (state.db ? 'L\'ouvrir dans la base « ' + h(state.db) + ' »' : 'Requête du serveur (aucune base)') + '</label>' +
        '<div class="sql-preview">' + highlight(sql.slice(0, 600)) + '</div>' +
        '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button><button class="btn primary" data-ok>⭐ Enregistrer</button></div>', (back, close) => {
        $('[data-x]', back).onclick = close;
        const ok = () => {
          const name = $('#fv-name', back).value.trim() || autoName(sql);
          const list = favs().filter(f => f.name !== name);
          list.unshift({ name, sql, db: $('#fv-db', back).checked ? state.db : null, table: $('#fv-db', back).checked ? state.table : null });
          saveFavs(list.slice(0, 200));
          T.list[T.cur].name = name.slice(0, 40); persist(); drawBar();
          close(); drawFavs(); toast('Ajouté aux favoris', 'success');
        };
        $('[data-ok]', back).onclick = ok;
        $('#fv-name', back).onkeydown = e => { if (e.key === 'Enter') ok(); };
      });
    };

    const side = $('#sql-history', view).closest('.card');
    const card = document.createElement('div');
    card.className = 'card';
    side.before(card);
    function drawFavs() {
      const list = favs();
      card.innerHTML = '<div class="card-head"><h3>⭐ Favoris</h3></div>' + (list.length > 6 ? '<input id="fv-filter" placeholder="Filtrer…" style="width:100%;margin-bottom:8px">' : '') +
        '<div class="history" id="fv-list"></div>';
      const draw = f => {
        const fl = (f || '').toLowerCase();
        $('#fv-list', card).innerHTML = list.length ? list.map((x, i) => (!fl || (x.name + ' ' + x.sql).toLowerCase().includes(fl)) ?
          '<div class="history-item fv-item" data-f="' + i + '" title="' + h(x.sql) + '"><strong>' + h(x.name) + '</strong>' +
          (x.db ? '<span class="muted small"> · ' + h(x.db) + '</span>' : '') + '<button class="sqt-x" data-fdel="' + i + '" title="Retirer des favoris">✕</button></div>' : '').join('')
          : '<p class="muted small">Clique sur « ⭐ Favori » pour garder une requête ici.</p>';
      };
      draw();
      const filter = $('#fv-filter', card); if (filter) filter.oninput = () => draw(filter.value);
      $('#fv-list', card).onclick = e => {
        const d = e.target.closest('[data-fdel]');
        if (d) { e.stopPropagation(); const l = favs(); l.splice(Number(d.dataset.fdel), 1); saveFavs(l); drawFavs(); return; }
        const it = e.target.closest('[data-f]');
        if (!it) return;
        const fav = list[it.dataset.f];
        // dans l'onglet actif s'il est vide, sinon dans un nouvel onglet
        if (!ta.value.trim()) { T.list[T.cur].name = fav.name.slice(0, 40); setText(fav.sql); sync(key); drawBar(); }
        else { sync(key); T.list.push({ name: fav.name.slice(0, 40), text: fav.sql }); switchTo(T.list.length - 1); }
      };
    }
    drawFavs();
  };

  window.addEventListener('beforeunload', () => { if (state.tab === 'sql') sync(sqlKey()); });

  // Ctrl+K : les favoris
  PALETTE_HOOKS.push((items, match, typed) => {
    if (!typed) return;
    favs().forEach(f => {
      if (match(f.name, f.sql, 'favori ' + f.name)) items.push({ group: 'Favoris SQL', ico: '⭐', label: f.name, sub: f.db || 'serveur',
        run: () => open(f.db && state.dbs.includes(f.db) ? f.db : null, f.db && f.table ? f.table : null, f.name.slice(0, 40), f.sql) });
    });
  });

  window.SqlTabs = { open };
})();
