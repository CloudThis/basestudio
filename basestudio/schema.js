// =====================================================================
//  BaseStudio - onglet « Schéma » d'une base (façon MERISE)
//    - MCD : les entités (tables) et les associations (ovales) avec
//      leurs cardinalités. Une table qui ne sert qu'à relier deux
//      tables (clé primaire = clés étrangères) devient une association.
//    - MLD : toutes les tables avec leurs colonnes, # = clé étrangère,
//      la flèche va vers la table référencée.
//  Les liens viennent des clés étrangères (FOREIGN KEY) de la base.
//  On déplace les boîtes à la souris (la position est retenue),
//  molette = zoom, glisser le fond = déplacer la vue.
//  Ce fichier est chargé après app.js et utilise ses outils (rows, h...).
// =====================================================================
(function () {
  // l'onglet arrive juste après « Tables »
  TABS.db.splice(1, 0, ['schema', '🔗 Schéma']);

  // ---------- Mémoire (positions des boîtes, noms des associations) ----------
  const readStore = () => { try { return JSON.parse(localStorage.getItem('bs.schema')) || {}; } catch (e) { return {}; } };
  const dbKey = () => (state.server ? state.server.host + ':' + state.server.port : '') + '/' + state.db;
  function loadSaved() {
    const s = readStore()[dbKey()] || {};
    return { mcd: s.mcd || {}, mld: s.mld || {}, names: s.names || {} };
  }
  function save(saved) {
    const all = readStore();
    all[dbKey()] = saved;
    try { localStorage.setItem('bs.schema', JSON.stringify(all)); } catch (e) {}
  }

  // ---------- Mesure du texte (pour la taille des boîtes) ----------
  const ctx = document.createElement('canvas').getContext('2d');
  let FS = 13, UI = 'sans-serif', CODE = 'monospace', RAD = 10;
  function readFonts() {
    const cs = getComputedStyle(document.documentElement);
    FS = Math.round((parseFloat(getComputedStyle(document.body).fontSize) || 14) * 0.95);
    UI = cs.getPropertyValue('--font-ui').trim() || 'sans-serif';
    CODE = cs.getPropertyValue('--font-code').trim() || 'monospace';
    RAD = Math.min(12, parseFloat(cs.getPropertyValue('--radius')) || 10);
  }
  function tw(text, size, weight, family) {
    ctx.font = weight + ' ' + size + 'px ' + family;
    return ctx.measureText(String(text)).width;
  }

  // ---------- Lecture de la structure de la base ----------
  async function loadModel(db) {
    const tabRows = await rows('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [db]);
    const colRows = await rows(
      'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS ' +
      'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [db]);
    const fkRows = await rows(
      'SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME ' +
      'FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_SCHEMA = ? ' +
      'AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION', [db, db]);

    const T = {};
    let views = 0;
    tabRows.forEach(([name, type]) => { if (type === 'VIEW') views++; else T[name] = { name, cols: [], pk: [] }; });
    colRows.forEach(([t, c, type, nul, key]) => {
      if (!T[t]) return;
      T[t].cols.push({ name: c, type, nullable: nul === 'YES', key });
      if (key === 'PRI') T[t].pk.push(c);
    });

    const fks = [], byId = {};
    fkRows.forEach(([cn, t, c, rt, rc]) => {
      if (!T[t] || !T[rt]) return;
      const id = t + '.' + cn;
      if (!byId[id]) { byId[id] = { id, name: cn, from: t, to: rt, cols: [], refCols: [] }; fks.push(byId[id]); }
      byId[id].cols.push(c); byId[id].refCols.push(rc);
    });
    fks.forEach(fk => fk.cols.forEach(c => {
      const col = T[fk.from].cols.find(x => x.name === c);
      if (col) col.fk = fk.to + '.' + fk.refCols[fk.cols.indexOf(c)];
    }));
    return { T, fks, views };
  }

  // Une table « de liaison » (ex : commande_produit) : sa clé primaire n'est faite
  // que de clés étrangères vers au moins 2 tables, et personne ne pointe vers elle.
  function junctionTables(model) {
    const referenced = new Set(model.fks.map(f => f.to));
    const out = new Set();
    Object.values(model.T).forEach(t => {
      const own = model.fks.filter(f => f.from === t.name);
      if (own.length < 2 || !t.pk.length || referenced.has(t.name)) return;
      const fkCols = new Set(own.flatMap(f => f.cols));
      if (!t.pk.every(c => fkCols.has(c))) return;
      if (own.filter(f => f.cols.some(c => t.pk.includes(c))).length >= 2) out.add(t.name);
    });
    return out;
  }

  // Cardinalités d'une clé étrangère
  //   côté table qui porte la clé : 1,1 (obligatoire) ou 0,1 (peut être NULL)
  //   côté table référencée : 0,n, ou 0,1 si la clé étrangère est unique
  function fkCards(model, fk) {
    const t = model.T[fk.from];
    const cols = fk.cols.map(c => t.cols.find(x => x.name === c));
    const child = cols.every(c => c && !c.nullable) ? '1,1' : '0,1';
    const isPk = t.pk.length === fk.cols.length && fk.cols.every(c => t.pk.includes(c));
    const unique = isPk || (fk.cols.length === 1 && cols[0] && cols[0].key === 'UNI');
    return { child, parent: unique ? '0,1' : '0,n' };
  }

  function defaultName(fk) {
    let n = fk.name;
    if (/_ibfk_\d+$/i.test(n) || /^fk_?\d*$/i.test(n)) n = '';
    n = n.replace(/^fk[_-]?/i, '');
    return n || fk.from + '_' + fk.to;
  }

  // ---------- Construction du dessin (boîtes + liens) ----------
  function buildGraph(model, mode, saved) {
    const nodes = [], links = [];
    const pos = saved[mode];
    const tables = Object.values(model.T);

    if (mode === 'mld') {
      tables.forEach(t => nodes.push({
        id: 'e:' + t.name, kind: 'entity', table: t.name, title: t.name,
        tip: t.name + ' · double-clic : ouvrir la structure',
        rows: t.cols.map(c => ({ text: (c.fk ? '#' : '') + c.name, pk: t.pk.includes(c.name), fk: !!c.fk, type: c.type }))
      }));
      model.fks.forEach(fk => links.push({ a: 'e:' + fk.from, b: 'e:' + fk.to, arrow: true }));
    } else {
      const junc = junctionTables(model);
      tables.filter(t => !junc.has(t.name)).forEach(t => nodes.push({
        id: 'e:' + t.name, kind: 'entity', table: t.name, title: t.name,
        tip: t.name + ' · double-clic : ouvrir la structure',
        rows: t.cols.filter(c => !c.fk || t.pk.includes(c.name)).map(c => ({ text: c.name, pk: t.pk.includes(c.name) }))
      }));
      // tables de liaison -> associations avec leurs attributs
      junc.forEach(name => {
        const t = model.T[name], id = 'a:j:' + name;
        nodes.push({
          id, kind: 'assoc', table: name, title: saved.names[id] || name,
          tip: 'Association (table « ' + name + ' ») · double-clic : renommer',
          rows: t.cols.filter(c => !c.fk).map(c => ({ text: c.name }))
        });
        model.fks.filter(f => f.from === name).forEach(f => links.push({ a: id, b: 'e:' + f.to, card: '0,n' }));
      });
      // les autres clés étrangères -> une association entre 2 entités
      model.fks.filter(f => !junc.has(f.from)).forEach(fk => {
        const id = 'a:fk:' + fk.id, c = fkCards(model, fk);
        nodes.push({
          id, kind: 'assoc', title: saved.names[id] || defaultName(fk), rows: [],
          tip: fk.from + '.' + fk.cols.join(', ') + ' → ' + fk.to + '.' + fk.refCols.join(', ') + ' · double-clic : renommer'
        });
        links.push({ a: id, b: 'e:' + fk.from, card: c.child });
        links.push({ a: id, b: 'e:' + fk.to, card: c.parent });
      });
    }

    nodes.forEach(n => {
      measure(n, mode);
      if (pos[n.id]) { n.x = pos[n.id][0]; n.y = pos[n.id][1]; }
    });
    return { nodes, links, byId: Object.fromEntries(nodes.map(n => [n.id, n])) };
  }

  const headH = () => Math.round(FS * 2.3);
  const rowH = () => Math.round(FS * 1.65);
  const PADX = 14;

  function measure(n, mode) {
    if (n.kind === 'assoc' && !n.rows.length) {
      n.w = Math.round(tw(n.title, FS, 600, UI) * 1.15 + 44);
      n.h = Math.round(FS * 2.9);
      return;
    }
    let w = tw(n.title, FS * 1.05, 700, UI) + PADX * 2 + 10;
    n.rows.forEach(r => {
      let rw = tw(r.text, FS, r.pk ? 650 : 400, UI) + PADX * 2;
      if (mode === 'mld' && r.type) rw += tw(r.type, FS * 0.86, 400, CODE) + 26;
      w = Math.max(w, rw);
    });
    n.w = Math.round(Math.max(w, n.kind === 'assoc' ? 110 : 130));
    n.h = headH() + n.rows.length * rowH() + (n.rows.length ? 10 : 4);
  }

  // ---------- Placement automatique ----------
  // Les boîtes se repoussent, les liens les rapprochent, puis on enlève
  // les chevauchements. Les boîtes déjà placées (fixed) ne bougent pas.
  function layout(nodes, links, fixed) {
    const N = nodes.length;
    if (!N) return;
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const E = links.map(l => [idx.get(l.a), idx.get(l.b)]).filter(([a, b]) => a !== undefined && b !== undefined && a !== b);
    const r = nodes.map(n => (n.w + n.h) / 4);
    const isFixed = nodes.map(n => fixed.has(n.id));

    // départ : en spirale, ou à côté d'un voisin déjà placé
    const R0 = 40 + Math.sqrt(N) * 70;
    nodes.forEach((n, i) => {
      if (n.x != null) return;
      const nb = E.find(([a, b]) => (a === i && nodes[b].x != null) || (b === i && nodes[a].x != null));
      if (nb) {
        const o = nodes[nb[0] === i ? nb[1] : nb[0]];
        n.x = o.x + 160 + i % 3 * 40; n.y = o.y + (i % 2 ? 120 : -120);
      } else {
        const a = i * 2.39996, rr = R0 * Math.sqrt((i + 0.5) / N);
        n.x = Math.cos(a) * rr; n.y = Math.sin(a) * rr * 0.75;
      }
    });

    if (isFixed.some(f => !f)) {
      const ITER = 450;
      for (let it = 0; it < ITER; it++) {
        const temp = 50 * (1 - it / ITER) + 1;
        const fx = new Float64Array(N), fy = new Float64Array(N);
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          let d = Math.hypot(dx, dy);
          if (d < 0.5) { dx = Math.random() - .5; dy = Math.random() - .5; d = 0.5; }
          const k = r[i] + r[j] + 30;
          if (d > k * 3) continue;   // trop loin : on ne se repousse plus
          const f = k * k / d;
          fx[i] += dx / d * f; fy[i] += dy / d * f;
          fx[j] -= dx / d * f; fy[j] -= dy / d * f;
        }
        E.forEach(([a, b]) => {
          const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
          const d = Math.hypot(dx, dy) || 0.5, k = r[a] + r[b] + 40, f = d * d / k;
          fx[a] -= dx / d * f; fy[a] -= dy / d * f;
          fx[b] += dx / d * f; fy[b] += dy / d * f;
        });
        for (let i = 0; i < N; i++) {
          if (isFixed[i]) continue;
          fx[i] -= nodes[i].x * 0.6; fy[i] -= nodes[i].y * 0.9;
          const m = Math.hypot(fx[i], fy[i]);
          if (m > 0) { const s = Math.min(m, temp) / m; nodes[i].x += fx[i] * s; nodes[i].y += fy[i] * s; }
        }
      }
    }

    // plus aucun chevauchement
    for (let pass = 0; pass < 120; pass++) {
      let moved = false;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        if (isFixed[i] && isFixed[j]) continue;
        const A = nodes[i], B = nodes[j];
        const dx = B.x - A.x, dy = B.y - A.y;
        const ox = (A.w + B.w) / 2 + 40 - Math.abs(dx), oy = (A.h + B.h) / 2 + 34 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const wa = isFixed[i] ? 0 : isFixed[j] ? 1 : 0.5, wb = 1 - wa;
        if (ox < oy) { const s = dx >= 0 ? 1 : -1; A.x -= s * ox * wa; B.x += s * ox * wb; }
        else { const s = dy >= 0 ? 1 : -1; A.y -= s * oy * wa; B.y += s * oy * wb; }
      }
      if (!moved) break;
    }
    nodes.forEach(n => { n.x = Math.round(n.x); n.y = Math.round(n.y); });
  }

  // ---------- Dessin SVG ----------
  function nodeSvg(n) {
    const w = n.w, ht = n.h, x = n.x - w / 2, y = n.y - ht / 2;
    let s = '<g class="sc-node sc-' + n.kind + '" data-id="' + h(n.id) + '" transform="translate(' + x + ',' + y + ')"><title>' + h(n.tip) + '</title>';
    const font = 'font-family:var(--font-ui)';

    if (n.kind === 'assoc' && !n.rows.length) {
      s += '<ellipse class="sc-box" cx="' + w / 2 + '" cy="' + ht / 2 + '" rx="' + w / 2 + '" ry="' + ht / 2 + '" style="fill:var(--surface-2);stroke:var(--accent)" stroke-width="1.6"/>';
      s += '<text x="' + w / 2 + '" y="' + ht / 2 + '" text-anchor="middle" dominant-baseline="central" font-size="' + FS + '" font-weight="600" font-style="italic" style="fill:var(--text);' + font + '">' + h(n.title) + '</text>';
      return s + '</g>';
    }

    const isA = n.kind === 'assoc';
    const rx = isA ? Math.min(22, ht / 2) : RAD, H = headH();
    const color = isA ? 'var(--accent)' : dbColor(n.table);
    s += '<rect class="sc-box" width="' + w + '" height="' + ht + '" rx="' + rx + '" style="fill:var(--surface);stroke:' + (isA ? 'var(--accent)' : 'var(--border)') + '" stroke-width="1.6"/>';
    s += '<path d="M0,' + H + ' V' + rx + ' A' + rx + ',' + rx + ' 0 0 1 ' + rx + ',0 H' + (w - rx) + ' A' + rx + ',' + rx + ' 0 0 1 ' + w + ',' + rx + ' V' + H + ' Z" style="fill:' + color + '" fill-opacity="0.22"/>';
    s += '<line x1="0" y1="' + H + '" x2="' + w + '" y2="' + H + '" style="stroke:' + color + '" stroke-width="1.4" stroke-opacity="0.8"/>';
    s += '<text x="' + w / 2 + '" y="' + H / 2 + '" text-anchor="middle" dominant-baseline="central" font-size="' + Math.round(FS * 1.05) + '" font-weight="700"' + (isA ? ' font-style="italic"' : '') + ' style="fill:var(--text);' + font + '">' + h(n.title) + '</text>';

    n.rows.forEach((r, i) => {
      const ry = H + 5 + rowH() * i + rowH() / 2;
      s += '<text x="' + PADX + '" y="' + ry + '" dominant-baseline="central" font-size="' + FS + '" font-weight="' + (r.pk ? 650 : 400) + '" style="fill:' + (r.fk ? 'var(--accent)' : 'var(--text)') + ';' + font + '">' + h(r.text) + '</text>';
      if (r.pk) {
        const lw = tw(r.text, FS, 650, UI);
        s += '<line x1="' + PADX + '" y1="' + (ry + FS * 0.62) + '" x2="' + (PADX + lw) + '" y2="' + (ry + FS * 0.62) + '" style="stroke:' + (r.fk ? 'var(--accent)' : 'var(--text)') + '" stroke-width="1.1"/>';
      }
      if (r.type) s += '<text x="' + (w - PADX) + '" y="' + ry + '" text-anchor="end" dominant-baseline="central" font-size="' + Math.round(FS * 0.86) + '" style="fill:var(--muted);font-family:var(--font-code)">' + h(r.type) + '</text>';
    });
    return s + '</g>';
  }

  // point d'une courbe de Bézier quadratique
  const qp = (A, C, B, t) => ({ x: (1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * C.x + t * t * B.x, y: (1 - t) * (1 - t) * A.y + 2 * (1 - t) * t * C.y + t * t * B.y });
  const inside = (p, n, m) => Math.abs(p.x - n.x) <= n.w / 2 + m && Math.abs(p.y - n.y) <= n.h / 2 + m;
  // endroit où la courbe sort de la boîte B (avec une marge m)
  function exitT(A, C, B, m) {
    if (inside(A, B, m)) return null;
    let lo = 0, hi = 1;
    for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (inside(qp(A, C, B, mid), B, m)) hi = mid; else lo = mid; }
    return lo;
  }
  function arrowHead(tip, from) {
    const dx = tip.x - from.x, dy = tip.y - from.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d, bx = tip.x - ux * 11, by = tip.y - uy * 11;
    return '<polygon points="' + tip.x + ',' + tip.y + ' ' + (bx - uy * 5.5) + ',' + (by + ux * 5.5) + ' ' + (bx + uy * 5.5) + ',' + (by - ux * 5.5) + '" style="fill:var(--muted)"/>';
  }
  function cardLabel(p, text) {
    const fs = Math.round(FS * 0.88), w = tw(text, fs, 700, UI) + 10, ht = fs + 6;
    return '<rect class="sc-card-bg" x="' + (p.x - w / 2) + '" y="' + (p.y - ht / 2) + '" width="' + w + '" height="' + ht + '" rx="4" style="fill:var(--panel)"/>' +
      '<text x="' + p.x + '" y="' + p.y + '" text-anchor="middle" dominant-baseline="central" font-size="' + fs + '" font-weight="700" style="fill:var(--text);font-family:var(--font-ui)">' + text + '</text>';
  }

  function linksSvg(G) {
    const groups = {};
    G.links.forEach(l => { const k = [l.a, l.b].sort().join('|'); (groups[k] = groups[k] || []).push(l); });
    let s = '';
    Object.values(groups).forEach(list => list.forEach((l, k) => {
      const A = G.byId[l.a], B = G.byId[l.b];
      if (!A || !B) return;
      const line = 'style="fill:none;stroke:var(--muted)" stroke-width="1.6" stroke-opacity="0.85"';
      s += '<g class="sc-link" data-a="' + h(l.a) + '" data-b="' + h(l.b) + '">';

      if (A === B) { // clé étrangère vers sa propre table (MLD)
        const x0 = A.x + A.w / 2, size = 46 + k * 22, y1 = A.y - 10 - k * 8, y2 = A.y + 10 + k * 8;
        s += '<path d="M' + x0 + ',' + y1 + ' C' + (x0 + size) + ',' + (y1 - size * .6) + ' ' + (x0 + size) + ',' + (y2 + size * .6) + ' ' + x0 + ',' + y2 + '" ' + line + '/>';
        if (l.arrow) s += arrowHead({ x: x0, y: y2 }, { x: x0 + size, y: y2 + size * .6 });
        return void (s += '</g>');
      }

      // plusieurs liens entre les mêmes boîtes : on les courbe pour qu'ils ne se cachent pas
      const off = (k - (list.length - 1) / 2) * 46;
      const P = l.a < l.b ? A : B, Q = l.a < l.b ? B : A;
      const dx = Q.x - P.x, dy = Q.y - P.y, len = Math.hypot(dx, dy) || 1;
      const C = { x: (A.x + B.x) / 2 - dy / len * off * 2, y: (A.y + B.y) / 2 + dx / len * off * 2 };
      s += '<path d="M' + A.x + ',' + A.y + ' Q' + C.x + ',' + C.y + ' ' + B.x + ',' + B.y + '" ' + line + '/>';
      if (l.arrow) {
        const t = exitT(A, C, B, 0);
        if (t != null) s += arrowHead(qp(A, C, B, t), qp(A, C, B, Math.max(0, t - 0.05)));
      }
      if (l.card) {
        const t = exitT(A, C, B, 16);
        if (t != null) s += cardLabel(qp(A, C, B, t), l.card);
      }
      s += '</g>';
    }));
    return s;
  }

  // ---------- Le dessin seul, en SVG autonome (pour le dictionnaire de données) ----------
  // palette : { '--text': '#111', ... } remplace les var(--…) (couleurs adaptées à l'impression)
  async function standaloneSvg(db, mode, palette) {
    readFonts();
    const model = await loadModel(db);
    const saved = db === state.db ? loadSaved() : { mcd: {}, mld: {}, names: {} };
    const G = buildGraph(model, mode, saved);
    if (!G.nodes.length) return '';
    const fixed = new Set(G.nodes.filter(n => n.x != null).map(n => n.id));
    if (fixed.size < G.nodes.length) layout(G.nodes, G.links, fixed);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    G.nodes.forEach(n => {
      x1 = Math.min(x1, n.x - n.w / 2); y1 = Math.min(y1, n.y - n.h / 2);
      x2 = Math.max(x2, n.x + n.w / 2 + (mode === 'mld' ? 80 : 0)); y2 = Math.max(y2, n.y + n.h / 2);
    });
    const pad = 20, b = { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    const resolve = str => str.replace(/var\((--[\w-]+)\)/g, (m, v) => String(palette[v] || '#888').replace(/"/g, "'"));
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(b.w) + '" height="' + Math.ceil(b.h) + '" viewBox="' + b.x + ' ' + b.y + ' ' + b.w + ' ' + b.h + '">' +
      resolve(linksSvg(G) + G.nodes.map(nodeSvg).join('')) + '</svg>';
  }
  window.SchemaDraw = { svg: standaloneSvg };

  // ---------- L'écran ----------
  VIEWS['db:schema'] = async view => {
    readFonts();
    const db = state.db;
    const model = await loadModel(db);
    if (state.db !== db || state.tab !== 'schema') return;   // on a changé d'écran entre-temps
    const saved = loadSaved();
    let mode = localStorage.getItem('bs.schema.mode') === 'mld' ? 'mld' : 'mcd';
    const nbTables = Object.keys(model.T).length;

    if (!nbTables) {
      view.innerHTML = '<div class="empty"><span class="big-ico">🔗</span>Cette base n\'a pas encore de table : rien à dessiner.</div>';
      return;
    }

    view.innerHTML =
      '<div class="sc-bar">' +
      '<div class="seg"><button data-mode="mcd" title="Modèle conceptuel : entités, associations, cardinalités">MCD</button>' +
      '<button data-mode="mld" title="Modèle logique : tables, colonnes, clés">MLD</button></div>' +
      '<span class="muted small" id="sc-info"></span>' +
      '<div class="sc-bar-r">' +
      '<button class="btn small" data-sc="zoom-out" title="Dézoomer">−</button>' +
      '<button class="btn small" data-sc="fit" title="Tout afficher">Ajuster</button>' +
      '<button class="btn small" data-sc="zoom-in" title="Zoomer">＋</button>' +
      (window.Relations ? '<button class="btn small" data-sc="link" title="Tire un trait d\'une table vers une autre pour créer une clé étrangère">🔗 Relier</button>' : '') +
      '<button class="btn small" data-sc="dico" title="Document qui décrit toutes les tables (à imprimer ou en PDF)">📖 Dictionnaire</button>' +
      '<button class="btn small" data-sc="arrange" title="Replacer toutes les boîtes automatiquement">✨ Réorganiser</button>' +
      '<button class="btn small" data-sc="png">⬇ PNG</button>' +
      '<button class="btn small" data-sc="svg">⬇ SVG</button>' +
      '<button class="btn small" data-sc="full" title="Plein écran">⛶</button></div></div>' +
      (model.fks.length ? '' : '<div class="alert info">Aucune clé étrangère (FOREIGN KEY) dans cette base : les tables sont dessinées sans liens. ' +
        'Clique sur <b>🔗 Relier</b> puis tire un trait d\'une table vers une autre pour en créer une.</div>') +
      '<div class="sc-wrap"><svg class="sc-svg" xmlns="http://www.w3.org/2000/svg"><g class="sc-world"><g class="sc-links"></g><g class="sc-nodes"></g><g class="sc-temp"></g></g></svg>' +
      '<div class="sc-help" id="sc-help">Glisse une boîte pour la déplacer · glisse le fond pour te déplacer · molette pour zoomer · double-clic pour ouvrir ou renommer</div></div>' +
      '<div class="sc-legend" id="sc-legend"></div>';

    const wrap = $('.sc-wrap', view), svg = $('.sc-svg', view), world = $('.sc-world', view);
    const linksG = $('.sc-links', view), nodesG = $('.sc-nodes', view);
    let G, cam = { s: 1, x: 0, y: 0 };

    const applyCam = () => world.setAttribute('transform', 'translate(' + cam.x + ',' + cam.y + ') scale(' + cam.s + ')');
    const drawLinks = () => { linksG.innerHTML = linksSvg(G); };
    const savePositions = () => {
      saved[mode] = Object.fromEntries(G.nodes.map(n => [n.id, [n.x, n.y]]));
      save(saved);
    };
    function bbox(pad) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      G.nodes.forEach(n => {
        x1 = Math.min(x1, n.x - n.w / 2); y1 = Math.min(y1, n.y - n.h / 2);
        x2 = Math.max(x2, n.x + n.w / 2 + (mode === 'mld' ? 80 : 0)); y2 = Math.max(y2, n.y + n.h / 2);
      });
      return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    }
    function fit() {
      const b = bbox(30), W = wrap.clientWidth, H = wrap.clientHeight;
      cam.s = Math.max(0.08, Math.min(1.25, W / b.w, H / b.h));
      cam.x = (W - b.w * cam.s) / 2 - b.x * cam.s;
      cam.y = (H - b.h * cam.s) / 2 - b.y * cam.s;
      applyCam();
    }
    function zoomAt(px, py, f) {
      const s = Math.max(0.08, Math.min(3, cam.s * f));
      cam.x = px - (px - cam.x) * s / cam.s;
      cam.y = py - (py - cam.y) * s / cam.s;
      cam.s = s; applyCam();
    }

    function draw(relayout) {
      readFonts();
      G = buildGraph(model, mode, relayout ? { mcd: {}, mld: {}, names: saved.names } : saved);
      const fixed = new Set(G.nodes.filter(n => n.x != null).map(n => n.id));
      if (fixed.size < G.nodes.length) { layout(G.nodes, G.links, fixed); savePositions(); }
      nodesG.innerHTML = G.nodes.map(nodeSvg).join('');
      drawLinks();
      $$('[data-mode]', view).forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      const nE = G.nodes.filter(n => n.kind === 'entity').length, nA = G.nodes.length - nE;
      $('#sc-info', view).textContent = mode === 'mcd'
        ? nE + ' entité' + (nE > 1 ? 's' : '') + ' · ' + nA + ' association' + (nA > 1 ? 's' : '')
        : nE + ' table' + (nE > 1 ? 's' : '') + ' · ' + model.fks.length + ' clé' + (model.fks.length > 1 ? 's' : '') + ' étrangère' + (model.fks.length > 1 ? 's' : '');
      if (model.views) $('#sc-info', view).textContent += ' · ' + model.views + ' vue(s) non dessinée(s)';
      $('#sc-legend', view).innerHTML = mode === 'mcd'
        ? '<b>Cardinalités (min,max)</b> : <code>0,1</code> zéro ou un · <code>1,1</code> exactement un · <code>0,n</code> zéro ou plusieurs. ' +
          'Les ovales sont les associations (double-clic pour leur donner un verbe, ex. « passer »). Souligné = identifiant.'
        : '<u>Souligné</u> = clé primaire · <span style="color:var(--accent)">#colonne</span> = clé étrangère · la flèche va vers la table référencée.';
    }

    // ---- souris : déplacer une boîte, déplacer la vue, double-clic ----
    let drag = null, lastClick = { id: null, t: 0 }, linking = false, linkFrom = null;
    const tempG = $('.sc-temp', view);
    const HELP = $('#sc-help', view).textContent;
    const toWorld = e => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - cam.x) / cam.s, y: (e.clientY - r.top - cam.y) / cam.s }; };
    const nodeAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); const g = el && el.closest && el.closest('.sc-node'); return g ? G.byId[g.dataset.id] : null; };
    function setLinking(on) {
      linking = on;
      wrap.classList.toggle('linking', on);
      const b = $('[data-sc="link"]', view); if (b) b.classList.toggle('primary', on);
      $('#sc-help', view).textContent = on ? '🔗 Tire un trait depuis la table qui reçoit la clé (ex : commande) vers la table référencée (ex : client) · Échap pour arrêter' : HELP;
    }
    wrap.tabIndex = 0;
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && linking) setLinking(false); });

    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const g = e.target.closest('.sc-node');
      // mode « Relier » : on part d'une table
      if (linking && g) {
        const n = G.byId[g.dataset.id];
        if (!n.table) return toast('Pars d\'une table (pas d\'une association)', 'error');
        linkFrom = n;
        svg.setPointerCapture(e.pointerId);
        return;
      }
      drag = { id: g ? g.dataset.id : null, sx: e.clientX, sy: e.clientY, moved: false };
      if (g) { const n = G.byId[g.dataset.id]; drag.ox = n.x; drag.oy = n.y; drag.el = g; }
      else { drag.ox = cam.x; drag.oy = cam.y; wrap.classList.add('panning'); }
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (linkFrom) {
        const p = toWorld(e), t = nodeAt(e);
        tempG.innerHTML = '<line x1="' + linkFrom.x + '" y1="' + linkFrom.y + '" x2="' + p.x + '" y2="' + p.y + '" class="sc-temp-line"/>' +
          (t && t.table ? '<rect x="' + (t.x - t.w / 2 - 4) + '" y="' + (t.y - t.h / 2 - 4) + '" width="' + (t.w + 8) + '" height="' + (t.h + 8) + '" rx="12" class="sc-temp-target"/>' : '');
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.id) {
        const n = G.byId[drag.id];
        n.x = Math.round(drag.ox + dx / cam.s); n.y = Math.round(drag.oy + dy / cam.s);
        drag.el.setAttribute('transform', 'translate(' + (n.x - n.w / 2) + ',' + (n.y - n.h / 2) + ')');
        drawLinks();
      } else { cam.x = drag.ox + dx; cam.y = drag.oy + dy; applyCam(); }
    });
    const endDrag = e => {
      if (linkFrom) {
        const from = linkFrom, to = e && e.type === 'pointerup' ? nodeAt(e) : null;
        linkFrom = null; tempG.innerHTML = '';
        if (to && to.table) Relations.fkModal({ db: state.db, table: from.table, refTable: to.table, onDone: () => render() });
        return;
      }
      if (!drag) return;
      const d = drag; drag = null;
      wrap.classList.remove('panning');
      if (d.id && d.moved) savePositions();
      if (d.id && !d.moved) {
        const now = Date.now();
        if (lastClick.id === d.id && now - lastClick.t < 400) { lastClick = { id: null, t: 0 }; openNode(G.byId[d.id]); }
        else lastClick = { id: d.id, t: now };
      }
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    // survol d'une boîte : ses liens s'allument
    nodesG.addEventListener('pointerover', e => {
      const g = e.target.closest('.sc-node'); if (!g) return;
      $$('.sc-link', linksG).forEach(l => l.classList.toggle('hl', l.dataset.a === g.dataset.id || l.dataset.b === g.dataset.id));
    });
    nodesG.addEventListener('pointerout', e => {
      if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.sc-node')) $$('.sc-link.hl', linksG).forEach(l => l.classList.remove('hl'));
    });

    function openNode(n) {
      if (n.kind === 'entity') return go(state.db, n.table, 'structure');
      modal('<h3>Nom de l\'association</h3><p>En MERISE, on lui donne souvent un verbe : « passer », « contenir », « appartenir »…</p>' +
        '<label class="field"><span>Nom</span><input id="sc-name" value="' + h(n.title) + '" spellcheck="false"></label>' +
        '<p class="muted small">Ce nom n\'est gardé que dans BaseStudio : la base n\'est pas modifiée.</p>' +
        '<div class="modal-actions"><button class="btn ghost" data-x>Annuler</button>' +
        (n.table ? '<button class="btn" data-open>Ouvrir la table « ' + h(n.table) + ' »</button>' : '') +
        '<button class="btn" data-reset>Nom par défaut</button><button class="btn primary" data-ok>Enregistrer</button></div>',
        (back, close) => {
          const done = name => {
            if (name) saved.names[n.id] = name; else delete saved.names[n.id];
            save(saved); close(); draw(false);
          };
          $('[data-x]', back).onclick = close;
          $('[data-reset]', back).onclick = () => done('');
          $('[data-ok]', back).onclick = () => done($('#sc-name', back).value.trim());
          $('#sc-name', back).onkeydown = e => { if (e.key === 'Enter') done($('#sc-name', back).value.trim()); };
          if (n.table) $('[data-open]', back).onclick = () => { close(); go(state.db, n.table, 'structure'); };
        });
    }

    // ---- export ----
    function svgString() {
      const b = bbox(30), cs = getComputedStyle(document.documentElement);
      const resolve = str => str.replace(/var\((--[\w-]+)\)/g, (m, v) => (cs.getPropertyValue(v).trim() || '#888').replace(/"/g, "'"));
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(b.w) + '" height="' + Math.ceil(b.h) + '" viewBox="' + b.x + ' ' + b.y + ' ' + b.w + ' ' + b.h + '">' +
        '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" style="fill:' + resolve('var(--bg)') + '"/>' +
        resolve(linksG.innerHTML + nodesG.innerHTML) + '</svg>';
    }
    const fileName = ext => state.db + '_' + mode + '.' + ext;
    function exportPng() {
      const str = svgString(), b = bbox(30);
      const scale = Math.max(1, Math.min(2, 8000 / Math.max(b.w, b.h)));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.ceil(b.w * scale); c.height = Math.ceil(b.h * scale);
        const x = c.getContext('2d'); x.scale(scale, scale); x.drawImage(img, 0, 0);
        const a = document.createElement('a');
        a.href = c.toDataURL('image/png'); a.download = fileName('png');
        document.body.appendChild(a); a.click(); a.remove();
        toast('Image enregistrée : Téléchargements\\' + fileName('png'), 'success');
      };
      img.onerror = () => toast('Impossible de créer l\'image', 'error');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
    }

    // ---- boutons ----
    view.querySelector('.sc-bar').addEventListener('click', e => {
      const m = e.target.closest('[data-mode]');
      if (m && m.dataset.mode !== mode) {
        mode = m.dataset.mode; localStorage.setItem('bs.schema.mode', mode);
        draw(false); fit(); return;
      }
      const b = e.target.closest('[data-sc]'); if (!b) return;
      const W = wrap.clientWidth / 2, H = wrap.clientHeight / 2;
      switch (b.dataset.sc) {
        case 'zoom-in': zoomAt(W, H, 1.25); break;
        case 'zoom-out': zoomAt(W, H, 0.8); break;
        case 'fit': fit(); break;
        case 'arrange': draw(true); fit(); break;
        case 'link': setLinking(!linking); break;
        case 'dico': if (window.Dictionary) Dictionary.open(state.db); break;
        case 'png': exportPng(); break;
        case 'svg': saveText(fileName('svg'), svgString(), 'svg'); break;
        case 'full':
          if (document.fullscreenElement) document.exitFullscreen();
          else if (wrap.requestFullscreen) wrap.requestFullscreen();
          break;
      }
    });
    wrap.addEventListener('fullscreenchange', () => setTimeout(fit, 60));

    draw(false);
    fit();
  };
})();
