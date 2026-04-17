# Compose — rubriques Contacts & Pièces jointes simplifiées

**Date** : 2026-04-17
**Branche** : `feat/compose-arbre-archive`
**Remplace** : l'arbre unifié « Client → Dossier → Parties + Répertoires + Documents » introduit par `5c6162c`

## Problème

Dans l'état actuel, une fois un dossier sélectionné, l'utilisateur voit un arbre unique qui mélange :
- les parties du dossier (avec checkbox + 3 radios À/Cc/Cci par ligne),
- les répertoires,
- les documents (avec checkbox),
- un radio « archiver le mail ici » accroché à chaque répertoire.

Quatre rôles cohabitent sur les mêmes lignes. En plus :
- un bug de mapping (`tree.js:248`) fait apparaître `dossierId=NaN` dès qu'on sélectionne un dossier depuis l'expansion d'un client,
- deux endpoints SECIB restent inaccessibles depuis le navigateur (body-on-GET : `Partie/Get`, `Document/GetListRepertoireDossier`), d'où les 404/500 en cascade visibles en console.

Objectif : **rendre le flux contacts + pièces jointes lisible et fonctionnel**.

## Scope

Dans le scope :
- Refonte du layout de `compose/panel.html` en sections distinctes.
- Refonte de `compose/tree.js` : on conserve le composant arbre pour la recherche (clients + dossiers) et pour les pièces jointes ; on retire les parties et le radio archivage de l'arbre.
- Nouveau composant « liste de contacts » (parties du dossier) avec sélecteur À/Cc/Cci mutuellement exclusif.
- Nouvelle checkbox « Archiver le mail dans Email ».
- Correction du bug `DossierId` côté mapping client → dossiers.
- Ajout de 2 endpoints gateway NPL-SECIB (`/parties`, `/repertoires`) et bascule de `secib-api.js`.

Hors scope :
- OAuth / renouvellement de token.
- `saveDocument` / `saveEmailMessage` (fonctions API, réutilisées telles quelles).
- Sidebar (archivage manuel d'un mail reçu).
- Recherche de contacts **hors parties** du dossier (option B/C du brainstorming, explicitement écartée).

En scope mais nouveau :
- Listener `compose.onAfterSend` dans `background.js` (le spec initial supposait son existence — vérifié absent).

## Layout cible (`panel.html`)

```
┌─────────────────────────────────────────┐
│ En-tête : sujet du mail                 │
├─────────────────────────────────────────┤
│ § 1. Recherche                           │
│   [ input : client ou dossier…      ]   │
│   Arbre résultats (clients + dossiers,   │
│   lazy-load : un client se déplie en     │
│   ses dossiers)                          │
├─────────────────────────────────────────┤
│ § 2. Dossier sélectionné                 │
│   CODE123 — Nom du dossier   [Changer]   │
├─────────────────────────────────────────┤
│ § 3. Contacts                            │
│   [À][Cc][Cci] Dupont <a@b.fr>           │
│   [À][Cc][Cci] Martin <c@d.fr>           │
│   (pas d'email)  Durand — grisé          │
├─────────────────────────────────────────┤
│ § 4. Pièces jointes                      │
│   ▸ Email (3)                            │
│   ▾ Correspondance (2)                   │
│       ☐ lettre.pdf     12/03             │
│       ☐ relance.docx   20/03             │
│   ▸ (Racine)                             │
├─────────────────────────────────────────┤
│ § 5. Archivage                           │
│   ☑ Archiver le mail dans « Email »      │
├─────────────────────────────────────────┤
│ [Fermer]              [Appliquer au mail]│
└─────────────────────────────────────────┘
```

Sections 2 à 5 cachées tant qu'aucun dossier n'est sélectionné. Dès qu'un dossier est choisi, les trois appels (`parties`, `repertoires`, `documents`) sont déclenchés en parallèle et les sections apparaissent au fur et à mesure des réponses.

## Section Contacts (§3)

### Données
- Source unique : `SecibAPI.getPartiesDossier(dossierId)` via la gateway.
- Chaque `PartieApiDto` porte `.Personne` avec `Nom`, `NomComplet`, `Email`.

### Rendu
- Liste plate dans un conteneur `.contacts-list`.
- Une ligne par partie, ordre de retour de l'API (pas de tri imposé).
- Structure d'une ligne :
  ```
  [À] [Cc] [Cci]   Nom complet    <email>
  ```
- Les 3 cases sont `input type="checkbox"` mais se comportent comme des radios : cocher l'une décoche les deux autres. Décocher celle qui est cochée retire le contact de la sélection.
- Si `Email` est vide, les 3 cases sont `disabled`, la ligne a la classe `.no-email` (opacité réduite), et un hint `« pas d'email »` remplace la zone email.

### État
- Remplace `partiesSelected: Map<emailLower, { nom, email, type }>` actuel.
- Même structure, mais peuplée depuis la section Contacts au lieu de l'arbre.

## Section Pièces jointes (§4)

### Données
- `SecibAPI.getRepertoiresDossier(dossierId)` (via gateway) + `SecibAPI.getDocumentsDossier(dossierId)` (via gateway, déjà en place).
- Documents groupés par `RepertoireId` ; documents sans `RepertoireId` regroupés sous un pseudo-répertoire « (Racine) » en tête.

### Rendu
- Arbre à 2 niveaux réutilisant `TreeView`.
- Un nœud répertoire affiche son libellé + compteur de documents.
- Un nœud document affiche `FileName || Libelle` + date courte.
- Checkbox sur chaque document. **Pas** de radio archivage, **pas** d'action au clic sur un répertoire (uniquement déplier/replier).

### État
- `documentsSelected: Map<DocumentId, DocumentCompactApiDto>` (inchangé).

## Section Archivage (§5)

### Rendu
- Un unique `input type="checkbox" id="archive-enabled" checked`.
- Label : `Archiver le mail dans « Email »`.

### Logique
- Quand un dossier est sélectionné : appel à `getRepertoiresDossier`, on cherche un répertoire dont le libellé insensible à la casse vaut `Email`.
  - Trouvé → on mémorise son `RepertoireId` en tant que `archiveRepertoireId`.
  - Absent → on tente `creerRepertoire(dossierId, "Email")`, on mémorise le `RepertoireId` retourné.
  - Échec création → la case est `disabled`, décochée, avec un tooltip « Impossible d'accéder au répertoire Email du dossier ».
- La checkbox est persistée dans `ComposeState` (clé `archiveEnabled`, défaut `true`).

### Déclenchement de l'archivage
L'écoute `compose.onAfterSend` n'existe pas encore dans `background.js` (vérifié : 134 lignes, aucune mention de `archive` / `repertoireId` / `ComposeState`). Il faut l'ajouter dans le cadre de ce spec :
- Listener `browser.compose.onAfterSend` dans `background.js`.
- Récupère `ComposeState.get(tabId)` juste après envoi.
- Si `archiveEnabled && archiveRepertoireId && dossierId` : charge les scripts `sidebar/secib-api.js` dans un contexte background (déjà partagé via manifest), sérialise le message envoyé en .eml base64 (`browser.messages.getRaw`), appelle `SecibAPI.saveEmailMessage({ dossierId, repertoireId: archiveRepertoireId, emlBase64, fileName })`.
- Si échec : notification utilisateur via `browser.notifications.create` — l'envoi ne doit pas être bloqué par une erreur d'archivage.
- Nettoie `ComposeState.remove(tabId)` après (succès ou échec).

Les noms de clés `archiveRepertoireId` / `archiveEnabled` sont nouveaux, donc ce listener est la seule lecture — pas de rétro-compatibilité à assurer.

## Bouton « Appliquer au mail »

Inchangé dans sa logique :
- injecte les destinataires (merge avec existants, dédupe par email),
- télécharge chaque document sélectionné via `getDocumentContent` et attache le fichier au compose,
- respecte la limite 25 Mo cumulés.

## Corrections de bugs

### Bug 1 — `dossierId=NaN` au dépliage d'un client

Fichier : `compose/tree.js`, fonction `loadClientChildren`.

Actuellement (ligne ~248) :
```js
return dossiers.map((d) => ({
  id: `dossier:${d.DossierId}`,
  label: d.Code || "—",
  sublabel: d.Nom || "",
  data: d,
  // ...
}));
```

`getDossiersPersonne` appelle `/Partie/GetByPersonneId` qui retourne des `PartieApiDto[]` — le dossier est dans `.Dossier`. Correction :
```js
return dossiers
  .filter((p) => p && p.Dossier && p.Dossier.DossierId)
  .map((p) => ({
    id: `dossier:${p.Dossier.DossierId}`,
    label: p.Dossier.Code || "—",
    sublabel: p.Dossier.Nom || "",
    data: p.Dossier,
    // ...
  }));
```

### Bug 2 — garde-fou `DossierId`

Dans `panel.js#handleDossierSelect` et `panel.js#restoreState`, avant tout appel API :
```js
const did = Number(dossierDto && dossierDto.DossierId);
if (!Number.isFinite(did)) {
  showError("DossierId invalide");
  return;
}
```

## Modifications gateway NPL-SECIB

Deux endpoints à ajouter, symétriques à `/documents` (qui fonctionne déjà) :

### `GET /api/v1/parties?dossierId=N`
- Forward vers SECIB : `GET /Partie/Get` avec body JSON `{ "DossierId": N }` (body-on-GET).
- Réponse : `{ data: PartieApiDto[] }`.

### `GET /api/v1/repertoires?dossierId=N`
- Forward vers SECIB : `GET /Document/GetListRepertoireDossier` avec body JSON `{ "DossierId": N }` (body-on-GET).
- Réponse : `{ data: RepertoireApiDto[] }`.

Les deux réutilisent le même pipeline que `/documents` (auth cabinet → token → fetch `node:https` avec body-on-GET → unwrap).

### Répercussion côté `secib-api.js`

```js
// avant
async function getPartiesDossier(dossierId) {
  return apiCall("GET", "/Partie/Get", { query: { dossierId } });
}
async function getRepertoiresDossier(dossierId) {
  // 6 tentatives …
}

// après
async function getPartiesDossier(dossierId) {
  return gatewayCall("/parties", { dossierId: Number(dossierId) });
}
async function getRepertoiresDossier(dossierId) {
  return gatewayCall("/repertoires", { dossierId: Number(dossierId) });
}
```

## Persistance (`ComposeState`)

Le shape stocké par onglet compose devient :
```js
{
  dossierId: number,
  dossierCode: string,
  dossierNom: string,
  archiveRepertoireId: number | null,   // remplace repertoireIdDefault/Override
  archiveEnabled: boolean,               // nouveau (défaut true)
  createdAutoEmail: boolean              // inchangé
}
```

Les clés `repertoireIdDefault`, `repertoireIdOverride`, `repertoireLabelDefault` sont supprimées (plus de choix override).

## Tests manuels attendus

1. Ouvrir Thunderbird, composer un mail, ouvrir le panneau Compose.
2. Taper le code d'un dossier connu → sélectionner le dossier.
3. Vérifier que les sections Contacts / Pièces jointes / Archivage apparaissent avec des données.
4. Taper un nom de client, déplier le client, sélectionner un dossier → même comportement (test du bug 1).
5. Cocher À pour un contact puis Cc → À doit se décocher.
6. Cocher 2 documents, cliquer Appliquer → les destinataires apparaissent dans le mail, les PJ sont attachées.
7. Envoyer le mail → vérifier que le .eml est présent dans le répertoire Email du dossier.
8. Décocher la case d'archivage, envoyer → aucun fichier créé dans SECIB.

## Pointeurs

- Code actuel : `compose/panel.html`, `compose/panel.js`, `compose/tree.js`, `compose/state.js`, `sidebar/secib-api.js`.
- Gateway : hors-repo (projet NPL-SECIB, voir `reference_plan_gateway`).
- MCP Node local (référence body-on-GET) : voir `reference_mcp_secib`.
