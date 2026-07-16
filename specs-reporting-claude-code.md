# Spécifications — Amélioration du module « Reporting »

**Destinataire :** Claude Code (implémentation) **Objet :** 4 évolutions du module Reporting — gestion ordonnée des livrables, édition intégrant les commentaires, suppression du glissement des actions, bilan IA \+ objectifs hebdomadaires. **À valider avant démarrage :** application cible et stack exacte (framework front, backend/API, base de données). Les endpoints et le modèle de données ci-dessous sont donnés à titre de référence et doivent être adaptés à l'architecture existante.

---

## 1\. Objectif

Faire évoluer le module Reporting pour qu'un pilote de projet puisse structurer ses livrables, produire un compte rendu propre intégrant les retours, et obtenir un bilan assisté par IA débouchant sur des objectifs hebdomadaires actionnables — sans friction inutile dans l'interface.

## 2\. Rôles & terminologie

- **Multiplicateur** — utilisateur pilote, autorisé à **gérer et ordonner les livrables** d'un ou plusieurs projets. *(Hypothèse : rôle existant. À confirmer — sinon, mapper sur le rôle « manager/pilote » en place. Le mot « multiplicateur » est conservé volontairement ; me préciser si c'est un intitulé de rôle réel dans l'app.)*  
- **Contributeur** — peut commenter et éditer le contenu du reporting selon droits.  
- **Lecteur** — consultation seule.

## 3\. Périmètre

**Inclus :** F1 ordonnancement des livrables · F2 édition \+ intégration des commentaires · F3 retrait du drag des actions · F4 bilan IA \+ objectifs hebdo. **Exclu :** refonte visuelle globale, gestion des droits au-delà de ce qui est nécessaire à F1–F4, export PDF (sauf si déjà présent — dans ce cas simplement ne pas régresser).

---

## 4\. Spécifications fonctionnelles

### F1 — Gestion ordonnée des livrables

**Besoin :** un Multiplicateur classe les livrables d'un reporting dans un **ordre défini** (ordre de présentation / de priorité).

**Comportement attendu :**

- Chaque livrable porte une position ordinale explicite au sein de son reporting (ou de son projet).  
- Réordonnancement via **contrôles explicites** (boutons monter/descendre \+ champ « ordre » saisissable), **et non par glisser-déposer** — cohérent avec F3 et plus accessible/testable. *(Variante possible : conserver un drag dédié aux livrables uniquement. Recommandation : contrôles explicites. Me dire si vous préférez la variante drag.)*  
- L'ordre est **persisté** et respecté à l'affichage, à l'édition et dans le bilan IA (F4).  
- Seul le Multiplicateur peut modifier l'ordre ; les autres rôles voient l'ordre en lecture.

**Modèle de données :** ajouter `livrables.ordre` (entier, non nul, unique par `reporting_id`). Prévoir une **renumérotation atomique** lors des insertions/déplacements pour éviter les collisions.

**API (référence) :**

- `POST /reporting/{id}/livrables/reorder` — corps : `{ "ordre": ["livrable_id_1", "livrable_id_2", ...] }` ; renumérote en une transaction.  
- `PATCH /livrables/{id}` — accepte `{ "ordre": n }` avec décalage automatique des voisins.

**Critères d'acceptation :**

- *Étant donné* un reporting avec 5 livrables, *quand* le Multiplicateur remonte le livrable en position 4 vers la position 1, *alors* les 4 livrables intermédiaires se décalent et l'ordre est conservé après rechargement.  
- *Quand* un Contributeur ou Lecteur affiche le reporting, *alors* aucun contrôle d'ordre n'est actionnable.

---

### F2 — Édition du reporting avec intégration des commentaires

**Besoin :** éditer le contenu du reporting **en intégrant les commentaires** laissés en revue.

**Comportement attendu :**

- Mode **édition** du corps du reporting (texte riche ou markdown selon l'existant), avec sauvegarde.  
- Les commentaires s'affichent en marge / fil dédié, rattachés au reporting (ou à une section/livrable via ancre).  
- Action **« Intégrer »** sur un commentaire : insère son contenu dans le corps du reporting (à l'ancre associée si présente, sinon en fin de section), puis passe le commentaire au statut `intégré` (horodaté \+ auteur de l'intégration).  
- Un commentaire peut aussi être marqué `résolu` sans intégration.  
- **Historisation** de l'édition (au minimum : dernière modif \= auteur \+ date ; idéalement versioning léger permettant de revenir en arrière).

**Modèle de données :**

- `commentaires` : `id`, `reporting_id`, `ancre` (nullable), `auteur`, `contenu`, `statut` (`ouvert` | `intégré` | `résolu`), `created_at`, `integrated_at`, `integrated_by`.  
- `reporting` : `corps` (texte), `updated_by`, `updated_at`, `version` (incrément).

**API (référence) :**

- `PUT /reporting/{id}` — met à jour `corps` (contrôle de concurrence via `version`/ETag pour éviter l'écrasement).  
- `POST /commentaires/{id}/integrate` — insère \+ statut `intégré`.  
- `POST /commentaires/{id}/resolve` — statut `résolu`.

**Critères d'acceptation :**

- *Quand* l'utilisateur clique « Intégrer » sur un commentaire, *alors* son contenu apparaît dans le corps du reporting et le commentaire bascule en `intégré` (non ré-intégrable).  
- *Quand* deux utilisateurs éditent en parallèle, *alors* la seconde sauvegarde sur une version périmée est rejetée avec un message clair (pas d'écrasement silencieux).

---

### F3 — Suppression du glissement (drag-and-drop) des actions

**Besoin :** retirer la fonction de **glissement des actions**.

**Comportement attendu :**

- Désactiver et retirer le drag-and-drop sur la liste des **actions** (handlers, lib de drag, indicateurs visuels de poignée).  
- Remplacer le tri manuel par glisser par un **tri déterministe** : par échéance, statut ou priorité (au choix — par défaut : échéance croissante). L'utilisateur peut basculer le critère de tri via un sélecteur si pertinent.  
- Nettoyer le code mort : endpoint de réordonnancement des actions et champ `actions.ordre` s'ils ne servent plus qu'au drag (prévoir migration de suppression du champ **uniquement** après confirmation qu'aucune autre fonctionnalité ne l'utilise).

**Critères d'acceptation :**

- *Quand* l'utilisateur affiche la liste des actions, *alors* aucune poignée de drag n'est présente et le glisser ne produit aucun effet.  
- *Alors* aucune requête de réordonnancement d'action n'est émise ; le tri suit le critère défini.  
- Aucune régression : les actions restent créables, éditables, filtrables.

---

### F4 — Assistant IA : bilan des actions \+ objectifs hebdomadaires

**Besoin :** via l'assistant IA, produire un **bilan des actions** et **proposer des objectifs hebdomadaires** pour faire avancer les projets.

**Comportement attendu :**

- Bouton **« Générer le bilan »** sur le reporting (ou par projet).  
- **Entrée** transmise au modèle : liste des actions (`titre`, `statut`, `échéance`, `responsable`, `projet`), livrables ordonnés (F1), et éventuellement le corps du reporting édité (F2). Aucune donnée hors périmètre.  
- **Sortie structurée (JSON)** puis rendue dans l'UI, **éditable avant enregistrement** :  
  - `bilan` par projet : avancement (synthèse qualitative \+ estimation % si les statuts le permettent), faits marquants, **risques et retards** identifiés (actions en dépassement d'échéance, bloquantes).  
  - `objectifs_hebdo` par projet : **3 à 5 objectifs SMART**, priorisés, chacun rattaché à une ou plusieurs actions/livrables existants, avec critère de succès explicite.  
- **Enregistrement** : le bilan validé est attaché au reporting (horodaté) ; les objectifs peuvent être créés comme actions de la semaine à venir (optionnel, sur validation).

**Implémentation IA :**

- Appel à l'API Anthropic (Messages). Modèle recommandé : un modèle Claude adapté au ratio coût/qualité de la tâche (ex. Sonnet) — paramétrable.  
- **Sortie strictement JSON** conforme à un schéma (parsing sécurisé, retry si JSON invalide).  
- **Garde-fous :**  
  - Se baser **uniquement** sur les données fournies ; ne rien inventer. Si une donnée manque (échéance absente, statut incohérent), le signaler dans le bilan plutôt que combler.  
  - Réponse en **français**.  
  - Ton concret et opérationnel ; objectifs mesurables, pas de généralités.  
- **Coût/latence :** afficher un indicateur de chargement ; envisager la mise en cache du dernier bilan et un garde-fou anti-double-clic.

**Gabarit de prompt (system) — à intégrer côté backend :**

Tu es un assistant de pilotage opérationnel. À partir des données d'actions et de

livrables fournies (et uniquement d'elles), produis un bilan factuel par projet puis

propose des objectifs hebdomadaires SMART.

Règles :

\- Ne t'appuie que sur les données transmises. N'invente aucun fait ; signale les

  données manquantes ou incohérentes.

\- Identifie explicitement les actions en retard (échéance dépassée) et les blocages.

\- Objectifs : 3 à 5 par projet, SMART, priorisés, rattachés à des actions/livrables

  existants, avec un critère de succès mesurable.

\- Réponds STRICTEMENT au format JSON suivant, sans texte hors JSON :

{

  "bilan": \[{ "projet": "", "avancement": "", "faits\_marquants": \[""\],

              "risques\_retards": \[""\] }\],

  "objectifs\_hebdo": \[{ "projet": "", "objectifs": \[

     { "intitule": "", "priorite": 1, "actions\_liees": \[""\], "critere\_succes": "" }

  \]}\]

}

**Critères d'acceptation :**

- *Quand* l'utilisateur clique « Générer le bilan », *alors* un bilan par projet \+ des objectifs hebdo SMART s'affichent, éditables avant enregistrement.  
- *Étant donné* une action dont l'échéance est dépassée, *alors* elle apparaît dans `risques_retards`.  
- *Quand* la réponse du modèle n'est pas un JSON valide, *alors* l'app relance une fois puis affiche une erreur maîtrisée (pas de crash, pas d'affichage brut).

---

**Évolutions complémentaires (F5 → F9)** — ces points touchent d'autres modules que le Reporting (COA, Mirage, mini-dashboards, COGS, paramètres produits). Confirmer qu'ils vivent dans la **même application/stack** (voir hypothèses). Le vocabulaire issu de notes dictées est repris tel quel, avec l'interprétation retenue signalée.

### F5 — Fiche COA : persistance des dates & pictogramme d'alerte

**F5.1 — Bug : dates non persistées sur la fiche COA**

- **Constat :** à l'enregistrement du COA, la **date de réception de commande** et la **date de péremption** sont saisies mais **disparaissent de la fiche COA** après enregistrement, alors qu'elles **restent affichées sur la page liste** (première page).  
- **Attendu :** ces deux dates doivent être **persistées et ré-affichées** sur la fiche après enregistrement et après rechargement, de façon cohérente avec la liste (source de données unique).  
- **Piste technique :** vérifier le mapping du formulaire à l'enregistrement (champs non liés au modèle ou non renvoyés par l'API de la fiche) et le rechargement de la fiche. Corriger côté **persistance ET affichage**.  
- **Critère d'acceptation :** *quand* j'enregistre un COA avec les deux dates, *alors* elles s'affichent sur la fiche après enregistrement et après reload, identiques à la liste.

**F5.2 — Pictogramme d'attention inexpliqué (lot PDRN JJ20726003)**

- **Constat :** un pictogramme d'alerte s'affiche sur le lot PDRN **JJ20726003** sans motif compréhensible.  
- **Attendu :**  
  - Rendre l'alerte **explicite** : au survol/clic, un tooltip indique **la règle déclenchée** (ex. péremption proche, donnée manquante, résultat OOS, date incohérente…).  
  - **Investiguer ce lot** : identifier la règle exacte qui se déclenche ; si **faux positif** (donnée mal saisie ou règle trop large), corriger la règle/la donnée ; sinon documenter le motif légitime.  
- **Critères d'acceptation :** tout pictogramme porte un motif lisible ; le cas JJ20726003 est soit corrigé (faux positif), soit justifié (motif affiché).

### F6 — Module Mirage : analyse dynamique sur données filtrées

**Besoin :** dès qu'un filtre est appliqué, l'analyse doit se recalculer sur le **sous-ensemble filtré**, pas sur l'ensemble des données.

**Comportement attendu :**

- **Recalcul automatique** de l'analyse (graphes \+ Pareto) à chaque changement de filtre.  
- Sur un filtre par **typologie de défaut** : afficher un graphe **quantité par année × type de produit** (segmentable par typologie). Axes/segmentation paramétrables (année, type de produit, typologie).  
- **Diagramme de Pareto** recalculé **uniquement sur les défauts filtrés/sélectionnés** — il ne doit plus reprendre l'ensemble des données.  
- *(Votre note « le mieux serait d'avoir… » est coupée — préciser la vue idéale visée pour la compléter.)*

**Critères d'acceptation :**

- *Quand* je filtre sur une typologie de défaut, *alors* le graphe quantité/année/type de produit et le Pareto ne reflètent que les données filtrées.  
- Aucun résidu de données hors filtre dans le Pareto.

### F7 — Mini-dashboards : drill-down vers la liste des COA

**Besoin :** cliquer sur une tuile mini-dashboard doit ouvrir la **liste des COA concernés** par la métrique.

**Comportement attendu :**

- Chaque tuile KPI devient **cliquable** → panneau/page listant les COA sous-jacents, chaque ligne ouvrant la **fiche COA**.  
- La liste **hérite du contexte/filtre** de la tuile.

**Critère d'acceptation :** *quand* je clique sur une tuile, *alors* s'ouvre la liste des COA correspondant exactement au compte affiché, chaque ligne menant à la fiche COA.

### F8 — COGS : refonte du calcul par lot

*(Section à fort enjeu, vocabulaire issu de notes dictées à confirmer — voir hypothèses. Interprétation retenue ci-dessous.)*

**F8.1 — Taille de référence en lecture seule, recalcul piloté par le volume éditable**

- La **taille de lot de référence** (champ que vous nommez « taille de l'eau de référence ») est **grisée / non modifiable** : elle fixe les **quantités de base**.  
- Le champ **éditable** est le **volume / la taille du lot cible** (« volume de l'eau ») : sa modification déclenche le **recalcul en temps réel du COGS** avec les quantités de matières mises à l'échelle.

**F8.2 — Notion de « multiple » pour les articles stériles en sachet**

- Ajouter au modèle COGS une notion de **multiple (conditionnement)** en **option**, pour les articles **stériles conditionnés en sachets**, afin de compter/consommer par pack.

**F8.3 — Éditer puis figer une référence de consommation**

- Permettre de **modifier** la référence de base de consommation (liée à la taille de lot), puis de la **figer (verrouiller)** pour la réutiliser comme **référence figée** dans les calculs suivants. Action **réversible** (défiger).

**F8.4 — Tailles de lot par défaut**

- **Louna Filler** et **Essentyal** : **1000 boîtes** par défaut.  
- **Astral Fine** : **2500 et 2000** *(à confirmer : deux SKU distincts, ou deux tailles de lot proposées par défaut ?)*.

**Critères d'acceptation :**

- La taille de référence n'est pas éditable ; modifier le volume recalcule le COGS et les quantités matières en temps réel.  
- L'option « multiple » n'apparaît que pour les articles stériles en sachet et impacte le calcul.  
- Une référence figée reste stable tant qu'elle n'est pas défigée.  
- Les nouveaux calculs proposent les tailles de lot par défaut ci-dessus.

### F9 — Création produit : générer la carte « lead time » associée

**Besoin :** à la **création d'un nouveau produit** dans les paramètres, proposer de **créer aussi sa carte lead time** (fiche des délais).

**Comportement attendu :**

- À la fin de la création produit, proposer (case à cocher / étape) : « Créer la carte lead time associée ».  
- Pré-remplir le lien vers le produit ; ouvrir la carte pour saisie des délais.

**Critère d'acceptation :** *quand* je crée un produit et coche l'option, *alors* une carte lead time liée est créée et éditable.

---

## 5\. Sécurité & permissions (transversal)

- F1 : modification de l'ordre réservée au Multiplicateur ; vérification **côté serveur**, pas seulement dans l'UI.  
- F2 : édition et intégration selon rôle ; contrôle de concurrence sur le corps du reporting.  
- F4 : ne jamais transmettre au modèle de données au-delà du périmètre du reporting concerné ; clé API Anthropic **côté backend uniquement**, jamais exposée au front.

## 6\. Tests attendus

- Unitaires : renumérotation des livrables (F1), transitions de statut des commentaires (F2), parsing/validation JSON du bilan (F4).  
- Intégration/E2E : réordonnancement persistant après reload (F1) ; intégration d'un commentaire \+ non-régression d'édition (F2) ; **absence totale de drag sur les actions** (F3) ; génération de bilan sur jeu de données avec retards (F4).  
- Non-régression : création/édition/filtre des actions inchangés après F3.

## 7\. Hypothèses à valider

1. Sens exact du rôle « Multiplicateur ».  
2. F1 : contrôles explicites (recommandé) **ou** drag conservé pour les livrables uniquement.  
3. F3 : le champ `actions.ordre` peut-il être supprimé, ou sert-il ailleurs ?  
4. F4 : les objectifs hebdo doivent-ils créer automatiquement des actions, ou rester propositions ?  
5. **Modules F5–F9** : même application/stack que le Reporting ? (Odoo, app QMS Railway/PostgreSQL, ou autre) — condition préalable au chiffrage.  
6. F5.2 : quelle règle déclenche réellement le pictogramme sur le lot JJ20726003 ? (à identifier dans le code/les données).  
7. F6 : compléter la vue Pareto idéale visée (note « le mieux serait d'avoir… » coupée).  
8. F8 : confirmer le libellé exact et la nature des champs « taille de l'eau de référence » et « volume de l'eau » (taille de lot ? volume de gel/eau de la formulation ?) et la **formule de mise à l'échelle** des quantités matières.  
9. F8.4 : « Astral Fine 2500 et 2000 » \= deux SKU distincts, ou deux tailles de lot par défaut ?

---

## 8\. Prompt prêt à coller pour Claude Code

Contexte : module Reporting de lounaflow-V2-ref . Implémente les

4 évolutions suivantes en respectant l'architecture existante et en ajoutant des tests.

F1 — Livrables ordonnés : ajoute un ordre explicite par reporting (champ \`ordre\`),

réordonnancement via boutons monter/descendre \+ saisie de position (PAS de drag),

persistant, réservé au rôle Multiplicateur (contrôle serveur). Endpoint reorder

transactionnel.

F2 — Édition \+ intégration des commentaires : mode édition du corps du reporting avec

contrôle de concurrence (version/ETag) ; commentaires rattachés au reporting ; action

« Intégrer » qui insère le contenu du commentaire dans le corps et passe le commentaire

en statut \`intégré\` (horodaté). Historise la dernière modification.

F3 — Supprime le drag-and-drop des ACTIONS (handlers, lib, poignées). Remplace par un

tri déterministe (défaut : échéance croissante). Nettoie le code mort ; ne supprime le

champ \`actions.ordre\` qu'après avoir vérifié qu'il n'est plus utilisé.

F4 — Bilan IA : bouton « Générer le bilan » qui appelle l'API Anthropic (clé côté

backend). Entrée \= actions \+ livrables ordonnés (+ corps du reporting). Sortie JSON

stricte { bilan\[\], objectifs\_hebdo\[\] } : bilan factuel par projet (avancement, faits

marquants, risques/retards incluant actions en retard) \+ 3–5 objectifs SMART priorisés

par projet, rattachés à des actions existantes. Garde-fous : se baser uniquement sur les

données, signaler les manques, sortie en français, retry si JSON invalide. Rendu éditable

avant enregistrement.

F5 — Fiche COA : corrige la non-persistance des dates (réception commande \+ péremption)

qui disparaissent de la fiche après enregistrement alors qu'elles restent dans la liste ;

affiche-les depuis la même source. Rends explicite tout pictogramme d'alerte (tooltip \=

règle déclenchée) et investigue le lot PDRN JJ20726003 (faux positif → corrige ; sinon

documente le motif).

F6 — Module Mirage : recalcule l'analyse à chaque filtre. Ajoute un graphe quantité par

année × type de produit (segmentable par typologie de défaut). Recalcule le Pareto

UNIQUEMENT sur les défauts filtrés (plus sur l'ensemble des données).

F7 — Rends chaque tuile mini-dashboard cliquable → liste des COA concernés (héritant du

filtre de la tuile), chaque ligne ouvrant la fiche COA.

F8 — COGS : taille de lot de référence en lecture seule (fixe les quantités) ; volume/

taille cible éditable → recalcul temps réel du COGS \+ quantités matières. Ajoute une

notion de « multiple » (conditionnement) optionnelle pour les articles stériles en sachet.

Permets d'éditer puis figer/défiger une référence de consommation. Tailles de lot par

défaut : Louna Filler \+ Essentyal \= 1000 boîtes ; Astral Fine \= 2500 / 2000\.

F9 — À la création d'un produit dans les paramètres, propose de créer sa carte lead time

liée (pré-remplie, éditable).

Livre : code \+ migrations \+ tests unitaires et E2E. Signale toute hypothèse prise.  
