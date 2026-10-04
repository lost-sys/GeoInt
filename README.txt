# GeoInt v8

## Ce qui a été ajouté
- Compte avec pseudo + mot de passe.
- `Lost` réservé au créateur avec un code créateur.
- Pseudos uniques, insensibles à la casse.
- Enregistrements stockés côté serveur et chiffrés côté navigateur.
- `Lost` peut épingler/désépingler les enregistrements des autres.
- Chat avec plusieurs salons : Général, Annonces, Recrutement, Aide, Trouvailles.
- Le salon Annonces est réservé à `Lost` pour l'écriture.
- Onglet Mises à jour avec historique.
- `Lost` peut publier les mises à jour.
- PWA installable comme application.
- Bouton « Installer » lorsqu'un navigateur compatible propose l'installation.

## Installation
1. Installer Node.js 18 ou plus récent.
2. Mettre `server.js`, `geoint-v7.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png` et `icon-512.png` dans le même dossier.
3. Définir un code créateur.
4. Lancer le serveur.

### Windows CMD
set ADMIN_CODE=MON_CODE_SECRET
node server.js

### PowerShell
$env:ADMIN_CODE="MON_CODE_SECRET"
node server.js

5. Ouvrir http://localhost:3000
6. Créer le compte `Lost` avec le code créateur.

Le fichier `data.json` sera créé automatiquement et contiendra les comptes, sessions, enregistrements, messages et mises à jour.

## Important
Le site n'est pas réellement multi-utilisateur sur Internet tant que ce serveur reste lancé uniquement sur ton PC.
Pour que plusieurs personnes se connectent, il faudra héberger `server.js` sur un serveur accessible par les autres.

Pour l'installation en application, le navigateur doit ouvrir GeoInt via `http://localhost:3000` ou HTTPS, pas en double-cliquant directement sur le fichier HTML.
Après installation de la PWA, le raccourci créé sur le bureau peut être lancé comme une application.
