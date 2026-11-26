// =====================================================================
//  BaseStudio - utilisateurs MySQL et leurs droits (menu « 👤 Utilisateurs »)
//  - la liste des comptes (utilisateur@hôte) avec un résumé de leurs droits
//  - créer un compte : nom, d'où il peut se connecter, mot de passe,
//    et ses droits (sur toutes les bases ou une seule) avec des cases
//    à cocher et des préréglages (lecture seule, lecture + écriture…)
//  - modifier les droits, changer le mot de passe, supprimer
//  Les mots de passe ne sont jamais écrits dans le journal SQL (••••).
// =====================================================================
(function () {
  const GROUPS = [
    ['Données', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']],
    ['Structure', ['CREATE', 'ALTER', 'DROP', 'INDEX', 'REFERENCES', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE',
      'CREATE TEMPORARY TABLES', 'LOCK TABLES', 'EVENT']],
    ['Administration (toutes les bases seulement)', ['CREATE USER', 'SHOW DATABASES', 'PROCESS', 'RELOAD', 'FILE', 'SUPER', 'SHUTDOWN']]
  ];
  const ADMIN = GROUPS[2][1];
  const HELP = {
    SELECT: 'lire les lignes', INSERT: 'ajouter des lignes', UPDATE: 'modifier des lignes', DELETE: 'supprimer des lignes',
    CREATE: 'créer des tables / bases', ALTER: 'modifier la structure', DROP: 'supprimer des tables / bases', INDEX: 'créer des index',
    REFERENCES: 'créer des clés étrangères', 'CREATE VIEW': 'créer des vues', 'SHOW VIEW': 'voir le code des vues', TRIGGER: 'créer des triggers',
    'CREATE ROUTINE': 'créer des procédures', 'ALTER ROUTINE': 'modifier / supprimer des procédures', EXECUTE: 'lancer des procédures',
    'CREATE TEMPORARY TABLES': 'tables temporaires', 'LOCK TABLES': 'verrouiller des tables', EVENT: 'tâches planifiées',
    'CREATE USER': 'gérer les comptes', 'SHOW DATABASES': 'voir toutes les bases', PROCESS: 'voir les requêtes en cours', RELOAD: 'FLUSH…',
    FILE: 'lire / écrire des fichiers du serveur', SUPER: 'super-administrateur', SHUTDOWN: 'arrêter le serveur'
  };
  const PRESETS = [
    ['👀 Lecture seule', ['SELECT', 'SHOW VIEW']],
    ['✏ Lecture + écriture', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SHOW VIEW', 'EXECUTE']],
    ['🛠 Développeur', [...GROUPS[0][1], ...GROUPS[1][1]]],
    ['👑 Tous les droits', ['ALL PRIVILEGES']]
  ];
  const sqlStr = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  const account = (u, hst) => sqlStr(u) + '@' + sqlStr(hst);
  const scopeSql = s => s === '*' ? '*.*' : q(s) + '.*';

  // Exécute sans écrire le mot de passe dans le journal
  async function runMasked(sql, masked) {
    const res = await window.api.query(sql, [], null);
    addJournal(masked, [], res.ok, res.ok ? res.data.time + ' ms' : res.error);
    if (!res.ok) throw new Error(res.error);
    if (window.SqlComplete) SqlComplete.clear();
    return res.data;
  }
  const MASK = "'••••••••'";
  const genPassword = () => {
    const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_!';
    const r = crypto.getRandomValues(new Uint32Array(16));
    return Array.from(r, x => a[x % a.length]).join('');
  };

  // « GRANT SELECT, INSERT ON `biblio`.* TO … » -> { scope: 'biblio', privs: [...], grantOption }
  function parseGrants(lines) {
    const out = {};
    lines.forEach(l => {
      const m = l.match(/^GRANT (.+?) ON (.+?) TO .+?$/);
      if (!m || /^PROXY/.test(m[1])) return;
      const on = m[2].trim();
      const scope = on === '*.*' ? '*' : on.replace(/^`((?:[^`]|``)+)`\.\*$/, (x, d) => d.replace(/``/g, '`'));
      if (scope.includes('.') && scope !== on.replace(/`/g, '')) return;   // droits sur une seule table : affichés, pas modifiables ici
      const privs = m[1].split(/,\s*(?![^()]*\))/).map(p => p.trim()).filter(p => p && p !== 'USAGE');
      out[scope] = { privs, grantOption: / WITH GRANT OPTION/.test(l), line: l };
    });
    return out;
  }
  const hideHash = l => l.replace(/(IDENTIFIED (?:BY PASSWORD|VIA \w+ USING) )'[^']*'/g, "$1'•••'");

  // ---------- le formulaire des droits (création et modification) ----------
  function privForm(prefix, dbs, grants) {
    return '<div class="form-grid"><label class="field"><span>Sur quelles bases ?</span><select id="' + prefix + '-scope">' +
      (grants ? '' : '<option value="">Aucun droit pour l\'instant</option>') +
      '<option value="*">Toutes les bases (*.*)</option>' + dbs.map(d => '<option value="' + h(d) + '">la base « ' + h(d) + ' »</option>').join('') + '</select></label>' +
      '<div class="field"><span>Préréglages</span><div class="snippets" style="margin:0">' + PRESETS.map((p, i) => '<button class="btn small" data-preset="' + i + '">' + p[0] + '</button>').join('') +
      '<button class="btn small ghost" data-preset="none">Tout décocher</button></div></div></div>' +
      '<div id="' + prefix + '-privs" class="us-privs">' +
      '<label class="check us-all"><input type="checkbox" data-priv="ALL PRIVILEGES"> <b>ALL PRIVILEGES</b> <em class="muted small">tous les droits</em></label>' +
      GROUPS.map(([g, list]) => '<div class="us-group" data-group="' + h(g) + '"><div class="us-gtitle">' + h(g) + '</div>' +
        list.map(p => '<label class="check" title="' + h(HELP[p] || '') + '"><input type="checkbox" data-priv="' + p + '"> ' + p + ' <em class="muted small">' + h(HELP[p] || '') + '</em></label>').join('') + '</div>').join('') +
      '<label class="check"><input type="checkbox" id="' + prefix + '-go"> GRANT OPTION <em class="muted small">peut donner ses propres droits à d\'autres comptes</em></label></div>';
  }
  function wirePrivs(root, prefix, onChange) {
    const boxes = () => $$('[data-priv]', root);
    const scopeEl = $('#' + prefix + '-scope', root);
    const sync = () => {
      const scope = scopeEl.value, all = $('[data-priv="ALL PRIVILEGES"]', root).checked;
      $('#' + prefix + '-privs', root).classList.toggle('disabled', !scope);
      boxes().forEach(b => {
        const admin = ADMIN.includes(b.dataset.priv);
        b.disabled = !scope || (b.dataset.priv !== 'ALL PRIVILEGES' && all) || (admin && scope !== '*');
        if (admin && scope !== '*') b.checked = false;
      });
      onChange();
    };
    boxes().forEach(b => b.addEventListener('change', sync));
    $('#' + prefix + '-go', root).addEventListener('change', onChange);
    scopeEl.addEventListener('change', sync);
    $$('[data-preset]', root).forEach(b => b.onclick = () => {
      const p = b.dataset.preset === 'none' ? [] : PRESETS[b.dataset.preset][1];
      if (!scopeEl.value) scopeEl.value = '*';
      boxes().forEach(x => x.checked = p.includes(x.dataset.priv));
      sync();
    });
    const set = (privs, grantOption) => {
      boxes().forEach(x => x.checked = privs.includes(x.dataset.priv));
      $('#' + prefix + '-go', root).checked = !!grantOption;
      sync();
    };
    const get = () => {
      const all = $('[data-priv="ALL PRIVILEGES"]', root).checked;
      return { scope: scopeEl.value, privs: all ? ['ALL PRIVILEGES'] : boxes().filter(b => b.checked && !b.disabled).map(b => b.dataset.priv), grantOption: $('#' + prefix + '-go', root).checked };
    };
    sync();
    return { get, set, sync };
  }
  const grantSql = (p, acc) => p.scope && p.privs.length ? 'GRANT ' + p.privs.join(', ') + ' ON ' + scopeSql(p.scope) + ' TO ' + acc + (p.grantOption ? ' WITH GRANT OPTION' : '') + ';' : '';

  VIEWS['server:users'] = async view => {
    let users;
    try { users = await rows('SELECT User, Host FROM mysql.user ORDER BY User, Host'); }
    catch (e) {
      view.innerHTML = '<div class="alert danger">Impossible de lire la liste des comptes : ton utilisateur n\'a sans doute pas le droit de voir <code>mysql.user</code>.\n' + h(e.message) + '</div>';
      return;
    }
    const me = String(state.server.user || '');
    const grantsRes = users.length ? await run(users.map(u => 'SHOW GRANTS FOR ' + account(u[0], u[1])).join(';\n') + ';').catch(() => null) : null;
    const grants = users.map((u, i) => grantsRes && grantsRes.results[i] ? grantsRes.results[i].rows.map(r => r[0]) : []);
    const dbs = state.dbs.filter(d => !['information_schema', 'performance_schema'].includes(d));
    if (state.tab !== 'users' || state.db) return;

    const summary = lines => {
      const g = parseGrants(lines), keys = Object.keys(g).filter(k => g[k].privs.length || g[k].grantOption);
      if (!keys.length) return '<span class="muted small">aucun droit (peut seulement se connecter)</span>';
      return keys.map(k => '<div class="us-grant"><span class="badge' + (k === '*' ? '' : ' grey') + '">' + (k === '*' ? 'toutes les bases' : h(k)) + '</span> ' +
        h(g[k].privs.join(', ')) + (g[k].grantOption ? ' <span class="muted small">+ GRANT OPTION</span>' : '') + '</div>').join('');
    };
    view.innerHTML =
      '<div class="card"><div class="card-head"><h3>Comptes du serveur <span class="badge grey">' + users.length + '</span></h3></div>' +
      '<p class="muted small">Un compte = un <b>nom</b> + l\'endroit d\'où il se connecte (<b>hôte</b>) : <code>localhost</code> = ce PC, <code>%</code> = n\'importe où.</p>' +
      '<div class="trg-list">' + users.map((u, i) => {
        const isMe = me === u[0] + '@' + u[1];
        return '<div class="trg-item"><div class="trg-main"><div class="trg-name">👤 ' + h(u[0] || '(anonyme)') + '<span class="muted">@' + h(u[1]) + '</span>' +
          (isMe ? ' <span class="badge">c\'est toi</span>' : '') + (u[0] === 'pma' ? ' <span class="badge grey" title="Compte utilisé par phpMyAdmin">phpMyAdmin</span>' : '') + '</div>' +
          summary(grants[i]) + '</div>' +
          '<div class="trg-actions"><button class="btn small" data-rights="' + i + '">🔑 Droits</button><button class="btn small" data-pass="' + i + '">🔒 Mot de passe</button>' +
          '<button class="btn small" data-grants="' + i + '">Voir les GRANT</button>' +
          (isMe ? '' : '<button class="btn small danger" data-drop="' + i + '">Supprimer</button>') + '</div></div>';
      }).join('') + '</div></div>' +

      '<div class="card"><div class="card-head"><h3>＋ Nouveau compte</h3></div>' +
      '<div class="form-grid trg-grid">' +
      '<label class="field"><span>Nom d\'utilisateur</span><input id="nu-name" placeholder="eleve" spellcheck="false" autocomplete="off"></label>' +
      '<label class="field"><span>Se connecte depuis</span><select id="nu-host"><option value="localhost">ce PC seulement (localhost)</option>' +
      '<option value="%">n\'importe où (%)</option><option value="__other">une autre adresse…</option></select></label>' +
      '<label class="field" id="nu-host2-f" hidden><span>Adresse (IP ou nom)</span><input id="nu-host2" placeholder="192.168.1.%" spellcheck="false"></label>' +
      '<label class="field"><span>Mot de passe</span><div class="field-row" style="gap:6px"><input id="nu-pass" type="password" autocomplete="new-password" class="grow">' +
      '<button class="btn small" id="nu-show" title="Afficher">👁</button><button class="btn small" id="nu-gen" title="Créer un mot de passe solide">🎲</button></div></label></div>' +
      privForm('nu', dbs, false) +
      '<div id="nu-warn"></div><div class="field"><span>SQL qui sera exécuté <em class="muted">(le mot de passe est masqué)</em></span><div class="sql-preview" id="nu-sql"></div></div>' +
      '<div class="editor-bar"><div></div><button class="btn primary" id="nu-ok">👤 Créer le compte</button></div></div>';

    // ---------- création ----------
    const host = () => $('#nu-host', view).value === '__other' ? $('#nu-host2', view).value.trim() : $('#nu-host', view).value;
    const build = mask => {
      const acc = account($('#nu-name', view).value.trim() || 'nom', host() || 'localhost');
      const pass = $('#nu-pass', view).value;
      const s = 'CREATE USER ' + acc + (pass ? ' IDENTIFIED BY ' + (mask ? MASK : sqlStr(pass)) : '') + ';';
      const g = grantSql(privs.get(), acc);
      return s + (g ? '\n' + g : '');
    };
    let privs = null;
    const upd = () => {
      if (!privs) return;
      $('#nu-sql', view).innerHTML = highlight(build(true));
      const w = [], name = $('#nu-name', view).value.trim(), pass = $('#nu-pass', view).value;
      if (name && users.some(u => u[0] === name && u[1] === host())) w.push('Ce compte existe déjà.');
      if (!pass) w.push('Sans mot de passe, n\'importe qui sur ' + (host() === 'localhost' ? 'ce PC' : 'le réseau') + ' peut se connecter avec ce nom.');
      else if (pass.length < 8) w.push('Mot de passe court : 8 caractères minimum conseillés (🎲 en crée un solide).');
      if (host() === '%' && privs.get().privs.includes('ALL PRIVILEGES')) w.push('Tous les droits depuis n\'importe où : à éviter, surtout sur un serveur en ligne.');
      $('#nu-warn', view).innerHTML = w.map(x => '<div class="alert info">💡 ' + x + '</div>').join('');
    };
    privs = wirePrivs(view, 'nu', () => upd());
    ['#nu-name', '#nu-host2', '#nu-pass'].forEach(s => $(s, view).addEventListener('input', upd));
    $('#nu-host', view).onchange = () => { $('#nu-host2-f', view).hidden = $('#nu-host', view).value !== '__other'; upd(); };
    $('#nu-show', view).onclick = () => { const p = $('#nu-pass', view); p.type = p.type === 'password' ? 'text' : 'password'; };
    $('#nu-gen', view).onclick = () => { const p = $('#nu-pass', view); p.value = genPassword(); p.type = 'text'; upd(); toast('Mot de passe créé : note-le avant de valider', 'success'); };
    $('#nu-ok', view).onclick = async () => {
      if (!$('#nu-name', view).value.trim()) return toast('Donne un nom au compte', 'error');
      if (!host()) return toast('Indique d\'où le compte se connecte', 'error');
      try { await runMasked(build(false), build(true)); toast('Compte créé', 'success'); render(); }
      catch (e) { $('#nu-warn', view).innerHTML = '<div class="alert danger"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>'; }
    };
    upd();

    // ---------- actions sur un compte ----------
    $$('[data-grants]', view).forEach(b => b.onclick = () => {
      const u = users[b.dataset.grants], code = grants[b.dataset.grants].map(hideHash).join(';\n') + ';';
      modal('<h3>👤 ' + h(u[0]) + '@' + h(u[1]) + '</h3><div class="sql-preview">' + highlight(code) + '</div>' +
        '<div class="modal-actions"><button class="btn primary" data-x>Fermer</button></div>', (back, close) => { $('[data-x]', back).onclick = close; });
    });
    $$('[data-drop]', view).forEach(b => b.onclick = () => {
      const u = users[b.dataset.drop], acc = account(u[0], u[1]);
      const warn = u[0] === 'root' ? '<strong style="color:var(--danger)">⚠ C\'est un compte administrateur « root ». Vérifie qu\'il te reste un autre compte root pour te connecter !</strong><br>'
        : u[0] === 'pma' ? '<strong style="color:var(--danger)">⚠ phpMyAdmin utilise ce compte : certaines de ses fonctions ne marcheront plus.</strong><br>' : '';
      confirmAndRun({ title: 'Supprimer le compte « ' + u[0] + '@' + u[1] + ' » ?', text: warn + 'Il ne pourra plus se connecter. Les bases et les données ne sont pas touchées.', okText: 'Supprimer', danger: true, done: 'Compte supprimé' },
        'DROP USER ' + acc + ';', undefined, () => render());
    });
    $$('[data-pass]', view).forEach(b => b.onclick = () => {
      const u = users[b.dataset.pass], acc = account(u[0], u[1]), isMe = me === u[0] + '@' + u[1];
      modal('<h3>🔒 Mot de passe de « ' + h(u[0]) + '@' + h(u[1]) + ' »</h3>' +
        (u[0] === 'root' ? '<div class="alert danger">⚠ Avec XAMPP, phpMyAdmin se connecte en <code>root</code> sans mot de passe. Si tu en mets un, il faudra aussi le changer dans <code>C:\\xampp\\phpMyAdmin\\config.inc.php</code>.</div>' : '') +
        (isMe ? '<div class="alert info">C\'est le compte avec lequel BaseStudio est connecté : à la prochaine connexion, tape le nouveau mot de passe.</div>' : '') +
        '<label class="field"><span>Nouveau mot de passe <em class="muted">(vide = aucun mot de passe)</em></span><div class="field-row" style="gap:6px"><input id="pw-1" type="password" autocomplete="new-password" class="grow">' +
        '<button class="btn small" id="pw-gen" title="Créer un mot de passe solide">🎲</button></div></label>' +
        '<label class="field"><span>Encore une fois</span><input id="pw-2" type="password" autocomplete="new-password"></label>' +
        '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button><button class="btn primary" data-ok>Changer</button></div>',
        (back, close) => {
          $('[data-x]', back).onclick = close;
          $('#pw-gen', back).onclick = () => { const p = genPassword(); $('#pw-1', back).value = $('#pw-2', back).value = p; $('#pw-1', back).type = 'text'; };
          $('[data-ok]', back).onclick = async () => {
            const p1 = $('#pw-1', back).value;
            if (p1 !== $('#pw-2', back).value) return toast('Les deux mots de passe sont différents', 'error');
            try {
              await runMasked('ALTER USER ' + acc + ' IDENTIFIED BY ' + sqlStr(p1) + ';', 'ALTER USER ' + acc + ' IDENTIFIED BY ' + MASK + ';');
              close(); toast('Mot de passe changé', 'success');
            } catch (e) { toast(e.message, 'error'); }
          };
        });
    });
    $$('[data-rights]', view).forEach(b => b.onclick = () => {
      const i = b.dataset.rights, u = users[i], acc = account(u[0], u[1]);
      const g = parseGrants(grants[i]);
      const scopes = [...new Set([...Object.keys(g).filter(k => k !== '*'), ...dbs])];
      modal('<h3>🔑 Droits de « ' + h(u[0]) + '@' + h(u[1]) + ' »</h3>' +
        (me === u[0] + '@' + u[1] ? '<div class="alert danger">⚠ C\'est ton propre compte : si tu retires tes droits, BaseStudio ne pourra plus gérer le serveur.</div>' : '') +
        '<p class="muted small">Choisis une portée : les cases montrent les droits actuels sur cette portée. Enregistrer remplace les droits de cette portée seulement.</p>' +
        privForm('ed', scopes, true) + '<div class="sql-preview" id="ed-sql"></div>' +
        '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button><button class="btn primary" data-ok>💾 Enregistrer</button></div>',
        (back, close) => {
          back.querySelector('.modal').classList.add('wide');
          const sql = () => {
            const p = ed.get(), cur = g[p.scope], parts = [];
            if (cur && cur.privs.length) parts.push('REVOKE ALL PRIVILEGES ON ' + scopeSql(p.scope) + ' FROM ' + acc + ';');
            if (cur && cur.grantOption) parts.push('REVOKE GRANT OPTION ON ' + scopeSql(p.scope) + ' FROM ' + acc + ';');
            const gs = grantSql(p, acc); if (gs) parts.push(gs);
            return parts.join('\n') || '-- rien à changer';
          };
          let ed = null;
          ed = wirePrivs(back, 'ed', () => { if (ed) $('#ed-sql', back).innerHTML = highlight(sql()); });
          const load = () => { const cur = g[$('#ed-scope', back).value]; ed.set(cur ? cur.privs : [], cur && cur.grantOption); };
          $('#ed-scope', back).addEventListener('change', load);
          // on part de la portée où il a déjà des droits
          $('#ed-scope', back).value = g['*'] && g['*'].privs.length ? '*' : (Object.keys(g).find(k => k !== '*') || '*');
          load();
          $('[data-x]', back).onclick = close;
          $('[data-ok]', back).onclick = async () => {
            const s = sql(); if (s.startsWith('--')) return close();
            try { await run(s); close(); toast('Droits enregistrés', 'success'); render(); }
            catch (e) { toast(e.message, 'error'); }
          };
        });
    });
  };
})();
