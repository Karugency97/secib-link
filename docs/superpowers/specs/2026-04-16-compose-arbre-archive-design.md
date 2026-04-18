# SECIB Link — Refonte panneau composition : arbre global + archivage mail

**Date :** 2026-04-16
**Auteur :** Cabinet NPL
**Statut :** Design validé, prêt pour planification
**Cible :** version `1.2.0` de l'extension `SECIB Link`

---

## 1. Contexte et problème

Le panneau de composition (`compose/panel.js`) actuel expose deux sections figées pour un dossier SECIB unique :

- **Parties du dossier** (cochables en To/Cc/Cci)
- **Documents du dossier** (cochables pour joindre au mail)

Trois limites bloquent l'adoption par les utilisateurs :

1. L'appel `GET /Document/GetListRepertoireDossier` renvoie `400 — "Le filtre de recherche n'est pas renseigné"`. Les répertoires ne s'affichent donc pas dans la sidebar principale, et toute nouvelle UX basée sur les répertoires est inopérante.
2. Le panneau ne permet pas de parcourir les dossiers d'un client depuis une vue unifiée : il faut taper un code ou un nom de dossier exact.
3. Le mail rédigé et envoyé depuis Thunderbird n'est pas archivé dans SECIB. L'utilisateur doit enregistrer le mail manuellement après envoi, ce qui casse le flux.

## 2. Objectifs

- **Corriger** le bug 400 sur `GetListRepertoireDossier` — prérequis pour tout le reste.
- **Remplacer** les sections "Parties" + "Documents" par une vue arbre unifiée `Client → Dossier → [Parties, Répertoires → Documents]`, pilotée par une recherche client OU dossier.
- **Archiver automatiquement** le mail envoyé dans le dossier SECIB sélectionné, dans le répertoire "Email" par défaut (créé si absent) ou dans un répertoire override.

## 3. Non-objectifs

- Refonte de la sidebar principale (contexte mail reçu).
- Support de l'édition de parties/dossiers depuis le panneau.
- UI de retry des archivages échoués (loggué + notifié uniquement pour ce MVP).
- Framework réactif (Preact, Vue, etc.) — vanilla JS suffit pour ce scope.

## 4. Architecture

### 4.1 Fichiers touchés

**Modifiés :**

- `sidebar/secib-api.js` — fix `getRepertoiresDossier`, ajout `creerRepertoire()`, ajout `saveEmailMessage()`, exposition `rechercherPersonne()`.
- `compose/panel.html` — remplace sections `parties-section` + `documents-section` par `<div id="tree-root">` + bloc "Destination enregistrement mail".
- `compose/panel.css` — styles pour l'arbre (indentation, toggles, badges, radio override répertoire).
- `compose/panel.js` — devient un orchestrateur léger (état sélection, actions Apply, écriture `storage.session`).
- `background.js` — écoute `browser.compose.onAfterSend` et déclenche le pipeline d'archivage.
- `manifest.json` — bump version `1.1.1` → `1.2.0`, pas de nouvelle permission (`messagesRead` déjà présent couvre `getRaw`).

**Nouveaux :**

- `compose/tree.js` — module `TreeView` : rendu, lazy-load, recherche, sélection. Exporte une API `createTree({ container, onDossierSelect, onRepertoireOverride, onPartyToggle, onDocumentToggle })`.

### 4.2 Persistance d'état compose ↔ background

Clé `storage.session` si disponible sur la version Thunderbird cible (API MV2 récente), sinon fallback `storage.local` avec clé préfixée et nettoyage actif à `tabs.onRemoved` + `compose.onAfterSend`. À confirmer au début de l'implémentation : `typeof browser.storage.session !== "undefined"`. Clé : `compose:{composeTabId}` avec schéma :

```json
{
  "dossierId": 456,
  "dossierCode": "2024-123",
  "dossierNom": "Martin c/ Dupont",
  "repertoireIdDefault": 789,
  "repertoireIdOverride": null,
  "repertoireLabelDefault": "Email",
  "createdAutoEmail": true
}
```

Nettoyage :

- `compose.onAfterSend` → après archivage (succès ou échec, on retire la clé pour ne pas réessayer).
- `tabs.onRemoved` → si la fenêtre compose est fermée avant envoi.

En cas d'échec d'archivage, copie de l'état vers `storage.local` sous clé `pending_archive:{messageId}` pour diagnostic ultérieur (pas d'UI retry dans ce MVP).

### 4.3 Dépendances / librairies externes

Aucune. Vanilla JS, même convention que le code existant.

## 5. Module `SecibAPI` — ajouts et fixes

### 5.1 Fix `getRepertoiresDossier`

Même stratégie que `getDocumentsDossier` (cascade de variantes), **mais** : avant implémentation, tester via le MCP `mcp__secib__secib_document_repertoires` la signature qui fonctionne sur le tenant cible. La cascade n'est qu'un filet de sécurité pour la portabilité entre versions d'API.

Ordre d'essai :

1. `v2 POST /Document/GetListRepertoireDossier` body `{ DossierId: N }`
2. `v2 POST` body `{ dossierId: N }`
3. `v1 POST` body `{ DossierId: N }`
4. `v1 POST` body `{ dossierId: N }`
5. `v1 GET ?filtreRepertoire.dossierId=N`
6. `v1 GET ?dossierId=N` (fallback historique)

Le premier succès court-circuite les suivants.

### 5.2 Nouvelle fonction `creerRepertoire(dossierId, libelle)`

Wrapper sur l'endpoint de création de répertoire. Signature exacte à confirmer via MCP SECIB (`mcp__secib__secib_document_repertoires` en écriture si dispo, sinon reverse depuis la doc Swagger). Candidats probables :

- `POST /Document/SaveRepertoire` body `{ DossierId, Libelle }`
- `POST /Dossier/AddRepertoire` body `{ DossierId, Libelle }`

Retourne `{ RepertoireId, Libelle }`. En cas d'échec, lève `CREATE_REPERTOIRE_FAILED` (traité par l'appelant comme fallback racine).

### 5.3 Nouvelle fonction `saveEmailMessage({ dossierId, repertoireId, emlBase64, fileName })`

Thin wrapper sur `saveDocument` existant :

```js
async function saveEmailMessage({ dossierId, repertoireId, emlBase64, fileName }) {
  return saveDocument({
    fileName,
    dossierId,
    repertoireId,
    contentBase64: emlBase64,
    isAnnexe: false
  });
}
```

La valeur ajoutée est sémantique (expose clairement l'intention dans le code appelant).

### 5.4 Exposition `rechercherPersonne`

La fonction existe déjà (privée dans le module). On la rend publique dans l'export. Paramètres utilisés par le tree : `{ denomination: q }` avec `limit: 10`. Pas de filtre type (on veut clients, personnes physiques et morales, tous).

## 6. Module `TreeView` (`compose/tree.js`)

### 6.1 Modèle de nœud

```js
TreeNode {
  id: string,              // "client:123" | "dossier:456" | "repertoire:789" | "document:999" | "parties:456"
  type: "client" | "dossier" | "repertoire" | "document" | "parties-group" | "partie",
  label: string,
  sublabel?: string,
  children: TreeNode[] | null,  // null = pas encore chargé (lazy)
  loading: boolean,
  expanded: boolean,
  data: object             // DTO brut SECIB
}
```

Pour un dossier déplié, `children` contient deux pseudo-nœuds :

- `parties-group` → enfants = liste de `partie` (chaque `partie` affiche nom + email + radios To/Cc/Cci + checkbox)
- `repertoire` nœuds → enfants = `document` (cochables pour PJ) + radio override "Archiver ici"

### 6.2 Flux de recherche

1. Debounce 300 ms sur `input`.
2. Si `q.length < 2` → reset tree root.
3. Appels parallèles :
   - `SecibAPI.rechercherDossiers(q, 15)` → nœuds `dossier` (niveau 1)
   - `SecibAPI.rechercherPersonne({ denomination: q }, 10)` → nœuds `client` (niveau 1, `children: null`)
4. Déduplication et rendu.
5. Expansion d'un nœud `client` → `getDossiersPersonne(personneId)` + rendu enfants.
6. Expansion d'un nœud `dossier` → `Promise.all([getPartiesDossier, getRepertoiresDossier, getDocumentsDossier])` + rendu enfants (un nœud "parties-group" et N nœuds "repertoire"). Les documents sont pré-chargés et répartis sous les répertoires via `RepertoireId`.

### 6.3 Sélection du dossier cible

Clic sur le label d'un nœud `dossier` (hors toggle ▶) → `onDossierSelect(dossier)`. Le panel réagit :

- Stocke `dossierId + code + nom` dans `storage.session`.
- Affiche la carte "Dossier sélectionné" en haut (avec bouton "Changer").
- Déplie automatiquement le dossier sélectionné dans l'arbre.
- Recherche ou crée le répertoire "Email" (cf. §7.1) et initialise `repertoireIdDefault`.

### 6.4 Override répertoire

Chaque nœud `repertoire` affiche un bouton radio à droite "Archiver ici". Sélection → `onRepertoireOverride(repertoireId)` → stockage dans `storage.session`. Valeur initiale cochée : le répertoire "Email" (default).

### 6.5 Coût API au chargement initial

Recherche avec 1 mot : 2 appels API max.
Expansion d'un dossier : 3 appels en parallèle (parties + répertoires + documents).
Expansion d'un client : 1 appel.

Acceptable pour une extension Thunderbird avec cache token OAuth.

## 7. Pipeline d'archivage à l'envoi

### 7.1 Sélection du dossier et préparation du répertoire "Email"

Dès que l'utilisateur sélectionne un dossier :

```
1. repertoires = await getRepertoiresDossier(dossierId)
2. email = repertoires.find(r => r.Libelle.toLowerCase() === "email")
3. if (email) → repertoireIdDefault = email.RepertoireId, createdAutoEmail = false
4. else →
     try {
       const created = await creerRepertoire(dossierId, "Email")
       repertoireIdDefault = created.RepertoireId
       createdAutoEmail = true
       // Injecter le nouveau répertoire dans l'arbre
     } catch {
       repertoireIdDefault = null  // fallback racine, badge "Racine" dans l'UI
       createdAutoEmail = false
     }
5. Écrire tout dans storage.session "compose:{tabId}"
```

### 7.2 Listener `onAfterSend` (dans `background.js`)

```
browser.compose.onAfterSend.addListener(async ({ tab, messageId, mode }) => {
  if (mode !== "sendNow") return
  const state = await browser.storage.session.get(`compose:${tab.id}`)
  const ctx = state[`compose:${tab.id}`]
  if (!ctx || !ctx.dossierId) return  // user n'a pas sélectionné

  try {
    const raw = await browser.messages.getRaw(messageId)       // Blob RFC822
    const emlBase64 = await blobToBase64(raw)
    const msg = await browser.messages.get(messageId)
    const subject = msg.subject || "(sans sujet)"
    const fileName = `${formatDateIso(new Date())}_${sanitize(subject)}.eml`
    const repertoireId = ctx.repertoireIdOverride || ctx.repertoireIdDefault

    await SecibAPI.saveEmailMessage({
      dossierId: ctx.dossierId,
      repertoireId,
      emlBase64,
      fileName
    })

    notify("success", `Mail archivé dans ${ctx.dossierCode}`)
  } catch (err) {
    console.error("[SECIB Link] Archivage échoué", err)
    notify("error", `Archivage SECIB échoué : ${err.message}`)
    await browser.storage.local.set({
      [`pending_archive:${messageId}`]: { ...ctx, error: err.message, at: Date.now() }
    })
  } finally {
    await browser.storage.session.remove(`compose:${tab.id}`)
  }
})
```

### 7.3 Helpers

- `blobToBase64(blob)` via `FileReader.readAsDataURL` puis split sur `","`.
- `formatDateIso(d)` → `YYYY-MM-DD`.
- `sanitize(s)` → remplace `/ \ : * ? " < > |` par `_`, normalize whitespace, tronque à 100 caractères.
- `notify(kind, message)` via `browser.notifications.create` + post message au panneau s'il est encore ouvert.

## 8. Gestion d'erreurs

| Point | Erreur | Comportement |
|---|---|---|
| Recherche arbre | API down / 401 | Message inline sous la barre, bouton retry |
| Expansion nœud | 400/500 | Nœud icône ⚠, autres nœuds fonctionnent |
| Création "Email" auto | Échec | Silencieux, fallback racine + badge "Racine" |
| `onAfterSend` storage vide | User n'a pas sélectionné | Stop silencieux |
| `messages.getRaw` échoue | Rare | Notification + log, state en `pending_archive` |
| Upload .eml échoue | Réseau / 4xx / 5xx | Notification persistante "Mail envoyé mais archivage échoué", state en `pending_archive` |
| Conflit nom fichier | `SaveOrUpdateDocument` gère | OK ; si vraie collision → suffixe `_2`, `_3` |
| Fenêtre compose fermée avant envoi | State en storage | Pas d'impact, `onAfterSend` lit indépendamment |
| Token OAuth expiré pendant upload | | Déjà géré par `apiCall` (refresh auto) |

**Principe directeur :** un échec d'archivage ne bloque jamais l'envoi du mail.

## 9. Sécurité et vie privée

- Le .eml contient des données confidentielles (contenu mail + PJ). Flux : Thunderbird → memory → HTTPS `secibneo.secib.fr` (déjà whitelisté dans `manifest.json`). Pas de passage par un tiers.
- Pas de logs de contenu mail (headers et body). Les logs existants ne tracent que URL + status + premiers caractères de la réponse d'erreur.
- Token OAuth en mémoire (`_token` dans le closure de `SecibAPI`), pas en `storage`.
- `storage.session` est scopée à la session Thunderbird (volatile), `storage.local` ne contient que les "pending_archive" (métadonnées, pas de .eml).

## 10. Tests — checklist manuelle

### A. Fix API répertoires
- [ ] Sélectionner un dossier SECIB → les répertoires s'affichent (plus de 400).
- [ ] Logs console : variante API utilisée loguée clairement.

### B. Arbre et recherche
- [ ] Taper un code dossier → dossier match seul.
- [ ] Taper un nom de client → clients matchants affichés, expansion lazy OK.
- [ ] Taper un mot commun (≥3 matches) → fusion propre, pas de doublon.
- [ ] Expansion dossier → parties + répertoires + documents chargés.
- [ ] Expansion répertoire → documents du répertoire affichés.

### C. Sélection et apply
- [ ] Cocher parties (To/Cc/Cci) + docs → "Appliquer au mail" injecte correctement.
- [ ] Rouvrir le panneau après fermeture → dossier sélectionné restauré.
- [ ] Ouvrir une 2ᵉ fenêtre compose → état cloisonné par `composeTabId`.

### D. Répertoire "Email" auto
- [ ] Dossier sans répertoire "Email" → création auto, badge "auto-créé".
- [ ] Création "Email" échoue (simuler 403) → fallback racine + badge "Racine".
- [ ] Override : cocher autre répertoire → c'est celui-là qui est utilisé à l'envoi.

### E. Enregistrement à l'envoi
- [ ] Envoyer un mail avec dossier sélectionné → `.eml` uploadé, nom `YYYY-MM-DD_sujet.eml`, contenu complet.
- [ ] Envoyer un mail **sans** dossier sélectionné → aucun upload, pas d'erreur.
- [ ] Envoi avec override répertoire → mail dans le bon répertoire.
- [ ] Notification succès affichée.
- [ ] Sujet avec caractères spéciaux (`/`, `:`, accents) → sanitize OK.
- [ ] Enregistrement "Brouillon" (mode `draft`) → ignoré.
- [ ] Simuler échec réseau pendant upload → notification erreur, mail quand même envoyé, state en `pending_archive:*`.

### F. Régressions
- [ ] Sidebar principale (contexte mail reçu) continue de fonctionner.
- [ ] `compose_action` toujours disponible dans barre compose.
- [ ] Token OAuth expiré pendant session → refresh automatique OK.

## 11. Livrables

- Branche `feat/compose-arbre-archive`.
- Commits atomiques par section (fix API, module tree, refonte panel, pipeline archivage).
- Spec committé avec le code (`docs/superpowers/specs/2026-04-16-compose-arbre-archive-design.md`).
- Bump `manifest.json` 1.1.1 → 1.2.0.
- Tag `v1.2.0` → CI GitHub Actions produit le `.xpi` (workflow existant).

## 12. Points ouverts à résoudre pendant l'implémentation

Ces points ne bloquent pas la validation du design, mais seront résolus tôt dans le plan :

1. **Signature exacte de `GetListRepertoireDossier`** — à tester via MCP SECIB avant d'implémenter la cascade.
2. **Endpoint de création de répertoire** — identifier précisément l'API (Swagger ou MCP). Si inexistant côté API, replanifier la fonctionnalité "création auto" en fallback manuel (dropdown "Choisir un répertoire" en UI).
3. **Comportement `browser.compose.onAfterSend` vs `onBeforeSend`** — confirmer sur Thunderbird 115+ que `onAfterSend` reçoit bien `messageId` et qu'il est lisible via `messages.getRaw` au moment du déclenchement (timing race possible).
4. **Disponibilité de `browser.storage.session`** — à tester au bootstrap de l'extension, fallback `storage.local` préfixé si absent.
