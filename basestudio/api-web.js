// =====================================================================
//  BaseStudio - version navigateur (Edge + XAMPP)
//  Crée "window.api" : toutes les demandes de l'interface passent par
//  api.php (connexion, requêtes, export / import, mises à jour).
// =====================================================================
(function () {
  if (window.api) return;

  async function call(action, data) {
    try {
      const res = await fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(Object.assign({ action }, data))
      });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch (e) { return { ok: false, error: 'Réponse inattendue de PHP :\n' + text.slice(0, 400) }; }
    } catch (e) {
      return { ok: false, error: 'Impossible de joindre Apache. Vérifie qu\'Apache est bien démarré dans XAMPP.', code: 'ECONNREFUSED' };
    }
  }

  // Télécharge un texte sous forme de fichier
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: type || 'text/plain;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return name;
  }

  // Ouvre la fenêtre "choisir un fichier" et lit le texte
  function pickText(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept;
      input.onchange = () => {
        const f = input.files[0]; if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name, text: r.result });
        r.readAsText(f);
      };
      input.click();
    });
  }

  // ===================================================================
  //  Import d'un fichier .sql, même très gros
  //  MySQL refuse un envoi plus grand que max_allowed_packet (1 Mo sur
  //  XAMPP). On découpe donc le fichier en requêtes, puis on les envoie
  //  par paquets. Chaque paquet est une nouvelle connexion : on y répète
  //  les réglages de session du fichier (SET NAMES, FOREIGN_KEY_CHECKS,
  //  USE…). Les START TRANSACTION / COMMIT du fichier sont ignorés (sinon
  //  un paquet resterait sans COMMIT et serait annulé).
  // ===================================================================
  const utf8Len = s => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3; } return n; };
  // le texte sans les commentaires du début (pour savoir quelle requête c'est)
  const core = s => s.replace(/^(\s*(--[^\n]*|#[^\n]*|\/\*(?!!)[\s\S]*?\*\/))*\s*/, '');
  const SESSION_RE = /^(\/\*!\d*\s*)?(SET\s+(NAMES|CHARACTER\s+SET|FOREIGN_KEY_CHECKS|UNIQUE_CHECKS|SQL_MODE|TIME_ZONE|SQL_NOTES|SESSION\s|@@SESSION\.|@OLD_|@saved_|character_set_|collation_)|USE\s)/i;
  const TX_RE = /^(START\s+TRANSACTION|BEGIN|BEGIN\s+WORK|COMMIT|COMMIT\s+WORK|ROLLBACK)\s*$|^SET\s+(@@(SESSION\.)?|SESSION\s+)?AUTOCOMMIT\b/i;
  const INSERT_RE = /^(INSERT|REPLACE)\b[\s\S]*?\bVALUES\s*\(/i;
  const sessionKey = c => c.replace(/^\/\*!\d*\s*/, '').split('=')[0].replace(/\s+/g, ' ').trim().toUpperCase();

  // Découpe en requêtes : gère DELIMITER, les chaînes '…' "…" `…` et les commentaires
  function splitSql(text) {
    const out = [], n = text.length, delimRe = /[ \t]*DELIMITER[ \t]+(\S+)[^\n]*(\n|$)/iy;
    let delim = ';', start = 0, i = 0, lineStart = true;
    const push = s => {
      const t = s.trim();
      if (t.replace(/\/\*(?!!)[\s\S]*?\*\//g, '').replace(/^\s*(--|#).*$/gm, '').trim()) out.push(t);
    };
    while (i < n) {
      if (lineStart) {
        delimRe.lastIndex = i;
        const m = delimRe.exec(text);
        if (m) { push(text.slice(start, i)); delim = m[1]; i = start = delimRe.lastIndex; continue; }
      }
      const c = text[i];
      lineStart = false;
      if (c === '\n') { i++; lineStart = true; continue; }
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        while (j < n) {
          const d = text[j];
          if (d === '\\' && c !== '`') { j += 2; continue; }
          if (d === c) { if (text[j + 1] === c) { j += 2; continue; } break; }
          j++;
        }
        i = j + 1; continue;
      }
      if (c === '#' || (c === '-' && text[i + 1] === '-' && /\s/.test(text[i + 2] || ' '))) { const j = text.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
      if (text.startsWith(delim, i)) { push(text.slice(start, i)); i = start = i + delim.length; continue; }
      i++;
    }
    push(text.slice(start));
    return out;
  }

  // Un INSERT trop gros devient plusieurs INSERT plus petits (on coupe entre les lignes)
  function splitInsert(stmt, limit) {
    const m = /^([\s\S]*?\bVALUES\s*)\(/i.exec(stmt);
    if (!m) return [stmt];
    const head = m[1], tuples = [];
    let i = head.length, depth = 0, from = i, q = null;
    for (; i < stmt.length; i++) {
      const c = stmt[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) { if (stmt[i + 1] === q) { i++; continue; } q = null; } continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '(') { if (depth === 0) from = i; depth++; }
      else if (c === ')') { depth--; if (depth === 0) tuples.push(stmt.slice(from, i + 1)); }
      else if (depth === 0 && c !== ',' && !/\s/.test(c)) break;   // après les valeurs : ON DUPLICATE KEY UPDATE…
    }
    const tail = stmt.slice(i).trim();
    if (tuples.length < 2) return [stmt];
    const out = []; let cur = [], size = utf8Len(head) + utf8Len(tail);
    tuples.forEach(t => {
      const b = utf8Len(t) + 2;
      if (cur.length && size + b > limit) { out.push(cur); cur = []; size = utf8Len(head) + utf8Len(tail); }
      cur.push(t); size += b;
    });
    if (cur.length) out.push(cur);
    return out.map(c => head + c.join(',\n') + (tail ? '\n' + tail : ''));
  }

  async function importText(database, name, text, onProgress) {
    let max = 1048576;
    const r = await call('query', { sql: 'SELECT @@max_allowed_packet', params: [], database: null });
    if (r.ok) max = Number(r.data.results[0].rows[0][0]) || max;
    const LIMIT = Math.max(64 * 1024, Math.min(Math.floor(max * 0.6), 8 * 1024 * 1024));
    const stmts = [];
    splitSql(text).forEach(s => {
      if (utf8Len(s) > LIMIT && INSERT_RE.test(core(s))) splitInsert(s, LIMIT).forEach(x => stmts.push(x));
      else stmts.push(s);
    });
    const total = stmts.length, session = new Map();
    let i = 0, packets = 0;
    if (onProgress) onProgress(0, total);
    while (i < total) {
      const prefix = [...session.values()], first = i, batch = [];
      let size = utf8Len(prefix.join('\n;\n'));
      while (i < total) {
        const s = stmts[i], c = core(s);
        if (TX_RE.test(c)) { i++; continue; }
        const b = utf8Len(s) + 3;
        if (batch.length && size + b > LIMIT) break;
        batch.push(s); size += b; i++;
        if (SESSION_RE.test(c)) session.set(sessionKey(c), s);
      }
      if (!batch.length) continue;
      // « \n;\n » : un commentaire -- en fin de requête ne peut pas avaler le ;
      const res = await call('import', { database, sql: prefix.concat(batch).join('\n;\n') + '\n;' });
      packets++;
      if (!res.ok) {
        const k = Math.min(batch.length - 1, Math.max(0, (res.done || 0) - prefix.length));
        let error = res.error;
        if (/max_allowed_packet|packet.*bigger|gone away/i.test(error))
          error += '\n\nUne seule requête du fichier est plus grosse que la limite du serveur (' + Math.round(max / 1024) + ' Ko). ' +
            'Augmente « max_allowed_packet » dans C:\\xampp\\mysql\\bin\\my.ini (ex : 64M) puis redémarre MySQL.';
        return { ok: false, error, failed: { index: stmts.indexOf(batch[k], first) + 1, total, sql: core(batch[k]).slice(0, 400) } };
      }
      if (onProgress) onProgress(i, total);
    }
    return { ok: true, data: { file: name, count: total, packets } };
  }
  window.SqlImport = { splitSql, splitInsert, importText };

  window.api = {
    connect: cfg => call('connect', { cfg }),
    disconnect: () => call('disconnect'),
    query: (sql, params, database) => call('query', { sql, params: params || [], database: database || null }),

    exportDb: async (database, table, withData) => {
      const res = await call('export', { database, table: table || null, withData: withData !== false });
      if (!res.ok) return res;
      const name = (table ? database + '_' + table : database) + '.sql';
      download(name, res.data, 'application/sql;charset=utf-8');
      return { ok: true, data: 'Téléchargements\\' + name };
    },

    // onProgress(faites, total) est appelé pendant l'import
    importSql: async (database, onProgress) => {
      const f = await pickText('.sql,.txt');
      if (!f) return { ok: true, data: null };
      return importText(database || null, f.name, f.text, onProgress);
    },

    // mises à jour depuis GitHub (voir update.js)
    updateCheck: () => call('update_check'),
    updateInstall: ref => call('update_install', { ref }),
    updateBackup: () => call('update_backup'),
    updateRollback: () => call('update_rollback'),

    // sauvegardes (voir backups.js)
    backupList: () => call('backup_list'),
    backupRun: (database, auto, keep) => call('backup_run', { database, auto: !!auto, keep: keep || 7 }),
    backupGet: file => call('backup_get', { file }),
    backupDelete: file => call('backup_delete', { file }),
    backupConfig: config => call('backup_config', { config }),
    backupOpen: () => call('backup_open'),
    download,

    saveFile: async (name, content) => ({ ok: true, data: 'Téléchargements\\' + download(name, content) }),
    openFile: async () => ({ ok: true, data: null })
  };
})();
