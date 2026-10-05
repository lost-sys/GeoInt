GeoInt V13 — persistance réelle + sessions longues

IMPORTANT
---------
La V8/V9 stockait les comptes, messages, rôles et enregistrements dans data.json.
Sur Render Free, le système de fichiers est éphémère : ce fichier peut disparaître quand
le service redémarre, se met en veille ou est redéployé.

La V10 utilise Supabase pour conserver les données et les sessions côté serveur.
Le token de connexion est conservé dans le navigateur et la session serveur est conservée
dans Supabase pendant 180 jours. Un simple redémarrage de Render ne déconnecte donc plus
l'utilisateur.

1) CRÉER LA TABLE SUPABASE
--------------------------
Dans Supabase > SQL Editor, exécute le contenu de supabase.sql :

create table if not exists public.geoint_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

2) AJOUTER LES VARIABLES SUR RENDER
-----------------------------------
Dans Render > GeoInt > Environment, ajoute :

SUPABASE_URL = URL de ton projet Supabase
SUPABASE_SECRET_KEY = clé secrète de ton projet Supabase

La clé secrète doit rester uniquement côté serveur. Ne la mets jamais dans GitHub,
le HTML, le JavaScript client ou un message public.

Supabase utilise désormais des clés "secret" pour le code serveur. Les anciennes clés
service_role fonctionnent encore, mais la clé secret est préférable pour un nouveau projet.

ADMIN_CODE reste inchangé.

3) COMMANDES RENDER
-------------------
Build Command : echo "No build needed"
Start Command : node server.js

4) GIT / DÉPLOIEMENT
--------------------
Remplacer sur GitHub :
- server.js
- geoint-v7.html
- sw.js
- README.txt
- ajouter supabase.sql (utile pour retrouver le schéma)

Render redéploie automatiquement après le commit.

5) COMPORTEMENT DE LA CONNEXION
--------------------------------
- Le token est déjà conservé dans localStorage.
- La session serveur est maintenant conservée dans Supabase.
- La session dure 180 jours.
- Si le serveur met quelques secondes à se réveiller, GeoInt réessaie la validation au lieu
de supprimer immédiatement le token.
- Un effacement des données du navigateur ou une déconnexion volontaire demandera une
nouvelle connexion, ce qui est normal.

6) DONNÉES
----------
Comptes, rôles, messages des salons, annonces, mises à jour, logs, enregistrements
chiffrés et sessions sont regroupés dans la ligne geoint_state de Supabase.

ATTENTION
---------
Les anciennes données déjà perdues après un redémarrage de Render ne peuvent pas être
récupérées par cette V10. La V10 empêche que cela se reproduise une fois Supabase configuré.

Pour un usage plus important, il faudra ensuite migrer vers de vraies tables séparées
(users, messages, records, etc.) et ajouter des sauvegardes.


V10.1 - comptes
- Un utilisateur connecté ne voit plus la fenêtre de connexion lorsqu’il clique sur son compte : un menu propose Changer de compte ou Se déconnecter.
- Le changement de compte ouvre uniquement la connexion.
- Le serveur limite strictement le nombre total de comptes à 3.


GeoInt v11 — Chat & Vocal
- Salons texte dynamiques et salons vocaux.
- Vocal WebRTC P2P avec micro, mute, casque/deafen et modération serveur.
- Gestion des salons : créer, renommer, lecture seule, supprimer (avec protections système).
- Gestion avancée des rôles : nom, couleur, position, affichage séparé, mentions et permissions.
- Modération : timeout temporaire du chat, mute/deafen vocal.
- Filtre automatique des gros mots : remplacement par des étoiles côté serveur.
- La signalisation vocale est éphémère et n'est pas enregistrée dans Supabase.
- Le reste des données persistantes continue d'utiliser Supabase.


GeoInt v11.1 : vocal amélioré (WebRTC, test micro/écoute locale, indicateur de parole), meilleure gestion des mutes serveur et mise en page mobile responsive.


V12.0 — refonte vocal/chat : redimensionnement par le bord gauche, présence vocale en temps réel, partage d’écran WebRTC bidirectionnel avec renégociation, volume 0–100 %, scène multi-flux, améliorations tactiles/mobile.

V13.0 — correctifs vocal, profils, graphe et cours
--------------------------------------------------
- Partage d'écran : piste vidéo persistante, lecture distante plus robuste et partage sans renégociation inutile.
- Salons vocaux : un utilisateur ne peut être présent que dans un seul salon à la fois ; les listes publiques ne consultent plus un endpoint qui ajoutait accidentellement l'utilisateur au salon.
- Profils : fermeture par croix, aperçu immédiat de la photo, avatar de secours et avatars visibles dans le chat/vocal.
- Graphe : nouveau graphe, ajout de nœuds par bouton/double-tap, manipulation visuelle réactivée.
- Cours : nouvelle section avec cours sur les machines virtuelles Windows, Kali Linux, Arch Linux et choix de distributions.
- Équipe : nouvelle page présentant Lost comme fondateur.


V13.2 : graphe réparé, IA économique Flash-Lite, comptes mémorisés, cours synchronisés, enregistrements image, logs réservés aux modérateurs, statistiques de profil.
