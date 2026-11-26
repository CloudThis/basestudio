# BaseStudio

Ton gestionnaire de bases MySQL / MariaDB (comme phpMyAdmin), avec une apparence que tu peux changer à 100 %.

## Le lancer

1. Dans le **panneau XAMPP**, clique sur **Start** à côté de **Apache** et de **MySQL** (comme pour phpMyAdmin).
2. Double-clique sur le raccourci **BaseStudio** du Bureau (le logo rose et violet), ou cherche « BaseStudio » dans le menu Démarrer.
3. Clique sur **Se connecter** (`localhost` / `3306` / `root` / mot de passe vide = réglages de XAMPP).

L'appli s'ouvre dans sa propre fenêtre Edge, sans rien installer d'autre que XAMPP.

### Où sont les fichiers

- **L'appli** : `C:\xampp\htdocs\basestudio\`. `api.php` parle à MySQL, le reste c'est l'interface.
- **Le raccourci** : il ouvre Edge en mode appli sur `http://localhost/basestudio/`. Pour le recréer, relance `INSTALLER.bat`.
- **L'ancienne version** après une mise à jour : `C:\xampp\htdocs\basestudio\_sauvegarde\`.

## La partager

Tes potes téléchargent BaseStudio sur https://github.com/CloudThis/basestudio (bouton vert **Code** puis **Download ZIP**), puis lancent `INSTALLER.bat`.

## Les mises à jour

Quand une nouvelle version est publiée, un bouton **⬆ Mise à jour** apparaît dans l'appli (en haut à droite et sur l'écran de connexion). Un clic montre les nouveautés, **Installer** télécharge les nouveaux fichiers, vérifie chacun (empreinte SHA-256) et garde l'ancienne version dans `_sauvegarde/`. Les bases, thèmes et réglages ne sont pas touchés. **Ctrl+K** puis « Vérifier les mises à jour » pour vérifier à la main.

- **Quoi de neuf** : au premier lancement après une mise à jour, une fenêtre montre les nouveautés. Pour la revoir : clique sur le numéro de version (en bas de l'écran de connexion) ou **Ctrl+K** puis « À propos ».
- **Revenir à la version précédente** : dans « À propos » (ou **Ctrl+K** puis « Revenir à la version précédente »). Les deux versions sont échangées : celle que tu quittes est gardée, et le bouton « ⬆ Mise à jour » te la reproposera.

## Ce que tu peux faire

- **Accueil** : tes bases en tuiles colorées (chaque base a sa couleur). Tu peux en créer et en supprimer.
- **Recherche rapide Ctrl+K** : tape un bout de nom pour ouvrir une base, une table, un trigger, une procédure ou une fonction (l'onglet s'ouvre et la ligne clignote), aller à un onglet (Triggers, Procédures, Vues, Rechercher, Schéma, Dictionnaire), lancer une action, ou coller du SQL.
- **Base** : les tables en cartes, un onglet **🔗 Schéma** qui dessine la base façon MERISE (voir plus bas), créer une table avec un formulaire (le SQL s'affiche en direct), créer des **triggers** (onglet ⚡ Triggers) et des **procédures / fonctions stockées** (onglet 🧩 Procédures), exporter / importer un fichier `.sql`, changer l'interclassement, supprimer la base.
- **Table** :
  - Parcourir les données : pages, tri en cliquant sur une colonne, recherche, export CSV.
  - Double-clic sur une case pour la modifier, 🗑 pour supprimer une ligne.
  - Structure : ajouter, modifier ou supprimer des colonnes, des index et des **clés étrangères**.
  - Une colonne qui est une clé étrangère devient une **liste déroulante** (« 3 – Dupont Marie ») dans Insérer et quand tu double-cliques une case dans Parcourir.
  - ⚡ Triggers : ceux de la table, et le formulaire pour en créer.
  - 📥 Import CSV : importe un fichier CSV / Excel dans la table (voir plus bas).
  - Insérer une ligne, renommer, copier, vider ou supprimer la table.
- **SQL** : un éditeur avec les couleurs, les numéros de ligne et l'**auto-complétion** (tables, colonnes, alias `c.`, fonctions, mots-clés : ↑ ↓ pour choisir, Entrée ou Tab pour valider, Ctrl+Espace pour ouvrir la liste). **Ctrl+Entrée** exécute, plusieurs requêtes passent d'un coup, il y a un historique et des modèles prêts (CREATE TABLE, JOIN, FOREIGN KEY…).
- **👤 Utilisateurs** (menu du haut) : les comptes MySQL et leurs droits (voir plus bas).
- **Onglets et favoris SQL** : dans l'éditeur SQL, **＋** ouvre un nouvel onglet (double-clic sur un onglet pour le renommer). Les onglets sont gardés même après avoir fermé BaseStudio. **⭐ Favori** enregistre la requête avec un nom : tu la retrouves dans la colonne de droite et dans **Ctrl+K**.
- **📊 Graphique** : sous chaque résultat (éditeur SQL, requête visuelle), en barres, courbe ou camembert, avec export PNG / SVG. Astuce : `SELECT ville, COUNT(*) FROM client GROUP BY ville`.
- **✏ Formulaire d'une ligne** (onglet Parcourir) : le crayon au début de chaque ligne ouvre toutes les colonnes l'une sous l'autre (listes pour les ENUM et les clés étrangères). Enregistrer, ‹ › ligne précédente / suivante, ⧉ Dupliquer, 🗑 Supprimer.
- **💾 Sauvegardes** et **📊 État du serveur** (menu du haut) : voir plus bas.
- **Glisser-déposer** : lâche un fichier `.sql` sur la fenêtre pour l'importer dans la base ouverte (ou sur le serveur), ou un `.csv` pour l'importer dans la table ouverte (sinon BaseStudio te demande laquelle).
- **↩ Annuler** : après une modification ou une suppression de ligne (Parcourir ou formulaire), une barre « ↩ Annuler » reste 20 secondes en bas. Un clic, ou **Ctrl+Z** (hors d'un champ de texte), remet l'ancienne valeur ou la ligne supprimée.
- **Garde-fou** : avant d'exécuter un `DELETE` ou un `UPDATE` sans `WHERE`, un `TRUNCATE`, un `DROP` (base, table, vue, colonne), l'éditeur SQL explique ce qui va être effacé et demande de confirmer.
- **✨ Mettre en forme** (éditeur SQL, ou **Ctrl+Maj+F**) : remet une requête au propre (mots-clés en majuscules, une clause par ligne, sous-requêtes décalées). Seulement la sélection si du texte est sélectionné.
- **Journal SQL** (bouton 📜 en bas à gauche) : toutes les requêtes que l'appli a envoyées. Clique sur une ligne pour la rouvrir dans l'éditeur.

## Le schéma MERISE (onglet 🔗 Schéma d'une base)

- **MCD** : les tables deviennent des entités, les clés étrangères des associations (ovales) avec leurs cardinalités (`0,1`, `1,1`, `0,n`). Une table de liaison (clé primaire faite uniquement de clés étrangères) devient une association avec ses attributs.
- **MLD** : toutes les tables avec leurs colonnes et leurs types. Souligné = clé primaire, `#` = clé étrangère, la flèche va vers la table référencée.
- Glisse une boîte pour la déplacer (la position est retenue), glisse le fond pour te déplacer, molette pour zoomer.
- Double-clic sur une entité : ouvre sa structure. Double-clic sur une association : lui donner un nom (un verbe, ex. « passer »). Ce nom n'est gardé que dans BaseStudio.
- **🔗 Relier** : tire un trait d'une table (ex : commande) vers une autre (ex : client) pour créer la clé étrangère. La colonne peut être créée automatiquement (`id_client`).
- **📖 Dictionnaire** : voir plus bas.
- **✨ Réorganiser** replace tout automatiquement, **⬇ PNG / ⬇ SVG** exportent le dessin, **⛶** passe en plein écran.
- Accès rapide : **Ctrl+K** puis tape « schéma » ou le nom d'une base.
- Les liens viennent des `FOREIGN KEY` : une base sans clé étrangère est dessinée sans liens.

## Les triggers (onglet ⚡ Triggers d'une base ou d'une table)

- La liste des triggers : voir le code, **Modifier** (le trigger est remplacé ; si le nouveau code a une erreur, l'ancien est remis), **Supprimer**.
- Le formulaire : choisis la table, `BEFORE` / `AFTER`, `INSERT` / `UPDATE` / `DELETE`, puis écris le code qui va entre `BEGIN` et `END`.
- Des modèles prêts (majuscules, date automatique, refuser une valeur avec `SIGNAL`, historique…) et les colonnes `NEW.` / `OLD.` s'insèrent d'un clic.
- Les erreurs classiques sont signalées avant d'exécuter (`SET NEW` en `AFTER`, `OLD` en `INSERT`, trigger qui modifie sa propre table…).
- Le SQL exact s'affiche en direct, et tu peux l'ouvrir dans l'éditeur SQL.
- Les exports `.sql` contiennent maintenant aussi les triggers (avec `DELIMITER`, comme phpMyAdmin).

## Les procédures et fonctions (onglet 🧩 Procédures d'une base)

- La liste des procédures (`CREATE PROCEDURE`) et fonctions (`CREATE FUNCTION`), avec leurs paramètres.
- **▶ Exécuter** : tu remplis les paramètres et BaseStudio lance `CALL …` (ou `SELECT ma_fonction(…)`). Les lignes renvoyées et les paramètres `OUT` / `INOUT` s'affichent.
- **Voir le code**, **Modifier** (si le nouveau code a une erreur, l'ancien est remis), **Supprimer**.
- Le formulaire : procédure ou fonction, nom, paramètres (`IN` / `OUT` / `INOUT`), type renvoyé (`RETURNS`) pour une fonction, `DETERMINISTIC`, accès aux données, commentaire, et le code entre `BEGIN` et `END`.
- Des modèles prêts (SELECT, INSERT, UPDATE, variable, IF, boucle WHILE, transaction…) et les paramètres, tables et colonnes s'insèrent d'un clic.
- Les erreurs classiques sont signalées avant d'exécuter (fonction sans `RETURN`, `RETURN` dans une procédure, `DECLARE` mal placé…).
- Les exports `.sql` d'une base contiennent aussi les procédures et fonctions.

## Le dictionnaire de données (📖)

Un document qui décrit toute la base : sommaire, schémas MCD et MLD, puis chaque table avec ses colonnes (type, null, défaut, clé, description), ses clés étrangères, index et triggers, les vues, les procédures et fonctions.
On l'ouvre depuis le Schéma, l'onglet Exporter d'une base ou Ctrl+K. **Imprimer / PDF** (choisis « Enregistrer au format PDF ») ou **Télécharger (.html)**.
Les commentaires des colonnes (Structure → Modifier) remplissent la colonne « Description ».

## Les vues (onglet 👁 Vues d'une base)

- La liste des vues : **Parcourir**, voir le code, modifier, supprimer.
- Le formulaire : le nom et la requête `SELECT` (avec l'auto-complétion), `WITH CHECK OPTION` si besoin.
- **✨ Écrire le SELECT** : choisis une table, BaseStudio écrit la requête avec les `LEFT JOIN` vers les tables liées par clé étrangère.
- **▶ Tester** montre les 20 premières lignes avant de créer la vue.

## L'import CSV (onglet 📥 Import CSV d'une table)

- Choisis le fichier (ou glisse-le sur la page). Le séparateur (`;` `,` tabulation) et l'encodage (UTF-8 ou Excel Windows) sont devinés.
- Chaque colonne de la table est associée à une colonne du fichier (automatique si les noms se ressemblent, modifiable).
- Les dates `25/12/2026` et les nombres `1 234,50` sont convertis. Une case vide donne `NULL` ou la valeur par défaut.
- Si une ligne existe déjà : arrêter, sauter (`INSERT IGNORE`) ou remplacer (`REPLACE`). Option « Vider la table avant ».
- L'envoi se fait par paquets (MySQL refuse plus de 1 Mo d'un coup) : 30 000 lignes passent en moins d'une seconde.

## La recherche (onglet 🔍 Rechercher d'une base)

- Cherche un texte ou un nombre dans toutes les colonnes de toutes les tables (ou celles que tu choisis) : contient, est exactement, commence par, ou REGEXP.
- Résultat : le nombre de lignes par table, **Voir les lignes** (texte surligné) ou **Ouvrir la table** (avec la recherche déjà remplie).

## Les utilisateurs et droits (👤 Utilisateurs)

- La liste des comptes (`nom@hôte`) avec le résumé de leurs droits. Le compte avec lequel tu es connecté ne peut pas être supprimé.
- **Nouveau compte** : nom, d'où il se connecte (`localhost`, `%` ou une adresse), mot de passe (🎲 en crée un solide), droits sur toutes les bases ou une seule, avec des préréglages (lecture seule, lecture + écriture, développeur, tous les droits).
- **🔑 Droits** : coche / décoche par base, **🔒 Mot de passe**, **Voir les GRANT**, **Supprimer**.
- Les mots de passe ne sont jamais écrits dans le journal SQL (`••••••••`).
- Attention : avec XAMPP, phpMyAdmin se connecte en `root` sans mot de passe. Si tu en mets un à `root`, change-le aussi dans `C:\xampp\phpMyAdmin\config.inc.php`.

## La requête visuelle (onglet 🎛 Requête visuelle d'une base)

Pour écrire un SELECT sans taper de SQL :

1. Coche les **tables** (celles reliées par une clé étrangère sont marquées 🔗) : les `JOIN` sont écrits tout seuls.
2. Coche les **colonnes** à afficher. Une colonne peut être comptée, additionnée, moyennée… (COUNT, SUM, AVG, MIN, MAX) : le `GROUP BY` est ajouté automatiquement.
3. Ajoute des **filtres** (=, ≠, >, contient, commence par, est dans la liste, est vide…), avec ET ou OU.
4. Choisis le **tri**, sans doublons (DISTINCT), INNER ou LEFT JOIN, le nombre maximum de lignes.

Le SQL s'affiche en direct : **▶ Exécuter**, **📊 Graphique** sur le résultat, ou **⌨️ Ouvrir dans l'éditeur SQL** pour le retoucher.

## Comparer deux bases (onglet ⚖ Comparer d'une base)

Choisis une autre base du serveur : BaseStudio liste les tables qui manquent d'un côté ou de l'autre, les colonnes et index différents, et peut aussi compter les lignes. **🛠 Rendre B identique à A** écrit le script `ALTER TABLE` / `CREATE TABLE` (structure seulement, les lignes restent), à exécuter tout de suite ou à ouvrir dans l'éditeur SQL. Coche « supprimer aussi ce qui est en trop » pour enlever les tables, colonnes et index que A n'a pas.

## Les sauvegardes (💾 Sauvegardes, menu du haut ou onglet d'une base)

- **💾 Sauvegarder maintenant** : un fichier `.sql.gz` (compressé) de toute la base : tables, données, vues, procédures, triggers.
- **Sauvegarde automatique** : à chaque lancement, chaque jour ou chaque semaine, et le nombre de sauvegardes à garder (les plus vieilles sont supprimées). Elle se fait tant que BaseStudio est ouvert ; si le PC était éteint, elle est faite au lancement suivant.
- **↩ Restaurer** remet la base comme dans la sauvegarde (BaseStudio sauvegarde d'abord l'état actuel, au cas où). **⬇ Télécharger .sql**, **🗑** supprimer.
- Les fichiers sont dans `Documents\BaseStudio\Sauvegardes` (bouton **📂 Ouvrir le dossier**), hors du dossier web : personne ne peut les télécharger depuis le navigateur.

## L'état du serveur (📊 État, menu du haut)

Actualisé toutes les 3 secondes : depuis quand MySQL tourne, connexions, **requêtes par seconde** (avec une courbe), trafic, requêtes lentes, cache InnoDB. Plus bas : les **requêtes en cours** (bouton ⏹ Arrêter pour en couper une qui bloque), la place prise par chaque base et les réglages importants du serveur.

## L'apparence (bouton 🎨)

- 9 thèmes prêts : Corail (par défaut), Violet nuit, Jour, Océan, Forêt, Sakura, Terminal, Coucher de soleil, Graphite.
- Toutes les couleurs : l'interface, les tableaux, et chaque couleur de l'éditeur SQL.
- Polices et tailles. Tu peux taper n'importe quelle police installée, ou charger une police Google.
- Arrondis, bordures, espacement, hauteur des lignes, largeur de la barre latérale, ombres.
- Effets : halo lumineux, panneaux transparents, effet verre (flou).
- Fond d'écran avec ta propre image (opacité et flou réglables).
- La barre du haut flottante ou collée, la taille des tuiles, la largeur du contenu, le nom de l'appli et le logo (laisse vide pour garder le logo BaseStudio, ou mets une lettre ou un emoji).
- **CSS personnalisé** : tu écris ton propre CSS pour changer absolument tout.
- **Mes thèmes** : enregistre tes créations, exporte-les en `.json` pour les partager, importe ceux de tes potes.

## Comment est rangé le code

| Fichier | Rôle |
|---|---|
| `api.php` | Parle à MySQL avec PHP (connexion, requêtes, export/import, mises à jour). |
| `index.html` | La structure de la page. |
| `style.css` | Le style. Tout passe par des variables CSS (`--accent`, `--radius`…). |
| `theme.js` | Le panneau Apparence et les thèmes. |
| `app.js` | Les écrans principaux (bases, tables, SQL, Ctrl+K…). |
| `update.js` | Le bouton « ⬆ Mise à jour ». |
| `version.json` | Le numéro de version et la liste des fichiers (pour les mises à jour). |
| `index.php` | La page d'accueil : renvoie `index.html` en ajoutant à chaque `.js` / `.css` sa date de modification, pour qu'Edge recharge tout seul un fichier modifié. |
| `api-web.js` | Fait le lien entre l'interface et `api.php`. |
| `schema.js` | L'onglet Schéma (MCD / MLD façon MERISE). |
| `triggers.js` | L'onglet Triggers (liste, création, modification). |
| `procedures.js` | L'onglet Procédures (procédures et fonctions stockées). |
| `relations.js` | Les clés étrangères : Structure, listes déroulantes, fenêtre de création. |
| `complete.js` | L'auto-complétion de l'éditeur SQL. |
| `dictionary.js` | Le dictionnaire de données (impression / PDF / .html). |
| `views.js` | L'onglet Vues (CREATE VIEW, assistant de jointures). |
| `csv.js` | L'import CSV dans une table. |
| `search.js` | La recherche dans toute une base. |
| `users.js` | Les utilisateurs MySQL et leurs droits. |
| `charts.js` | Les graphiques (barres, courbe, camembert). |
| `rowform.js` | Le formulaire d'édition d'une ligne (onglet Parcourir). |
| `sqltabs.js` | Les onglets et favoris de l'éditeur SQL. |
| `builder.js` | La requête visuelle. |
| `compare.js` | La comparaison de deux bases. |
| `backups.js` | Les sauvegardes (manuelles et automatiques). |
| `status.js` | L'état du serveur. |
| `dropfile.js` | Le glisser-déposer d'un fichier .sql / .csv. |
| `undo.js` | La barre « ↩ Annuler ». |
| `sqlguard.js` | Le garde-fou de l'éditeur SQL. |
| `sqlformat.js` | La mise en forme du SQL. |

Tu peux modifier ces fichiers directement dans `C:\xampp\htdocs\basestudio\`, puis recharger la page (F5). Pour ajouter un thème prêt, ajoute une entrée dans `PRESETS` au début de `theme.js`. Attention : une mise à jour remplace ces fichiers (ta version est gardée dans `_sauvegarde\`).

`INSTALLER.bat` et `_installer.ps1` ont servi à l'installation : tu peux les supprimer, ou les garder pour recréer le raccourci.

## Bon à savoir

- **Mots de passe** : « Se souvenir de ce serveur » ne garde que le serveur, le port et l'utilisateur, **jamais le mot de passe**. Un serveur sans mot de passe (XAMPP) se connecte en un clic ; sinon BaseStudio te le demande, et Edge peut proposer de le retenir dans son gestionnaire de mots de passe (chiffré par Windows). Pendant que tu es connecté, le mot de passe est gardé chiffré côté serveur, et la clé disparaît quand tu fermes l'appli ou te déconnectes.
- **Import de gros fichiers `.sql`** : le fichier est découpé et envoyé par paquets, avec une barre de progression. Les `DELIMITER` (procédures, triggers) sont gérés. Si une seule requête dépasse la limite du serveur, augmente `max_allowed_packet` dans `C:\xampp\mysql\bin\my.ini` (ex : `64M`) puis redémarre MySQL.
