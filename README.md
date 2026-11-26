# BaseStudio

Un gestionnaire de bases MySQL / MariaDB (comme phpMyAdmin) pour Windows + XAMPP, avec une apparence 100 % personnalisable.

- Bases et tables en tuiles colorées, recherche rapide **Ctrl+K**
- Parcourir, modifier, insérer (listes déroulantes pour les clés étrangères), import **CSV**, export `.sql`
- Éditeur SQL avec couleurs et **auto-complétion**
- **Schéma MCD / MLD** façon MERISE, création des clés étrangères en reliant les tables
- **Triggers**, **procédures / fonctions**, **vues**, **recherche** dans toute une base
- **Utilisateurs et droits**, **dictionnaire de données** (PDF)
- Thèmes, polices, couleurs, fond d'écran, CSS personnalisé

## Installer

1. Installe [XAMPP](https://www.apachefriends.org/fr/) dans `C:\xampp` (le choix par défaut).
2. Ici, clique sur le bouton vert **Code** puis **Download ZIP**.
3. Clic droit sur le ZIP > **Extraire tout…**, puis double-clique sur **INSTALLER.bat** dans le dossier extrait.
   Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires** puis **Exécuter quand même**.
4. Un raccourci **BaseStudio** apparaît sur le Bureau.

## Lancer

1. Dans le panneau XAMPP, clique sur **Start** pour **Apache** et **MySQL**.
2. Double-clique sur le raccourci **BaseStudio**.
3. **Se connecter** (`localhost` / `3306` / `root` / mot de passe vide).

## Mises à jour

Quand une nouvelle version est publiée, un bouton **⬆ Mise à jour** apparaît dans l'appli (en haut à droite et sur l'écran de connexion). Un clic montre les nouveautés, puis **Installer** fait tout : tes bases, tes thèmes et tes réglages ne sont pas touchés. Pour vérifier à la main : **Ctrl+K** puis « Vérifier les mises à jour ».

Le détail de toutes les fonctions est dans [`basestudio/README.md`](basestudio/README.md).
