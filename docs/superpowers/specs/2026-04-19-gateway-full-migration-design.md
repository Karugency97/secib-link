# SECIB-Link — migration complète vers la Gateway NPL-SECIB

**Date** : 2026-04-19
**Branche** : `claude/interesting-shtern-f0877f` (même branche que le spec parapheur)
**Statut** : spec en revue

## Problème

SECIB-Link (extension Thunderbird) exécute aujourd'hui **deux familles d'appels** :

- Certaines opérations passent par la **Gateway NPL-SECIB** (répertoires, documents, content binaire, étape parapheur — cette dernière ajoutée dans la spec du même jour).
- D'autres frappent **SECIB Neo en direct** via OAuth2 `client_credentials` : recherche personne, détail personne, parties d'une personne, détail dossier, recherche libre de dossiers.

Cette hybridation force chaque poste à stocker des credentials OAuth2 SECIB dans son `browser.storage.local` (`secib_base_url`, `secib_cabinet_id`, `secib_client_id`, `secib_client_secret`) en plus de la config Gateway. Le déploiement multi-postes devient friction × 2 : doc d'installation plus longue, credentials SECIB à distribuer, refresh token côté client à maintenir, deux chemins d'authentification à debug.

L'objectif est de **faire passer 100 % des appels API de l'extension par la Gateway**, pour obtenir un seul chemin d'auth (`X-API-Key`), une seule URL à configurer (la Gateway), et un code base sans logique OAuth2 côté client.

Ce sous-projet est la **suite logique** de la migration partielle faite dans la spec parapheur (qui a migré le flux save vers la Gateway). Il finit le travail.

## Scope

**Dans le scope**

- **Part C — Gateway v2 (enhancements)** : étendre deux endpoints Gateway existants (`GET /personnes`, `GET /dossiers`) pour accepter des filtres spécifiques (`coordonnees`, `denomination`, `code`, `nom`) en plus du `q` (RechercheGenerique) actuel. Ajout **additif** — le comportement `?q=` existant reste fonctionnel pour les autres clients.
- **Part D — Extension full-Gateway** : migrer les 7 appels sidebar/compose restants vers la Gateway, supprimer tout le code OAuth2 SECIB, simplifier la config utilisateur (Gateway URL + API key seulement, obligatoires), bump de version majeur.

**Hors scope**

- Panneau compose : ses appels passent déjà par `SecibAPI` — la migration se fait automatiquement.
- Backgrounds / listeners Thunderbird : aucun appel SECIB direct.
- Gateway côté ops (monitoring, rate limiting) : inchangé.
- Gestion des erreurs réseau avancée (retry, offline mode) : non prévu dans cette itération.

## Architecture cible

```
avant :
┌──────────────┐       ┌───────────────┐       ┌───────────┐
│ SECIB-Link   │─OAuth─│ SECIB Neo     │       │ SECIB Neo │
│   (hybride)  │       │ (token)       │       │ (API)     │
│              │─────────────────────────────▶ │           │
│              │─X-API-▶─ Gateway  NPL ─────── ▶           │
│              │─Key    └───────────────┘       └───────────┘
└──────────────┘

après :
┌──────────────┐                ┌───────────────┐       ┌───────────┐
│ SECIB-Link   │  X-API-Key     │ Gateway       │ OAuth2│ SECIB Neo │
│ (Gateway-    │───────────────▶│ NPL-SECIB     │──────▶│           │
│  only)       │                │ (token cache  │       │           │
│              │                │  Redis)       │       │           │
└──────────────┘                └───────────────┘       └───────────┘
```

Les credentials OAuth2 SECIB vivent uniquement **côté Gateway** (serveur). L'extension ne voit que la Gateway.

## Part C — Gateway v2 enhancements

Deux routes étendues, **additivement**. Le comportement existant (`?q=`) est préservé pour backwards compat des autres clients de la Gateway (recouvrement, portail-cabinet, dorothy).

### Route `GET /api/v1/personnes`

**Aujourd'hui** :
```
GET /api/v1/personnes?q=<RechercheGenerique>&type=<PP|PM>&limit=<n>
→ SECIB POST /Personne/Get  body { RechercheGenerique, TypePersonne, NbMax }
```

**Après** — nouveaux query params optionnels :

| Param | SECIB filter | Usage |
|---|---|---|
| `q` | `RechercheGenerique` | existant — recherche libre |
| `type` | `TypePersonne` (PP/PM) | existant |
| `limit` | `NbMax` | existant |
| **`coordonnees`** | `Coordonnees` | **nouveau** — recherche par email/tel |
| **`denomination`** | `Denomination` | **nouveau** — recherche par nom/raison sociale |

Ordre de précédence si plusieurs sont fournis (le premier non vide gagne, les autres ignorés) :
1. `coordonnees`
2. `denomination`
3. `q`

Raison : le cas d'usage principal de l'extension est la recherche par email de l'expéditeur (`coordonnees`). Si le client passe à la fois `coordonnees` et `q`, on privilégie le filtre le plus précis. Pas de mix côté body SECIB (SECIB accepte un filtre à la fois).

### Route `GET /api/v1/dossiers`

**Aujourd'hui** :
```
GET /api/v1/dossiers?q=<RechercheGenerique>&limit=<n>
→ SECIB POST /Dossier/Get  body { RechercheGenerique, NbMax }
```

**Problème observé en Phase 0** : `RechercheGenerique` ne matche PAS les codes dossier du type `DOS-2104.0167` — retour de liste récente au lieu du match exact.

**Après** — nouveaux query params optionnels :

| Param | SECIB endpoint + filter | Usage |
|---|---|---|
| `q` | `POST /Dossier/Get` body `{ RechercheGenerique }` | existant |
| `limit` | `NbMax` | existant |
| **`code`** | `POST /Dossier/GetDossiers` body `{ Code }` | **nouveau** — recherche par code exact |
| **`nom`** | `POST /Dossier/GetDossiers` body `{ Nom }` | **nouveau** — recherche par nom |

Note importante : `code` et `nom` passent par `/Dossier/GetDossiers` (endpoint SECIB différent de `/Dossier/Get` pour `q`). `GetDossiers` est celui utilisé aujourd'hui par la sidebar pour la recherche exacte — c'est ce qui marche.

Ordre de précédence si plusieurs sont fournis :
1. `code`
2. `nom`
3. `q`

### Headers / pagination SECIB

Pour `GetDossiers`, SECIB attend un header `Range: 0-{limit-1}` sous forme de query param `?range=0-14`. La Gateway SecibClient gère déjà la construction d'URL — on passe `range` comme param côté request. Le test d'intégration vérifiera la présence du range correctement formaté.

### Cache

- Les routes de recherche ne sont **pas cachées** (requêtes variables, résultats volumineux). Comportement inchangé.

## Part D — Extension full-Gateway migration

### Calls à migrer

| # | Fonction `SecibAPI` | Avant (direct SECIB) | Après (Gateway) |
|---|---|---|---|
| 1 | `rechercherPersonne(criteres, limit, offset)` | POST `/Personne/Get` + body | GET `/personnes?coordonnees=` ou `?denomination=` ou `?q=` + `&limit=&type=` |
| 2 | `rechercherParCoordonnees(coord, limit)` | via (1) | via (1) avec `coordonnees=` |
| 3 | `rechercherParDenomination(denom, limit)` | via (1) | via (1) avec `denomination=` |
| 4 | `getPersonnePhysique(personneId)` | GET `/Personne/GetPersonnePhysique` | GET `/personnes/{id}?type=PP` |
| 5 | `getPersonneMorale(personneId)` | GET `/Personne/GetPersonneMorale` | GET `/personnes/{id}?type=PM` |
| 6 | `getDossiersPersonne(personneId)` | GET `/Partie/GetByPersonneId` | GET `/personnes/{id}/dossiers` |
| 7 | `getDossierDetail(dossierId)` | GET `/Dossier/GetDossierById` | GET `/dossiers/{id}` |
| 8 | `rechercherDossiers(terme, limit)` | POST `/Dossier/GetDossiers` + body (Code ou Nom) | GET `/dossiers?code=` ou `?nom=` |

### Code à supprimer de `sidebar/secib-api.js`

Une fois tous les call sites migrés :
- `_token`, `_tokenExpiry` module-level state
- `getConfig()` — ne sert plus (config Gateway est lue par `getGatewayConfig()` déjà existant)
- `authenticate()` — plus d'OAuth2 côté client
- `buildUrl(config, path, version, query)` — construction d'URL SECIB direct
- `apiCall(method, path, options)` — helper SECIB direct
- Commentaire d'en-tête (lignes 1-4) mis à jour : "Module API — uniquement via Gateway NPL-SECIB"

Le module devient **significativement plus court** (de ~350 lignes à ~180 lignes estimées).

### Settings UI (sidebar.html) — simplification

**Avant** : 6 champs de config (4 OAuth2 SECIB + 2 Gateway).

**Après** : 2 champs seulement :

```
┌──────────────────────────────────────────┐
│ Configuration Gateway NPL-SECIB          │
│                                          │
│ URL Gateway                              │
│ [ https://apisecib.nplavocat.com    ]    │
│                                          │
│ API Key                                  │
│ [ gw_sl_...                         ]    │
│                                          │
│ [Enregistrer]           [Fermer]         │
└──────────────────────────────────────────┘
```

Les champs SECIB (`input-base-url`, `input-cabinet-id`, `input-client-id`, `input-client-secret`) sont **supprimés du HTML**. Les labels associés aussi.

La section hint "Gateway NPL-SECIB (optionnel)" devient **le titre principal** de la configuration — la Gateway n'est plus optionnelle.

### Storage migration

À la première ouverture de la settings page en v2.0.0, on supprime proactivement les clés SECIB obsolètes :

```js
await browser.storage.local.remove([
  "secib_base_url", "secib_cabinet_id", "secib_client_id", "secib_client_secret"
]);
```

Exécuté une seule fois au démarrage du background.js (ou de la sidebar.js, au choix — le background est plus propre car déclenché à l'install/upgrade). Si la clé n'existe pas, `remove` est silencieux — pas de side-effect négatif.

### Validation au save des settings

`getGatewayConfig()` (déjà existant) throw `GATEWAY_CONFIG_MISSING` si URL ou key absentes. Le save button dans les settings fait déjà cette validation (à vérifier — sinon on ajoute un test simple avant enregistrement). Message "La Gateway est obligatoire" si absent.

## Versioning

Bump **`1.3.0 → 2.0.0`**.

Rationale :
- **Rupture côté configuration utilisateur** : les champs OAuth2 SECIB disparaissent, les credentials stockés deviennent inutiles. L'utilisateur peut avoir à s'assurer que la Gateway URL + API Key sont bien renseignées (mais la plupart les ont déjà, car l'étape parapheur les a rendues obligatoires).
- **Nouvelle architecture d'authentification** : un single API key côté client, plus d'OAuth2 dans le navigateur.
- **Marqueur clair** dans le changelog / release notes pour les admins.

Updates.json : le lien `/releases/download/v2.0.0/secib_link-2.0.0-tb.xpi` remplacera `v1.3.0/...`. Le patch v1.0.1 conservé pour l'historique (convention actuelle).

## Impact code

| Fichier | Changement |
|---|---|
| Gateway `src/routes/personnes.ts` | +4 params optionnels (`coordonnees`, `denomination`) dans `GET /` ; logique de précédence ; tests nouveaux |
| Gateway `src/routes/dossiers.ts` | +4 params optionnels (`code`, `nom`) dans `GET /` ; bascule conditionnelle vers `/Dossier/GetDossiers` quand `code` ou `nom` ; tests nouveaux |
| Gateway `tests/integration/personnes.test.ts` | +3 à 5 tests (coordonnees, denomination, précédence) |
| Gateway `tests/integration/dossiers.test.ts` | +3 à 5 tests (code, nom, précédence) |
| Gateway `docs/INTEGRATION_GUIDE.md` | Section 5.2 (personnes) et 5.5 (dossiers) : docs des nouveaux params + exemples |
| [sidebar/secib-api.js](sidebar/secib-api.js) | 8 fonctions réécrites via `gatewayCall` / `gatewayPost` ; suppression de `getConfig` / `authenticate` / `apiCall` / `buildUrl` / state OAuth2 ; en-tête maj |
| [sidebar/sidebar.html](sidebar/sidebar.html) | Settings panel : suppression de 4 form-groups SECIB (8 lignes HTML env.) ; renommage du titre de section ; suppression de la section "Gateway NPL-SECIB (optionnel)" (le hint) |
| [sidebar/sidebar.js](sidebar/sidebar.js) | Settings save/load : suppression des refs DOM et logic pour les 4 champs SECIB ; éventuelle migration `browser.storage.local.remove` des anciennes clés |
| [background.js](background.js) | +1 appel de cleanup `browser.storage.local.remove(...)` au startup (optionnel, peut aussi vivre dans sidebar.js) |
| [README.md](README.md) | Section "Installation (utilisateur final)" : **2 champs** à configurer au lieu de 6. Simplification majeure de la doc. |
| `manifest.json` | Bump `1.3.0 → 2.0.0` |
| `updates.json` | Entry 2.0.0 remplace 1.3.0 |

**Non touché** : `compose/*.js` (utilise `SecibAPI.*` — bénéficie automatiquement de la migration), `icons/*`, autres ressources.

## Tests

### Gateway (nouveau)

Dans `tests/integration/personnes.test.ts` :
- `GET /personnes?coordonnees=abc@x.com` → body SECIB forwardé contient `Coordonnees: "abc@x.com"`
- `GET /personnes?denomination=Dupont` → body SECIB forwardé contient `Denomination: "Dupont"`
- `GET /personnes?coordonnees=x&q=y` → `Coordonnees` utilisé, `q` ignoré (précédence)
- `GET /personnes?q=Dupont` → comportement actuel (RechercheGenerique) inchangé

Dans `tests/integration/dossiers.test.ts` :
- `GET /dossiers?code=DOS-2104.0167` → body SECIB forwardé contient `Code: "DOS-2104.0167"` vers `/Dossier/GetDossiers`
- `GET /dossiers?nom=Dossier%20TEST` → body `Nom: "Dossier TEST"`
- `GET /dossiers?code=X&q=Y` → Code prioritaire, q ignoré
- `GET /dossiers?q=Dupont` → comportement actuel (RechercheGenerique) inchangé

### Extension (manuels)

Après Part D intégralement implémentée :

- **Config propre** : après upgrade, settings ne montre plus que Gateway URL + API Key. Les anciennes clés SECIB sont supprimées du storage.
- **Recherche par email expéditeur** : ouvrir un mail, la sidebar trouve l'expéditeur (via `/personnes?coordonnees=`) et affiche ses dossiers.
- **Recherche par nom** : taper un nom dans la barre de recherche, résultats cohérents (via `/personnes?denomination=` ou `/dossiers?nom=`).
- **Recherche par code dossier** : taper `DOS-2104.0167`, le dossier TEST apparaît (via `/dossiers?code=`) — testé en Phase 0 échouait via `?q=`, doit marcher avec `?code=`.
- **Compose panel** : recherche de dossiers et de personnes fonctionne (bénéficie automatiquement de la migration).
- **Save mail avec étape parapheur** : inchangé (déjà Gateway post-parapheur feature).
- **Gateway non configurée après upgrade** : bandeau rouge clair, bouton enregistrer désactivé. Utilisateur redirigé vers settings.

## Annexe — décisions clés

| Décision | Raison |
|---|---|
| Enhancements additifs sur `GET` existants (vs nouveaux endpoints POST) | Préserve la backwards compat pour les autres clients Gateway (recouvrement, dorothy, portail-cabinet) ; pas de breaking change côté serveur |
| Ordre de précédence `coordonnees > denomination > q` | Le filtre le plus précis gagne ; reflète la priorité métier de l'extension (email d'abord) |
| Bump 2.0.0 plutôt que 1.4.0 | La suppression de l'OAuth2 SECIB côté client est un changement d'architecture majeur ; bump major signale clairement "vérifier la config post-upgrade" |
| Storage migration proactive | Nettoie les anciennes clés inutiles — évite la confusion d'un "mauvais" état de storage ; silencieux si clés absentes |
| Compose panel hors liste de fichiers modifiés | Il consomme `SecibAPI.*` qui est unifié — bénéficie automatiquement sans code change dédié |
| Cette spec sur la même branche que parapheur | Le PR existant ([#2](https://github.com/Karugency97/secib-link/pull/2)) grandit pour inclure les deux features — l'utilisateur testera tout d'un bloc en final, évite un cycle de test intermédiaire |
| Part C (Gateway v2) sur sa propre PR dans le repo Gateway | Même pattern que Part A ; séparation repo + déploiement indépendant avant Part D |
