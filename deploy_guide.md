# Guide technique de préparation au déploiement d'Iris (Hostinger VPS & Nginx Proxy Manager)

**Iris est encore en développement : ce document n'est pas une attestation de mise en production.** Consulter d'abord la [passation et ses critères de sortie](docs/ROADMAP-PASSATION.md) et la [configuration d'environnement](docs/CONFIGURATION-ENVIRONNEMENT.md). Les étapes ci-dessous décrivent une stack Docker derrière Nginx Proxy Manager (NPM), non une recette de sécurité, de sauvegarde/restauration ou de conformité déjà validée.

## 0. Prérequis : Clé de déploiement SSH (Dépôt Privé)

Étant donné que votre dépôt Github est privé, vous devez générer une clé SSH spécifique pour ce projet sur votre VPS (afin de ne pas interférer avec vos autres clés existantes).

Connectez-vous à votre VPS en SSH et tapez la commande suivante (elle créera une clé nommée spécifiquement pour le projet Iris) :

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_noxia_iris -C "vps-hostinger-iris"
```
*(Appuyez sur Entrée pour ne pas mettre de mot de passe à la clé, afin que les pulls automatisés ne bloquent pas).*

Ensuite, nous devons dire au système SSH du VPS d'utiliser cette clé spécifique pour ce dépôt. Éditez ou créez le fichier de configuration SSH :

```bash
nano ~/.ssh/config
```

Et ajoutez-y ces lignes :
```text
Host github-iris
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_noxia_iris
    IdentitiesOnly yes
```

Enfin, affichez la clé publique générée à l'écran pour la copier :
```bash
cat ~/.ssh/id_ed25519_noxia_iris.pub
```
Allez sur **GitHub > Votre dépôt `iris` > Settings > Deploy keys > Add deploy key**, collez la clé publique, donnez-lui un nom (ex: "VPS Hostinger"), et validez.

## 1. Déploiement du code sur le VPS

Connectez-vous à votre VPS en SSH et placez-vous dans le dossier où vous souhaitez héberger le projet.
Puisque votre code est synchronisé avec GitHub, il suffit de cloner ou mettre à jour le dépôt :

```bash
# 1. Cloner (la première fois en utilisant notre Host personnalisé)
git clone git@github-iris:OrizonLab/iris.git noxia-iris-chantier
cd noxia-iris-chantier

# Ou mettre à jour (les fois suivantes)
git pull origin main
```

*Installation clonée avant le transfert du dépôt (14-11-2026), depuis `git@github-iris:Noxia-Groupe/iris.git` : GitHub redirige l'ancienne adresse, `git pull` continue donc de fonctionner. Pour viser directement la nouvelle, en gardant l'hôte `github-iris` et sa clé de déploiement : `git remote set-url origin git@github-iris:OrizonLab/iris.git`. Ne renommez pas le dossier `noxia-iris-chantier` : il donne son nom au projet Compose, qui préfixe le volume de la base (`noxia-iris-chantier_postgres_data`) ; sous un autre nom, Compose verrait un autre projet et créerait un volume de base neuf et vide, les données restant dans l'ancien.*

## 2. Configuration (Fichiers .env)

L'application utilise désormais **PostgreSQL** (conteneurisé). Deux fichiers de
configuration sont nécessaires. Des modèles sont fournis (`.env.example`).

**a) `.env` à la racine** (identifiants de la base, lus par docker-compose) :

```bash
cp .env.example .env
nano .env
```
```env
POSTGRES_USER=iris
POSTGRES_PASSWORD=un_mot_de_passe_base_robuste
POSTGRES_DB=iris
```

**b) `server/.env`** (secrets applicatifs) :

```bash
cp server/.env.example server/.env
nano server/.env
```

- Remplacer `JWT_SECRET` par une valeur aléatoire longue ; il est obligatoire en production.
- Renseigner `SUPERADMIN_EMAILS` **avant le premier démarrage d'une base vierge**. Aucune adresse administrateur par défaut n'est créée lorsque la liste est vide.
- Renseigner `AZURE_TENANT_ID` (« ID de l'annuaire (locataire) ») et `AZURE_CLIENT_ID` (« ID d'application (client) »), deux GUID, pour la connexion normale Microsoft 365. Dans Entra ID, l'application est de type « Application monopage (SPA) » et son URI de redirection est exactement `https://<domaine-de-l-instance>/auth/callback` ; pas de secret client. Procédure complète : [guide de configuration](docs/CONFIGURATION-ENVIRONNEMENT.md#microsoft-entra-id-microsoft-365). Aucun mot de passe local `ADMIN_PASSWORD` ni `ADMIN_EMAIL` n'est utilisé pour créer un compte.
- Prévoir `BREAK_GLASS_EMAIL` (compte `SUPERADMIN` actif, aussi présent dans `SUPERADMIN_EMAILS`) et `BREAK_GLASS_TOKEN` (`openssl rand -hex 32`) pour le secours, conservés hors Git. Ce secours est propre à l'instance, **pas** un accès plateforme universel.
- Régler `TRUST_PROXY=2` (proxys de confiance, #261) pour la chaîne décrite ici (Nginx Proxy Manager, puis le nginx du frontend, sans port publié) : sans ce réglage, les essais de l'accès de secours comptent tous pour une seule adresse, et un tiers peut le bloquer pour tous. Détail : [guide de configuration](docs/CONFIGURATION-ENVIRONNEMENT.md#backend-et-sécurité).

Utiliser [`server/.env.example`](server/.env.example) et le [guide de configuration](docs/CONFIGURATION-ENVIRONNEMENT.md) comme références détaillées. Ne jamais recopier les valeurs d'exemple dans une instance réelle.

> Note : en Docker, `DATABASE_URL` est construite et injectée **automatiquement** par
> docker-compose à partir du service `db` — inutile de la définir vous-même ici ; `PORT` et
> `NODE_ENV` sont aussi imposés par docker-compose. `server/.env` doit exister avant toute
> commande `docker compose` (il est chargé par `env_file`). Après une modification, recréer
> le conteneur : `docker compose up -d --force-recreate backend`.

## 3. Lancement avec Docker Compose

Vérifiez que vous êtes à la racine du dépôt (là où se trouve `docker-compose.yml`), puis contrôlez la configuration avant de construire les services :

```bash
docker compose config
docker compose up -d --build
```
*Note : Le réseau externe `nginx-proxy` doit déjà exister sur votre VPS, car il est géré par votre NPM.*

*Note : Le réseau externe `backup-net` doit également exister avant le premier démarrage — il permet à pgBackWeb (autre stack Docker sur le même VPS) d'atteindre le service `db` pour les sauvegardes. Créez-le une seule fois avec :*
```bash
docker network create backup-net
```
*Ajoutez ensuite ce même réseau externe `backup-net` au service pgBackWeb dans son propre `docker-compose.yml`, puis connectez-vous à la base depuis pgBackWeb avec l'hôte `iris_db` (nom du conteneur), le port `5432` et les identifiants définis dans votre `.env`.*

*Note : depuis le lot P0 (#280), le réseau interne de la stack s'appelle `iris-network` (auparavant `noxia-network`). Sur une installation existante, `docker compose up -d --build` crée le nouveau réseau et y recrée les trois conteneurs (coupure le temps que la base redémarre et que le backend applique ses migrations, au moins une dizaine de secondes, le backend attendant le contrôle de santé de la base ; volumes, réseaux externes et noms de conteneurs inchangés) ; l'ancien réseau, désormais inutilisé, reste. Repérez-le avec `docker network ls` (son nom est préfixé par celui du projet Compose, par défaut le dossier du dépôt : `noxia-iris-chantier_noxia-network` avec le clonage de la section 1), puis supprimez-le : `docker network rm <projet>_noxia-network`.*

### Migrations de base de données

Les **migrations Prisma sont appliquées automatiquement** au démarrage du conteneur
backend (`prisma migrate deploy`). Pour faire évoluer le schéma par la suite :

1. En local, modifiez `server/prisma/schema.prisma` puis créez la migration :
   `npx prisma migrate dev --name description_du_changement`
2. Commitez le dossier généré dans `server/prisma/migrations/`.
3. Sur le VPS, `docker compose up -d --build` rejoue les nouvelles migrations.

### Sauvegarde de la base

Les données vivent dans le volume Docker `postgres_data` de `docker-compose.yml`, nommé `noxia-iris-chantier_postgres_data` par Docker sur une installation clonée dans le dossier `noxia-iris-chantier` (voir plus haut). Pour un export :

```bash
docker exec iris_db pg_dump -U iris iris > sauvegarde_$(date +%F).sql
```

Ce fichier contient toute la base, dont des données personnelles (clients, contacts, comptes), les taux horaires et, en clair, le jeton du lien public du planning, qui ouvre le planning sans authentification. Avant la commande, taper `umask 077` dans le même terminal : le fichier ne sera lisible que par son propriétaire (ce réglage vaut pour tout ce que ce terminal crée ensuite, jusqu'à sa fermeture). Ranger les sauvegardes hors du dossier du dépôt. Leur conservation (durée, chiffrement, copie hors site) relève de la stratégie de sauvegarde, lot séparé non encore décidé ([passation](docs/ROADMAP-PASSATION.md), section 5).

### Restauration d'une sauvegarde

*Statut : procédure documentée et éprouvée en CI sur des données de synthèse (`server/tests/restauration-sauvegarde.test.mjs`, #618). Elle ne vaut pas « sauvegarde et restauration testées » pour l'instance pilote ([passation](docs/ROADMAP-PASSATION.md), section 5) et n'est pas validée pour mise en service. Elle ne couvre que la sauvegarde complète au format SQL de la sous-section précédente ; une sauvegarde faite par un autre outil (pgBackWeb, par exemple) n'est pas couverte.*

**Règle : une sauvegarde complète se restaure toujours dans une base recréée vide, backend arrêté.** Ne jamais restaurer dans une base déjà migrée, pas même les seules données : elle contient déjà le compte système, les paramètres de rémunération et l'historique des migrations, que la sauvegarde contient aussi.

**Factures émises après la sauvegarde.** Une sauvegarde antérieure à des factures émises ramènerait en arrière leur numérotation (`SequenceFacture`), alors que la numérotation des factures doit rester continue et chronologique. La conduite à tenir dans ce cas est une question ouverte pour Nelson : ne pas restaurer une telle sauvegarde sans sa décision (#642).

Pourquoi : dans une base déjà migrée, les déclencheurs existent avant les données, et chaque ligne chargée les rejoue.
- Les huit journaux horodatés par la base (`JournalAdministration`, `JournalFacture`, `InterventionRapport`, `InterventionSignature`, `EnvoiDocument`, `JournalSaisieChantier`, `JournalCompteComptable`, `JournalRegleComptable`) prendraient l'instant de la restauration au lieu de leur date d'origine, tout comme la date d'acceptation des signatures.
- Les gardes refuseraient des lignes : pièces émises, lignes de devis signés, règlements, entre autres. La ligne du journal des règles comptables serait refusée elle aussi, car son déclencheur ne trouve pas le plan comptable pendant la restauration.
- Le compte système et les paramètres de rémunération entreraient en conflit avec ceux de la sauvegarde, et l'historique des migrations serait doublé.
- Sans `-v ON_ERROR_STOP=1`, `psql` poursuit malgré les erreurs et rend 0 sur une base partielle. Avec cette option, il s'arrête à la première erreur.

Dans une base vide, les déclencheurs, les clés étrangères et les contraintes différées sont créés après les données : ils ne rejouent rien. Les contraintes de vérification, créées avec les tables, jouent au chargement, sans effet sur des données déjà valides. `--single-transaction` évite qu'une erreur en cours de route laisse une base chargée sans ses déclencheurs, que le backend démarrerait ensuite sans rien migrer.

Étapes (commandes pour l'utilisateur et la base `iris` de la sous-section précédente) :

1. **Vérifier que le fichier est complet.** La commande doit afficher `1`. Un fichier coupé (sauvegarde interrompue, copie incomplète) pourrait se restaurer sans erreur, mais sans tout ou partie de ses déclencheurs et de ses clés étrangères.
   ```bash
   grep -cx -- '-- PostgreSQL database dump complete' sauvegarde_AAAA-MM-JJ.sql
   ```
2. **Image d'Iris.** Restaurer avec une image d'Iris au moins aussi récente que la sauvegarde. Au redémarrage, le backend n'applique que les migrations plus récentes que celles de la sauvegarde ; une image plus ancienne n'en verrait aucune à appliquer, sans le signaler.
3. **Arrêter le backend** : `docker compose stop backend`. Le frontend et la base restent démarrés. Pendant la restauration, ne lancer ni `docker compose up` ni un redémarrage de Docker : avec `restart: always`, le backend redémarrerait et migrerait la base vide. La restauration échouerait alors en entier, sans rien écrire : il faudrait arrêter de nouveau le backend, puis reprendre à l'étape 5, sans refaire l'étape 4. La copie de sécurité est déjà faite, et la base n'est plus celle d'origine : une nouvelle copie ne la contiendrait pas et, faite dans la même minute, écraserait la première, de même nom. Si un outil de sauvegarde planifiée atteint la base (pgBackWeb, par le réseau `backup-net`, par exemple), suspendre aussi ses sauvegardes planifiées jusqu'à la fin de l'étape 7 : lancée pendant les étapes 5 et 6, une sauvegarde enregistrerait une base vide, qui passerait pourtant le contrôle de l'étape 1, ou serait coupée par `dropdb --force`.
4. **Sauvegarder d'abord la base actuelle**, sous un autre nom de fichier. La commande doit rendre 0 (`echo $?`), et le contrôle de l'étape 1, appliqué à ce fichier, doit afficher `1`. Sinon, la copie est incomplète : ne pas aller plus loin, la base actuelle n'étant pas encore touchée. Avec une copie complète, rien n'est perdu si la sauvegarde à restaurer se révèle mauvaise. Même précaution que pour la sauvegarde (`umask 077` dans ce terminal, copie rangée hors du dépôt). Ne pas supprimer cette copie : elle seule garde les écritures faites depuis la sauvegarde à restaurer, factures émises comprises ; sa conservation relève de la stratégie de sauvegarde, non encore décidée.
   ```bash
   docker exec iris_db pg_dump -U iris iris > avant_restauration_$(date +%F_%H%M).sql
   ```
5. **Recréer la base vide.** `--force` ferme les connexions encore ouvertes, celle de pgBackWeb par exemple.
   ```bash
   docker exec iris_db dropdb -U iris --force iris
   docker exec iris_db createdb -U iris iris
   ```
6. **Restaurer**, avec le `psql` du même conteneur, qui doit être au moins aussi récent que le `pg_dump` qui a fait la sauvegarde. Noter juste avant l'heure UTC (`date -u`), pour la vérification.
   ```bash
   docker exec -i iris_db psql -U iris -d iris -v ON_ERROR_STOP=1 --single-transaction < sauvegarde_AAAA-MM-JJ.sql
   ```
   La commande doit rendre 0 (`echo $?`). Sinon, rien n'est écrit : corriger la cause, puis reprendre à l'étape 5, sans refaire l'étape 4 (si le backend a redémarré, l'arrêter d'abord comme à l'étape 3).
7. **Vérifier** (ci-dessous), avant de redémarrer.
8. **Redémarrer le backend** : `docker compose start backend`. Il n'applique que les migrations plus récentes que la sauvegarde. Reprendre ensuite les sauvegardes planifiées suspendues à l'étape 3.

Pour revenir à la copie de sécurité avant l'étape 8 (sauvegarde restaurée mauvaise, vérification en échec), reprendre à l'étape 5 avec le fichier de l'étape 4, sans refaire l'étape 4 ; si le backend a redémarré, l'arrêter d'abord comme à l'étape 3.

Sur un nouveau serveur, démarrer la base seule (`docker compose up -d db`), puis suivre les étapes 1, 2, 5, 6 et 7, et démarrer ensuite toute la pile (`docker compose up -d`).

**Vérification après la restauration.**
- **Déclencheurs** : leur nombre dans la base doit égaler celui du fichier. Ce contrôle signale une restauration arrêtée avant ses déclencheurs, faite sans `--single-transaction` par exemple. Il ne signale ni une restauration dans une base déjà migrée, ni une restauration sans `-v ON_ERROR_STOP=1` qui a poursuivi après une erreur et rendu 0 : la requête des journaux ci-dessous peut alors montrer des horodatages remplacés ou, comparée à la base d'origine, des lignes manquantes. Il ne remplace pas non plus l'étape 1, seule à détecter un fichier coupé : il compte les déclencheurs du fichier lui-même, et un fichier coupé après ses déclencheurs, mais avant ses clés étrangères, le passe.
  ```bash
  docker exec iris_db psql -U iris -d iris -tAc 'SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal'
  grep -cE '^CREATE (CONSTRAINT )?TRIGGER ' sauvegarde_AAAA-MM-JJ.sql
  ```
- **Journaux** : pour chacun, la requête ci-dessous (à lancer dans `docker exec -it iris_db psql -U iris -d iris`) donne le nombre de lignes et la plus ancienne et la plus récente date. La plus récente doit précéder le début de la restauration, noté en UTC à l'étape 6 (les dates de la requête sont en UTC). Si la même requête a été lancée sur la base d'origine juste avant la sauvegarde, elle doit donner le même résultat ; lancée plus tard sur une base d'origine restée en service, elle peut donner des nombres et des dates plus grands.
  ```sql
  SELECT 'JournalAdministration' AS journal, count(*), min("createdAt"), max("createdAt") FROM "JournalAdministration"
  UNION ALL SELECT 'JournalFacture', count(*), min("createdAt"), max("createdAt") FROM "JournalFacture"
  UNION ALL SELECT 'InterventionRapport', count(*), min("createdAt"), max("createdAt") FROM "InterventionRapport"
  UNION ALL SELECT 'InterventionSignature', count(*), min("createdAt"), max("createdAt") FROM "InterventionSignature"
  UNION ALL SELECT 'EnvoiDocument', count(*), min("createdAt" AT TIME ZONE 'UTC'), max("createdAt" AT TIME ZONE 'UTC') FROM "EnvoiDocument"
  UNION ALL SELECT 'JournalSaisieChantier', count(*), min("createdAt"), max("createdAt") FROM "JournalSaisieChantier"
  UNION ALL SELECT 'JournalCompteComptable', count(*), min("createdAt"), max("createdAt") FROM "JournalCompteComptable"
  UNION ALL SELECT 'JournalRegleComptable', count(*), min("createdAt"), max("createdAt") FROM "JournalRegleComptable";
  ```
  Les dates sont en UTC.

## 4. Configuration dans Nginx Proxy Manager (NPM)

Rendez-vous sur l'interface web de votre Nginx Proxy Manager pour créer le proxy de votre nom de domaine (ex: `iris.noxia.com`).

Dans **Proxy Hosts** > **Add Proxy Host** :

1. **Domain Names** : `votre-domaine.com`
2. **Scheme** : `http`
3. **Forward Hostname / IP** : `iris_frontend` *(C'est le nom exact du conteneur frontend défini dans le docker-compose)*
4. **Forward Port** : `80`
5. **Block Common Exploits** : Coché (Recommandé)
6. **Websockets Support** : Coché

Dans l'onglet **SSL** :
- Sélectionnez "Request a new SSL Certificate" (Let's Encrypt).
- Cochez "Force SSL".
- Acceptez les conditions et enregistrez.

Si le proxy HTTPS est configuré et la stack saine, vérifier l'accès, l'authentification Entra, le secours, les migrations et les parcours métier. Une sauvegarde ponctuelle ne valide pas une stratégie de reprise : tester aussi la restauration sur une base isolée, sur un autre serveur par exemple, selon la procédure de la section 3 (« Restauration d'une sauvegarde », cas d'un nouveau serveur). Le feu vert de production dépend de la [recette de sortie](docs/ROADMAP-PASSATION.md) et de la décision de Nelson.
