// =====================================================================
//  BaseStudio - Apparence 100% personnalisable
//  Un "thème" = un simple objet JS. Chaque réglage devient une variable
//  CSS (ex : accent -> --accent, fontSize -> --font-size).
//  Il est sauvegardé dans le localStorage de l'appli.
// =====================================================================
(function () {

  // ---------- Thème de base ("Nuit") ----------
  const DEFAULT = {
    // couleurs générales
    bg: '#0e0f13', panel: '#16171d', sidebar: '#1a1b22', surface: '#1d1e26', surface2: '#272833',
    border: '#2a2b36', text: '#ecebf2', muted: '#8f8ea3',
    accent: '#ff7a5c', accentText: '#1a0c08',
    success: '#3dd68c', danger: '#ff5470', warning: '#ffc65c', info: '#5cc8ff',
    // tableaux
    gridHeader: '#1b1c24', gridStripe: '#14151b', gridHover: '#24252f',
    // éditeur SQL
    editorBg: '#111218', synKeyword: '#ff9e80', synString: '#a5e075', synNumber: '#ffc65c',
    synComment: '#5e5f76', synFunction: '#7cc7ff', synIdent: '#d7a6ff',
    // typographie
    fontUi: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
    fontCode: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
    googleFonts: '',
    fontSize: 14, codeSize: 13, titleWeight: 700,
    // formes
    radius: 14, borderW: 1, sp: 1, rowH: 36, tileSize: 210, contentW: 1500, shadow: 0.35,
    // effets
    blur: 0, panelOpacity: 100, glow: 1, animations: true,
    // fond d'écran
    bgImage: '', bgImageOpacity: 0.25, bgImageBlur: 0,
    // disposition / nom
    topbar: 'floating', appName: 'BaseStudio', logo: '',
    // CSS libre
    customCss: ''
  };

  // ---------- Thèmes prêts à l'emploi ----------
  const PRESETS = {
    'Corail': {},
    'Violet nuit': {
      bg: '#0d0f14', panel: '#151821', sidebar: '#11131a', surface: '#1b1f2a', surface2: '#232838',
      border: '#262b3a', text: '#e7e9f0', muted: '#8a90a6', accent: '#8b7cff', accentText: '#ffffff',
      success: '#3ecf8e', danger: '#ff5c7a', warning: '#ffb547', info: '#4cc2ff',
      gridHeader: '#1b1f2a', gridStripe: '#171a24', gridHover: '#22273a',
      editorBg: '#10121a', synKeyword: '#c792ea', synString: '#c3e88d', synNumber: '#f78c6c',
      synComment: '#5c6488', synFunction: '#82aaff', synIdent: '#ffcb6b', radius: 10
    },
    'Jour': {
      bg: '#f4f5f9', panel: '#ffffff', sidebar: '#eceef5', surface: '#ffffff', surface2: '#e6e9f2',
      border: '#dde1ea', text: '#1b1e28', muted: '#6b7185', accent: '#6a5cff', accentText: '#ffffff',
      success: '#16a34a', danger: '#e11d48', warning: '#d97706', info: '#0284c7',
      gridHeader: '#f1f3f8', gridStripe: '#f9fafc', gridHover: '#eceefb',
      editorBg: '#fbfcfe', synKeyword: '#7c3aed', synString: '#15803d', synNumber: '#ea580c',
      synComment: '#94a3b8', synFunction: '#2563eb', synIdent: '#b45309', shadow: 0.12, glow: 0.6
    },
    'Océan': {
      bg: '#07141f', panel: '#0c1e2c', sidebar: '#0a1924', surface: '#10283a', surface2: '#15344b',
      border: '#1b3a50', text: '#e3f2fb', muted: '#7fa3b8', accent: '#2ec5ff', accentText: '#04121c',
      success: '#34d399', danger: '#fb7185', warning: '#fbbf24', info: '#a78bfa',
      gridHeader: '#0f2433', gridStripe: '#0b1d2a', gridHover: '#143247',
      editorBg: '#081722', synKeyword: '#5eead4', synString: '#bef264', synNumber: '#fda4af',
      synComment: '#4b6b80', synFunction: '#7dd3fc', synIdent: '#fde68a'
    },
    'Forêt': {
      bg: '#0b120e', panel: '#111a14', sidebar: '#0e1611', surface: '#16231b', surface2: '#1d2e23',
      border: '#213326', text: '#e5efe7', muted: '#87a08e', accent: '#4ade80', accentText: '#052e12',
      success: '#86efac', danger: '#f87171', warning: '#facc15', info: '#67e8f9',
      gridHeader: '#15211a', gridStripe: '#0f1813', gridHover: '#1c2d22',
      editorBg: '#0c140f', synKeyword: '#a3e635', synString: '#fde68a', synNumber: '#fb923c',
      synComment: '#4f6b57', synFunction: '#5eead4', synIdent: '#f0abfc'
    },
    'Sakura': {
      bg: '#fff5f8', panel: '#ffffff', sidebar: '#ffedf3', surface: '#ffffff', surface2: '#ffe1eb',
      border: '#f5d0dc', text: '#3a1f2b', muted: '#9a7282', accent: '#ec4899', accentText: '#ffffff',
      success: '#10b981', danger: '#e11d48', warning: '#f59e0b', info: '#8b5cf6',
      gridHeader: '#fff0f5', gridStripe: '#fffafc', gridHover: '#ffe8f0',
      editorBg: '#fffbfd', synKeyword: '#db2777', synString: '#059669', synNumber: '#ea580c',
      synComment: '#c4a1af', synFunction: '#7c3aed', synIdent: '#b45309',
      radius: 16, shadow: 0.1, glow: 0.8
    },
    'Terminal': {
      bg: '#000000', panel: '#050805', sidebar: '#030503', surface: '#0a100a', surface2: '#112211',
      border: '#163316', text: '#b8ffb8', muted: '#4f8a4f', accent: '#33ff66', accentText: '#001a06',
      success: '#33ff66', danger: '#ff3355', warning: '#ffee33', info: '#33ddff',
      gridHeader: '#081108', gridStripe: '#040904', gridHover: '#0e1f0e',
      editorBg: '#020402', synKeyword: '#33ff66', synString: '#ffee33', synNumber: '#33ddff',
      synComment: '#2f5a2f', synFunction: '#88ffaa', synIdent: '#ff99ff',
      fontUi: '"Cascadia Code", Consolas, monospace', radius: 2, glow: 0.4, shadow: 0
    },
    'Coucher de soleil': {
      bg: '#170d14', panel: '#21121c', sidebar: '#1b0f17', surface: '#2a1723', surface2: '#36202e',
      border: '#3a2231', text: '#fbe9f0', muted: '#b48ea0', accent: '#ff7a59', accentText: '#1a0b06',
      success: '#4ade80', danger: '#ff4d6d', warning: '#ffd166', info: '#c084fc',
      gridHeader: '#26151f', gridStripe: '#1d1018', gridHover: '#33202c',
      editorBg: '#140a11', synKeyword: '#ff9e7a', synString: '#ffd166', synNumber: '#f472b6',
      synComment: '#6e4a5c', synFunction: '#c084fc', synIdent: '#7dd3fc'
    },
    'Graphite': {
      bg: '#0b0d10', panel: '#121418', sidebar: '#0e1013', surface: '#171a1f', surface2: '#1f232a',
      border: '#23272f', text: '#e6e8eb', muted: '#8b929c', accent: '#3b82f6', accentText: '#ffffff',
      success: '#22c55e', danger: '#ef4444', warning: '#f59e0b', info: '#06b6d4',
      gridHeader: '#15181d', gridStripe: '#101216', gridHover: '#1b2030',
      editorBg: '#0d0f12', synKeyword: '#60a5fa', synString: '#86efac', synNumber: '#fbbf24',
      synComment: '#5b6370', synFunction: '#c4b5fd', synIdent: '#fda4af', radius: 6, glow: 0.3
    }
  };

  // ---------- Liste des réglages affichés dans le panneau ----------
  const UI_FONTS = ['"Segoe UI Variable", "Segoe UI", system-ui, sans-serif', 'Inter, sans-serif', 'Poppins, sans-serif',
    'Montserrat, sans-serif', 'Roboto, sans-serif', 'Arial, sans-serif', 'Verdana, sans-serif', '"Trebuchet MS", sans-serif',
    'Georgia, serif', '"Times New Roman", serif', '"Comic Sans MS", cursive'];
  const CODE_FONTS = ['"Cascadia Code", "JetBrains Mono", Consolas, monospace', '"JetBrains Mono", monospace',
    '"Fira Code", monospace', 'Consolas, monospace', '"Courier New", monospace', '"Source Code Pro", monospace'];

  const SECTIONS = [
    { title: '🎨 Couleurs générales', items: [
      ['bg', 'Fond de l\'appli', 'color'], ['panel', 'Cartes / panneaux', 'color'],
      ['sidebar', 'Barre du haut', 'color'], ['surface', 'Surfaces (boutons, champs)', 'color'],
      ['surface2', 'Survol', 'color'], ['border', 'Bordures', 'color'],
      ['text', 'Texte', 'color'], ['muted', 'Texte secondaire', 'color'],
      ['accent', 'Couleur principale', 'color'], ['accentText', 'Texte sur couleur principale', 'color'],
      ['success', 'Succès', 'color'], ['danger', 'Danger / erreurs', 'color'],
      ['warning', 'Avertissement / clé primaire', 'color'], ['info', 'Info', 'color']
    ]},
    { title: '📋 Couleurs des tableaux', items: [
      ['gridHeader', 'En-têtes', 'color'], ['gridStripe', 'Lignes paires', 'color'], ['gridHover', 'Ligne survolée', 'color']
    ]},
    { title: '⌨️ Couleurs de l\'éditeur SQL', items: [
      ['editorBg', 'Fond de l\'éditeur / des champs', 'color'], ['synKeyword', 'Mots-clés (SELECT…)', 'color'],
      ['synString', 'Textes \'…\'', 'color'], ['synNumber', 'Nombres', 'color'],
      ['synComment', 'Commentaires', 'color'], ['synFunction', 'Fonctions COUNT()…', 'color'],
      ['synIdent', 'Noms `entre accents`', 'color']
    ]},
    { title: '🔤 Typographie', items: [
      ['fontUi', 'Police de l\'interface', 'font', UI_FONTS],
      ['fontCode', 'Police du code', 'font', CODE_FONTS],
      ['googleFonts', 'Polices Google à charger', 'text', 'ex : Poppins, Fira Code'],
      ['fontSize', 'Taille du texte', 'range', 11, 20, 1, 'px'],
      ['codeSize', 'Taille du code', 'range', 10, 20, 1, 'px'],
      ['titleWeight', 'Épaisseur des titres', 'range', 300, 900, 50, '']
    ]},
    { title: '📐 Formes & espacements', items: [
      ['radius', 'Arrondi des coins', 'range', 0, 24, 1, 'px'],
      ['borderW', 'Épaisseur des bordures', 'range', 0, 3, 1, 'px'],
      ['sp', 'Espacement (compact ↔ aéré)', 'range', 0.6, 1.6, 0.05, '×'],
      ['rowH', 'Hauteur des lignes de tableau', 'range', 24, 56, 1, 'px'],
      ['tileSize', 'Taille des tuiles', 'range', 150, 340, 5, 'px'],
      ['contentW', 'Largeur max du contenu', 'range', 900, 2600, 50, 'px'],
      ['shadow', 'Ombres', 'range', 0, 1, 0.05, '']
    ]},
    { title: '✨ Effets', items: [
      ['glow', 'Halo lumineux du fond', 'range', 0, 3, 0.1, ''],
      ['panelOpacity', 'Opacité des panneaux', 'range', 20, 100, 1, '%'],
      ['blur', 'Flou derrière les panneaux (verre)', 'range', 0, 30, 1, 'px'],
      ['animations', 'Animations', 'toggle']
    ]},
    { title: '🖼️ Fond d\'écran', items: [
      ['bgImage', 'Image', 'image'],
      ['bgImageOpacity', 'Opacité de l\'image', 'range', 0, 1, 0.05, ''],
      ['bgImageBlur', 'Flou de l\'image', 'range', 0, 30, 1, 'px']
    ]},
    { title: '🧭 Disposition & nom', items: [
      ['topbar', 'Barre du haut', 'select', [['floating', 'Flottante (pilule)'], ['flat', 'Collée en haut']]],
      ['appName', 'Nom de l\'appli', 'text', 'BaseStudio'],
      ['logo', 'Logo (vide = logo BaseStudio)', 'text', 'lettre ou emoji']
    ]}
  ];

  // Réglages qui ont une unité "px"
  const PX = ['fontSize', 'codeSize', 'radius', 'borderW', 'rowH', 'tileSize', 'contentW', 'blur', 'bgImageBlur'];
  // Réglages qui ne sont PAS des variables CSS
  const NOT_VARS = ['googleFonts', 'animations', 'bgImage', 'topbar', 'appName', 'logo', 'customCss'];

  // ---------- Sauvegarde ----------
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { window.toast && toast('Impossible de sauvegarder (image trop lourde ?)', 'error'); return false; }
  }

  let theme = Object.assign({}, DEFAULT, load('bs.theme', {}));

  // camelCase -> --kebab-case  (surface2 -> --surface-2)
  const cssVar = k => '--' + k.replace(/([A-Z0-9])/g, '-$1').toLowerCase();

  // ---------- Appliquer le thème ----------
  function apply() {
    const root = document.documentElement.style;
    for (const k in theme) {
      if (NOT_VARS.includes(k) || !(k in DEFAULT)) continue;
      root.setProperty(cssVar(k), PX.includes(k) ? theme[k] + 'px' : String(theme[k]));
    }
    root.setProperty('--speed', theme.animations ? '0.18s' : '0s');
    root.setProperty('--bg-image', theme.bgImage ? 'url("' + theme.bgImage.replace(/"/g, '%22') + '")' : 'none');
    document.body.classList.toggle('no-anim', !theme.animations);
    document.body.classList.toggle('topbar-flat', theme.topbar === 'flat');

    document.querySelectorAll('.brand-name').forEach(el => el.textContent = theme.appName || 'BaseStudio');
    // logo : vide = le logo BaseStudio (image), sinon la lettre / l'emoji choisi
    const useImg = !theme.logo || theme.logo === '◆';
    document.querySelectorAll('.brand-logo').forEach(el => {
      el.classList.toggle('has-img', useImg);
      if (useImg) el.innerHTML = '<img src="logo.svg" alt="">'; else el.textContent = theme.logo;
    });
    document.title = theme.appName || 'BaseStudio';

    // polices Google (si connecté à internet)
    let link = document.getElementById('gfonts');
    const fams = (theme.googleFonts || '').split(',').map(s => s.trim()).filter(Boolean);
    if (fams.length) {
      if (!link) { link = document.createElement('link'); link.id = 'gfonts'; link.rel = 'stylesheet'; document.head.appendChild(link); }
      const href = 'https://fonts.googleapis.com/css2?' + fams.map(f => 'family=' + encodeURIComponent(f) + ':wght@300;400;500;600;700;800').join('&') + '&display=swap';
      if (link.href !== href) link.href = href;
    } else if (link) link.remove();

    document.getElementById('custom-css').textContent = theme.customCss || '';
  }

  function set(key, value) {
    theme[key] = value;
    apply();
    store('bs.theme', theme);
  }

  function replaceTheme(obj) {
    theme = Object.assign({}, DEFAULT, obj);
    apply();
    store('bs.theme', theme);
    buildPanel();
  }

  // ---------- Fichiers (export / import) ----------
  async function saveText(name, content, ext) {
    if (window.api) return window.api.saveFile(name, content, ext);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = name; a.click();
  }
  function pickFile(accept, asDataUrl) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept;
      input.onchange = () => {
        const f = input.files[0]; if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        asDataUrl ? r.readAsDataURL(f) : r.readAsText(f);
      };
      input.click();
    });
  }

  // ---------- Construction du panneau ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function swatch(t) {
    const x = Object.assign({}, DEFAULT, t);
    return '<div class="swatch">' + [x.bg, x.panel, x.surface2, x.accent, x.synKeyword, x.text]
      .map(c => '<span style="background:' + esc(c) + '"></span>').join('') + '</div>';
  }

  function controlHtml(item) {
    const [key, label, type, a, b, c, unit] = item;
    const v = theme[key];
    const id = 'ap-' + key;
    if (type === 'color') {
      return '<div class="ap-row"><label for="' + id + '">' + label + '</label><span class="color-ctl">' +
        '<input type="color" id="' + id + '" data-key="' + key + '" value="' + esc(v) + '">' +
        '<input class="hex" data-key="' + key + '" data-hex value="' + esc(v) + '" spellcheck="false"></span></div>';
    }
    if (type === 'range') {
      return '<div class="ap-row col"><div class="ap-line"><label for="' + id + '">' + label + '</label>' +
        '<span class="val" id="' + id + '-val">' + v + (unit || '') + '</span></div>' +
        '<input type="range" id="' + id + '" data-key="' + key + '" data-unit="' + (unit || '') + '" min="' + a + '" max="' + b + '" step="' + c + '" value="' + v + '"></div>';
    }
    if (type === 'toggle') {
      return '<div class="ap-row"><label for="' + id + '">' + label + '</label>' +
        '<input type="checkbox" id="' + id + '" data-key="' + key + '" data-toggle ' + (v ? 'checked' : '') + '></div>';
    }
    if (type === 'select') {
      return '<div class="ap-row"><label for="' + id + '">' + label + '</label><select id="' + id + '" data-key="' + key + '">' +
        a.map(([val, txt]) => '<option value="' + val + '"' + (val === v ? ' selected' : '') + '>' + txt + '</option>').join('') + '</select></div>';
    }
    if (type === 'text') {
      return '<div class="ap-row"><label for="' + id + '">' + label + '</label>' +
        '<input class="txt" id="' + id + '" data-key="' + key + '" value="' + esc(v) + '" placeholder="' + esc(a || '') + '" spellcheck="false"></div>';
    }
    if (type === 'font') {
      // champ libre + liste de suggestions : tu peux taper n'importe quelle police installée
      return '<div class="ap-row col"><label for="' + id + '">' + label + '</label>' +
        '<input id="' + id + '" data-key="' + key + '" list="' + id + '-list" value="' + esc(v) + '" spellcheck="false">' +
        '<datalist id="' + id + '-list">' + a.map(f => '<option value="' + esc(f) + '">').join('') + '</datalist></div>';
    }
    if (type === 'image') {
      return '<div class="ap-row col"><label>' + label + '</label>' +
        '<input class="txt" style="width:100%!important" data-key="bgImage" placeholder="Colle une adresse d\'image (https://…)" value="' + (v && !v.startsWith('data:') ? esc(v) : '') + '">' +
        '<div class="ap-buttons"><button class="btn small" data-ap="pick-bg">📁 Choisir une image…</button>' +
        '<button class="btn small ghost" data-ap="clear-bg">Retirer</button></div></div>';
    }
    return '';
  }

  function buildPanel() {
    const body = document.getElementById('ap-body');
    if (!body) return;
    const mine = load('bs.themes', {});
    let html = '';

    // Thèmes prêts
    html += '<details class="ap-section" open><summary>🌈 Thèmes prêts</summary><div class="ap-content"><div class="presets">' +
      Object.keys(PRESETS).map(n => '<button class="preset" data-preset="' + esc(n) + '">' + swatch(PRESETS[n]) +
        '<div class="pname">' + esc(n) + '</div></button>').join('') + '</div></div></details>';

    // Mes thèmes
    html += '<details class="ap-section"><summary>💾 Mes thèmes</summary><div class="ap-content">' +
      '<div class="ap-hint">Enregistre l\'apparence actuelle sous un nom pour la retrouver plus tard.</div>' +
      '<div class="field-row"><input id="ap-theme-name" placeholder="Nom du thème…"><button class="btn primary small" data-ap="save-theme">Enregistrer</button></div>' +
      '<div class="presets" style="margin-top:10px">' +
      (Object.keys(mine).length ? Object.keys(mine).map(n => '<div class="preset" data-mine="' + esc(n) + '">' + swatch(mine[n]) +
        '<div class="pname"><span>' + esc(n) + '</span><button class="icon-btn" data-del-theme="' + esc(n) + '" title="Supprimer">✕</button></div></div>').join('')
        : '<div class="muted small">Aucun thème enregistré pour l\'instant.</div>') +
      '</div><div class="ap-buttons">' +
      '<button class="btn small" data-ap="export-theme">⬇ Exporter (.json)</button>' +
      '<button class="btn small" data-ap="import-theme">⬆ Importer (.json)</button></div>' +
      '<div class="ap-hint">Pratique pour partager ton thème avec tes potes.</div></div></details>';

    // Réglages
    for (const s of SECTIONS) {
      html += '<details class="ap-section"><summary>' + s.title + '</summary><div class="ap-content">' +
        s.items.map(controlHtml).join('') + '</div></details>';
    }

    // CSS libre
    html += '<details class="ap-section"><summary>🧩 CSS personnalisé</summary><div class="ap-content">' +
      '<div class="ap-hint">Pour aller encore plus loin : écris ton propre CSS, il s\'applique en direct. ' +
      'Exemples : <code>.btn</code>, <code>.card</code>, <code>.tile</code>, <code>#topbar</code>, <code>.tab</code>, <code>table.grid</code>, <code>.editor</code>.</div>' +
      '<textarea class="ap-custom-css" data-key="customCss" spellcheck="false" placeholder="/* ex : */\n.card { border: 2px dashed var(--accent); }\n#topbar { background: linear-gradient(90deg, var(--accent), var(--info)); }">' +
      esc(theme.customCss) + '</textarea></div></details>';

    html += '<div class="ap-buttons" style="margin-top:18px"><button class="btn danger small" data-ap="reset">↺ Tout réinitialiser</button></div>';
    body.innerHTML = html;
  }

  // ---------- Réactions aux clics / saisies dans le panneau ----------
  function onInput(e) {
    const el = e.target;
    const key = el.dataset.key;
    if (!key) return;
    let value = el.value;
    if (el.dataset.toggle !== undefined) value = el.checked;
    else if (el.type === 'range') {
      value = Number(value);
      const lbl = document.getElementById(el.id + '-val');
      if (lbl) lbl.textContent = value + (el.dataset.unit || '');
    } else if (el.dataset.hex !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) return; // on attend un code complet
      const picker = el.parentElement.querySelector('input[type=color]');
      if (picker) picker.value = value;
    } else if (el.type === 'color') {
      const hex = el.parentElement.querySelector('[data-hex]');
      if (hex) hex.value = value;
    }
    set(key, value);
  }

  async function onClick(e) {
    const t = e.target.closest('[data-preset],[data-mine],[data-del-theme],[data-ap]');
    if (!t) return;
    const mine = load('bs.themes', {});

    if (t.dataset.delTheme) {
      e.stopPropagation();
      delete mine[t.dataset.delTheme];
      store('bs.themes', mine); buildPanel(); return;
    }
    if (t.dataset.preset) {
      // on garde le nom, le logo, le fond et le CSS perso
      const keep = { appName: theme.appName, logo: theme.logo, bgImage: theme.bgImage, customCss: theme.customCss, googleFonts: theme.googleFonts };
      replaceTheme(Object.assign({}, PRESETS[t.dataset.preset], keep));
      window.toast && toast('Thème « ' + t.dataset.preset + ' » appliqué', 'success');
      return;
    }
    if (t.dataset.mine) { replaceTheme(mine[t.dataset.mine]); return; }

    switch (t.dataset.ap) {
      case 'save-theme': {
        const name = document.getElementById('ap-theme-name').value.trim();
        if (!name) { window.toast && toast('Donne un nom à ton thème', 'error'); return; }
        mine[name] = Object.assign({}, theme);
        if (store('bs.themes', mine)) { buildPanel(); window.toast && toast('Thème « ' + name + ' » enregistré', 'success'); }
        break;
      }
      case 'export-theme':
        await saveText((theme.appName || 'theme') + '-theme.json', JSON.stringify(theme, null, 2), 'json');
        break;
      case 'import-theme': {
        const txt = await pickFile('.json,application/json', false);
        if (!txt) return;
        try { replaceTheme(JSON.parse(txt)); window.toast && toast('Thème importé', 'success'); }
        catch (err) { window.toast && toast('Ce fichier n\'est pas un thème valide', 'error'); }
        break;
      }
      case 'pick-bg': {
        const data = await pickFile('image/*', true);
        if (data) { set('bgImage', data); if (theme.bgImageOpacity < 0.1) set('bgImageOpacity', 0.3); buildPanel(); }
        break;
      }
      case 'clear-bg': set('bgImage', ''); buildPanel(); break;
      case 'reset':
        replaceTheme({});
        window.toast && toast('Apparence réinitialisée', 'success');
        break;
    }
  }

  // ---------- Ouvrir / fermer ----------
  function open() {
    buildPanel();
    document.getElementById('appearance').classList.add('open');
    document.getElementById('appearance-overlay').hidden = false;
  }
  function close() {
    document.getElementById('appearance').classList.remove('open');
    document.getElementById('appearance-overlay').hidden = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    const body = document.getElementById('ap-body');
    body.addEventListener('input', onInput);
    body.addEventListener('click', onClick);
    document.getElementById('appearance-overlay').addEventListener('click', close);
  });

  window.Theme = { open, close, apply, get: () => theme, PRESETS, DEFAULT };
})();
