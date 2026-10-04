GeoInt v9 — rôles, permissions et PWA

Fichiers :
- geoint-v7.html : interface GeoInt
- server.js : serveur Node sans dépendance
- manifest.webmanifest : installation PWA
- sw.js : cache et mises à jour automatiques de la PWA
- icon-192.png / icon-512.png : icônes

Déploiement Render :
- Build Command : echo "No build needed"
- Start Command : node server.js
- Environment variable : ADMIN_CODE = ton code secret

Nouveautés v9 :
- rôles système : Propriétaire, Administrateur, Modérateur, Enquêteur, Membre
- création de rôles personnalisés
- couleurs de rôles
- permissions : gérer rôles, gérer utilisateurs, modérer chat, publier annonces, épingler, publier mises à jour, voir logs
- attribution de plusieurs rôles à un utilisateur
- rôles affichés dans le profil et le chat
- permissions contrôlées côté serveur
- onglet Gestion réservé aux personnes ayant les permissions adaptées
- PWA avec cache versionné et navigation réseau-prioritaire pour récupérer les nouvelles versions
- enregistrement du Service Worker avec version v9 pour forcer la vérification d'une nouvelle version

IMPORTANT : data.json reste stocké sur le disque local du service. Sur Render Free, ce stockage n'est pas persistant. Pour conserver les comptes/messages/rôles de façon durable, utiliser une base de données persistante.
