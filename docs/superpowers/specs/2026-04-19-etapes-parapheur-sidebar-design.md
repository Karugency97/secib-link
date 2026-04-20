# Sidebar — étapes parapheur SECIB à l'enregistrement d'un mail

**Date** : 2026-04-19
**Branche** : `claude/interesting-shtern-f0877f`
**Statut** : spec révisée post-Phase 0 (validation API SECIB effectuée)

## Problème

Aujourd'hui, quand un collaborateur reçoit un mail et l'enregistre dans SECIB via l'extension SECIB-Link, le document .eml arrive dans le répertoire choisi du dossier, sans aucune indication de suite à donner. Pour demander à un associé (ou à un autre collaborateur) de traiter ce mail, il faut sortir de Thunderbird, ouvrir SECIB Neo, retrouver le document, et lui affecter manuellement une étape du parapheur avec un destinataire. Cette friction fait que la délégation par parapheur n'est presque jamais utilisée depuis Thunderbird, alors que SECIB Neo expose déjà les étapes de parapheur configurées par le cabinet et la liste des intervenants.

L'objectif est de **permettre d'associer le mail à une étape parapheur + un destinataire au moment où on l'enregistre**, sans quitter Thunderbird.

## Scope

**Dans le scope**
- Ajout de deux sélecteurs couplés dans la modale « Enregistrer dans… » de la sidebar :
  - **Étape parapheur** (optionnel) — liste des étapes configurées par le cabinet.
  - **Destinataire** (requis si étape choisie) — collaborateur à qui assigner le parapheur, parmi tous les intervenants du cabinet.
- Les deux champs sont **indissociables** côté SECIB (API renvoie `BusinessException_EtapeParapheurDestinataireIndisociable` si un seul est fourni). L'UI reflète cette contrainte : choisir une étape active le select destinataire, qui devient alors obligatoire.
- L'association étape+destinataire s'applique **uniquement** au `.eml` principal. En mode avancé pièces jointes, les PJ routées individuellement ne reçoivent ni étape ni destinataire.
- Tous les appels liés à cette feature (étapes, intervenants, save du document) passent par la **Gateway NPL-SECIB**. La Gateway devient **obligatoire** pour le chemin d'enregistrement de la sidebar (pas seulement pour la feature parapheur).
- Nouvel endpoint Gateway `POST /api/v1/documents/save-or-update` en passe-plat vers `/Document/SaveOrUpdateDocument` côté SECIB, acceptant les champs optionnels `EtapeParapheurId` (GUID) et `DestinataireId` (int) tous les deux ensemble ou pas du tout.

**Hors scope**
- Panneau compose (envoi de mail) — pourra être ajouté dans un second temps avec la même plomberie.
- Onglet « Mes documents en parapheur » dans la sidebar.
- Filtrage du destinataire aux seuls intervenants du dossier en cours — on liste tous les utilisateurs/intervenants du cabinet (décision explicite).
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
│  ├─ select Destinataire     │       │                        │       │           │
│  └─ input Nom               │ GET   │ /referentiel/          │       │/Utilisateur│
│                             │──────▶│    intervenants        │──────▶│  /List    │
│                             │◀──────│   (cache 24h)          │◀──────│Intervenant│
│                             │       │                        │       │           │
│ bouton Enregistrer          │ POST  │ /documents/            │       │ /Document/│
│                             │──────▶│    save-or-update      │──────▶│ SaveOr    │
│                             │◀──────│   (pass-through)       │◀──────│ Update    │
└─────────────────────────────┘       └────────────────────────┘       └───────────┘
```

La Gateway est **obligatoire** côté sidebar pour cette feature : si l'URL Gateway ou la clé API ne sont pas configurées dans les paramètres de l'extension, la modale d'enregistrement désactive le bouton « Enregistrer » et affiche un bandeau explicite « Configurez la Gateway dans les paramètres ». Ce choix architectural part du constat que l'extension est déployée sur plusieurs postes sans API locale — la Gateway est le point d'accès unique.

### Findings Phase 0 (API SECIB — 2026-04-19)

Validation effectuée contre le tenant SECIB NPL en production :

- ✅ `POST /Document/SaveOrUpdateDocument` accepte les champs `EtapeParapheurId` et `DestinataireId` directement dans le body (top-level, pas d'objet imbriqué).
- ✅ Les deux champs sont **indissociables** : fournir l'un sans l'autre → HTTP 400 `BusinessException_EtapeParapheurDestinataireIndisociable`. Si l'utilisateur ne choisit pas d'étape, les deux champs sont omis.
- ✅ `EtapeParapheurId` est un **GUID string** (ex. `8e33ad58-f662-4afe-a4cc-b37100d61a20`), pas un int.
- ✅ `DestinataireId` est un **int** correspondant à un `UtilisateurId` tel que renvoyé par `/Utilisateur/ListIntervenant`.
- ✅ Document confirmé visible dans le parapheur SECIB Neo du destinataire à l'étape choisie après un appel test.

Les endpoints Gateway pour la lecture des référentiels sont **déjà en production** :
- `GET /api/v1/referentiel/etapes-parapheur` → `/Document/ListeEtapeParapheur` (cache 24h)
- `GET /api/v1/referentiel/intervenants` → `/Utilisateur/ListIntervenant` (cache 24h)

Aucun nouvel endpoint de lecture n'est requis. Seul `POST /api/v1/documents/save-or-update` reste à créer.

## UX de la modale

Emplacement des nouveaux champs : entre « Répertoire » et « Nom du fichier ».

```
┌────────────────────────────────────────────┐
│ Enregistrer dans                     ✕     │
├────────────────────────────────────────────┤
│ Répertoire                                 │
│ [ Racine du dossier           ▾ ]          │
│                                            │
│ Étape parapheur (optionnel)                │
│ [ Aucune                      ▾ ]          │
│                                            │
│ Destinataire (requis si étape)             │
│ [ — choisir un collaborateur — ▾ ]         │
│                                            │
│ Nom du fichier                             │
│ [ Mail.eml                      ]          │
│                                            │
│ ☐ Mode avancé : gérer les PJ séparément    │
│                                            │
│ [Annuler]                    [Enregistrer] │
└────────────────────────────────────────────┘
```

Règles :

| Situation | Comportement |
|---|---|
| Gateway non configurée | Bandeau rouge « Configurez la Gateway dans les paramètres » en haut de la modale, bouton Enregistrer désactivé. Pas de dropdowns étape/destinataire affichés. |
| Gateway configurée, cabinet sans étapes parapheur | Form-groups étape ET destinataire cachés (ils vont toujours ensemble). Save fonctionne normalement sans étape. |
| Gateway configurée, étapes disponibles | Dropdown étape visible avec `Aucune` (valeur vide, défaut) + une option par étape renvoyée par la Gateway (libellé = propriété `Libelle`). Dropdown destinataire visible ET **désactivé** tant qu'aucune étape n'est choisie. |
| Étape choisie par l'utilisateur | Le dropdown destinataire **s'active** et devient **requis**. Si l'utilisateur clique Enregistrer sans avoir choisi de destinataire → bandeau rouge « Choisissez un destinataire ». |
| Étape remise à « Aucune » | Destinataire remis à vide et désactivé automatiquement. |
| Mode avancé PJ activé | Dropdowns étape/destinataire restent visibles. Hint sous le dropdown destinataire : *« Appliqué uniquement au mail, pas aux pièces jointes. »* |
| Ouverture de la modale | Dropdowns repartent toujours sur « Aucune » / vide désactivé. Pas de mémorisation du dernier choix. |
| Lecture des étapes ou intervenants échoue (réseau, 5xx) | Les deux form-groups cachés silencieusement (on traite l'échec comme un cabinet sans étapes). Log console. Save standard fonctionne. |

## Flow technique

### Au clic sur un dossier

```js
Promise.allSettled([
  getRepertoires(dossierId),
  getEtapesParapheur(),      // ← nouveau, via Gateway
  getIntervenants(),         // ← nouveau, via Gateway
])
```

Les étapes et intervenants sont **mis en cache en mémoire** côté sidebar (variables module) pour la durée de vie de la fenêtre flottante — ils changent rarement, la Gateway les cache déjà 24h côté Redis. Un reload de la sidebar ou un changement de config vide les caches locaux.

Si l'un des deux appels (étapes ou intervenants) échoue, on cache les deux form-groups — on ne veut pas afficher un seul des deux dropdowns (le couple est indissociable côté SECIB).

### À l'enregistrement

```js
const etapeId = selectEtape.value || null;
const destinataireId = selectDestinataire.value ? parseInt(selectDestinataire.value, 10) : null;

// Garde : si étape sans destinataire, erreur UI (bloque le save)
if (etapeId && !destinataireId) {
  showSaveFeedback("error", "Choisissez un destinataire pour l'étape parapheur");
  return;
}

saveDocument({
  fileName,
  dossierId,
  repertoireId,
  contentBase64,
  isAnnexe: false,
  etapeParapheurId: etapeId,      // GUID string, omis si null
  destinataireId: destinataireId, // int, omis si null
});
// → POST /api/v1/documents/save-or-update via Gateway
// → passe-plat /Document/SaveOrUpdateDocument côté SECIB
```

En mode avancé, chaque pièce jointe routée séparément appelle `saveDocument()` **sans** `etapeParapheurId` ni `destinataireId` — seul le `.eml` principal reçoit l'association parapheur+destinataire.

L'ancien appel direct `POST /Document/SaveOrUpdateDocument` (via `apiCall` SECIB direct) dans `sidebar/secib-api.js` est **supprimé**. Toute la logique save sidebar bascule sur la Gateway.

### Gestion des erreurs

| Cas | Comportement |
|---|---|
| `getEtapesParapheur` ou `getIntervenants` échoue (réseau / 5xx) | Log console + les deux form-groups cachés. Save continue normalement sans étape. |
| Save Gateway 5xx | Message d'erreur standard dans le bandeau de la modale, bouton Enregistrer réactivé pour retry. |
| Save Gateway 4xx `invalid_etape_parapheur` ou `invalid_destinataire` (valeurs rejetées par SECIB entre chargement et save) | Bandeau rouge avec le message. Mail **non enregistré**. L'utilisateur peut rejouer avec une autre sélection, ou repasser à « Aucune » pour save sans étape. |
| Save Gateway 4xx `etape_destinataire_indissociable` (sécurité client-side ratée) | Bandeau rouge « Étape et destinataire doivent être choisis ensemble ». Mail non enregistré. |
| Token SECIB expiré pendant save Gateway | Géré par la Gateway (OAuth2 interne). Transparent pour l'extension. |
| Gateway non joignable (réseau, DNS, 502) | Bandeau d'erreur « Gateway injoignable », bouton Enregistrer réactivé. |

Le tag `Enregistré SECIB` sur le mail est posé comme aujourd'hui, indépendamment de l'étape/destinataire choisis.

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
  "EtapeParapheurId": "8e33ad58-f662-4afe-a4cc-b37100d61a20",
  "DestinataireId": 3
}
```

- `FileName`, `DossierId`, `Content`, `IsAnnexe` : obligatoires.
- `RepertoireId` : optionnel.
- `EtapeParapheurId` (GUID string) et `DestinataireId` (int) : optionnels **ensemble**. La Gateway valide cette contrainte avant de transmettre à SECIB (retour 400 `etape_destinataire_indissociable` si un seul est fourni) pour surfacer une erreur claire côté client sans coût d'appel SECIB.

**Response 2xx** : pass-through du body SECIB `/Document/SaveOrUpdateDocument` (généralement `{ DocumentId, FileName, DossierId, ... }`).

**Response 4xx** :
- `400 invalid_json` — body JSON invalide.
- `400 missing_required_field` — champ obligatoire manquant.
- `400 etape_destinataire_indissociable` — un seul de `EtapeParapheurId` / `DestinataireId` fourni (validé côté Gateway avant appel SECIB).
- `422 secib_client_error` — SECIB renvoie une erreur métier (étape inconnue, destinataire inconnu, etc.). Le message SECIB est propagé dans `error.message`.

**Response 5xx** : standard Gateway (passe-plat SECIB échec).

**Pas de cache** (opération d'écriture).

## Impact code

| Fichier | Changement |
|---|---|
| [sidebar/sidebar.html](sidebar/sidebar.html) | +2 `<div class="form-group">` : `<select id="select-etape-parapheur">` et `<select id="select-destinataire">`. Un `<p class="field-hint">` sous le select destinataire. Un `<div id="gateway-required-banner" class="error-banner hidden">` en haut de la modale. |
| [sidebar/sidebar.css](sidebar/sidebar.css) | Réutilise `.form-group`. +classes `.field-hint` et `.error-banner` si non existantes. +style pour `<select>` aligné sur les `<input>`. |
| [sidebar/secib-api.js](sidebar/secib-api.js) | +`gatewayPost(path, body)` helper. +`getEtapesParapheur()` via Gateway (GET `/referentiel/etapes-parapheur`). +`getIntervenants()` via Gateway (GET `/referentiel/intervenants`). `saveDocument()` bascule vers Gateway (POST `/documents/save-or-update`), supprime l'ancien appel direct SECIB. Propage `etapeParapheurId` et `destinataireId` si fournis. |
| [sidebar/sidebar.js](sidebar/sidebar.js) | Caches mémoire étapes et intervenants, chargement en parallèle de `getRepertoires`, show/hide form-groups selon données chargées, couplage étape ⇄ destinataire (activation conditionnelle du 2ᵉ select), gestion bandeau Gateway-non-configurée, validation client-side « étape → destinataire requis », propagation au save, reset à « Aucune » à chaque ouverture. |
| Gateway `src/routes/documents.ts` | +route `POST /save-or-update` → validation both-or-neither puis passe-plat `/Document/SaveOrUpdateDocument`, propage `EtapeParapheurId` et `DestinataireId` si présents. |
| Gateway `docs/INTEGRATION_GUIDE.md` | +section documentant `POST /documents/save-or-update` (body, contraintes, réponses, erreurs). |
| [README.md](README.md) | Maj section « Fonctionnalités » (étape parapheur + destinataire à l'enregistrement) et « API SECIB utilisées » (ajouter `ListeEtapeParapheur`, `ListIntervenant`, nouveau chemin Gateway). |

**Non touché** : `background.js`, `manifest.json` (hors bump version), tout le dossier `compose/`.

## Phase 0 — validation API SECIB

**Statut** : ✅ validée 2026-04-19 (voir section « Findings Phase 0 » plus haut).

Artefacts laissés dans SECIB Neo pendant les probes (dossier TEST, DossierId 164) :
- `probe-A.txt` (et ses duplicatas `(2)`, `(3)`) — visible au parapheur de Nancy PIERRE-LOUIS à l'étape « Transmis par le client par mail ».
- `test-parapheur-phase0.txt` — créé avant découverte de la contrainte destinataire, échec attendu.

À supprimer manuellement depuis SECIB Neo après exploitation.

## Tests

### Tests unitaires Gateway (nouveaux, à créer)

Fichier : `tests/integration/documents.test.ts`, nouveau describe `POST /documents/save-or-update` :

- Happy path **sans** étape ni destinataire (mail simple) → 200, body propagé.
- Happy path **avec** étape + destinataire → 200, body propagé, champs présents dans la requête SECIB.
- 400 `invalid_json` sur body JSON invalide.
- 400 `etape_destinataire_indissociable` si `EtapeParapheurId` fourni sans `DestinataireId`.
- 400 `etape_destinataire_indissociable` si `DestinataireId` fourni sans `EtapeParapheurId`.
- 422 `secib_client_error` si SECIB renvoie 400/422 (ex. étape inconnue).

### Tests manuels extension (pas de suite automatisée JS)

- Enregistrer un mail **sans étape** → comportement actuel inchangé, ni étape ni destinataire dans SECIB Neo.
- Enregistrer un mail **avec étape + destinataire** → document visible dans le parapheur du destinataire à l'étape choisie.
- Choisir une étape **sans destinataire** puis cliquer Enregistrer → bandeau rouge client-side, aucun appel Gateway.
- Choisir étape puis repasser à « Aucune » → destinataire désactivé et remis à vide automatiquement.
- Gateway **non configurée** → bandeau rouge, bouton désactivé.
- Cabinet sans étapes configurées → deux dropdowns cachés, save standard fonctionne.
- Mode avancé PJ + étape/destinataire choisis → `.eml` à l'étape, PJ sans parapheur.
- Re-enregistrement du même mail → bandeau « déjà enregistré » inchangé.

## Versioning

- **Extension SECIB-Link** : bump `1.2.0 → 1.3.0` — la migration du save vers Gateway est semi-breaking (nouvelle dépendance obligatoire sur la Gateway pour le flux d'enregistrement).
- **Gateway NPL-SECIB** : bump patch (feature additive, pas de changement de contrat existant).

## Annexe — décisions clés du brainstorming

| Décision | Raison |
|---|---|
| Scope minimal sidebar uniquement (pas compose) | Déployable rapidement, couvre le besoin principal (traiter un mail reçu). Compose viendra avec la même plomberie dans un second temps. |
| Étape parapheur SECIB (pas agenda, pas custom) | Mécanisme natif SECIB Neo, visible directement dans l'UI parapheur des collaborateurs. Pas de données dupliquées. |
| Destinataire couplé à l'étape | **Contrainte SECIB** (validation Phase 0) : l'API rejette tout save avec l'un sans l'autre. Match exact du besoin utilisateur initial (« demander à un collaborateur de traiter un mail »). |
| Liste destinataires = tous les intervenants du cabinet | Plus large, permet de déléguer à n'importe qui. `/referentiel/intervenants` existe déjà, pas de filtre à construire. |
| Étape+destinataire appliqués uniquement au `.eml` (pas aux PJ en mode avancé) | Le parapheur concerne le « traitement du mail », les PJ sont de la data support. Simplifie l'UI (pas de grille multi-sélection par PJ). |
| Gateway obligatoire pour save sidebar | Déploiement multi-postes sans API SECIB locale → Gateway = point d'accès unique. Évite un code à deux chemins. |
| Validation both-or-neither côté Gateway | Surface une erreur claire côté client sans coût d'appel SECIB ; double sécurité avec la validation client-side. |
| Pas de mémorisation du dernier choix | Évite qu'un utilisateur applique par inadvertance une étape/destinataire à un mail qui n'en a pas besoin. |
