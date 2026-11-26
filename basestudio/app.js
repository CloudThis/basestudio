// =====================================================================
//  BaseStudio - interface
//  Organisation du fichier :
//    1. Outils (petites fonctions utiles partout)
//    2. Connexion
//    3. Barre latérale (arbre des bases)
//    4. Navigation (onglets)
//    5. Les écrans : serveur, base, table, SQL...
// =====================================================================

// ---------------------------------------------------------------------
// 1. OUTILS
// ---------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Échappe le texte pour l'afficher sans risque dans le HTML
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Entoure un nom de table/colonne avec des accents graves : `nom`
const q = name => '`' + String(name).replace(/`/g, '``') + '`';

const SYSTEM_DBS = ['information_schema', 'mysql', 'performance_schema', 'sys', 'phpmyadmin'];
const COLLATIONS = ['utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_bin', 'utf8_general_ci', 'latin1_swedish_ci'];
const TYPES = ['INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BOOLEAN',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'ENUM', 'JSON', 'BLOB'];

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' o';
  const u = ['Ko', 'Mo', 'Go', 'To']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
const fmtNum = n => Number(n || 0).toLocaleString('fr-FR');

// Chaque base a sa propre couleur (calculée à partir de son nom)
function dbColor(name) {
  let x = 0;
  for (const c of String(name)) x = (x * 31 + c.charCodeAt(0)) % 360;
  return 'hsl(' + x + ' 72% 64%)';
}
const initial = name => h(String(name).charAt(0).toUpperCase() || '?');

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}
window.toast = toast;

// État de l'appli (ce qui est sélectionné, etc.)
const state = {
  server: null,          // infos du serveur connecté
  dbs: [],               // liste des bases
  tables: {},            // tables par base : { maBase: [{name, type}] }
  open: new Set(),       // bases dépliées dans l'arbre
  db: null,              // base sélectionnée
  table: null,           // table sélectionnée
  tab: 'home',           // onglet affiché
  filter: '',            // recherche dans l'arbre
  browse: { page: 0, size: 50, sort: null, dir: 'ASC', search: '' },
  sqlText: {}            // texte de l'éditeur SQL pour chaque endroit
};

// ---- Exécuter du SQL (passe par api.php) + écrire dans le journal ----
async function run(sql, params = [], db = undefined) {
  const res = await window.api.query(sql, params, db);
  addJournal(sql, params, res.ok, res.ok ? res.data.time + ' ms' : res.error);
  if (!res.ok) {
    // session expirée (ou ancienne session) : retour à l'écran de connexion
    if (res.code === 'NOT_CONNECTED' && state.server) { toast('Session expirée : reconnecte-toi', 'error'); disconnect(); }
    const err = new Error(res.error);
    err.sql = sql;
    throw err;
  }
  // la structure a changé : l'auto-complétion doit relire les tables et colonnes
  if (/\b(create|alter|drop|rename)\b/i.test(sql)) {
    if (window.SqlComplete) SqlComplete.clear();
    palObjectsAt = 0;   // Ctrl+K relira les triggers et procédures
  }
  return res.data; // { results: [...], time }
}
// Raccourci : renvoie directement les lignes du premier résultat
async function rows(sql, params, db) {
  const data = await run(sql, params, db);
  const r = data.results[0];
  return r && r.type === 'rows' ? r.rows : [];
}

// Remplace les "?" par les valeurs, juste pour l'affichage dans le journal
function preview(sql, params) {
  let i = 0;
  if (!params || !params.length) return sql;
  return sql.replace(/\?\?|\?/g, m => {
    const v = params[i++];
    if (m === '??') return q(v);
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return v;
    return "'" + String(v).replace(/'/g, "''") + "'";
  });
}

// ---- DELIMITER (comme dans phpMyAdmin) ----
// "DELIMITER" n'est pas du vrai SQL : c'est une commande des logiciels comme phpMyAdmin.
// On l'enlève, et on remplace le délimiteur choisi (// ou $$...) par un ";".
// Le serveur MySQL sait tout seul qu'un BEGIN ... END forme un seul bloc.
function convertDelimiters(sql) {
  if (!/^\s*DELIMITER\s+/im.test(sql)) return sql;
  let delim = ';';
  const out = [];
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (m) { delim = m[1]; continue; }           // ligne "DELIMITER //" : on change de délimiteur
    const t = line.replace(/\s+$/, '');
    if (delim !== ';' && t.endsWith(delim)) {
      out.push(t.slice(0, t.length - delim.length).replace(/\s+$/, '') + ';');  // "END //" -> "END;"
    } else out.push(line);
  }
  return out.join('\n');
}
window.convertDelimiters = convertDelimiters;

// ---- Journal SQL (en bas de l'écran) ----
const journal = [];
function addJournal(sql, params, ok, info) {
  journal.unshift({ sql: preview(sql, params), ok, info, time: new Date().toLocaleTimeString('fr-FR') });
  if (journal.length > 200) journal.pop();
  $('#journal-count').textContent = journal.length;
  $('#journal-list').innerHTML = journal.map((j, i) =>
    '<div class="j-item" data-j="' + i + '" title="' + h(j.info) + '">' +
    '<span class="j-time">' + j.time + '</span>' +
    '<span class="j-sql">' + h(j.sql.replace(/\s+/g, ' ')) + '</span>' +
    '<span class="' + (j.ok ? 'j-ok">✔ ' : 'j-err">✖ ') + h(String(j.info).slice(0, 60)) + '</span></div>').join('');
}

// ---- Fenêtres (modales) ----
function modal(html, onMount) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal">' + html + '</div>';
  $('#modal-root').appendChild(back);
  const close = () => back.remove();
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  if (onMount) onMount(back, close);
  const first = $('input, select, textarea, .btn.primary, .btn.danger', back);
  if (first) setTimeout(() => first.focus(), 30);
  return close;
}

// Demande une confirmation. Renvoie true si on clique sur OK.
function confirmBox({ title, text, sql, okText = 'Confirmer', danger = false }) {
  return new Promise(resolve => {
    modal(
      '<h3>' + h(title) + '</h3>' + (text ? '<p>' + text + '</p>' : '') +
      (sql ? '<div class="sql-preview">' + highlight(sql) + '</div>' : '') +
      '<div class="modal-actions"><button class="btn ghost" data-r="0">Annuler</button>' +
      '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-r="1">' + h(okText) + '</button></div>',
      (back, close) => {
        $$('[data-r]', back).forEach(b => b.onclick = () => { close(); resolve(b.dataset.r === '1'); });
      });
  });
}

// Exécute une action "dangereuse" après confirmation, avec le SQL affiché
async function confirmAndRun(opts, sql, db, after) {
  if (!(await confirmBox(Object.assign({ sql }, opts)))) return;
  try {
    await run(sql, [], db);
    toast(opts.done || 'C\'est fait !', 'success');
    if (after) await after();
  } catch (e) { toast(e.message, 'error'); }
}

// ---- Coloration du SQL ----
const KEYWORDS = ('SELECT FROM WHERE AND OR NOT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DATABASE SCHEMA DROP ALTER ADD COLUMN ' +
  'PRIMARY KEY FOREIGN REFERENCES UNIQUE INDEX ON JOIN LEFT RIGHT INNER OUTER CROSS AS ORDER BY GROUP HAVING LIMIT OFFSET ' +
  'DISTINCT NULL IS IN LIKE BETWEEN EXISTS CASE WHEN THEN ELSE END DEFAULT AUTO_INCREMENT ENGINE CHARSET CHARACTER COLLATE ' +
  'IF SHOW TABLES DATABASES COLUMNS DESCRIBE DESC ASC USE TRUNCATE RENAME TO VIEW UNION ALL CONSTRAINT CASCADE RESTRICT ' +
  'INT INTEGER BIGINT TINYINT SMALLINT MEDIUMINT DECIMAL FLOAT DOUBLE VARCHAR CHAR TEXT MEDIUMTEXT LONGTEXT DATE DATETIME TIMESTAMP ' +
  'TIME YEAR BOOLEAN BOOL ENUM JSON BLOB UNSIGNED COMMENT AFTER FIRST MODIFY CHANGE GRANT REVOKE PRIVILEGES USER IDENTIFIED ' +
  'BEGIN COMMIT ROLLBACK TRANSACTION PROCEDURE FUNCTION TRIGGER RETURNS CALL REPLACE IGNORE DUPLICATE TRUE FALSE CURRENT_TIMESTAMP ' +
  'EXPLAIN WITH RECURSIVE OVER PARTITION FULL STATUS VARIABLES PROCESSLIST INNODB MYISAM').split(' ');
const KW = new Set(KEYWORDS);
const TOKEN_RE = /(--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:\\.|''|[^'\\])*'?|"(?:\\.|""|[^"\\])*"?)|(`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()|([A-Za-z_][A-Za-z0-9_]*)/g;

function highlight(sql) {
  let out = '', last = 0, m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(sql))) {
    out += h(sql.slice(last, m.index));
    const t = h(m[0]);
    if (m[1]) out += '<span class="syn-c">' + t + '</span>';
    else if (m[2]) out += '<span class="syn-s">' + t + '</span>';
    else if (m[3]) out += '<span class="syn-i">' + t + '</span>';
    else if (m[4]) out += '<span class="syn-n">' + t + '</span>';
    else if (m[5]) out += KW.has(m[5].toUpperCase()) ? '<span class="syn-k">' + t + '</span>' : '<span class="syn-f">' + t + '</span>';
    else out += KW.has(m[6].toUpperCase()) ? '<span class="syn-k">' + t + '</span>' : t;
    last = TOKEN_RE.lastIndex;
  }
  return out + h(sql.slice(last));
}

// ---- Éditeur SQL avec couleurs et numéros de ligne ----
function createEditor(container, initial, onRun, onChange) {
  container.innerHTML =
    '<div class="editor"><div class="gutter">1</div><div class="code"><pre></pre>' +
    '<textarea spellcheck="false" wrap="off" placeholder="Écris ton SQL ici…"></textarea></div></div>';
  const ta = $('textarea', container), pre = $('pre', container), gutter = $('.gutter', container);
  const refresh = () => {
    pre.innerHTML = highlight(ta.value) + '\n';
    const n = ta.value.split('\n').length;
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    if (onChange) onChange(ta.value);
  };
  const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; };
  ta.addEventListener('input', refresh);
  ta.addEventListener('scroll', sync);
  // auto-complétion (complete.js) : branchée avant les autres touches pour garder Entrée / Tab
  if (window.SqlComplete) SqlComplete.attach(ta, refresh);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRun(); }
    if (e.key === 'Tab') { // la touche Tab insère des espaces au lieu de changer de champ
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('    ', s, ta.selectionEnd, 'end');
      refresh();
    }
  });
  ta.value = initial || '';
  refresh();
  return {
    get: () => ta.value,
    // si du texte est sélectionné, on n'exécute que la sélection
    getRunnable: () => ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value,
    set: v => { ta.value = v; refresh(); ta.focus(); },
    insert: v => { ta.setRangeText(v, ta.selectionStart, ta.selectionEnd, 'end'); refresh(); ta.focus(); },
    focus: () => ta.focus()
  };
}

// ---- Tableau de données ----
// result = { columns: [...], rows: [[...]] }
function gridHtml(result, opts = {}) {
  const max = opts.max || 1000;
  const shown = result.rows.slice(0, max);
  const head = (opts.actions ? '<th></th>' : '') + result.columns.map((c, i) => {
    let cls = opts.sortable ? 'sortable' : '';
    let arrow = '';
    if (opts.sort === c) arrow = '<span class="arrow">' + (opts.dir === 'DESC' ? '↓' : '↑') + '</span>';
    const pk = opts.pk && opts.pk.includes(c) ? '<span class="pk" title="Clé primaire">🔑 </span>' : '';
    return '<th class="' + cls + '" data-col="' + i + '">' + pk + h(c) + arrow + '</th>';
  }).join('');

  const body = shown.map((r, ri) => '<tr data-r="' + ri + '">' +
    (opts.actions ? '<td class="row-actions"><button class="icon-btn del" data-del="' + ri + '" title="Supprimer la ligne">🗑</button></td>' : '') +
    r.map((v, ci) => {
      if (v === null) return '<td class="null' + (opts.editable ? ' editable' : '') + '" data-c="' + ci + '">NULL</td>';
      const num = typeof v === 'number' || (/^-?\d+(\.\d+)?$/.test(v) && String(v).length < 20);
      return '<td class="' + (num ? 'num' : '') + (opts.editable ? ' editable' : '') + '" data-c="' + ci + '" title="' + h(String(v).slice(0, 500)) + '">' + h(String(v).slice(0, 200)) + '</td>';
    }).join('') + '</tr>').join('');

  return '<div class="grid-wrap' + (opts.tall ? ' tall' : '') + '"><table class="grid"><thead><tr>' + head + '</tr></thead><tbody>' +
    (body || '<tr><td colspan="' + (result.columns.length + 1) + '" class="muted" style="text-align:center">Aucune ligne</td></tr>') +
    '</tbody></table></div>' +
    (result.rows.length > max ? '<p class="muted small">Seules les ' + max + ' premières lignes sont affichées.</p>' : '');
}

function toCsv(result) {
  const cell = v => v === null ? '' : /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  return '\ufeff' + [result.columns, ...result.rows].map(r => r.map(cell).join(';')).join('\n');
}
async function saveText(name, content, ext) {
  const res = await window.api.saveFile(name, content, ext);
  if (res && res.ok && res.data) toast('Fichier enregistré : ' + res.data, 'success');
}

// ---------------------------------------------------------------------
// 2. CONNEXION
// ---------------------------------------------------------------------
// Serveurs mémorisés : serveur, port et utilisateur SEULEMENT, jamais le mot de passe.
// noPassword = ce serveur n'a pas de mot de passe (XAMPP) : connexion en un clic.
function savedServers() {
  let list;
  try { list = JSON.parse(localStorage.getItem('bs.servers')) || []; } catch (e) { list = []; }
  // les anciennes versions gardaient le mot de passe en clair : on l'efface tout de suite
  if (list.some(s => 'password' in s)) {
    list = list.map(s => ({ host: s.host, port: s.port, user: s.user, noPassword: s.noPassword ?? !s.password }));
    localStorage.setItem('bs.servers', JSON.stringify(list));
  }
  return list;
}
function renderSavedServers() {
  const list = savedServers();
  $('#saved-servers').innerHTML = list.length ? '<div class="saved-title">Serveurs enregistrés</div>' +
    list.map((s, i) => '<div class="saved-item" data-srv="' + i + '" title="' + (s.noPassword ? 'Connexion directe (pas de mot de passe)' : 'Mot de passe demandé') + '">' +
      '<span>' + (s.noPassword ? '🖥️' : '🔒') + ' <strong>' + h(s.user) + '</strong>@' + h(s.host) + ':' + h(s.port) + '</span>' +
      '<button class="icon-btn" data-srv-del="' + i + '" title="Oublier">✕</button></div>').join('') : '';
}
// remplit le formulaire avec un serveur mémorisé (sans mot de passe)
function fillLogin(s) {
  $('#lg-host').value = s.host; $('#lg-port').value = s.port; $('#lg-user').value = s.user;
  $('#lg-pass').value = '';
}

async function connect(cfg) {
  const btn = $('#lg-submit');
  btn.disabled = true; btn.textContent = 'Connexion…';
  $('#login-error').hidden = true;
  const res = await window.api.connect(cfg);
  btn.disabled = false; btn.textContent = 'Se connecter';

  if (!res.ok) {
    let msg = res.error;
    if (res.code === 'ECONNREFUSED') msg = 'Impossible de joindre le serveur. Vérifie que MySQL est bien démarré dans XAMPP (bouton « Start »).';
    if (res.code === 'ER_ACCESS_DENIED_ERROR') msg = 'Utilisateur ou mot de passe incorrect.';
    $('#login-error').textContent = msg;
    $('#login-error').hidden = false;
    return;
  }

  if ($('#lg-remember').checked) {
    const list = savedServers().filter(s => !(s.host === cfg.host && String(s.port) === String(cfg.port) && s.user === cfg.user));
    list.unshift({ host: cfg.host, port: cfg.port, user: cfg.user, noPassword: !cfg.password });   // jamais le mot de passe
    localStorage.setItem('bs.servers', JSON.stringify(list.slice(0, 8)));
  }
  $('#lg-pass').value = '';
  state.server = Object.assign({}, cfg, res.data);
  $('#server-chip').textContent = cfg.user + '@' + cfg.host + ' · ' + res.data.version;
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  await loadTree();
  go(null, null, 'home');
}

async function disconnect() {
  await window.api.disconnect();
  Object.assign(state, { server: null, dbs: [], tables: {}, db: null, table: null });
  state.open.clear();
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  renderSavedServers();
}

// ---------------------------------------------------------------------
// 3. LISTE DES BASES ET DES TABLES
// ---------------------------------------------------------------------
async function loadTree() {
  try {
    state.dbs = (await rows('SHOW DATABASES')).map(r => r[0]);
    // on recharge les tables déjà connues (et celles de la base ouverte)
    const known = new Set([...Object.keys(state.tables), state.db].filter(Boolean));
    state.tables = {};
    for (const db of known) if (state.dbs.includes(db)) await loadTables(db);
  } catch (e) { toast(e.message, 'error'); }
  renderTree();
}

async function loadTables(db) {
  const list = await rows('SHOW FULL TABLES FROM ' + q(db));
  state.tables[db] = list.map(r => ({ name: r[0], type: r[1] }));
}

// (il n'y a plus de barre latérale : les bases et tables servent à la recherche Ctrl+K)
function renderTree() {}

// ---------------------------------------------------------------------
// 4. NAVIGATION
// ---------------------------------------------------------------------
const TABS = {
  server: [['home', 'Bases de données'], ['sql', 'SQL'], ['import', 'Importer'], ['users', 'Utilisateurs']],
  db: [['tables', '▦ Tables'], ['sql', '⌨️ SQL'], ['create', '＋ Nouvelle table'], ['export', '⬇ Exporter'], ['import', '📥 Importer'], ['ops', '⚙ Opérations']],
  table: [['browse', '👀 Parcourir'], ['structure', '🧱 Structure'], ['sql', '⌨️ SQL'], ['insert', '＋ Insérer'], ['export', '⬇ Exporter'], ['ops', '⚙ Opérations']]
};
const level = () => state.table ? 'table' : state.db ? 'db' : 'server';
const tableType = () => ((state.tables[state.db] || []).find(t => t.name === state.table) || {}).type || 'BASE TABLE';

function go(db, table, tab) {
  const changed = db !== state.db || table !== state.table;
  state.db = db; state.table = table;
  if (changed) state.browse = { page: 0, size: state.browse.size, sort: null, dir: 'ASC', search: '' };
  state.tab = tab || TABS[level()][0][0];
  if (db && !state.tables[db]) loadTables(db).catch(() => {});
  render();
  $('#main').scrollTop = 0;
}

function render() {
  const lvl = level();
  // menu du haut
  $$('#topnav [data-nav]').forEach(b => b.classList.toggle('active', lvl === 'server' && b.dataset.nav === state.tab));

  // fil d'Ariane en "pastilles"
  let bc = '';
  if (lvl !== 'server') {
    bc = '<span class="chip" data-go="server">🖥️ Serveur</span><span class="sep">›</span>' +
      '<span class="chip' + (!state.table ? ' last' : '') + '" data-go="db" style="--c:' + dbColor(state.db) + '"><i class="dot"></i>' + h(state.db) + '</span>';
    if (state.table) bc += '<span class="sep">›</span><span class="chip last">' + (tableType() === 'VIEW' ? '👁 ' : '▦ ') + h(state.table) + '</span>';
  }
  $('#breadcrumb').innerHTML = bc;

  // grand titre
  const head = $('#page-head');
  head.style.setProperty('--c', state.db ? dbColor(state.db) : 'var(--accent)');
  let ico, title;
  if (lvl === 'server') {
    title = { home: 'Salut 👋', sql: 'Éditeur SQL', import: 'Importer un fichier SQL', users: 'Utilisateurs et droits' }[state.tab];
    ico = { home: '🗄️', sql: '⌨️', import: '📥', users: '👤' }[state.tab];
  } else if (lvl === 'db') { title = state.db; ico = initial(state.db); }
  else { title = state.table; ico = tableType() === 'VIEW' ? '👁' : '▦'; }
  $('#page-title').innerHTML = '<span class="title-ico">' + ico + '</span><span>' + h(title) + '</span>';
  $('#top-actions').innerHTML = '<button class="btn small" data-action="reload-view">⟳ Actualiser</button>';

  // onglets (pour une base ou une table)
  $('#tabs').hidden = lvl === 'server';
  $('#tabs').innerHTML = lvl === 'server' ? '' : TABS[lvl].map(([id, label]) =>
    '<button class="tab' + (state.tab === id ? ' active' : '') + '" data-tab="' + id + '">' + label + '</button>').join('');

  // contenu
  const view = $('#view');
  view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
  view.innerHTML = '<div class="empty"><span class="big-ico">⏳</span>Chargement…</div>';
  const fn = VIEWS[lvl + ':' + state.tab] || VIEWS[state.tab];
  Promise.resolve(fn(view)).catch(e => {
    view.innerHTML = '<div class="alert danger">' + h(e.message) + '</div>';
  });
}

// ---------------------------------------------------------------------
// 5. ÉCRANS
// ---------------------------------------------------------------------
const VIEWS = {};

// ======== SERVEUR : liste des bases ========
VIEWS['server:home'] = async view => {
  const list = await rows(
    'SELECT s.SCHEMA_NAME, s.DEFAULT_COLLATION_NAME, COUNT(t.TABLE_NAME), COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) ' +
    'FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME ' +
    'GROUP BY s.SCHEMA_NAME, s.DEFAULT_COLLATION_NAME ORDER BY s.SCHEMA_NAME');
  const total = list.reduce((a, r) => a + Number(r[3]), 0);
  const mine = list.filter(r => !SYSTEM_DBS.includes(r[0]));
  const sys = list.filter(r => SYSTEM_DBS.includes(r[0]));

  const tile = (r, small) =>
    '<div class="tile' + (small ? ' small' : '') + '" data-open-db="' + h(r[0]) + '" style="--c:' + dbColor(r[0]) + '" title="' + h(r[1]) + '">' +
    '<div class="tile-ico">' + initial(r[0]) + '</div>' +
    '<div class="tile-name">' + h(r[0]) + '</div>' +
    '<div class="tile-meta">' + r[2] + ' table' + (r[2] > 1 ? 's' : '') + ' · ' + fmtBytes(r[3]) + '</div>' +
    '<button class="icon-btn tile-del" data-drop-db="' + h(r[0]) + '" title="Supprimer la base">🗑</button></div>';

  view.innerHTML =
    '<div class="hello"><div><p class="muted">Voici tes bases : ' + mine.length + ' base' + (mine.length > 1 ? 's' : '') + ' perso · ' +
    fmtBytes(total) + ' au total · ' + h(state.server.version) + '</p></div>' +
    '<button class="btn primary" data-action="new-db">＋ Nouvelle base</button></div>' +
    '<div class="tiles">' + mine.map(r => tile(r)).join('') +
    '<div class="tile tile-new" data-action="new-db"><div class="tile-ico">＋</div><div class="tile-name">Nouvelle base</div><div class="tile-meta">CREATE DATABASE…</div></div></div>' +
    (sys.length ? '<details class="sys-dbs"><summary>⚙ Bases système (' + sys.length + ') : à ne pas modifier sauf si tu sais ce que tu fais</summary>' +
      '<div class="tiles">' + sys.map(r => tile(r, true)).join('') + '</div></details>' : '');

  $$('[data-open-db]', view).forEach(el => el.onclick = e => { if (!e.target.closest('[data-drop-db]')) go(el.dataset.openDb, null); });
  $$('[data-drop-db]', view).forEach(el => el.onclick = e => { e.stopPropagation(); dropDb(el.dataset.dropDb); });
};
function stat(label, value) {
  return '<div class="stat"><div class="label">' + h(label) + '</div><div class="value">' + value + '</div></div>';
}

// Fenêtre "Nouvelle base"
function newDbModal() {
  modal(
    '<h3>Nouvelle base de données</h3><p>Le SQL généré s\'affiche en dessous : c\'est exactement ce qui sera exécuté.</p>' +
    '<label class="field"><span>Nom de la base</span><input id="nd-name" placeholder="ma_base" spellcheck="false"></label>' +
    '<label class="field"><span>Interclassement</span><select id="nd-coll">' + COLLATIONS.map(c => '<option>' + c + '</option>').join('') + '</select></label>' +
    '<div class="sql-preview" id="nd-sql"></div>' +
    '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button>' +
    '<button class="btn" data-editor>Ouvrir dans l\'éditeur SQL</button><button class="btn primary" data-ok>Créer</button></div>',
    (back, close) => {
      const sql = () => {
        const name = $('#nd-name', back).value.trim() || 'ma_base';
        const coll = $('#nd-coll', back).value;
        return 'CREATE DATABASE ' + q(name) + ' CHARACTER SET ' + coll.split('_')[0] + ' COLLATE ' + coll + ';';
      };
      const upd = () => $('#nd-sql', back).innerHTML = highlight(sql());
      $('#nd-name', back).oninput = upd; $('#nd-coll', back).onchange = upd; upd();
      $('[data-x]', back).onclick = close;
      $('[data-editor]', back).onclick = () => { close(); state.sqlText['server'] = sql(); go(null, null, 'sql'); };
      const ok = async () => {
        const name = $('#nd-name', back).value.trim();
        if (!name) return toast('Donne un nom à la base', 'error');
        try {
          await run(sql());
          close(); toast('Base « ' + name + ' » créée', 'success');
          await loadTree(); go(name, null);
        } catch (e) { toast(e.message, 'error'); }
      };
      $('[data-ok]', back).onclick = ok;
      $('#nd-name', back).onkeydown = e => { if (e.key === 'Enter') ok(); };
    });
}

function dropDb(db) {
  const sys = SYSTEM_DBS.includes(db);
  confirmAndRun({
    title: 'Supprimer la base « ' + db + ' » ?',
    text: (sys ? '<strong style="color:var(--danger)">⚠ C\'est une base système, la supprimer peut casser ton serveur MySQL !</strong><br>' : '') +
      'Toutes ses tables et données seront perdues définitivement.',
    okText: 'Supprimer', danger: true, done: 'Base supprimée'
  }, 'DROP DATABASE ' + q(db) + ';', undefined, async () => {
    delete state.tables[db]; state.open.delete(db);
    await loadTree();
    go(null, null, 'home');
  });
}

// ======== BASE : liste des tables ========
VIEWS['db:tables'] = async view => {
  const list = await rows(
    'SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH, TABLE_COLLATION, TABLE_COMMENT ' +
    'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [state.db]);
  const size = list.reduce((a, r) => a + Number(r[4] || 0), 0);
  const nbRows = list.reduce((a, r) => a + Number(r[3] || 0), 0);
  const color = dbColor(state.db);

  view.innerHTML =
    '<div class="chips-row"><span class="stat-chip"><b>' + list.length + '</b> table' + (list.length > 1 ? 's' : '') + '</span>' +
    '<span class="stat-chip"><b>' + fmtNum(nbRows) + '</b> lignes (environ)</span><span class="stat-chip"><b>' + fmtBytes(size) + '</b></span></div>' +
    (list.length ? '' : '<div class="alert info">Cette base est vide. Crée ta première table 👇</div>') +
    '<div class="tiles tables" style="--c:' + color + '">' +
    list.map(r => '<div class="tcard" data-open-t="' + h(r[0]) + '">' +
      '<div class="tcard-top"><span class="tcard-ico">' + (r[1] === 'VIEW' ? '👁' : '▦') + '</span><span class="tcard-name">' + h(r[0]) + '</span></div>' +
      '<div class="tcard-meta">' + (r[3] === null ? '—' : fmtNum(r[3])) + ' ligne(s) · ' + (r[4] === null ? '—' : fmtBytes(r[4])) +
      (r[1] === 'VIEW' ? ' · vue' : r[2] ? ' · ' + h(r[2]) : '') + '</div>' +
      '<div class="tcard-actions"><button class="btn small" data-t-struct="' + h(r[0]) + '">Structure</button>' +
      (r[1] === 'VIEW' ? '' : '<button class="btn small" data-t-empty="' + h(r[0]) + '">Vider</button>') +
      '<button class="btn small danger" data-t-drop="' + h(r[0]) + '" data-view="' + (r[1] === 'VIEW' ? 1 : 0) + '">Supprimer</button></div></div>').join('') +
    '<div class="tcard tcard-new" data-goto="create">＋ Nouvelle table</div></div>';

  $$('[data-goto]', view).forEach(el => el.onclick = () => go(state.db, null, el.dataset.goto));
  $$('[data-open-t]', view).forEach(el => el.onclick = e => { if (!e.target.closest('button')) go(state.db, el.dataset.openT, 'browse'); });
  $$('[data-t-struct]', view).forEach(el => el.onclick = () => go(state.db, el.dataset.tStruct, 'structure'));
  $$('[data-t-empty]', view).forEach(el => el.onclick = () => emptyTable(state.db, el.dataset.tEmpty));
  $$('[data-t-drop]', view).forEach(el => el.onclick = () => dropTable(state.db, el.dataset.tDrop, el.dataset.view === '1'));
};

function emptyTable(db, t) {
  confirmAndRun({ title: 'Vider la table « ' + t + ' » ?', text: 'Toutes les lignes seront supprimées (la structure est gardée).', okText: 'Vider', danger: true, done: 'Table vidée' },
    'TRUNCATE TABLE ' + q(t) + ';', db, () => render());
}
function dropTable(db, t, isView) {
  confirmAndRun({ title: 'Supprimer « ' + t + ' » ?', text: 'Elle sera supprimée définitivement avec toutes ses données.', okText: 'Supprimer', danger: true, done: 'Supprimée' },
    (isView ? 'DROP VIEW ' : 'DROP TABLE ') + q(t) + ';', db, async () => {
      await loadTables(db); renderTree(); go(db, null, 'tables');
    });
}

// ======== Définition d'une colonne -> SQL (utilisé pour créer / modifier) ========
function colDef(c) {
  let type = c.type;
  let len = (c.length || '').trim();
  if (!len && type === 'VARCHAR') len = '255';
  if (!len && type === 'CHAR') len = '1';
  if (len) type += '(' + len + ')';
  let sql = q(c.name) + ' ' + type + (c.unsigned ? ' UNSIGNED' : '') + (c.nullable ? ' NULL' : ' NOT NULL');
  const d = (c.def || '').trim();
  if (d) {
    if (/^(NULL|CURRENT_TIMESTAMP(\(\))?)$/i.test(d)) sql += ' DEFAULT ' + d.toUpperCase();
    else if (/^-?\d+(\.\d+)?$/.test(d)) sql += ' DEFAULT ' + d;
    else sql += " DEFAULT '" + d.replace(/'/g, "''") + "'";
  }
  if (c.ai) sql += ' AUTO_INCREMENT';
  if (c.comment) sql += " COMMENT '" + c.comment.replace(/'/g, "''") + "'";
  return sql;
}

// ======== BASE : créer une table ========
VIEWS['db:create'] = async view => {
  const cols = [{ name: 'id', type: 'INT', length: '', def: '', nullable: false, ai: true, index: 'PRIMARY' }];

  view.innerHTML =
    '<div class="card"><div class="card-head"><h3>Nouvelle table dans « ' + h(state.db) + ' »</h3></div>' +
    '<div class="form-grid">' +
    '<label class="field"><span>Nom de la table</span><input id="ct-name" placeholder="ma_table" spellcheck="false"></label>' +
    '<label class="field"><span>Moteur</span><select id="ct-engine"><option>InnoDB</option><option>MyISAM</option><option>MEMORY</option></select></label>' +
    '<label class="field"><span>Interclassement</span><select id="ct-coll">' + COLLATIONS.map(c => '<option>' + c + '</option>').join('') + '</select></label>' +
    '</div>' +
    '<table class="col-table"><thead><tr><th>Nom</th><th>Type</th><th>Taille / valeurs</th><th>Défaut</th><th>Null</th><th>A_I</th><th>Index</th><th></th></tr></thead><tbody id="ct-cols"></tbody></table>' +
    '<div style="margin-top:10px"><button class="btn small" id="ct-add">＋ Ajouter une colonne</button></div>' +
    '<p class="muted small">Défaut : laisse vide pour aucun, tape <code>NULL</code>, <code>CURRENT_TIMESTAMP</code> ou une valeur. Pour ENUM, mets les valeurs dans « Taille » : <code>\'oui\',\'non\'</code></p>' +
    '<div class="sql-preview" id="ct-sql"></div>' +
    '<div class="editor-bar"><div class="left"></div><div class="right">' +
    '<button class="btn" id="ct-editor">Ouvrir dans l\'éditeur SQL</button>' +
    '<button class="btn primary" id="ct-ok">Créer la table</button></div></div></div>';

  const tbody = $('#ct-cols', view);
  const drawCols = () => {
    tbody.innerHTML = cols.map((c, i) => '<tr data-i="' + i + '">' +
      '<td><input data-f="name" value="' + h(c.name) + '" placeholder="nom_colonne" spellcheck="false"></td>' +
      '<td><select data-f="type">' + TYPES.map(t => '<option' + (t === c.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td>' +
      '<td><input data-f="length" value="' + h(c.length) + '" style="width:110px"></td>' +
      '<td><input data-f="def" value="' + h(c.def) + '" style="width:130px"></td>' +
      '<td class="c"><input type="checkbox" data-f="nullable"' + (c.nullable ? ' checked' : '') + '></td>' +
      '<td class="c"><input type="checkbox" data-f="ai"' + (c.ai ? ' checked' : '') + '></td>' +
      '<td><select data-f="index">' + [['', '—'], ['PRIMARY', 'PRIMARY'], ['UNIQUE', 'UNIQUE'], ['INDEX', 'INDEX']]
        .map(([v, l]) => '<option value="' + v + '"' + (v === c.index ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td>' +
      '<td><button class="icon-btn" data-rm="' + i + '" title="Retirer">✕</button></td></tr>').join('');
  };
  const sql = () => {
    const name = $('#ct-name', view).value.trim() || 'ma_table';
    const coll = $('#ct-coll', view).value;
    const lines = cols.filter(c => c.name.trim()).map(c => '  ' + colDef(c));
    const pk = cols.filter(c => c.index === 'PRIMARY' && c.name.trim()).map(c => q(c.name));
    if (pk.length) lines.push('  PRIMARY KEY (' + pk.join(', ') + ')');
    cols.filter(c => c.index === 'UNIQUE' && c.name.trim()).forEach(c => lines.push('  UNIQUE (' + q(c.name) + ')'));
    cols.filter(c => c.index === 'INDEX' && c.name.trim()).forEach(c => lines.push('  INDEX (' + q(c.name) + ')'));
    return 'CREATE TABLE ' + q(name) + ' (\n' + lines.join(',\n') + '\n) ENGINE=' + $('#ct-engine', view).value +
      ' DEFAULT CHARSET=' + coll.split('_')[0] + ' COLLATE=' + coll + ';';
  };
  const upd = () => $('#ct-sql', view).innerHTML = highlight(sql());

  tbody.addEventListener('input', e => {
    const i = e.target.closest('tr').dataset.i, f = e.target.dataset.f;
    if (!f) return;
    cols[i][f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'ai' && e.target.checked && !cols[i].index) { cols[i].index = 'PRIMARY'; drawCols(); }
    upd();
  });
  tbody.addEventListener('click', e => {
    if (e.target.dataset.rm !== undefined) { cols.splice(Number(e.target.dataset.rm), 1); drawCols(); upd(); }
  });
  $('#ct-add', view).onclick = () => {
    cols.push({ name: '', type: 'VARCHAR', length: '', def: '', nullable: false, ai: false, index: '' });
    drawCols(); upd(); $$('#ct-cols tr:last-child input', view)[0].focus();
  };
  ['#ct-name', '#ct-engine', '#ct-coll'].forEach(s => $(s, view).addEventListener('input', upd));
  $('#ct-editor', view).onclick = () => { state.sqlText['db:' + state.db] = sql(); go(state.db, null, 'sql'); };
  $('#ct-ok', view).onclick = async () => {
    const name = $('#ct-name', view).value.trim();
    if (!name) return toast('Donne un nom à la table', 'error');
    try {
      await run(sql(), [], state.db);
      toast('Table « ' + name + ' » créée', 'success');
      await loadTables(state.db); go(state.db, name, 'structure');
    } catch (e) { toast(e.message, 'error'); }
  };
  drawCols(); upd();
};

// ======== Infos sur les colonnes d'une table ========
async function tableColumns(db, table) {
  // Field, Type, Collation, Null, Key, Default, Extra, Privileges, Comment
  const r = await rows('SHOW FULL COLUMNS FROM ' + q(table), [], db);
  return r.map(c => ({ name: c[0], type: c[1], collation: c[2], nullable: c[3] === 'YES', key: c[4], def: c[5], extra: c[6], comment: c[8] }));
}

// ======== TABLE : parcourir les données ========
VIEWS['table:browse'] = async view => {
  const b = state.browse;
  const cols = await tableColumns(state.db, state.table);
  const pk = cols.filter(c => c.key === 'PRI').map(c => c.name);
  const isView = tableType() === 'VIEW';

  // recherche : on cherche le texte dans toutes les colonnes
  let where = '', params = [];
  if (b.search) {
    where = ' WHERE CONCAT_WS(\' \', ' + cols.map(c => q(c.name)).join(', ') + ') LIKE ?';
    params.push('%' + b.search + '%');
  }
  const total = Number((await rows('SELECT COUNT(*) FROM ' + q(state.table) + where, params, state.db))[0][0]);
  const pages = Math.max(1, Math.ceil(total / b.size));
  if (b.page >= pages) b.page = pages - 1;

  const order = b.sort ? ' ORDER BY ' + q(b.sort) + ' ' + b.dir : '';
  const data = await run('SELECT * FROM ' + q(state.table) + where + order + ' LIMIT ' + b.size + ' OFFSET ' + (b.page * b.size), params, state.db);
  const result = data.results[0];

  view.innerHTML =
    '<div class="toolbar"><div class="left">' +
    '<input id="br-search" placeholder="🔍 Rechercher dans la table…" value="' + h(b.search) + '" style="width:260px">' +
    '<span class="muted">' + fmtNum(total) + ' ligne' + (total > 1 ? 's' : '') + ' · ' + data.time + ' ms</span></div>' +
    '<div class="right">' +
    (isView ? '' : '<button class="btn primary small" data-goto="insert">＋ Insérer</button>') +
    '<button class="btn small" id="br-csv">⬇ CSV</button>' +
    '<select id="br-size">' + [25, 50, 100, 250, 500].map(n => '<option' + (n === b.size ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>' +
    '<div class="pager"><button class="btn small" data-p="first">«</button><button class="btn small" data-p="prev">‹</button>' +
    '<span class="muted small">Page ' + (b.page + 1) + ' / ' + pages + '</span>' +
    '<button class="btn small" data-p="next">›</button><button class="btn small" data-p="last">»</button></div></div></div>' +
    gridHtml(result, { sortable: true, sort: b.sort, dir: b.dir, pk, editable: !isView, actions: !isView, tall: true }) +
    (isView ? '' : '<p class="muted small">💡 Double-clique sur une case pour la modifier (Entrée pour valider, Échap pour annuler, tape <code>NULL</code> pour vider). Clique sur un titre de colonne pour trier.</p>');

  // recherche
  let timer;
  $('#br-search', view).oninput = e => { clearTimeout(timer); timer = setTimeout(() => { b.search = e.target.value; b.page = 0; render(); }, 400); };
  if (b.search) { const s = $('#br-search', view); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  // pages
  $('#br-size', view).onchange = e => { b.size = Number(e.target.value); b.page = 0; render(); };
  $$('[data-p]', view).forEach(el => el.onclick = () => {
    const p = el.dataset.p;
    b.page = p === 'first' ? 0 : p === 'prev' ? Math.max(0, b.page - 1) : p === 'next' ? Math.min(pages - 1, b.page + 1) : pages - 1;
    render();
  });
  $$('[data-goto]', view).forEach(el => el.onclick = () => go(state.db, state.table, el.dataset.goto));
  $('#br-csv', view).onclick = () => saveText(state.table + '.csv', toCsv(result), 'csv');
  // tri
  $$('th.sortable', view).forEach(th => th.onclick = () => {
    const col = result.columns[th.dataset.col];
    if (b.sort === col) { if (b.dir === 'ASC') b.dir = 'DESC'; else { b.sort = null; b.dir = 'ASC'; } }
    else { b.sort = col; b.dir = 'ASC'; }
    render();
  });

  // condition WHERE qui identifie une ligne précise
  const whereRow = r => {
    const use = pk.length ? pk : result.columns;
    const sql = use.map(c => q(c) + ' <=> ?').join(' AND ');
    const vals = use.map(c => r[result.columns.indexOf(c)]);
    return { sql: sql + (pk.length ? '' : ' LIMIT 1'), vals };
  };

  // suppression d'une ligne
  $$('[data-del]', view).forEach(btn => btn.onclick = async () => {
    const r = result.rows[btn.dataset.del];
    const w = whereRow(r);
    const sql = 'DELETE FROM ' + q(state.table) + ' WHERE ' + w.sql;
    if (!(await confirmBox({ title: 'Supprimer cette ligne ?', sql: preview(sql, w.vals) + ';', okText: 'Supprimer', danger: true }))) return;
    try { await run(sql, w.vals, state.db); toast('Ligne supprimée', 'success'); render(); }
    catch (e) { toast(e.message, 'error'); }
  });

  // clés étrangères de la table (pour proposer une liste déroulante, voir relations.js)
  const fkc = window.Relations && !isView ? await Relations.fkColumns(state.db, state.table).catch(() => ({})) : {};
  $$('th[data-col]', view).forEach(th => {
    const ref = fkc[result.columns[th.dataset.col]];
    if (ref) th.title = '🔗 Clé étrangère vers ' + ref.table + '.' + ref.col;
  });

  // modification d'une case (double-clic)
  $$('td.editable', view).forEach(td => td.ondblclick = () => {
    if (td.classList.contains('editing')) return;
    const ri = td.parentElement.dataset.r, ci = Number(td.dataset.c);
    const r = result.rows[ri], col = result.columns[ci];
    const old = r[ci];
    td.classList.add('editing');
    const cancel = () => { td.classList.remove('editing'); td.textContent = old === null ? 'NULL' : String(old).slice(0, 200); };
    const save = async val => {
      const w = whereRow(r);
      try {
        await run('UPDATE ' + q(state.table) + ' SET ' + q(col) + ' = ? WHERE ' + w.sql, [val, ...w.vals], state.db);
        toast('Modifié', 'success');
        render();
      } catch (err) { toast(err.message, 'error'); }
    };
    const textInput = () => {
      td.innerHTML = '<input value="' + h(old === null ? '' : old) + '">';
      const input = $('input', td);
      input.focus(); input.select();
      input.onkeydown = e => {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter') save(input.value === 'NULL' ? null : input.value);
      };
      input.onblur = () => setTimeout(() => { if (td.classList.contains('editing')) cancel(); }, 150);
    };

    // clé étrangère : liste déroulante des valeurs de la table référencée
    const ref = fkc[col];
    if (!ref) return textInput();
    td.innerHTML = '<select disabled><option>⏳</option></select>';
    Relations.options(state.db, ref.table, ref.col).then(o => {
      if (!td.classList.contains('editing')) return;
      if (o.more) return textInput();   // trop de valeurs pour une liste
      const colInfo = cols.find(c => c.name === col) || {};
      td.innerHTML = '<select>' + (colInfo.nullable ? '<option value="\u0000">NULL</option>' : '') +
        o.list.map(x => '<option value="' + h(x[0]) + '"' + (String(x[0]) === String(old) ? ' selected' : '') + '>' + h(Relations.optLabel(x)) + '</option>').join('') + '</select>';
      const sel = $('select', td);
      if (old === null && colInfo.nullable) sel.value = '\u0000';
      sel.focus();
      sel.onchange = () => save(sel.value === '\u0000' ? null : sel.value);
      sel.onkeydown = e => { if (e.key === 'Escape') cancel(); };
      sel.onblur = () => setTimeout(() => { if (td.classList.contains('editing')) cancel(); }, 150);
    }).catch(() => textInput());
  });
};

// ======== TABLE : structure ========
VIEWS['table:structure'] = async view => {
  const cols = await tableColumns(state.db, state.table);
  const idx = await rows('SHOW INDEX FROM ' + q(state.table), [], state.db);
  const isView = tableType() === 'VIEW';

  // on regroupe les index par nom
  const indexes = {};
  idx.forEach(r => {
    const name = r[2];
    if (!indexes[name]) indexes[name] = { name, unique: String(r[1]) === '0', cols: [], type: r[10] };
    indexes[name].cols.push(r[4]);
  });

  view.innerHTML =
    '<div class="card"><div class="card-head"><h3>Colonnes</h3></div>' +
    '<div class="grid-wrap"><table class="grid"><thead><tr><th>#</th><th>Nom</th><th>Type</th><th>Interclassement</th><th>Null</th><th>Défaut</th><th>Extra</th><th>Commentaire</th><th></th></tr></thead><tbody>' +
    cols.map((c, i) => '<tr><td class="muted">' + (i + 1) + '</td>' +
      '<td><strong>' + (c.key === 'PRI' ? '<span class="pk">🔑 </span>' : c.key === 'UNI' ? '<span style="color:var(--info)">◆ </span>' : c.key === 'MUL' ? '<span class="muted">◇ </span>' : '') + h(c.name) + '</strong></td>' +
      '<td class="mono" style="color:var(--syn-keyword)">' + h(c.type) + '</td><td class="muted">' + h(c.collation || '') + '</td>' +
      '<td>' + (c.nullable ? 'Oui' : 'Non') + '</td><td class="' + (c.def === null ? 'null' : '') + '">' + (c.def === null ? (c.nullable ? 'NULL' : 'Aucun') : h(c.def)) + '</td>' +
      '<td class="muted">' + h(c.extra) + '</td><td class="muted">' + h(c.comment) + '</td>' +
      '<td class="row-actions" style="white-space:nowrap">' + (isView ? '' :
        '<button class="btn small" data-edit-col="' + i + '">Modifier</button> <button class="btn small danger" data-drop-col="' + h(c.name) + '">Supprimer</button>') +
      '</td></tr>').join('') +
    '</tbody></table></div></div>' +

    (isView ? '' :
      '<div class="card"><div class="card-head"><h3>Ajouter une colonne</h3></div>' +
      '<div class="form-grid">' +
      '<label class="field"><span>Nom</span><input id="ac-name" placeholder="nouvelle_colonne" spellcheck="false"></label>' +
      '<label class="field"><span>Type</span><select id="ac-type">' + TYPES.map(t => '<option' + (t === 'VARCHAR' ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Taille / valeurs</span><input id="ac-len"></label>' +
      '<label class="field"><span>Défaut</span><input id="ac-def" placeholder="vide = aucun"></label>' +
      '<label class="field"><span>Position</span><select id="ac-pos"><option value="">À la fin</option><option value="FIRST">Au début</option>' +
      cols.map(c => '<option value="' + h(c.name) + '">Après ' + h(c.name) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="ac-null"> Peut être NULL</label></label>' +
      '</div><div class="sql-preview" id="ac-sql"></div>' +
      '<div class="editor-bar"><div></div><button class="btn primary" id="ac-ok">Ajouter la colonne</button></div></div>') +

    '<div class="card"><div class="card-head"><h3>Index</h3></div>' +
    (Object.keys(indexes).length ? '<div class="grid-wrap"><table class="grid"><thead><tr><th>Nom</th><th>Colonnes</th><th>Unique</th><th>Type</th><th></th></tr></thead><tbody>' +
      Object.values(indexes).map(ix => '<tr><td><strong>' + (ix.name === 'PRIMARY' ? '<span class="pk">🔑 </span>' : '') + h(ix.name) + '</strong></td>' +
        '<td class="mono">' + ix.cols.map(h).join(', ') + '</td><td>' + (ix.unique ? 'Oui' : 'Non') + '</td><td class="muted">' + h(ix.type) + '</td>' +
        '<td class="row-actions"><button class="btn small danger" data-drop-idx="' + h(ix.name) + '">Supprimer</button></td></tr>').join('') +
      '</tbody></table></div>' : '<p class="muted">Aucun index.</p>') + '</div>';

  // suppression de colonne / d'index
  $$('[data-drop-col]', view).forEach(el => el.onclick = () => confirmAndRun(
    { title: 'Supprimer la colonne « ' + el.dataset.dropCol + ' » ?', text: 'Toutes les valeurs de cette colonne seront perdues.', okText: 'Supprimer', danger: true, done: 'Colonne supprimée' },
    'ALTER TABLE ' + q(state.table) + ' DROP COLUMN ' + q(el.dataset.dropCol) + ';', state.db, () => render()));
  $$('[data-drop-idx]', view).forEach(el => el.onclick = () => confirmAndRun(
    { title: 'Supprimer l\'index « ' + el.dataset.dropIdx + ' » ?', okText: 'Supprimer', danger: true, done: 'Index supprimé' },
    'ALTER TABLE ' + q(state.table) + (el.dataset.dropIdx === 'PRIMARY' ? ' DROP PRIMARY KEY;' : ' DROP INDEX ' + q(el.dataset.dropIdx) + ';'), state.db, () => render()));
  $$('[data-edit-col]', view).forEach(el => el.onclick = () => editColumnModal(cols[el.dataset.editCol]));

  if (isView) return;
  // ajout de colonne
  const sql = () => {
    const pos = $('#ac-pos', view).value;
    return 'ALTER TABLE ' + q(state.table) + ' ADD ' + colDef({
      name: $('#ac-name', view).value.trim() || 'nouvelle_colonne', type: $('#ac-type', view).value,
      length: $('#ac-len', view).value, def: $('#ac-def', view).value, nullable: $('#ac-null', view).checked
    }) + (pos === 'FIRST' ? ' FIRST' : pos ? ' AFTER ' + q(pos) : '') + ';';
  };
  const upd = () => $('#ac-sql', view).innerHTML = highlight(sql());
  ['#ac-name', '#ac-type', '#ac-len', '#ac-def', '#ac-pos', '#ac-null'].forEach(s => $(s, view).addEventListener('input', upd));
  upd();
  $('#ac-ok', view).onclick = async () => {
    if (!$('#ac-name', view).value.trim()) return toast('Donne un nom à la colonne', 'error');
    try { await run(sql(), [], state.db); toast('Colonne ajoutée', 'success'); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
};

// Fenêtre "Modifier une colonne"
function editColumnModal(col) {
  // "varchar(255) unsigned" -> type VARCHAR, taille 255
  const m = col.type.match(/^(\w+)(?:\((.*)\))?(\s+unsigned)?/i) || [];
  const type = (m[1] || 'VARCHAR').toUpperCase();
  const c = { name: col.name, type, length: m[2] || '', unsigned: !!m[3], nullable: col.nullable,
    def: col.def === null ? '' : String(col.def).replace(/^'(.*)'$/s, '$1'), ai: /auto_increment/i.test(col.extra), comment: col.comment };
  const types = TYPES.includes(type) ? TYPES : [type, ...TYPES];

  modal(
    '<h3>Modifier « ' + h(col.name) + ' »</h3>' +
    '<label class="field"><span>Nom</span><input id="ec-name" value="' + h(c.name) + '"></label>' +
    '<div class="field-row"><label class="field grow"><span>Type</span><select id="ec-type">' + types.map(t => '<option' + (t === type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    '<label class="field grow"><span>Taille / valeurs</span><input id="ec-len" value="' + h(c.length) + '"></label></div>' +
    '<label class="field"><span>Défaut</span><input id="ec-def" value="' + h(c.def) + '" placeholder="vide = aucun"></label>' +
    '<label class="field"><span>Commentaire</span><input id="ec-com" value="' + h(c.comment) + '"></label>' +
    '<div class="field-row"><label class="check"><input type="checkbox" id="ec-null"' + (c.nullable ? ' checked' : '') + '> Peut être NULL</label>' +
    '<label class="check"><input type="checkbox" id="ec-ai"' + (c.ai ? ' checked' : '') + '> AUTO_INCREMENT</label></div>' +
    '<div class="sql-preview" id="ec-sql"></div>' +
    '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button><button class="btn primary" data-ok>Enregistrer</button></div>',
    (back, close) => {
      const sql = () => 'ALTER TABLE ' + q(state.table) + ' CHANGE ' + q(col.name) + ' ' + colDef({
        name: $('#ec-name', back).value.trim() || col.name, type: $('#ec-type', back).value, length: $('#ec-len', back).value,
        unsigned: c.unsigned, def: $('#ec-def', back).value, nullable: $('#ec-null', back).checked, ai: $('#ec-ai', back).checked,
        comment: $('#ec-com', back).value
      }) + ';';
      const upd = () => $('#ec-sql', back).innerHTML = highlight(sql());
      $$('input, select', back).forEach(el => el.addEventListener('input', upd)); upd();
      $('[data-x]', back).onclick = close;
      $('[data-ok]', back).onclick = async () => {
        try { await run(sql(), [], state.db); close(); toast('Colonne modifiée', 'success'); render(); }
        catch (e) { toast(e.message, 'error'); }
      };
    });
}

// ======== TABLE : insérer une ligne ========
VIEWS['table:insert'] = async view => {
  if (tableType() === 'VIEW') { view.innerHTML = '<div class="alert info">On ne peut pas insérer directement dans une vue.</div>'; return; }
  const cols = await tableColumns(state.db, state.table);
  const isLong = t => /text|blob|json/i.test(t);

  view.innerHTML = '<div class="card"><div class="card-head"><h3>Nouvelle ligne dans « ' + h(state.table) + ' »</h3>' +
    '<span class="muted small">Laisse une case vide pour utiliser la valeur par défaut.</span></div>' +
    cols.map((c, i) => '<div class="insert-row"><div class="col-name">' + (c.key === 'PRI' ? '<span class="pk">🔑 </span>' : '') + h(c.name) +
      '<span class="col-type">' + h(c.type) + '</span></div>' +
      (isLong(c.type) ? '<textarea data-i="' + i + '" rows="2"></textarea>' :
        '<input data-i="' + i + '" placeholder="' + h(/auto_increment/i.test(c.extra) ? 'automatique' : c.def !== null ? 'défaut : ' + c.def : '') + '">') +
      '<label class="check small">' + (c.nullable ? '<input type="checkbox" data-null="' + i + '"> NULL' : '') + '</label></div>').join('') +
    '<div class="sql-preview" id="in-sql"></div>' +
    '<div class="editor-bar"><label class="check"><input type="checkbox" id="in-again" checked> Rester ici pour en ajouter une autre</label>' +
    '<button class="btn primary" id="in-ok">Insérer</button></div></div>';

  const build = () => {
    const names = [], vals = [];
    cols.forEach((c, i) => {
      const isNull = $('[data-null="' + i + '"]', view)?.checked;
      const v = $('[data-i="' + i + '"]', view).value;
      if (isNull) { names.push(q(c.name)); vals.push(null); }
      else if (v !== '') { names.push(q(c.name)); vals.push(v); }
    });
    const sql = names.length
      ? 'INSERT INTO ' + q(state.table) + ' (' + names.join(', ') + ') VALUES (' + vals.map(() => '?').join(', ') + ')'
      : 'INSERT INTO ' + q(state.table) + ' () VALUES ()';
    return { sql, vals };
  };
  const upd = () => { const b = build(); $('#in-sql', view).innerHTML = highlight(preview(b.sql, b.vals) + ';'); };
  $('.card', view).addEventListener('input', upd); upd();
  $('[data-i]', view)?.focus();

  $('#in-ok', view).onclick = async () => {
    const b = build();
    try {
      const data = await run(b.sql, b.vals, state.db);
      const id = data.results[0].insertId;
      toast('Ligne ajoutée' + (id ? ' (id ' + id + ')' : ''), 'success');
      if ($('#in-again', view).checked) render(); else go(state.db, state.table, 'browse');
    } catch (e) { toast(e.message, 'error'); }
  };
};

// ======== SQL (partout) ========
function sqlSnippets() {
  if (state.table) {
    const t = q(state.table);
    return [
      ['SELECT', 'SELECT * FROM ' + t + ' WHERE 1 LIMIT 100;'],
      ['INSERT', 'INSERT INTO ' + t + ' (`colonne1`, `colonne2`) VALUES (\'valeur1\', \'valeur2\');'],
      ['UPDATE', 'UPDATE ' + t + ' SET `colonne` = \'valeur\' WHERE `id` = 1;'],
      ['DELETE', 'DELETE FROM ' + t + ' WHERE `id` = 1;'],
      ['COUNT', 'SELECT COUNT(*) FROM ' + t + ';'],
      ['DESCRIBE', 'DESCRIBE ' + t + ';']
    ];
  }
  if (state.db) return [
    ['CREATE TABLE', 'CREATE TABLE `ma_table` (\n    `id` INT NOT NULL AUTO_INCREMENT,\n    `nom` VARCHAR(100) NOT NULL,\n    `cree_le` DATETIME DEFAULT CURRENT_TIMESTAMP,\n    PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;'],
    ['DROP TABLE', 'DROP TABLE `ma_table`;'],
    ['SHOW TABLES', 'SHOW TABLES;'],
    ['PROCÉDURE', 'DELIMITER //\n\nCREATE PROCEDURE `ma_procedure`(IN p_id INT)\nBEGIN\n    SELECT * FROM `ma_table` WHERE `id` = p_id;\nEND //\n\nDELIMITER ;\n\nCALL `ma_procedure`(1);'],
    ['TRIGGER', 'DELIMITER //\n\nCREATE TRIGGER `avant_insert_ma_table`\nBEFORE INSERT ON `ma_table`\nFOR EACH ROW\nBEGIN\n    SET NEW.`nom` = UPPER(NEW.`nom`);\nEND //\n\nDELIMITER ;'],
    ['FOREIGN KEY', 'ALTER TABLE `enfant`\n    ADD CONSTRAINT `fk_enfant_parent`\n    FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`)\n    ON DELETE CASCADE;'],
    ['JOIN', 'SELECT a.*, b.*\nFROM `table_a` a\nINNER JOIN `table_b` b ON b.`a_id` = a.`id`;']
  ];
  return [
    ['CREATE DATABASE', 'CREATE DATABASE `ma_base` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;'],
    ['DROP DATABASE', 'DROP DATABASE `ma_base`;'],
    ['SHOW DATABASES', 'SHOW DATABASES;'],
    ['CREATE USER', 'CREATE USER \'nom\'@\'localhost\' IDENTIFIED BY \'motdepasse\';\nGRANT ALL PRIVILEGES ON `ma_base`.* TO \'nom\'@\'localhost\';'],
    ['PROCESSLIST', 'SHOW PROCESSLIST;']
  ];
}
function history() { try { return JSON.parse(localStorage.getItem('bs.history')) || []; } catch (e) { return []; } }

const sqlKey = () => state.table ? 't:' + state.db + '.' + state.table : state.db ? 'db:' + state.db : 'server';

VIEWS['sql'] = async view => {
  const key = sqlKey();
  const where = state.table ? 'la table « ' + state.table + ' »' : state.db ? 'la base « ' + state.db + ' »' : 'le serveur';
  if (state.sqlText[key] === undefined) state.sqlText[key] = state.table ? 'SELECT * FROM ' + q(state.table) + ' LIMIT 100;' : '';

  view.innerHTML =
    '<div class="sql-split"><div>' +
    '<div class="card"><div class="card-head"><h3>Requête SQL sur ' + h(where) + '</h3></div>' +
    '<div class="snippets">' + sqlSnippets().map((s, i) => '<button class="btn small" data-snip="' + i + '">' + h(s[0]) + '</button>').join('') + '</div>' +
    '<div id="sql-editor"></div>' +
    '<div class="editor-bar"><div class="left"><span class="muted small">Plusieurs requêtes possibles, séparées par <code>;</code> · <code>DELIMITER</code> accepté · Sélectionne du texte pour n\'exécuter que lui</span></div>' +
    '<div class="right"><button class="btn ghost small" id="sql-clear">Effacer</button>' +
    '<button class="btn primary" id="sql-run">▶ Exécuter <span class="kbd" style="color:inherit;border-color:currentColor;opacity:.7">Ctrl+Entrée</span></button></div></div></div>' +
    '<div id="sql-results"></div></div>' +
    '<div><div class="card"><div class="card-head"><h3>Historique</h3><button class="btn ghost small" id="sql-hclear">Vider</button></div>' +
    '<div class="history" id="sql-history"></div></div></div></div>';

  const drawHistory = () => {
    const list = history();
    $('#sql-history', view).innerHTML = list.length ? list.map((s, i) => '<div class="history-item" data-h="' + i + '" title="' + h(s) + '">' + h(s.replace(/\s+/g, ' ')) + '</div>').join('')
      : '<p class="muted small">Tes requêtes exécutées apparaîtront ici.</p>';
  };

  const exec = async () => {
    const sql = editor.getRunnable().trim();
    if (!sql) return;
    const out = $('#sql-results', view);
    out.innerHTML = '<div class="empty">⏳ Exécution…</div>';
    // historique
    const hist = history().filter(s => s !== sql); hist.unshift(sql);
    localStorage.setItem('bs.history', JSON.stringify(hist.slice(0, 50))); drawHistory();

    try {
      const data = await run(convertDelimiters(sql), [], state.db || undefined);
      out.innerHTML = data.results.map((r, i) => r.type === 'rows'
        ? '<div class="card result-block"><div class="result-head"><strong>Résultat ' + (data.results.length > 1 ? i + 1 : '') + '</strong>' +
          '<span class="muted small">' + fmtNum(r.rows.length) + ' ligne(s) · ' + data.time + ' ms <button class="btn small" data-csv="' + i + '">⬇ CSV</button></span></div>' + gridHtml(r) + '</div>'
        : '<div class="alert success result-block">✔ Requête ' + (data.results.length > 1 ? (i + 1) + ' ' : '') + 'exécutée · ' + fmtNum(r.affectedRows) + ' ligne(s) affectée(s)' +
          (r.insertId ? ' · id inséré : ' + r.insertId : '') + ' · ' + data.time + ' ms</div>').join('');
      $$('[data-csv]', out).forEach(b => b.onclick = () => saveText('resultat.csv', toCsv(data.results[b.dataset.csv]), 'csv'));

      // si la structure a changé, on met à jour la barre latérale
      if (/\b(create|drop|alter|rename|truncate)\b/i.test(sql)) {
        state.tables = {};
        await loadTree();
        if (state.db && !state.dbs.includes(state.db)) go(null, null, 'home');
        else if (state.table && !(state.tables[state.db] || []).some(t => t.name === state.table)) {
          // la table n'existe plus
          if (!state.tables[state.db]) await loadTables(state.db);
          if (!(state.tables[state.db] || []).some(t => t.name === state.table)) go(state.db, null, 'tables');
        }
      }
    } catch (e) {
      out.innerHTML = '<div class="alert danger result-block"><strong>Erreur MySQL :</strong>\n' + h(e.message) + '</div>';
    }
  };

  const editor = createEditor($('#sql-editor', view), state.sqlText[key], exec, v => state.sqlText[key] = v);
  editor.focus();
  $('#sql-run', view).onclick = exec;
  $('#sql-clear', view).onclick = () => editor.set('');
  $('#sql-hclear', view).onclick = () => { localStorage.removeItem('bs.history'); drawHistory(); };
  $$('[data-snip]', view).forEach(b => b.onclick = () => editor.set(sqlSnippets()[b.dataset.snip][1]));
  $('#sql-history', view).onclick = e => { const it = e.target.closest('[data-h]'); if (it) editor.set(history()[it.dataset.h]); };
  drawHistory();
};

// ======== EXPORT (base ou table) ========
VIEWS['export'] = async view => {
  const what = state.table ? 'la table « ' + state.table + ' »' : 'la base « ' + state.db + ' »';
  let createSql = '';
  if (state.table) {
    const r = await rows((tableType() === 'VIEW' ? 'SHOW CREATE VIEW ' : 'SHOW CREATE TABLE ') + q(state.table), [], state.db);
    createSql = r[0][1] + ';';
  }
  view.innerHTML = '<div class="card"><div class="card-head"><h3>Exporter ' + h(what) + '</h3></div>' +
    '<p class="muted">Crée un fichier <code>.sql</code> que tu pourras ré-importer ici, dans phpMyAdmin ou sur un autre serveur.</p>' +
    '<label class="check" style="margin:6px 0"><input type="radio" name="ex-mode" value="1" checked> Structure + données</label><br>' +
    '<label class="check" style="margin:6px 0"><input type="radio" name="ex-mode" value="0"> Structure seulement</label>' +
    '<div class="editor-bar"><div></div><button class="btn primary" id="ex-ok">⬇ Exporter en .sql</button></div></div>' +
    (createSql ? '<div class="card"><div class="card-head"><h3>Code SQL de création</h3><button class="btn small" id="ex-copy">Copier</button></div>' +
      '<div class="sql-preview">' + highlight(createSql) + '</div></div>' : '');

  $('#ex-ok', view).onclick = async () => {
    const withData = $('input[name=ex-mode]:checked', view).value === '1';
    const res = await window.api.exportDb(state.db, state.table, withData);
    if (!res.ok) toast(res.error, 'error');
    else if (res.data) toast('Export enregistré : ' + res.data, 'success');
  };
  if (createSql) $('#ex-copy', view).onclick = () => { navigator.clipboard.writeText(createSql); toast('Copié !', 'success'); };
};

// ======== IMPORT ========
VIEWS['import'] = async view => {
  const target = state.db ? 'dans la base « ' + state.db + ' »' : 'sur le serveur';
  view.innerHTML = '<div class="card"><div class="card-head"><h3>Importer un fichier SQL ' + h(target) + '</h3></div>' +
    '<p class="muted">Choisis un fichier <code>.sql</code> (un export de phpMyAdmin, de BaseStudio, un script de ton prof…). Toutes les requêtes du fichier seront exécutées.</p>' +
    (state.db ? '' : '<div class="alert info">Astuce : si ton fichier ne contient pas de <code>CREATE DATABASE</code> / <code>USE</code>, ouvre d\'abord la base voulue puis importe depuis son onglet « Importer ».</div>') +
    '<button class="btn primary big" id="im-ok">📁 Choisir un fichier et l\'importer</button>' +
    '<div id="im-result" style="margin-top:14px"></div></div>';

  $('#im-ok', view).onclick = async () => {
    const out = $('#im-result', view);
    out.innerHTML = '<div class="muted">⏳ Lecture du fichier…</div>';
    const t0 = Date.now();
    const res = await window.api.importSql(state.db || null, (done, total) => {
      const pct = total ? Math.round(done * 100 / total) : 0;
      out.innerHTML = '<div class="muted">⏳ Import en cours : ' + fmtNum(done) + ' / ' + fmtNum(total) + ' requêtes (' + pct + ' %)</div>' +
        '<div class="progress"><div style="width:' + pct + '%"></div></div>';
    });
    if (!res.ok) {
      const f = res.failed;
      out.innerHTML = '<div class="alert danger"><strong>Erreur pendant l\'import' + (f ? ' (requête ' + fmtNum(f.index) + ' sur ' + fmtNum(f.total) + ')' : '') + ' :</strong>\n' + h(res.error) +
        (f ? '\n\nLes requêtes d\'avant ont été exécutées. Requête en cause :</div><div class="sql-preview">' + highlight(f.sql) + '</div>' : '</div>');
      addJournal('-- import fichier', [], false, res.error);
      state.tables = {}; await loadTree();
      return;
    }
    if (!res.data) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="alert success">✔ Import terminé : ' + fmtNum(res.data.count) + ' requête(s) exécutée(s) en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s' +
      (res.data.packets > 1 ? ' (envoyées en ' + res.data.packets + ' paquets)' : '') + '.\n' + h(res.data.file) + '</div>';
    addJournal('-- import ' + res.data.file, [], true, res.data.count + ' requêtes');
    state.tables = {};
    await loadTree();
  };
};

// ======== OPÉRATIONS sur une base ========
VIEWS['db:ops'] = async view => {
  const coll = (await rows('SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [state.db]))[0]?.[0];
  view.innerHTML =
    '<div class="card"><div class="card-head"><h3>Interclassement</h3></div>' +
    '<div class="field-row"><select id="op-coll" style="max-width:320px">' + [...new Set([coll, ...COLLATIONS])].filter(Boolean).map(c => '<option' + (c === coll ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
    '<button class="btn" id="op-coll-ok">Changer</button></div>' +
    '<p class="muted small">Ne s\'applique qu\'aux nouvelles tables.</p></div>' +
    '<div class="card" style="border-color:color-mix(in srgb, var(--danger) 40%, transparent)"><div class="card-head"><h3 style="color:var(--danger)">Zone dangereuse</h3></div>' +
    '<p class="muted">Supprimer la base efface toutes ses tables et leurs données. Pense à faire un export avant !</p>' +
    '<button class="btn danger" id="op-drop">Supprimer la base « ' + h(state.db) + ' »</button></div>';

  $('#op-coll-ok', view).onclick = () => {
    const c = $('#op-coll', view).value;
    confirmAndRun({ title: 'Changer l\'interclassement ?', okText: 'Changer', done: 'Interclassement modifié' },
      'ALTER DATABASE ' + q(state.db) + ' CHARACTER SET ' + c.split('_')[0] + ' COLLATE ' + c + ';', undefined, () => render());
  };
  $('#op-drop', view).onclick = () => dropDb(state.db);
};

// ======== OPÉRATIONS sur une table ========
VIEWS['table:ops'] = async view => {
  const isView = tableType() === 'VIEW';
  view.innerHTML =
    '<div class="card"><div class="card-head"><h3>Renommer</h3></div>' +
    '<div class="field-row"><input id="op-name" value="' + h(state.table) + '" style="max-width:320px"><button class="btn" id="op-rename">Renommer</button></div></div>' +
    (isView ? '' : '<div class="card"><div class="card-head"><h3>Copier la table</h3></div>' +
      '<div class="field-row"><input id="op-copy" value="' + h(state.table) + '_copie" style="max-width:320px">' +
      '<label class="check"><input type="checkbox" id="op-copy-data" checked> avec les données</label>' +
      '<button class="btn" id="op-copy-ok">Copier</button></div></div>') +
    '<div class="card" style="border-color:color-mix(in srgb, var(--danger) 40%, transparent)"><div class="card-head"><h3 style="color:var(--danger)">Zone dangereuse</h3></div>' +
    '<div class="field-row">' + (isView ? '' : '<button class="btn danger" id="op-empty">Vider la table (TRUNCATE)</button>') +
    '<button class="btn danger" id="op-drop">Supprimer ' + (isView ? 'la vue' : 'la table') + '</button></div></div>';

  $('#op-rename', view).onclick = () => {
    const n = $('#op-name', view).value.trim();
    if (!n || n === state.table) return;
    confirmAndRun({ title: 'Renommer en « ' + n + ' » ?', okText: 'Renommer', done: 'Renommée' },
      'RENAME TABLE ' + q(state.table) + ' TO ' + q(n) + ';', state.db, async () => { await loadTables(state.db); go(state.db, n, 'ops'); });
  };
  if (!isView) {
    $('#op-copy-ok', view).onclick = () => {
      const n = $('#op-copy', view).value.trim();
      if (!n) return;
      let sql = 'CREATE TABLE ' + q(n) + ' LIKE ' + q(state.table) + ';';
      if ($('#op-copy-data', view).checked) sql += '\nINSERT INTO ' + q(n) + ' SELECT * FROM ' + q(state.table) + ';';
      confirmAndRun({ title: 'Copier la table ?', okText: 'Copier', done: 'Table copiée' }, sql, state.db,
        async () => { await loadTables(state.db); go(state.db, n, 'browse'); });
    };
    $('#op-empty', view).onclick = () => emptyTable(state.db, state.table);
  }
  $('#op-drop', view).onclick = () => dropTable(state.db, state.table, isView);
};

// ---------------------------------------------------------------------
// RECHERCHE RAPIDE (Ctrl+K)
// ---------------------------------------------------------------------
let palItems = [], palSel = 0;

async function openPalette() {
  $('#palette').hidden = false;
  const input = $('#pal-input');
  input.value = ''; palSel = 0;
  input.focus();
  drawPalette();
  // on charge les tables de toutes les bases perso pour pouvoir les chercher
  for (const db of state.dbs) {
    if (!state.tables[db] && !SYSTEM_DBS.includes(db)) { try { await loadTables(db); } catch (e) {} }
  }
  await loadObjects();
  if (!$('#palette').hidden) drawPalette();
}

// Triggers, procédures et fonctions de toutes les bases perso (pour Ctrl+K).
// Lu directement par l'API pour ne pas remplir le journal ; gardé 30 secondes.
let palObjects = [], palObjectsAt = 0;
async function loadObjects() {
  if (Date.now() - palObjectsAt < 30000) return;
  const skip = SYSTEM_DBS.map(() => '?').join(', ');
  const res = await window.api.query(
    'SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA NOT IN (' + skip + ') ' +
    'UNION ALL SELECT TRIGGER_SCHEMA, TRIGGER_NAME, \'TRIGGER\' FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA NOT IN (' + skip + ')',
    [...SYSTEM_DBS, ...SYSTEM_DBS], null);
  if (res.ok) { palObjects = res.data.results[0].rows.map(r => ({ db: r[0], name: r[1], kind: r[2] })); palObjectsAt = Date.now(); }
}

// Ouvre un onglet puis met en évidence l'élément de la liste qui porte ce nom
function goAndFocus(db, table, tab, name) {
  go(db, table, tab);
  let tries = 0;
  const look = () => {
    const el = $$('#view .trg-name').find(e => e.textContent.replace(/^\S+\s/, '').trim().split(/\s/)[0] === name);
    if (el) {
      const item = el.closest('.trg-item');
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      item.classList.add('flash'); setTimeout(() => item.classList.remove('flash'), 2200);
    } else if (tries++ < 20) setTimeout(look, 150);
  };
  setTimeout(look, 150);
}
function closePalette() { $('#palette').hidden = true; }

function drawPalette(keepScroll) {
  const f = $('#pal-input').value.trim();
  const fl = f.toLowerCase();
  const match = (...txt) => !fl || txt.some(t => String(t).toLowerCase().includes(fl));
  const items = [];

  // du SQL tapé directement
  if (/^(select|show|insert|update|delete|create|drop|alter|describe|truncate|rename)\b/i.test(f)) {
    items.push({ group: 'SQL', ico: '▶', label: 'Ouvrir dans l\'éditeur SQL', sub: f, run: () => { state.sqlText[sqlKey()] = f; state.tab = 'sql'; render(); } });
  }
  // actions
  [['＋', 'Nouvelle base de données', () => newDbModal()],
   ['⌨️', 'Éditeur SQL', () => { state.tab = 'sql'; render(); }],
   ['🗄️', 'Accueil : toutes les bases', () => go(null, null, 'home')],
   ['📥', 'Importer un fichier SQL', () => { state.tab = 'import'; render(); }],
   ['👤', 'Utilisateurs et droits', () => go(null, null, 'users')],
   ['⬆', 'Vérifier les mises à jour', () => window.Updater && Updater.check(true)],
   ['🎨', 'Apparence', () => Theme.open()],
   ['⏻', 'Se déconnecter', () => disconnect()]
  ].forEach(([ico, label, run]) => { if (match(label)) items.push({ group: 'Actions', ico, label, sub: '', run }); });
  // schéma de la base ouverte
  if (state.db && match('Schéma ' + state.db, 'Schema MCD MLD MERISE')) {
    const db = state.db;
    items.push({ group: 'Actions', ico: '🔗', label: 'Schéma de « ' + db + ' »', sub: 'MCD / MLD', run: () => go(db, null, 'schema') });
  }
  if (state.db && window.Dictionary && match('Dictionnaire de données ' + state.db, 'documentation PDF')) {
    const db = state.db;
    items.push({ group: 'Actions', ico: '📖', label: 'Dictionnaire de données de « ' + db + ' »', sub: 'imprimer / PDF', run: () => Dictionary.open(db) });
  }
  // les autres onglets de la base ouverte
  if (state.db) {
    const db = state.db;
    [['triggers', '⚡', 'Triggers', 'trigger déclencheur'], ['routines', '🧩', 'Procédures et fonctions', 'procedure fonction routine'],
     ['views', '👁', 'Vues', 'view vue'], ['search', '🔍', 'Rechercher dans', 'search chercher recherche']].forEach(([tab, ico, label, words]) => {
      if (TABS.db.some(t => t[0] === tab) && match(label + ' ' + db, words))
        items.push({ group: 'Actions', ico, label: label + (tab === 'search' ? ' « ' : ' de « ') + db + ' »', sub: 'onglet', run: () => go(db, null, tab) });
    });
  }
  // bases
  state.dbs.forEach(db => {
    if (match(db)) items.push({ group: 'Bases', ico: initial(db), color: dbColor(db), label: db, sub: SYSTEM_DBS.includes(db) ? 'système' : 'base', run: () => go(db, null) });
  });
  // schémas des bases (quand on tape le nom d'une base, ou « schéma »)
  if (fl) state.dbs.forEach(db => {
    if (SYSTEM_DBS.includes(db) || db === state.db) return;
    if (match('Schéma ' + db, 'Schema ' + db, 'MCD ' + db, 'MLD ' + db)) items.push({ group: 'Schémas', ico: '🔗', color: dbColor(db), label: 'Schéma de « ' + db + ' »', sub: 'MCD / MLD', run: () => go(db, null, 'schema') });
  });
  // tables
  Object.keys(state.tables).forEach(db => (state.tables[db] || []).forEach(t => {
    if (fl && match(t.name, db + '.' + t.name)) items.push({ group: 'Tables', ico: t.type === 'VIEW' ? '👁' : '▦', color: dbColor(db), label: t.name, sub: db, run: () => go(db, t.name, 'browse') });
  }));
  // triggers, procédures et fonctions (on tape une partie de leur nom)
  const KIND = { TRIGGER: ['⚡', 'trigger', 'triggers'], PROCEDURE: ['🧩', 'procédure', 'routines'], FUNCTION: ['ƒ', 'fonction', 'routines'] };
  if (fl) palObjects.forEach(o => {
    const k = KIND[o.kind];
    if (k && match(o.name, o.db + '.' + o.name))
      items.push({ group: 'Triggers et procédures', ico: k[0], color: dbColor(o.db), label: o.name, sub: k[1] + ' · ' + o.db, run: () => goAndFocus(o.db, null, k[2], o.name) });
  });

  palItems = items.slice(0, 60);
  if (palSel >= palItems.length) palSel = Math.max(0, palItems.length - 1);
  let html = '', last = '';
  palItems.forEach((it, i) => {
    if (it.group !== last) { html += '<div class="pal-group">' + it.group + '</div>'; last = it.group; }
    html += '<div class="pal-item' + (i === palSel ? ' sel' : '') + '" data-pi="' + i + '">' +
      '<span class="pi-ico"' + (it.color ? ' style="background:' + it.color + ';color:#111"' : '') + '>' + it.ico + '</span>' +
      '<span class="pi-label">' + h(it.label) + '</span><span class="pi-sub">' + h(it.sub) + '</span></div>';
  });
  $('#pal-list').innerHTML = html || '<div class="pal-empty">Rien trouvé 🤷</div>';
  if (keepScroll) { const sel = $('.pal-item.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' }); }
}

// ---------------------------------------------------------------------
// DÉMARRAGE + CLICS GÉNÉRAUX
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  renderSavedServers();
  // on pré-remplit avec le dernier serveur utilisé
  const last = savedServers()[0];
  if (last) fillLogin(last);

  $('#login-form').addEventListener('submit', e => {
    e.preventDefault();
    connect({ host: $('#lg-host').value.trim(), port: $('#lg-port').value.trim(), user: $('#lg-user').value.trim(), password: $('#lg-pass').value });
  });

  $('#saved-servers').addEventListener('click', e => {
    const del = e.target.closest('[data-srv-del]');
    if (del) {
      e.stopPropagation();
      const list = savedServers(); list.splice(Number(del.dataset.srvDel), 1);
      localStorage.setItem('bs.servers', JSON.stringify(list)); renderSavedServers(); return;
    }
    const it = e.target.closest('[data-srv]');
    if (!it) return;
    const s = savedServers()[it.dataset.srv];
    fillLogin(s);
    if (s.noPassword) connect({ host: s.host, port: s.port, user: s.user, password: '' });
    else { $('#lg-pass').focus(); toast('Tape le mot de passe de ' + s.user + ', puis Entrée'); }
  });

  $('#topnav').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]');
    if (b) go(null, null, b.dataset.nav);
  });

  // recherche rapide
  $('#pal-input').addEventListener('input', () => { palSel = 0; drawPalette(); });
  $('#pal-input').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); drawPalette(true); }
    if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); drawPalette(true); }
    if (e.key === 'Enter' && palItems[palSel]) { const it = palItems[palSel]; closePalette(); it.run(); }
    if (e.key === 'Escape') closePalette();
  });
  $('#pal-list').addEventListener('click', e => {
    const it = e.target.closest('[data-pi]');
    if (it) { const item = palItems[it.dataset.pi]; closePalette(); item.run(); }
  });
  $('#palette').addEventListener('mousedown', e => { if (e.target.id === 'palette') closePalette(); });

  $('#tabs').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (t) { state.tab = t.dataset.tab; render(); }
  });
  $('#breadcrumb').addEventListener('click', e => {
    const c = e.target.closest('[data-go]');
    if (!c || c.classList.contains('last')) return;
    if (c.dataset.go === 'server') go(null, null, 'home'); else go(state.db, null);
  });
  $('#journal-list').addEventListener('click', e => {
    const it = e.target.closest('[data-j]');
    if (!it) return;
    state.sqlText[sqlKey()] = journal[it.dataset.j].sql;
    $('#journal').classList.add('collapsed');
    state.tab = 'sql'; render();
  });

  // boutons avec data-action
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    switch (a.dataset.action) {
      case 'open-appearance': Theme.open(); break;
      case 'close-appearance': Theme.close(); break;
      case 'disconnect': disconnect(); break;
      case 'go-home': go(null, null, 'home'); break;
      case 'open-palette': openPalette(); break;
      case 'new-db': newDbModal(); break;
      case 'reload-view': render(); break;
      case 'toggle-journal': $('#journal').classList.toggle('collapsed'); break;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#appearance').classList.contains('open')) Theme.close();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.server) {
      e.preventDefault();
      $('#palette').hidden ? openPalette() : closePalette();
    }
    if (e.key === 'F5') { e.preventDefault(); if (state.server) render(); }
  });
});
