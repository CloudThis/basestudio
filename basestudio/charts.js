// =====================================================================
//  BaseStudio - graphiques
//  Sous chaque résultat d'une requête (éditeur SQL, constructeur de
//  requêtes) : bouton « 📊 Graphique ». On choisit le type (barres,
//  courbe, camembert), la colonne des étiquettes et les valeurs.
//  Export en PNG ou SVG.
// =====================================================================
(function () {
  const PALETTE = ['#5b8def', '#f2a03d', '#4fbf8a', '#e8615a', '#a77bf3', '#3cc4c9', '#e57bb5', '#b5c23b', '#8d99ae', '#f07c3c'];
  const TYPES = [['bar', '📊 Barres'], ['line', '📈 Courbe'], ['pie', '🥧 Camembert']];
  const W = 760, H = 400, MAX = 60;
  const isNum = v => v !== null && v !== '' && !isNaN(Number(v));
  const num = v => isNum(v) ? Number(v) : 0;
  const short = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const fmt = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1).replace('.', ',') + ' k' : String(Math.round(v * 100) / 100).replace('.', ',');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // un pas « joli » pour les graduations (1, 2, 5, 10, 20…)
  function niceStep(max) {
    const raw = max / 5, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // prépare les données : étiquettes + séries (somme si une étiquette revient plusieurs fois)
  function prepare(result, xi, ys, group) {
    let labels = [], series = ys.map(() => []);
    const at = new Map();
    result.rows.forEach(r => {
      const lab = r[xi] === null ? 'NULL' : String(r[xi]);
      if (group && at.has(lab)) { const k = at.get(lab); ys.forEach((y, j) => series[j][k] += num(r[y])); return; }
      at.set(lab, labels.length); labels.push(lab);
      ys.forEach((y, j) => series[j].push(num(r[y])));
    });
    const cut = labels.length > MAX;
    if (cut) { labels = labels.slice(0, MAX); series = series.map(s => s.slice(0, MAX)); }
    return { labels, series, cut };
  }

  function svg(result, o) {
    const cs = getComputedStyle(document.documentElement);
    const col = v => cs.getPropertyValue(v).trim() || '#888';
    const text = col('--text'), muted = col('--muted'), border = col('--border'), bg = col('--panel');
    const xi = result.columns.indexOf(o.x), ys = o.y.map(c => result.columns.indexOf(c));
    const d = prepare(result, xi, ys, o.group);
    let body = '';
    const font = 'font-family="Segoe UI, sans-serif"';

    if (o.type === 'pie') {
      // camembert : la première série, 10 parts au maximum (le reste dans « Autres »)
      let parts = d.labels.map((l, i) => [l, Math.max(0, d.series[0][i])]).sort((a, b) => b[1] - a[1]);
      if (parts.length > 10) parts = [...parts.slice(0, 9), ['Autres', parts.slice(9).reduce((a, p) => a + p[1], 0)]];
      const total = parts.reduce((a, p) => a + p[1], 0) || 1, cx = 210, cy = H / 2 + 10, r = 150;
      let a0 = -Math.PI / 2;
      parts.forEach(([lab, v], i) => {
        const a1 = a0 + v / total * Math.PI * 2, c = PALETTE[i % PALETTE.length];
        if (v / total > 0.9999) body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + c + '"/>';
        else if (v > 0) body += '<path d="M' + cx + ' ' + cy + ' L' + (cx + r * Math.cos(a0)).toFixed(1) + ' ' + (cy + r * Math.sin(a0)).toFixed(1) +
          ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ' 1 ' + (cx + r * Math.cos(a1)).toFixed(1) + ' ' + (cy + r * Math.sin(a1)).toFixed(1) + ' Z" fill="' + c + '" stroke="' + bg + '" stroke-width="2"><title>' + esc(lab) + ' : ' + fmt(v) + '</title></path>';
        const ly = 50 + i * 30;
        body += '<rect x="410" y="' + (ly - 11) + '" width="14" height="14" rx="3" fill="' + c + '"/>' +
          '<text x="432" y="' + ly + '" fill="' + text + '" font-size="13" ' + font + '>' + esc(short(lab, 28)) + ' <tspan fill="' + muted + '">' + fmt(v) + ' (' + (v / total * 100).toFixed(1).replace('.', ',') + ' %)</tspan></text>';
        a0 = a1;
      });
    } else {
      const L = 64, R = 20, T = 30, B = 90, pw = W - L - R, ph = H - T - B;
      const all = d.series.flat(), max = Math.max(0, ...all), min = Math.min(0, ...all);
      const step = niceStep((max - min) || 1), top = Math.ceil(max / step) * step || step, bot = Math.floor(min / step) * step;
      const Y = v => T + ph - (v - bot) / (top - bot) * ph;
      for (let v = bot; v <= top + step / 2; v += step) {
        body += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="' + border + '"' + (v === 0 ? '' : ' stroke-dasharray="3 4"') + '/>' +
          '<text x="' + (L - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" fill="' + muted + '" font-size="11" text-anchor="end" ' + font + '>' + fmt(v) + '</text>';
      }
      const n = d.labels.length || 1, slot = pw / n;
      const every = Math.ceil(n / 30);   // pas plus de 30 étiquettes en bas
      d.labels.forEach((lab, i) => {
        if (i % every) return;
        const x = L + slot * i + slot / 2;
        body += '<text transform="translate(' + x.toFixed(1) + ',' + (T + ph + 14) + ') rotate(' + (n > 8 ? -40 : 0) + ')" fill="' + muted + '" font-size="11" text-anchor="' + (n > 8 ? 'end' : 'middle') + '" ' + font + '>' + esc(short(lab, 16)) + '</text>';
      });
      if (o.type === 'bar') {
        const bw = Math.max(2, slot * 0.8 / d.series.length);
        d.series.forEach((s, j) => s.forEach((v, i) => {
          const x = L + slot * i + slot * 0.1 + bw * j, y = Y(Math.max(0, v)), hh = Math.abs(Y(v) - Y(0));
          body += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 1).toFixed(1) + '" height="' + Math.max(0.5, hh).toFixed(1) + '" rx="2" fill="' + PALETTE[j % PALETTE.length] + '"><title>' + esc(d.labels[i]) + ' · ' + esc(o.y[j]) + ' : ' + fmt(v) + '</title></rect>';
        }));
      } else {
        d.series.forEach((s, j) => {
          const c = PALETTE[j % PALETTE.length], pts = s.map((v, i) => [L + slot * i + slot / 2, Y(v)]);
          body += '<path d="' + pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + '" fill="none" stroke="' + c + '" stroke-width="2.5" stroke-linejoin="round"/>';
          if (pts.length <= 60) pts.forEach((p, i) => body += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="' + c + '"><title>' + esc(d.labels[i]) + ' · ' + esc(o.y[j]) + ' : ' + fmt(s[i]) + '</title></circle>');
        });
      }
      // légende (plusieurs séries)
      if (o.y.length > 1) o.y.forEach((name, j) => {
        body += '<rect x="' + (L + j * 150) + '" y="8" width="12" height="12" rx="3" fill="' + PALETTE[j % PALETTE.length] + '"/><text x="' + (L + j * 150 + 18) + '" y="18" fill="' + text + '" font-size="12" ' + font + '>' + esc(short(name, 18)) + '</text>';
      });
    }
    return {
      cut: d.cut,
      markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><rect width="100%" height="100%" fill="' + bg + '"/>' +
        (o.title ? '<text x="' + (W - 20) + '" y="18" fill="' + muted + '" font-size="12" text-anchor="end" ' + font + '>' + esc(short(o.title, 60)) + '</text>' : '') + body + '</svg>'
    };
  }

  function open(result, title) {
    if (!result || !result.rows.length) return toast('Pas de lignes à mettre en graphique', 'error');
    const cols = result.columns;
    const numeric = cols.filter((c, i) => result.rows.slice(0, 200).every(r => r[i] === null || isNum(r[i])) && result.rows.some(r => isNum(r[i])));
    if (!numeric.length) return toast('Il faut au moins une colonne de nombres pour faire un graphique (ex : COUNT(*), SUM(prix)…)', 'error');
    // étiquettes : la première colonne qui n'est pas un nombre (sinon la première colonne)
    const labelCol = cols.find(c => !numeric.includes(c)) || cols[0];
    const o = { type: 'bar', x: labelCol, y: [numeric.find(c => c !== labelCol) || numeric[0]], group: true, title: title || '' };

    modal('<h3>📊 Graphique</h3>' +
      '<div class="field-row" style="flex-wrap:wrap;align-items:flex-end">' +
      '<div class="seg" id="ch-type">' + TYPES.map(t => '<button class="' + (t[0] === o.type ? 'active' : '') + '" data-type="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
      '<label class="field" style="margin:0"><span>Étiquettes (en bas / parts)</span><select id="ch-x">' + cols.map(c => '<option' + (c === o.x ? ' selected' : '') + '>' + h(c) + '</option>').join('') + '</select></label>' +
      '<label class="check small" style="margin-bottom:8px"><input type="checkbox" id="ch-group" checked> additionner les étiquettes identiques</label></div>' +
      '<div class="field"><span>Valeurs</span><div class="ch-ys">' + numeric.map(c => '<label class="check"><input type="checkbox" data-y="' + h(c) + '"' + (o.y.includes(c) ? ' checked' : '') + '> ' + h(c) + '</label>').join('') + '</div></div>' +
      '<div id="ch-out" class="ch-out"></div><p class="muted small" id="ch-note"></p>' +
      '<div class="modal-actions"><button class="btn" data-exp="svg">⬇ SVG</button><button class="btn" data-exp="png">⬇ PNG</button><button class="btn primary" data-x>Fermer</button></div>',
      (back, close) => {
        back.firstChild.style.maxWidth = '860px'; back.firstChild.style.width = '96vw';
        let current = '';
        const draw = () => {
          o.y = $$('[data-y]', back).filter(c => c.checked).map(c => c.dataset.y);
          if (o.type === 'pie' && o.y.length > 1) o.y = o.y.slice(0, 1);
          if (!o.y.length) { $('#ch-out', back).innerHTML = '<div class="empty">Coche au moins une colonne de valeurs</div>'; current = ''; return; }
          const s = svg(result, o);
          current = s.markup;
          $('#ch-out', back).innerHTML = s.markup;
          $('#ch-note', back).textContent = (s.cut ? 'Seules les ' + MAX + ' premières étiquettes sont dessinées. ' : '') + (o.type === 'pie' ? 'Camembert : une seule colonne de valeurs (la première cochée).' : '');
        };
        $$('[data-type]', back).forEach(b => b.onclick = () => {
          o.type = b.dataset.type;
          $$('[data-type]', back).forEach(x => x.classList.toggle('active', x === b));
          draw();
        });
        $('#ch-x', back).onchange = e => { o.x = e.target.value; draw(); };
        $('#ch-group', back).onchange = e => { o.group = e.target.checked; draw(); };
        $$('[data-y]', back).forEach(c => c.onchange = () => {
          if (o.type === 'pie' && c.checked) $$('[data-y]', back).forEach(x => { if (x !== c) x.checked = false; });
          draw();
        });
        $('[data-x]', back).onclick = close;
        $$('[data-exp]', back).forEach(b => b.onclick = () => {
          if (!current) return;
          const name = 'graphique.' + b.dataset.exp;
          if (b.dataset.exp === 'svg') { window.api.download(name, current, 'image/svg+xml'); return toast('Image enregistrée : Téléchargements\\' + name, 'success'); }
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
            const x = c.getContext('2d'); x.scale(2, 2); x.drawImage(img, 0, 0);
            const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            toast('Image enregistrée : Téléchargements\\' + name, 'success');
          };
          img.onerror = () => toast('Impossible de créer l\'image', 'error');
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(current);
        });
        draw();
      });
  }

  // ajoute le bouton « 📊 Graphique » sous chaque résultat qui a des lignes
  function decorate(out, results) {
    const blocks = $$('.result-block', out);
    results.forEach((r, i) => {
      if (r.type !== 'rows' || !r.rows.length || !blocks[i]) return;
      const head = $('.result-head span', blocks[i]);
      if (!head) return;
      const b = document.createElement('button');
      b.className = 'btn small'; b.textContent = '📊 Graphique';
      b.onclick = () => open(r);
      head.appendChild(document.createTextNode(' ')); head.appendChild(b);
    });
  }

  window.Charts = { open, decorate };
})();
