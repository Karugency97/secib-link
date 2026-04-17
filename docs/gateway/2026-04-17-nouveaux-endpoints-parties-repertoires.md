# Gateway NPL-SECIB — endpoints `/parties` et `/repertoires`

**Destinataire :** mainteneur de la gateway NPL-SECIB (projet hors repo SECIB-Link).
**Contexte :** SECIB-Link (extension Thunderbird) a besoin de lire les parties et répertoires d'un dossier SECIB. Les endpoints cibles exigent un body JSON sur une requête GET, ce que le navigateur refuse (`fetch` ne laisse pas passer de body sur GET). La gateway sert de passe-plat — même pattern que l'endpoint `/documents` déjà en production.

## Endpoint 1 : `GET /api/v1/parties?dossierId=N`

**Query params** :
- `dossierId` (entier, obligatoire)

**Traitement** :
1. Authentifier contre SECIB (OAuth2 client_credentials, même cabinet que `/documents`).
2. Forward vers `GET https://secibneo.secib.fr/{version}/{cabinetId}/api/v1/Partie/Get` avec body JSON `{ "DossierId": <N> }` (body-on-GET via `node:https`).
3. Unwrap la réponse SECIB (tableau de `PartieApiDto`).

**Réponse** : `200 { "data": PartieApiDto[] }`

**Erreurs** :
- `400` si `dossierId` manquant ou non numérique.
- `401` si auth gateway échoue (propager code SECIB).
- `500 { "error": { "code": "UPSTREAM_ERROR", "message": "..." } }` sinon.

## Endpoint 2 : `GET /api/v1/repertoires?dossierId=N`

**Query params** :
- `dossierId` (entier, obligatoire)

**Traitement** :
1. Auth identique.
2. Forward vers `GET https://secibneo.secib.fr/{version}/{cabinetId}/api/v1/Document/GetListRepertoireDossier` avec body JSON `{ "DossierId": <N> }` (body-on-GET).
3. Unwrap.

**Réponse** : `200 { "data": RepertoireApiDto[] }`

**Erreurs** : mêmes codes que ci-dessus.

## Tests côté gateway

Pour un dossier connu (ex. `DossierId=42`) :
```
curl -H "X-API-Key: $GATEWAY_KEY" "https://apisecib.nplavocat.com/api/v1/parties?dossierId=42"
curl -H "X-API-Key: $GATEWAY_KEY" "https://apisecib.nplavocat.com/api/v1/repertoires?dossierId=42"
```
Les deux doivent renvoyer `200 { "data": [...] }`.

## Référence d'implémentation

Le MCP SECIB local (`reference_mcp_secib` en mémoire) contient un exemple de body-on-GET en Node.js réussi pour `GetListeDocument`. Même technique à appliquer ici.
