// =====================================================================
//  BaseStudio - mettre en forme le SQL (bouton « ✨ Mettre en forme »
//  de l'éditeur, ou Ctrl+Maj+F)
//  Mots-clés en MAJUSCULES, une clause par ligne (SELECT, FROM, WHERE,
//  JOIN, GROUP BY…), une colonne par ligne dans le SELECT, les AND / OR
//  à la ligne, les sous-requêtes décalées, et les colonnes d'un
//  CREATE TABLE l'une sous l'autre. Textes et commentaires ne sont pas
//  touchés. Le code des procédures / triggers (BEGIN … END) est laissé tel quel.
// =====================================================================
(function () {
  const TOKENS = /(\s+)|(--[^\n]*|#[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|('(?:\\.|''|[^'\\])*'?|"(?:\\.|""|[^"\\])*"?)|(`[^`]*`?)|(\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(@{0,2}[A-Za-z_$][\w$]*)|(<=>|<>|!=|<=|>=|:=|\|\||&&|[=<>+\-*\/%!~^&|])|([(),;.])/gi;
  const CLAUSE = new Set(['SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'VALUES', 'UNION', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'SET', 'WINDOW']);
  const JOINMOD = new Set(['LEFT', 'RIGHT', 'INNER', 'CROSS', 'FULL', 'NATURAL', 'OUTER']);
  // mots-clés collés à leur parenthèse : INT(11), IF(…), REPLACE(…)
  const TIGHT = new Set(['INT', 'INTEGER', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'VARCHAR', 'CHAR', 'ENUM', 'IF', 'REPLACE',
    'LEFT', 'RIGHT', 'YEAR', 'TIME', 'DATE', 'TIMESTAMP', 'DATETIME', 'CURRENT_TIMESTAMP', 'CHARSET', 'BINARY', 'VARBINARY', 'BIT', 'TEXT', 'BLOB', 'JSON']);

  // noms de moteurs : on garde l'écriture habituelle (InnoDB, MyISAM)
  const KEEP = new Set(['INNODB', 'MYISAM']);
  // un nom suivi de « ( » prend un espace après ces mots : INTO t (a, b), TABLE t (…), REFERENCES t (id)
  const NAME_SPACE = new Set(['INTO', 'TABLE', 'REFERENCES', 'EXISTS', 'JOIN', 'VIEW']);

  function tokenize(sql) {
    const out = []; let m;
    TOKENS.lastIndex = 0;
    while ((m = TOKENS.exec(sql))) {
      if (!m[0]) { TOKENS.lastIndex++; continue; }
      const t = m[1] ? 'ws' : m[2] ? 'lc' : m[3] ? 'bc' : m[4] ? 'str' : m[5] ? 'id' : m[6] ? 'num' : m[7] ? 'word' : m[8] ? 'op' : m[0];
      out.push({ t, v: m[0], U: m[7] ? m[0].toUpperCase() : null });
    }
    return out;
  }

  function format(sql) {
    const all = tokenize(sql);
    if (all.some(x => x.U === 'BEGIN' || x.U === 'DELIMITER')) return null;   // code de procédure : on n'y touche pas
    const toks = all.filter(x => x.t !== 'ws');
    let prev2 = null, out = '', depth = 0, frames = [{ indent: 0, depth: 0, clause: '' }], between = false, table = 0, first = null, prev = null, unary = false;
    const frame = () => frames[frames.length - 1];
    const nl = ind => { out = out.replace(/[ \t]+$/, '') + '\n' + ' '.repeat(ind); };
    const atLineStart = () => /(^|\n) *$/.test(out);
    const word = i => { for (let j = i; j < toks.length; j++) if (toks[j].t !== 'lc' && toks[j].t !== 'bc') return toks[j]; return null; };
    const isKw = x => x && x.t === 'word' && KW.has(x.U);

    function emit(x, text) {
      let space = !atLineStart() && out !== '';
      if ([',', ')', ';', '.'].includes(x.t)) space = false;
      if (prev && (prev.t === '(' || prev.t === '.')) space = false;
      if (unary) { space = false; unary = false; }
      if (x.t === '(' && prev && (prev.t === 'id' || (prev.t === 'word' && (!KW.has(prev.U) || TIGHT.has(prev.U))))) space = false;
      if (x.t === '(' && prev && prev2 && prev2.t === 'word' && NAME_SPACE.has(prev2.U) && (prev.t === 'id' || prev.t === 'word')) space = true;
      // VALUES(col) dans ON DUPLICATE KEY UPDATE, mais VALUES (…) dans un INSERT
      if (x.t === '(' && prev && prev.U === 'VALUES') space = !(prev2 && prev2.t === 'op');
      out += (space ? ' ' : '') + text;
      if (x.t !== 'lc' && x.t !== 'bc') { prev2 = prev; prev = x; }
    }

    for (let i = 0; i < toks.length; i++) {
      const x = toks[i], f = frame(), next = word(i + 1);
      if (x.t === 'lc') { emit(x, x.v); nl(f.indent + (f.clause ? 4 : 0)); continue; }
      if (x.t === 'bc') { emit(x, x.v); continue; }
      if (x.t === ';') {
        if (atLineStart()) out = out.replace(/ +$/, '');   // après un commentaire : en début de ligne
        emit(x, ';'); out += '\n\n';
        depth = 0; frames = [{ indent: 0, depth: 0, clause: '' }]; between = false; table = 0; first = null; prev = prev2 = null;
        continue;
      }
      if (x.t === 'word') {
        const U = x.U, afterDot = prev && prev.t === '.', beforeDot = next && next.t === '.';
        const keep = afterDot || beforeDot || !KW.has(U) || KEEP.has(U);
        const pU = prev && prev.t === 'word' ? prev.U : '';
        if (!first) first = U;
        if (!afterDot && !beforeDot && depth === f.depth) {
          let brk = false;
          if (CLAUSE.has(U)) {
            brk = !(U === 'FROM' && pU === 'DELETE') && !(U === 'UPDATE' && (pU === 'ON' || pU === 'KEY')) && !(U === 'DELETE' && pU === 'ON')
              && !(U === 'SET' && (first !== 'UPDATE' || pU === 'CHARACTER')) && !(U === 'VALUES' && prev && prev.t === 'op')
              && !(U === 'REPLACE' && next && next.t === '(');
          } else if ((U === 'GROUP' || U === 'ORDER') && next && next.U === 'BY' && pU !== 'WITHIN') brk = true;
          else if (U === 'ON' && next && next.U === 'DUPLICATE') brk = true;
          else if (JOINMOD.has(U) && !JOINMOD.has(pU) && next && (next.U === 'JOIN' || JOINMOD.has(next.U))) brk = true;
          else if ((U === 'JOIN' || U === 'STRAIGHT_JOIN') && !JOINMOD.has(pU)) brk = true;
          if (brk && out.trim() && !atLineStart()) nl(f.indent);
          if (brk) f.clause = U === 'ORDER' || U === 'GROUP' ? U : JOINMOD.has(U) || U === 'JOIN' ? 'FROM' : U;
          if ((U === 'AND' || U === 'OR') && ['WHERE', 'HAVING', 'FROM'].includes(f.clause)) {
            if (U === 'AND' && between) between = false;
            else nl(f.indent + 4);
          }
        }
        if (U === 'BETWEEN') between = true;
        emit(x, keep ? x.v : U);
        continue;
      }
      if (x.t === ',') {
        emit(x, ',');
        if (table && depth === table) nl(4);
        else if (depth === f.depth && f.clause === 'SELECT') nl(f.indent + 7);
        continue;
      }
      if (x.t === '(') {
        emit(x, '(');
        depth++;
        if (next && next.U === 'SELECT') { frames.push({ indent: f.indent + 4, depth, clause: '' }); nl(f.indent + 4); prev = x; }
        else if (first === 'CREATE' && !table && depth === 1 && /^CREATE\s+(TEMPORARY\s+)?TABLE\b/i.test(out.trim())) { table = 1; nl(4); prev = x; }
        continue;
      }
      if (x.t === ')') {
        if (frames.length > 1 && f.depth === depth) { frames.pop(); nl(frame().indent); prev = null; }
        else if (table && depth === table) { nl(0); prev = null; }
        emit(x, ')');
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (x.t === 'op') {
        // signe d'un nombre (= -1) : pas d'espace après
        const isUnary = (x.v === '-' || x.v === '+') && (!prev || prev.t === 'op' || prev.t === '(' || prev.t === ',' || isKw(prev));
        emit(x, x.v);
        if (isUnary) unary = true;
        continue;
      }
      emit(x, x.v);
    }
    return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- bouton dans l'éditeur SQL ----------
  const orig = VIEWS['sql'];
  VIEWS['sql'] = async view => {
    await orig(view);
    const ta = $('#sql-editor textarea', view);
    if (!ta) return;
    const btn = document.createElement('button');
    btn.className = 'btn small'; btn.textContent = '✨ Mettre en forme'; btn.title = 'Réindenter le SQL (Ctrl+Maj+F) ; seulement la sélection si du texte est sélectionné';
    $('#sql-clear', view).before(btn);
    const apply = () => {
      const sel = ta.selectionStart !== ta.selectionEnd;
      const src = sel ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value;
      if (!src.trim()) return;
      const res = format(src);
      if (res === null) return toast('Le code de procédure / trigger (BEGIN … END) n\'est pas remis en forme', 'error');
      if (res === src.trim()) return toast('C\'est déjà bien rangé 👌');
      if (sel) ta.setRangeText(res, ta.selectionStart, ta.selectionEnd, 'select'); else ta.value = res;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    };
    btn.onclick = apply;
    ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); apply(); } });
  };

  window.SqlFormat = { format };
})();
