// =====================================================================
//  BaseStudio - mises à jour
//  Au démarrage (puis toutes les 6 heures), BaseStudio demande à api.php
//  s'il existe une version plus récente sur GitHub. Si oui, un bouton
//  « ⬆ Mise à jour » apparaît (en haut, et sur l'écran de connexion).
//  Un clic montre les nouveautés ; « Installer » télécharge et remplace
//  les fichiers (l'ancienne version est gardée dans _sauvegarde/).
// =====================================================================
(function () {
  const EVERY = 6 * 3600 * 1000;      // vérification toutes les 6 heures
  const MEMO = 'bs.update';           // dernier résultat (évite de trop interroger GitHub)
  let info = null;

  const buttons = () => $$('.update-btn');
  function show() {
    buttons().forEach(b => {
      b.hidden = !(info && info.newer);
      if (info) b.innerHTML = '⬆ Mise à jour <b>' + h(info.latest) + '</b>';
    });
  }

  async function localVersion() {
    try { const r = await fetch('version.json', { cache: 'no-store' }); return (await r.json()).version || '?'; } catch (e) { return '?'; }
  }

  async function check(manual) {
    if (!window.api || !window.api.updateCheck) { if (manual) toast('Les mises à jour automatiques ne marchent que dans la version XAMPP / Edge.', 'error'); return; }
    if (!manual) {
      try {
        const m = JSON.parse(localStorage.getItem(MEMO) || 'null');
        // résultat récent et toujours valable : pas besoin de redemander à GitHub
        if (m && Date.now() - m.at < EVERY && m.info.current === await localVersion()) { info = m.info; show(); return; }
      } catch (e) {}
    }
    const res = await window.api.updateCheck();
    if (!res.ok) { if (manual) toast(res.error, 'error'); return; }
    info = res.data;
    localStorage.setItem(MEMO, JSON.stringify({ at: Date.now(), info }));
    show();
    if (manual) {
      if (info.newer) open();
      else toast('BaseStudio est à jour (version ' + info.current + ')', 'success');
    }
  }

  function open() {
    if (!info || !info.newer) return check(true);
    modal('<h3>⬆ Mise à jour disponible</h3>' +
      '<p>Version <b>' + h(info.latest) + '</b>' + (info.date ? ' du ' + h(new Date(info.date).toLocaleDateString('fr-FR')) : '') +
      ' · tu as la version ' + h(info.current) + '.</p>' +
      (info.notes.length ? '<div class="upd-notes"><b>Nouveautés</b><ul>' + info.notes.map(n => '<li>' + h(n) + '</li>').join('') + '</ul></div>' : '') +
      '<p class="muted small">Tes bases, tes thèmes et tes réglages ne sont pas touchés. L\'ancienne version est gardée dans le dossier <code>_sauvegarde</code>.</p>' +
      '<div id="upd-out"></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-x>Plus tard</button><button class="btn primary" data-ok>⬆ Installer la mise à jour</button></div>',
      (back, close) => {
        $('[data-x]', back).onclick = close;
        $('[data-ok]', back).onclick = async e => {
          const btn = e.currentTarget;
          btn.disabled = true; btn.textContent = '⏳ Téléchargement…';
          $('[data-x]', back).disabled = true;
          const res = await window.api.updateInstall(info.ref);
          if (!res.ok) {
            $('#upd-out', back).innerHTML = '<div class="alert danger">' + h(res.error) + '</div>';
            btn.disabled = false; btn.textContent = '⬆ Réessayer'; $('[data-x]', back).disabled = false;
            return;
          }
          localStorage.removeItem(MEMO);
          $('#upd-out', back).innerHTML = '<div class="alert success">✔ BaseStudio ' + h(res.data.version) + ' est installé. Redémarrage…</div>';
          btn.textContent = '✔ Installé';
          setTimeout(() => location.reload(), 1200);
        };
      });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const v = await localVersion();
    $$('.app-version').forEach(el => el.textContent = 'v' + v);
    document.addEventListener('click', e => { if (e.target.closest('.update-btn')) open(); });
    setTimeout(() => check(false), 2500);
    setInterval(() => check(false), EVERY);
  });

  window.Updater = { check, open };
})();
