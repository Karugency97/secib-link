# Sidebar — étapes parapheur SECIB à l'enregistrement d'un mail

**Date** : 2026-04-19
**Branche** : `claude/interesting-shtern-f0877f`
**Statut** : spec en revue

## Problème

Aujourd'hui, quand un collaborateur reçoit un mail et l'enregistre dans SECIB via l'extension SECIB-Link, le document .eml arrive dans le répertoire choisi du dossier, sans aucune indication de suite à donner. Pour demander à un associé (ou à un autre collaborateur) de traiter ce mail, il faut sortir de Thunderbird, ouvrir SECIB Neo, retrouver le document, et lui affecter manuellement une étape du parapheur. Cette friction fait que la délégation par parapheur n'est presque jamais utilisée depuis Thunderbird, alors que SECIB Neo expose déjà les étapes de parapheur configurées par le cabinet.

L'objectif est de **permettre d'associer le mail à une étape parapheur au moment où on l'enregistre**, sans quitter Thunderbird.

## Scope

**Dans le scope**
- Ajout d'un sélecteur « Étape parapheur » (optionnel) dans la modale « Enregistrer dans… » de la sidebar.
- L'étape s'applique **uniquement** au `.eml` principal. En mode avancé pièces jointes, les PJ routées individuellement ne reçoivent pas d'étape.
- Tous les appels liés à cette feature (lecture des étapes + save du document) passent par la **Gateway NPL-SECIB**. La Gateway devient **obligatoire** pour le chemin d'enregistrement de la sidebar (pas seulement pour la feature parapheur).
- Nouvel endpoint Gateway `POST /api/v1/documents/save-or-update` en passe-plat vers `/Document/SaveOrUpdateDocument` côté SECIB, acceptant un champ optionnel `EtapeParapheurId`.

**Hors scope**
- Panneau compose (envoi de mail) — pourra être ajouté dans un second temps avec la même plomberie.
- Onglet « Mes documents en parapheur » dans la sidebar.
- Assignation nominative à un utilisateur précis : SECIB Neo gère l'assignation par **état**, pas par utilisateur. L'assignation au collaborateur cible passe implicitement par le choix de l'étape (ex. étape « À valider par associé »).
- Migration des autres appels sidebar (recherche personne, recherche dossiers, liste répertoires) vers la Gateway — ces appels continuent à frapper SECIB Neo en direct via HTTPS public.
- Automatisation suite au save (mail interne, notification) — non prévu.

## Architecture

```
┌─────────────────────────────┐       ┌────────────────────────┐       ┌───────────┐
│ Thunderbird sidebar         │       │ Gateway NPL-SECIB      │       │ SECIB Neo │
│                             │       │                        │       │           │
│ modale Enregistrer          │ GET   │ /referentiel/          │       │ /Document/│
│  ├─ select Répertoire       │──────▶│    etapes-parapheur    │──────▶│ ListeEtape│
│  ├─ select Étape parapheur  │◀──────│   (cache 24h)          │◀──────│ Parapheur │
│  └─ input Nom               │       │                        │       │           │
│                             │       │                        │       │ /Document/│
│ bouton Enregistrer          │ POST  │ /documents/            │       │ SaveOr    │
│                             │──────▶│    save-or-update      │──────▶│ Update    │
│                             │◀──────│   (pass-through)       │◀──────│ Document  │
└─────────────────────────────┘       └────────────────────────┘       └───────────┘
```

La Gateway est **obligatoire** côté sidebar pour cette feature : si l'URL Gateway ou la clé API ne sont pas configurées dans les paramètres de l'extension, la modale d'enregistrement désactive le bouton « Enregistrer » et affiche un bandeau explicite « Configurez la Gateway dans les paramètres ». Ce choix architectural part du constat que l'extension est déployée sur plusieurs postes sans API locale — la Gateway est le point d'accès unique.

### Point technique validé en Phase 0

L'hypothèse retenue est que `/Document/SaveOrUpdateDocument` accepte un champ `EtapeParapheurId` dans le body. Un test manuel doit être effectué avant d'écrire le code front (voir section Phase 0). Si l'hypothèse tombe, le design nécessitera une révision (appel séparé post-save).

## UX de la modale

Emplacement du nouveau champ : entre « Répertoire » et « Nom du fichier ».

```
┌──────────────────────────────────────────┐
│ Enregistrer dans                     ✕   │
├──────────────────────────────────────────┤
│ Répertoire                               │
│ [ Racine du dossier          ▾ ]         │
│                                          │
│ Étape parapheur (optionnel)              │
│ [ Aucune                     ▾ ]         │
│                                          │
│ Nom du fichier                           │
│ [ Mail.eml                    ]          │
│                                          │
│ ☐ Mode avancé : gérer les PJ séparément  │
│                                          │
│ [Annuler]                  [Enregistrer] │
└──────────────────────────────────────────┘
```

Règles :

| Situation | Comportement |
|---|---|
| Gateway non configurée | Bandeau rouge « Configurez la Gateway dans les paramètres » en haut de la modale, bouton Enregistrer désactivé. Pas de dropdown étape parapheur affiché. |
| Gateway configurée, cabinet sans étapes parapheur | Form-group étape parapheur caché. Dropdown non affiché (pas d'option « Aucune » toute seule). Save fonctionne normalement. |
| Gateway configurée, étapes disponibles | Dropdown visible avec `Aucune` (valeur vide, défaut) + une option par étape renvoyée par la Gateway (libellé = propriété `Libelle` de chaque étape). |
| Mode avancé PJ activé | Dropdown étape parapheur reste visible, hint ajouté sous le dropdown : *« Appliqué uniquement au mail, pas aux pièces jointes. »* |
| Ouverture de la modale | Le dropdown repart toujours sur « Aucune ». Pas de mémorisation du dernier choix — évite les erreurs d'application à un mail qui ne devrait pas avoir d'étape. |
| Lecture de la liste échoue (réseau, 5xx) | Form-group caché silencieusement. Log console. Save fonctionne normalement. |

## Flow technique

### Au clic sur un dossier

```js
Promise.allSettled([
  getRepertoires(dossierId),
  getEtapesParapheur(),       // ← nouveau, via Gateway
])
```

La liste des étapes est **mise en cache en mémoire** côté sidebar (variable module) pour la durée de vie de la fenêtre flottante. La Gateway les cache déjà 24h côté Redis (TTL configuré). Un reload de la sidebar ou un changement de config vide le cache local.

### À l'enregistrement

```js
const etapeId = selectEtape.value || null;

saveDocument({
  fileName,
  dossierId,
  repertoireId,
  contentBase64,
  isAnnexe: false,
  etapeParapheurId: etapeId,  // omis si null
});
// → POST /api/v1/documents/save-or-update via Gateway
// → passe-plat /Document/SaveOrUpdateDocument côté SECIB
```

En mode avancé, chaque pièce jointe routée séparément appelle `saveDocument()` **sans** `etapeParapheurId` — seul le `.eml` principal reçoit l'étape.

L'ancien appel direct `POST /Document/SaveOrUpdateDocument` (via `apiCall` SECIB direct) dans `sidebar/secib-api.js` est **supprimé**. Toute la logique save sidebar bascule sur la Gateway.

### Gestion des erreurs

| Cas | Comportement |
|---|---|
| `getEtapesParapheur` échoue (réseau / 5xx) | Log console + form-group caché. Save continue normalement. |
| Save Gateway 5xx | Message d'erreur standard dans le bandeau de la modale, bouton Enregistrer réactivé pour retry. |
| Save Gateway 4xx avec code `invalid_etape_parapheur` (étape supprimée côté SECIB entre chargement et save) | Bandeau rouge « Étape parapheur invalide ». Mail **non enregistré**. L'utilisateur peut ré-ouvrir la liste et choisir une autre étape, ou « Aucune ». |
| Token SECIB expiré pendant save Gateway | Géré par la Gateway (la Gateway gère son propre OAuth2 vers SECIB). Transparent pour l'extension. |
| Gateway non joignable (réseau, DNS, 502) | Bandeau d'erreur « Gateway injoignable », bouton Enregistrer réactivé. |

Le tag `Enregistré SECIB` sur le mail est posé comme aujourd'hui, indépendamment de l'étape choisie.

## Contrat Gateway — nouveau endpoint

**Endpoint** : `POST /api/v1/documents/save-or-update`

**Auth** : `X-API-Key` (standard Gateway)

**Request body** :
```json
{
  "FileName": "Mail de X du 2026-04-19.eml",
  "DossierId": 1234,
  "RepertoireId": 56,
  "Content": "<base64>",
  "IsAnnexe": false,
  "EtapeParapheurId": 7
}
```

Tous les champs sauf `RepertoireId` et `EtapeParapheurId` sont obligatoires. `EtapeParapheurId` est omis si l'utilisateur n'a pas choisi d'étape.

**Response 2xx** : pass-through du body SECIB `/Document/SaveOrUpdateDocument` (généralement `{ DocumentId, ... }`).

**Response 4xx** :
- `400 invalid_json` — body JSON invalide.
- `400 missing_required_field` — champ obligatoire manquant.
- `422 invalid_etape_parapheur` — `EtapeParapheurId` ne correspond à aucune étape du cabinet (remontée de l'erreur SECIB).

**Response 5xx** : standard Gateway (passe-plat SECIB échec).

**Pas de cache** (opération d'écriture).

## Impact code

| Fichier | Changement |
|---|---|
| [sidebar/sidebar.html](sidebar/sidebar.html) | +1 `<div class="form-group">` avec `<select id="select-etape-parapheur">` et hint `<p class="field-hint">`, placé entre Répertoire et Nom de fichier. +1 `<div id="gateway-required-banner" class="error-banner hidden">` en haut de la modale. |
| [sidebar/sidebar.css](sidebar/sidebar.css) | Réutilise `.form-group`. +classes `.field-hint` et `.error-banner` si non existantes. |
| [sidebar/secib-api.js](sidebar/secib-api.js) | +`getEtapesParapheur()` via Gateway (GET `/referentiel/etapes-parapheur`). `saveDocument()` bascule vers Gateway (POST `/documents/save-or-update`), supprime l'ancien appel direct `SaveOrUpdateDocument`. Propage `etapeParapheurId` si fourni. |
| [sidebar/sidebar.js](sidebar/sidebar.js) | Cache mémoire étapes, appel en parallèle de `getRepertoires`, show/hide form-group selon liste, gestion bandeau Gateway-non-configurée, lecture select au save, reset à Aucune à chaque ouverture. |
| Gateway `src/routes/documents.ts` | +route `POST /save-or-update` → passe-plat `/Document/SaveOrUpdateDocument`, propage `EtapeParapheurId` si présent. Gestion erreurs 422 `invalid_etape_parapheur` à partir du code SECIB. |
| Gateway `docs/INTEGRATION_GUIDE.md` | +section documentant `POST /documents/save-or-update` (body, réponses, erreurs). |
| [README.md](README.md) | Maj section « Fonctionnalités » (étape parapheur à l'enregistrement) et « API SECIB utilisées » (ajouter `ListeEtapeParapheur` + étape via Gateway). |

**Non touché** : `background.js`, `manifest.json`, tout le dossier `compose/`.

## Phase 0 — pré-requis à valider avant d'écrire le code

1. **Lecture étapes OK via Gateway**
   ```bash
   curl -H "X-API-Key: $GW_KEY" "$GW_URL/api/v1/referentiel/etapes-parapheur"
   # attendu : 200 { "data": [{ Id, Libelle, ... }, ...] }
   ```

2. **Test hypothèse A — `SaveOrUpdateDocument` accepte `EtapeParapheurId`**

   Test manuel à effectuer côté Gateway (en `curl` ou via MCP SECIB local) :
   - Créer un document .eml de test avec `EtapeParapheurId` valide dans le body.
   - Vérifier dans SECIB Neo que le document apparaît bien à l'étape choisie du parapheur.

   Si le test échoue → basculer sur hypothèse B (appel `/Document/UpdateEtape…` séparé post-save) et reprendre le design (impact : 2 appels Gateway ou endpoint Gateway différent).

## Tests

Pas de suite de tests automatisée JS actuellement sur SECIB-Link. Tests manuels requis après implémentation :

- Enregistrer un mail **sans étape** → comportement actuel inchangé, étape vide dans SECIB Neo.
- Enregistrer un mail **avec étape** → document visible dans le parapheur SECIB Neo à l'étape choisie.
- Gateway **non configurée** → bandeau rouge, bouton Enregistrer désactivé.
- Cabinet **sans étapes** configurées → dropdown caché, save standard fonctionne.
- Mode avancé PJ + étape choisie → `.eml` à l'étape, PJ sans étape, toutes enregistrées.
- Re-enregistrement du même mail → tag déjà posé, bandeau « déjà enregistré » comme aujourd'hui.
- Étape supprimée côté SECIB entre chargement modale et clic Enregistrer → bandeau rouge, mail non enregistré.

Côté Gateway, tests unitaires à ajouter dans `tests/unit/routes/documents.test.ts` :
- `POST /documents/save-or-update` — happy path avec et sans `EtapeParapheurId`.
- Erreur 400 body invalide, 400 champ manquant, 422 étape invalide.

## Versioning

- **Extension SECIB-Link** : bump `1.2.0 → 1.3.0` — la migration du save vers Gateway est semi-breaking (nouvelle dépendance obligatoire sur la Gateway pour le flux d'enregistrement).
- **Gateway NPL-SECIB** : bump patch (feature additive, pas de changement de contrat existant).

## Annexe — décisions clés du brainstorming

| Décision | Raison |
|---|---|
| Scope minimal sidebar uniquement (pas compose) | Déployable rapidement, couvre le besoin principal (traiter un mail reçu). Compose viendra avec la même plomberie dans un second temps. |
| Étape parapheur SECIB (pas agenda, pas custom) | Mécanisme natif SECIB Neo, visible directement dans l'UI parapheur des collaborateurs. Pas de données dupliquées. |
| Étape appliquée uniquement au `.eml` (pas aux PJ en mode avancé) | Le parapheur concerne le « traitement du mail », les PJ sont de la data support. Simplifie l'UI (pas de grille multi-sélection). |
| Gateway obligatoire pour save sidebar | Déploiement multi-postes sans API SECIB locale → Gateway = point d'accès unique. Évite un code à deux chemins. |
| Pas de mémorisation du dernier choix d'étape | Évite qu'un utilisateur applique par inadvertance une étape à un mail qui n'en a pas besoin. |
