// =====================================================================
//  BaseStudio - version navigateur (Edge + XAMPP)
//  Crée "window.api" (comme preload.js dans la version .exe), mais en
//  passant par api.php au lieu de main.js.
//  Si on est dans la version .exe, window.api existe déjà : on ne fait rien.
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

    importSql: async database => {
      const f = await pickText('.sql,.txt');
      if (!f) return { ok: true, data: null };
      const sql = window.convertDelimiters ? window.convertDelimiters(f.text) : f.text; // gère DELIMITER
      const res = await call('import', { database: database || null, sql });
      if (!res.ok) return res;
      return { ok: true, data: { file: f.name, count: res.data.count } };
    },

    // mises à jour depuis GitHub (voir update.js)
    updateCheck: () => call('update_check'),
    updateInstall: ref => call('update_install', { ref }),

    saveFile: async (name, content) => ({ ok: true, data: 'Téléchargements\\' + download(name, content) }),
    openFile: async () => ({ ok: true, data: null })
  };
})();
