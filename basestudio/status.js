// =====================================================================
//  BaseStudio - état du serveur (menu « 📊 État »)
//  Actualisé toutes les 3 secondes tant que l'écran est ouvert :
//  - depuis quand MySQL tourne, connexions, requêtes par seconde (courbe),
//    trafic, requêtes lentes, place prise par chaque base
//  - les requêtes en cours (SHOW PROCESSLIST) avec un bouton pour en arrêter une
//  - les réglages importants du serveur (variables)
// =====================================================================
(function () {
  TABS.server.push(['status', 'État du serveur']);
  SERVER_TITLES.status = ['📊', 'État du serveur'];
  const EVERY = 3000, POINTS = 40;
  const VARS = [
    ['version', 'Version'], ['port', 'Port'], ['datadir', 'Dossier des données'], ['max_connections', 'Connexions maximum'],
    ['max_allowed_packet', 'Taille max d\'une requête', 'size'], ['innodb_buffer_pool_size', 'Mémoire InnoDB', 'size'],
    ['character_set_server', 'Jeu de caractères'], ['collation_server', 'Interclassement'], ['default_storage_engine', 'Moteur par défaut'],
    ['time_zone', 'Fuseau horaire'], ['sql_mode', 'Mode SQL'], ['long_query_time', 'Requête « lente » au-delà de (s)'], ['wait_timeout', 'Déconnexion après inactivité (s)']
  ];

  const size = n => { n = Number(n); return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' Go' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : n >= 1024 ? (n / 1024).toFixed(1) + ' Ko' : n + ' o'; };
  const duration = s => {
    s = Number(s); const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return (d ? d + ' j ' : '') + (d || hh ? hh + ' h ' : '') + m + ' min';
  };
  let history = [], prev = null;   // points de la courbe, mesure précédente

  function spark(points) {
    if (points.length < 2) return '<div class="muted small" style="height:60px;display:flex;align-items:center">La courbe apparaît après quelques secondes…</div>';
    const max = Math.max(1, ...points), w = 300, hgt = 60, step = w / (POINTS - 1);
    const xy = points.map((v, i) => [(POINTS - points.length + i) * step, hgt - 4 - v / max * (hgt - 8)]);
    const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return '<svg class="st-spark" viewBox="0 0 ' + w + ' ' + hgt + '" preserveAspectRatio="none">' +
      '<path d="' + line + ' L' + xy[xy.length - 1][0] + ' ' + hgt + ' L' + xy[0][0] + ' ' + hgt + ' Z" class="area"/><path d="' + line + '" class="line"/></svg>';
  }

  VIEWS['server:status'] = async view => {
    history = []; prev = null;
    view.innerHTML = '<div id="st-tiles" class="st-tiles"></div>' +
      '<div class="card"><div class="card-head"><h3>⏱ Requêtes en cours</h3><label class="check small"><input type="checkbox" id="st-sleep"> montrer les connexions qui attendent</label></div><div id="st-proc"></div></div>' +
      '<div class="st-split"><div class="card"><div class="card-head"><h3>🗄️ Place prise par les bases</h3></div><div id="st-sizes"></div></div>' +
      '<div class="card"><div class="card-head"><h3>⚙ Réglages du serveur</h3></div><div id="st-vars"></div></div></div>';
    const alive = () => state.tab === 'status' && !state.db && document.body.contains(view.firstChild) && $('#st-tiles', view);

    // réglages et tailles : une seule fois
    rows('SHOW GLOBAL VARIABLES').then(v => {
      const m = Object.fromEntries(v);
      $('#st-vars', view).innerHTML = '<table class="grid st-kv"><tbody>' + VARS.filter(x => x[0] in m).map(([k, label, f]) =>
        '<tr><td>' + h(label) + '</td><td title="' + h(k) + '"><code>' + h(f === 'size' ? size(m[k]) : m[k] || '—').replace(/,/g, ',<wbr>') + '</code></td></tr>').join('') + '</tbody></table>';
    }).catch(e => { $('#st-vars', view).innerHTML = '<div class="alert danger">' + h(e.message) + '</div>'; });
    rows('SELECT TABLE_SCHEMA, COUNT(*), SUM(DATA_LENGTH), SUM(INDEX_LENGTH), SUM(TABLE_ROWS) FROM information_schema.TABLES GROUP BY TABLE_SCHEMA ORDER BY SUM(DATA_LENGTH + INDEX_LENGTH) DESC').then(r => {
      const max = Math.max(1, ...r.map(x => Number(x[2]) + Number(x[3])));
      $('#st-sizes', view).innerHTML = '<div class="st-bars">' + r.map(([db, n, d, i, rws]) => {
        const t = Number(d) + Number(i);
        return '<div class="st-bar" title="données ' + size(d) + ' · index ' + size(i) + '"><span class="name">' + h(db) + '</span>' +
          '<span class="track"><i style="width:' + Math.max(1, t / max * 100) + '%;background:' + dbColor(db) + '"></i></span>' +
          '<span class="muted small">' + size(t) + ' · ' + fmtNum(n) + ' tables · ~' + fmtNum(Number(rws) || 0) + ' lignes</span></div>';
      }).join('') + '</div>';
    }).catch(e => { $('#st-sizes', view).innerHTML = '<div class="alert danger">' + h(e.message) + '</div>'; });

    const sleep = $('#st-sleep', view);
    sleep.onchange = tick;

    async function tick() {
      if (!alive()) return;
      let data;
      try { data = await window.api.query('SHOW GLOBAL STATUS; SHOW FULL PROCESSLIST', [], null); }   // pas dans le journal : 1 fois toutes les 3 s
      catch (e) { return; }
      if (!alive()) return;
      if (!data.ok) { $('#st-tiles', view).innerHTML = '<div class="alert danger">' + h(data.error) + '</div>'; return; }
      const st = Object.fromEntries(data.data.results[0].rows), proc = data.data.results[1];
      const now = Date.now(), n = k => Number(st[k] || 0);
      let qps = null, inRate = null, outRate = null;
      if (prev) {
        const dt = (now - prev.at) / 1000;
        qps = Math.max(0, (n('Questions') - prev.q - 1) / dt);   // -1 : notre propre SHOW STATUS
        inRate = (n('Bytes_received') - prev.bin) / dt; outRate = (n('Bytes_sent') - prev.bout) / dt;
        history.push(qps); if (history.length > POINTS) history.shift();
      }
      prev = { at: now, q: n('Questions'), bin: n('Bytes_received'), bout: n('Bytes_sent') };
      const tile = (ico, label, value, sub) => '<div class="card st-tile"><span class="muted small">' + ico + ' ' + label + '</span><strong>' + value + '</strong>' + (sub ? '<span class="muted small">' + sub + '</span>' : '') + '</div>';
      const hits = n('Innodb_buffer_pool_read_requests'), miss = n('Innodb_buffer_pool_reads');
      $('#st-tiles', view).innerHTML =
        tile('🟢', 'En marche depuis', duration(n('Uptime')), state.server.version) +
        tile('🔌', 'Connexions', fmtNum(n('Threads_connected')), 'record depuis le démarrage : ' + fmtNum(n('Max_used_connections'))) +
        '<div class="card st-tile wide"><span class="muted small">⚡ Requêtes par seconde</span><strong>' + (qps === null ? '…' : qps.toFixed(1).replace('.', ',')) + '</strong>' + spark(history) + '</div>' +
        tile('📶', 'Trafic', inRate === null ? '…' : '↓ ' + size(Math.round(inRate)) + '/s', inRate === null ? '' : '↑ ' + size(Math.round(outRate)) + '/s · total ' + size(n('Bytes_sent'))) +
        tile('🐢', 'Requêtes lentes', fmtNum(n('Slow_queries')), fmtNum(n('Questions')) + ' requêtes en tout') +
        tile('🎯', 'Lectures en mémoire', hits ? (100 - miss / hits * 100).toFixed(1).replace('.', ',') + ' %' : '—', 'cache InnoDB');

      // requêtes en cours
      const cols = proc.columns, ci = k => cols.indexOf(k);
      const users = proc.rows.filter(r => r[ci('Command')] !== 'Daemon' && r[ci('User')] !== 'system user');   // pas les processus internes de MariaDB
      const list = users.filter(r => sleep.checked || (r[ci('Command')] !== 'Sleep' && !/PROCESSLIST/i.test(r[ci('Info')] || '')));
      $('#st-proc', view).innerHTML = list.length ? '<div class="grid-wrap"><table class="grid"><thead><tr><th>Id</th><th>Utilisateur</th><th>Base</th><th>Action</th><th>Depuis</th><th>État</th><th>Requête</th><th></th></tr></thead><tbody>' +
        list.map(r => '<tr><td class="num">' + h(r[ci('Id')]) + '</td><td>' + h(r[ci('User')]) + '<span class="muted small">@' + h(String(r[ci('Host')]).split(':')[0]) + '</span></td>' +
          '<td>' + h(r[ci('db')] || '—') + '</td><td>' + h(r[ci('Command')]) + '</td><td class="num">' + h(r[ci('Time')]) + ' s</td><td>' + h(r[ci('State')] || '') + '</td>' +
          '<td class="st-q" title="' + h(r[ci('Info')] || '') + '"><code>' + h(String(r[ci('Info')] || '').slice(0, 160)) + '</code></td>' +
          '<td>' + (/PROCESSLIST/i.test(r[ci('Info')] || '') ? '<span class="muted small">toi</span>' : '<button class="btn small danger" data-kill="' + h(r[ci('Id')]) + '">⏹ Arrêter</button>') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="muted">Aucune requête en cours : le serveur se repose 😴</p>';
      $$('[data-kill]', view).forEach(b => b.onclick = () => confirmAndRun({ title: 'Arrêter la connexion ' + b.dataset.kill + ' ?', text: 'Sa requête en cours est annulée et la connexion est fermée.', okText: '⏹ Arrêter', danger: true, done: 'Connexion arrêtée' },
        'KILL ' + Number(b.dataset.kill), null, tick));
    }
    await tick();
    const timer = setInterval(() => { if (!alive()) clearInterval(timer); else tick(); }, EVERY);
  };

  PALETTE_HOOKS.push((items, match) => {
    if (match('État du serveur status processlist connexions')) items.push({ group: 'Actions', ico: '📊', label: 'État du serveur', sub: 'connexions, requêtes en cours', run: () => go(null, null, 'status') });
  });
})();
