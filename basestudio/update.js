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

  // ---------- « À propos » : version, nouveautés, mises à jour, retour arrière ----------
  async function localInfo() {
    try { const j = await (await fetch('version.json', { cache: 'no-store' })).json(); return { version: j.version || '?', date: j.date || '', notes: (j.notes || []).filter(n => typeof n === 'string') }; }
    catch (e) { return { version: '?', date: '', notes: [] }; }
  }
  const notesHtml = notes => notes.length ? '<div class="upd-notes"><b>Nouveautés de cette version</b><ul>' + notes.map(n => '<li>' + h(n) + '</li>').join('') + '</ul></div>'
    : '<p class="muted">Pas de nouveautés notées pour cette version.</p>';

  async function about(intro) {
    const me = await localInfo();
    const bak = window.api && window.api.updateBackup ? await window.api.updateBackup() : null;
    const prev = bak && bak.ok && bak.data ? bak.data : null;
    modal('<h3>' + (intro ? '🎉 Quoi de neuf dans BaseStudio ' + h(me.version) : 'ℹ️ BaseStudio ' + h(me.version)) + '</h3>' +
      (intro ? '<p>La mise à jour est installée. Voici ce qui change :</p>' : '<p class="muted small">Version ' + h(me.version) + (me.date ? ' du ' + h(new Date(me.date).toLocaleDateString('fr-FR')) : '') + '</p>') +
      notesHtml(me.notes) +
      (prev ? '<p class="muted small">Un souci avec cette version ? La version <b>' + h(prev.version) + '</b> est gardée sur ce PC : tu peux y revenir.</p>' : '') +
      '<div class="modal-actions">' +
      (prev ? '<button class="btn ghost" data-back>↩ Revenir à la version ' + h(prev.version) + '</button>' : '') +
      (intro ? '' : '<button class="btn" data-check>🔄 Vérifier les mises à jour</button>') +
      '<button class="btn primary" data-x>' + (intro ? 'Super !' : 'Fermer') + '</button></div>',
      (back, close) => {
        $('[data-x]', back).onclick = close;
        const c = $('[data-check]', back); if (c) c.onclick = () => { close(); check(true); };
        const b = $('[data-back]', back); if (b) b.onclick = () => { close(); rollback(prev.version); };
      });
  }

  async function rollback(prevVersion) {
    if (!window.api || !window.api.updateRollback) return;
    if (!prevVersion) {
      const bak = await window.api.updateBackup();
      prevVersion = bak.ok && bak.data ? bak.data.version : null;
      if (!prevVersion) return toast('Aucune version précédente n\'est gardée sur ce PC.', 'error');
    }
    const cur = await localVersion();
    if (!(await confirmBox({ title: 'Revenir à la version ' + prevVersion + ' ?',
      text: 'BaseStudio ' + h(cur) + ' sera remplacé par la version ' + h(prevVersion) + '. Tes bases, thèmes et réglages ne sont pas touchés.<br>' +
        'La version ' + h(cur) + ' reste gardée : le bouton « ⬆ Mise à jour » te la reproposera.', okText: '↩ Revenir à ' + prevVersion }))) return;
    const res = await window.api.updateRollback();
    if (!res.ok) return toast(res.error, 'error');
    localStorage.removeItem(MEMO);
    localStorage.setItem(SEEN, res.data.version);   // pas de « Quoi de neuf » pour un retour en arrière
    toast('Retour à la version ' + res.data.version + '. Redémarrage…', 'success');
    setTimeout(() => location.reload(), 1200);
  }

  // Premier lancement après une mise à jour : on montre les nouveautés une fois
  const SEEN = 'bs.seenVersion';
  async function whatsNew() {
    const v = await localVersion();
    if (v === '?') return;
    const seen = localStorage.getItem(SEEN);
    localStorage.setItem(SEEN, v);
    if (seen && seen !== v && !$('.modal')) about(true);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const v = await localVersion();
    $$('.app-version').forEach(el => { el.textContent = 'v' + v; el.title = 'Version, nouveautés, mises à jour'; });
    document.addEventListener('click', e => {
      if (e.target.closest('.update-btn')) open();
      else if (e.target.closest('.app-version')) about(false);
    });
    setTimeout(whatsNew, 600);
    setTimeout(() => check(false), 2500);
    setInterval(() => check(false), EVERY);
  });

  window.Updater = { check, open, about, rollback };
})();
