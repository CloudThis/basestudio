// =====================================================================
//  BaseStudio - garde-fou de l'éditeur SQL
//  Avant d'exécuter, BaseStudio repère les requêtes qui peuvent tout
//  effacer et demande confirmation en expliquant ce qui va se passer :
//  DELETE / UPDATE sans WHERE, TRUNCATE, DROP (base, table, vue, colonne…).
// =====================================================================
(function () {
  // on enlève commentaires et textes entre guillemets avant de chercher les mots
  const bare = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(--|#)[^\n]*/g, ' ')
    .replace(/'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"/g, "''").replace(/\s+/g, ' ').trim();
  const name = s => (s || '').replace(/`/g, '');

  // renvoie la liste des dangers d'une requête
  function dangers(stmt) {
    const s = bare(stmt), list = [];
    let m;
    if ((m = /^DELETE\s+(?:LOW_PRIORITY\s+|QUICK\s+|IGNORE\s+)*FROM\s+(`[^`]+`|[\w.$]+)/i.exec(s)) && !/\bWHERE\b/i.test(s))
      list.push(['🗑', 'supprime <b>toutes les lignes</b> de « ' + h(name(m[1])) + ' »', 'pas de WHERE']);
    if ((m = /^UPDATE\s+(?:LOW_PRIORITY\s+|IGNORE\s+)*(`[^`]+`|[\w.$]+)/i.exec(s)) && !/\bWHERE\b/i.test(s))
      list.push(['✏', 'modifie <b>toutes les lignes</b> de « ' + h(name(m[1])) + ' »', 'pas de WHERE']);
    if ((m = /^TRUNCATE\s+(?:TABLE\s+)?(`[^`]+`|[\w.$]+)/i.exec(s)))
      list.push(['🧹', 'vide complètement la table « ' + h(name(m[1])) + ' »', 'TRUNCATE']);
    if ((m = /^DROP\s+(DATABASE|SCHEMA)\s+(?:IF\s+EXISTS\s+)?(`[^`]+`|[\w$]+)/i.exec(s)))
      list.push(['💥', 'supprime <b>la base « ' + h(name(m[2])) + ' »</b> et toutes ses tables', 'DROP DATABASE']);
    else if ((m = /^DROP\s+(?:TEMPORARY\s+)?(TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+(?:RESTRICT|CASCADE))?$/i.exec(s)))
      list.push(['💥', 'supprime ' + (/view/i.test(m[1]) ? 'la vue ' : 'la table ') + '« ' + h(name(m[2]).replace(/\s*;$/, '')) + ' »' + (/view/i.test(m[1]) ? '' : ' et toutes ses lignes'), 'DROP ' + m[1].toUpperCase()]);
    if (/^ALTER\s+TABLE\b/i.test(s) && (m = s.match(/\bDROP\s+(?:COLUMN\s+)?(?!INDEX|KEY|PRIMARY|FOREIGN|CONSTRAINT|CHECK|PARTITION)(`[^`]+`|\w+)/gi)))
      list.push(['✂', 'supprime la colonne ' + m.map(x => '« ' + h(name(x.replace(/^DROP\s+(COLUMN\s+)?/i, ''))) + ' »').join(', ') + ' et ses valeurs', 'DROP COLUMN']);
    return list;
  }

  // true = on peut exécuter
  async function check(sql, db) {
    const stmts = window.SqlImport ? SqlImport.splitSql(sql) : sql.split(';');
    const found = [];
    stmts.forEach(st => dangers(st).forEach(d => found.push(d.concat([st]))));
    if (!found.length) return true;
    return confirmBox({
      title: found.length > 1 ? '⚠ ' + found.length + ' requêtes vont effacer des données' : '⚠ Attention, cette requête efface des données',
      danger: true, okText: 'Exécuter quand même',
      text: '<ul class="guard-list">' + found.map(([ico, what, why]) => '<li>' + ico + ' Elle ' + what + ' <span class="badge grey">' + h(why) + '</span></li>').join('') + '</ul>' +
        (found.some(f => f[2] === 'pas de WHERE') ? 'Pour ne toucher que certaines lignes, ajoute un <code>WHERE</code> (ex : <code>WHERE id = 3</code>).<br>' : '') +
        (db ? 'Conseil : fais d\'abord une sauvegarde (onglet 💾 Sauvegardes).' : '') +
        '<span class="muted small" style="display:block;margin-top:6px">Ce n\'est pas annulable avec ↩ Annuler.</span>'
    });
  }

  window.SqlGuard = { check, dangers };
})();
