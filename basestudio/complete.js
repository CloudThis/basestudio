// =====================================================================
//  BaseStudio - auto-complétion de l'éditeur SQL
//  Pendant qu'on tape, une petite liste propose :
//    - les tables de la base ouverte (surtout après FROM, JOIN, UPDATE…)
//    - les colonnes des tables utilisées dans la requête
//    - après « table. » ou « alias. » : les colonnes de cette table
//    - les fonctions (COUNT, NOW…) et les mots-clés SQL
//  ↑ ↓ pour choisir · Entrée ou Tab pour valider · Échap pour fermer
//  Ctrl+Espace pour ouvrir la liste à la main.
//  Branché par createEditor() dans app.js (SqlComplete.attach).
// =====================================================================
(function () {
  const FUNCS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW', 'CURDATE', 'CURTIME', 'DATE', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF',
    'YEAR', 'MONTH', 'DAY', 'CONCAT', 'CONCAT_WS', 'UPPER', 'LOWER', 'TRIM', 'LENGTH', 'SUBSTRING', 'REPLACE', 'ROUND', 'FLOOR', 'CEIL',
    'ABS', 'IFNULL', 'COALESCE', 'NULLIF', 'IF', 'GROUP_CONCAT', 'LAST_INSERT_ID', 'RAND', 'MD5', 'SHA2', 'CAST', 'FORMAT'];
  const TABLE_AFTER = ['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'DESCRIBE', 'DESC', 'REFERENCES', 'EXISTS'];
  const MAX = 12;
  const cache = {};

  // Tables et colonnes de la base (gardées 1 minute ; vidées si la structure change)
  // On passe directement par l'API pour ne pas remplir le journal SQL.
  async function schema(db) {
    if (!db) return { tables: {} };
    const c = cache[db];
    if (c && Date.now() - c.at < 60000) return c;
    const res = await window.api.query(
      'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [db], null);
    const tables = {};
    if (res.ok) res.data.results[0].rows.forEach(([t, col, type]) => (tables[t] = tables[t] || []).push({ name: col, type }));
    return (cache[db] = { at: Date.now(), tables });
  }

  // Les tables utilisées dans la requête en cours, et leurs alias (FROM client c -> c = client)
  function tablesInStatement(stmt, tables) {
    const found = {}, re = /\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+`?([\w$]+)`?(?:\s+(?:AS\s+)?`?([\w$]+)`?)?/gi;
    const names = Object.keys(tables), byLower = Object.fromEntries(names.map(n => [n.toLowerCase(), n]));
    let m;
    while ((m = re.exec(stmt))) {
      const t = byLower[m[1].toLowerCase()];
      if (!t) continue;
      found[t.toLowerCase()] = t;
      if (m[2] && !KW.has(m[2].toUpperCase())) found[m[2].toLowerCase()] = t;
    }
    // FROM a, b
    const list = stmt.match(/\bFROM\s+([\w$`]+(?:\s+(?:AS\s+)?[\w$`]+)?(?:\s*,\s*[\w$`]+(?:\s+(?:AS\s+)?[\w$`]+)?)+)/i);
    if (list) list[1].split(',').forEach(part => {
      const [t, a] = part.trim().replace(/`/g, '').split(/\s+/).filter(x => x.toUpperCase() !== 'AS');
      const real = byLower[(t || '').toLowerCase()];
      if (real) { found[real.toLowerCase()] = real; if (a && !KW.has(a.toUpperCase())) found[a.toLowerCase()] = real; }
    });
    return found;
  }

  // Une seule liste pour tous les éditeurs, posée au-dessus de tout (position fixe)
  let pop = null, owner = null, ownerAccept = null;
  function getPop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'ac-pop';
    pop.hidden = true;
    document.body.appendChild(pop);
    pop.addEventListener('mousedown', e => {
      e.preventDefault();   // garde le curseur dans l'éditeur
      const it = e.target.closest('[data-ac]');
      if (it && ownerAccept) ownerAccept(Number(it.dataset.ac));
    });
    return pop;
  }

  function attach(ta, refresh) {
    const pop = getPop();
    let items = [], sel = 0, ctx = null, token = 0;

    const close = () => { if (owner === ta) { pop.hidden = true; owner = null; } items = []; ctx = null; };
    const isOpen = () => owner === ta && !pop.hidden;

    // Où est le curseur, en pixels (police à chasse fixe, pas de retour à la ligne)
    const caretXY = before => {
      const cs = getComputedStyle(ta);
      const cv = caretXY.cv || (caretXY.cv = document.createElement('canvas').getContext('2d'));
      cv.font = cs.fontSize + ' ' + cs.fontFamily;
      const cw = cv.measureText('M').width, lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      const lines = before.split('\n');
      return {
        x: parseFloat(cs.paddingLeft) + lines[lines.length - 1].length * cw - ta.scrollLeft,
        y: parseFloat(cs.paddingTop) + lines.length * lh - ta.scrollTop
      };
    };

    async function suggest(manual) {
      const my = ++token;
      const pos = ta.selectionStart;
      if (pos !== ta.selectionEnd) return close();
      const text = ta.value, before = text.slice(0, pos);
      // pas dans une chaîne ou un commentaire
      const line = before.slice(before.lastIndexOf('\n') + 1);
      if (/--/.test(line) || ((line.match(/'/g) || []).length % 2)) return close();

      let qual = null, prefix, start;
      const mq = before.match(/(?:`([^`]+)`|([A-Za-z_][\w$]*))\.`?([\w$]*)$/);
      if (mq) { qual = mq[1] || mq[2]; prefix = mq[3]; }
      else { const mw = before.match(/([A-Za-z_][\w$]*)$/); prefix = mw ? mw[1] : ''; }
      start = pos - prefix.length;
      if (!qual && !manual && prefix.length < 1) return close();

      const db = state.db;
      const sc = await schema(db);
      if (my !== token) return;   // on a retapé entre-temps
      const tables = sc.tables, tnames = Object.keys(tables);
      const stmtStart = text.lastIndexOf(';', pos - 1) + 1, stmtEnd = text.indexOf(';', pos);
      const stmt = text.slice(stmtStart, stmtEnd < 0 ? text.length : stmtEnd);
      const used = tablesInStatement(stmt, tables);
      const p = prefix.toLowerCase();
      const out = [];
      const push = (text, kind, hint) => out.push({ text, kind, hint });

      if (qual) {
        const t = used[qual.toLowerCase()] || tnames.find(n => n.toLowerCase() === qual.toLowerCase());
        if (!t) return close();
        (tables[t] || []).forEach(c => push(c.name, 'col', c.type));
        push('*', 'col', 'toutes les colonnes');
      } else {
        const prevWord = (before.slice(0, start).match(/([A-Za-z_]+)\s*`?$/) || [])[1];
        const wantTable = prevWord && TABLE_AFTER.includes(prevWord.toUpperCase());
        if (!db && prevWord && /^(USE|DATABASE)$/i.test(prevWord)) state.dbs.forEach(d => push(d, 'db', 'base'));
        tnames.forEach(t => push(t, 'table', (tables[t] || []).length + ' colonnes'));
        if (!wantTable) {
          const seen = new Set();
          Object.values(used).forEach(t => (tables[t] || []).forEach(c => {
            if (seen.has(c.name)) return; seen.add(c.name);
            push(c.name, 'col', t + ' · ' + c.type);
          }));
          FUNCS.forEach(f => push(f, 'fn', 'fonction'));
          KEYWORDS.forEach(k => push(k, 'kw', ''));
        }
      }

      // filtre : d'abord ce qui commence par le texte tapé, puis ce qui le contient
      const rank = it => { const n = it.text.toLowerCase(); return n.startsWith(p) ? 0 : n.includes(p) && p.length > 1 ? 1 : 9; };
      const order = { col: 0, table: 1, db: 1, fn: 2, kw: 3 };
      let list = out.filter(it => rank(it) < 9 || !p)
        .sort((a, b) => (a.text === '*') - (b.text === '*') || rank(a) - rank(b) || order[a.kind] - order[b.kind] || a.text.length - b.text.length)
        .filter((it, i, arr) => arr.findIndex(x => x.text === it.text && x.kind === it.kind) === i)
        .slice(0, MAX);
      // inutile de proposer exactement ce qui est déjà tapé
      if (list.length === 1 && list[0].text.toLowerCase() === p && !qual) list = [];
      if (!list.length) return close();

      items = list; sel = 0; ctx = { start, end: pos };
      owner = ta; ownerAccept = accept;
      draw();
      pop.hidden = false;
      const r = ta.getBoundingClientRect(), xy = caretXY(before.slice(0, start));
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const x = r.left + Math.max(0, Math.min(xy.x, r.width - 40));
      let y = r.top + Math.min(xy.y, r.height) + 2;
      // pas de place en bas de l'écran : la liste s'ouvre au-dessus de la ligne
      if (y + pop.offsetHeight > window.innerHeight - 8) y = r.top + xy.y - lh - pop.offsetHeight - 4;
      pop.style.left = Math.max(4, Math.min(x, window.innerWidth - pop.offsetWidth - 8)) + 'px';
      pop.style.top = Math.max(4, y) + 'px';
    }

    const ICO = { col: '▪', table: '▦', db: '🗄', fn: 'ƒ', kw: 'K' };
    function draw() {
      pop.innerHTML = items.map((it, i) => '<div class="ac-item' + (i === sel ? ' sel' : '') + '" data-ac="' + i + '">' +
        '<span class="ac-ico ac-' + it.kind + '">' + ICO[it.kind] + '</span><span class="ac-name">' + h(it.text) + '</span>' +
        '<span class="ac-hint">' + h(it.hint) + '</span></div>').join('');
      const s = $('.sel', pop); if (s) s.scrollIntoView({ block: 'nearest' });
    }

    function accept(i) {
      const it = items[i]; if (!it || !ctx) return close();
      let txt = it.text, back = 0;
      if (it.kind === 'fn') { txt += '()'; back = 1; }
      else if ((it.kind === 'table' || it.kind === 'col' || it.kind === 'db') && it.text !== '*' && !/^[A-Za-z_][\w$]*$/.test(txt)) txt = '`' + txt.replace(/`/g, '``') + '`';
      // si on avait ouvert un accent grave, on le ferme
      if (ta.value[ctx.start - 1] === '`' && it.kind !== 'fn' && it.kind !== 'kw') { txt = it.text; if (ta.value[ctx.end] !== '`') txt += '`'; }
      ta.setRangeText(txt, ctx.start, ctx.end, 'end');
      if (back) ta.selectionStart = ta.selectionEnd = ta.selectionStart - back;
      close();
      refresh();
      ta.focus();
    }

    // les touches passent ici AVANT les raccourcis de l'éditeur (Ctrl+Entrée, Tab)
    ta.addEventListener('keydown', e => {
      if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); suggest(true); return; }
      if (!isOpen()) return;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === 'ArrowDown') { stop(); sel = (sel + 1) % items.length; draw(); }
      else if (e.key === 'ArrowUp') { stop(); sel = (sel - 1 + items.length) % items.length; draw(); }
      else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { stop(); accept(sel); }
      else if (e.key === 'Escape') { stop(); close(); }
      else if (e.key === 'Enter') close();
    });
    ta.addEventListener('input', e => {
      if (e.inputType === 'insertText' && /[\w.$`]/.test(e.data || '')) suggest(false);
      else if (e.inputType === 'deleteContentBackward' && isOpen()) suggest(false);
      else close();
    });
    ta.addEventListener('blur', () => setTimeout(close, 150));
    ta.addEventListener('scroll', close);
    ta.addEventListener('mousedown', close);
  }

  window.SqlComplete = { attach, clear: () => { for (const k in cache) delete cache[k]; } };
})();
