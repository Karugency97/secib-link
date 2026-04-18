# Gateway NPL-SECIB — endpoint contenu binaire d'un document

**Statut :** À implémenter côté gateway.
**Destinataire :** mainteneur de la gateway NPL-SECIB.
**Demandeur :** SECIB-Link (extension Thunderbird).

## Contexte

SECIB-Link laisse l'utilisateur cocher des documents d'un dossier pour les joindre au mail en cours de composition. Le client télécharge actuellement le contenu via l'endpoint SECIB `GET /Document/GetContentDocumentBase64?documentId=UUID` (appelé directement depuis le navigateur, pas via la gateway).

**Problème :** cet endpoint convertit systématiquement le document en PDF côté serveur et renvoie le PDF en base64. Pour certains formats, la conversion échoue :

```
400 "La conversion PDF coté serveur pour les fichiers '.eml' n'est pas prise en charge"
400 "La conversion PDF coté serveur pour les fichiers '.htm' n'est pas prise en charge"
400 "La conversion PDF coté serveur pour les fichiers '.jpeg' n'est pas prise en charge"
400 "La conversion PDF coté serveur pour les fichiers '.msg' n'est pas prise en charge"
```

Formats observés en erreur : `.eml`, `.htm`, `.jpeg`, `.msg`. Probablement d'autres (tous les binaires non convertibles en PDF : images diverses, archives, vidéos, etc.).

**Besoin :** pouvoir récupérer le **contenu binaire brut** d'un document, sans conversion serveur, pour l'attacher tel quel au mail Thunderbird.

## Piste côté SECIB

L'API SECIB expose probablement un (ou plusieurs) endpoint qui renvoie le binaire sans conversion. Pistes à investiguer par le mainteneur gateway :

- Un paramètre sur `GetContentDocumentBase64` (ex. `convertToPdf=false`) qui désactive la conversion.
- Un endpoint distinct type `GetDocumentContent`, `GetRawContent`, `GetOriginalContent`, etc.
- Consulter le MCP SECIB local (`mcp-secib/src/tools/document.ts`) qui gère déjà ce cas en production pour les agents MCP.

Le pattern de nommage `GetContentDocumentBase64` suggère qu'un flag ou un endpoint jumeau existe ; la conversion PDF semble être une feature « bonus » appliquée par défaut.

## Endpoint gateway proposé

`GET /api/v1/documents/{documentId}/content`

### Path params

- `documentId` (UUID SECIB, obligatoire)

### Headers

- `X-API-Key: <key>` — même authentification que le reste de la gateway.

### Traitement

1. Authentifier contre SECIB (OAuth2 client_credentials, pool de tokens existant).
2. Appeler l'endpoint SECIB qui renvoie le binaire brut (à déterminer — voir piste ci-dessus).
3. Repacker la réponse SECIB pour la gateway.

### Réponse — `200 OK`

```json
{
  "data": {
    "documentId": "4d9aaa81-d337-4924-89e3-b42e00ed6e93",
    "fileName": "lettre.eml",
    "mimeType": "message/rfc822",
    "contentBase64": "UmVjZWl2ZWQ6IGZyb20g..."
  }
}
```

- `fileName` : nom exact du fichier tel que stocké dans SECIB (avec son extension originale).
- `mimeType` : si SECIB le fournit, le relayer tel quel ; sinon déduire depuis l'extension ou laisser `"application/octet-stream"`.
- `contentBase64` : contenu binaire original, encodé base64 côté gateway (pas de conversion PDF).

### Erreurs

- `400` si `documentId` absent ou non-UUID.
- `404` si le document n'existe pas / n'est pas accessible au cabinet authentifié.
- `500 { "error": { "code": "UPSTREAM_ERROR", "message": "..." } }` si erreur SECIB non prévue. Propager le message original SECIB dans `message` pour faciliter le debug.

## Alternative : réponse binaire directe

Si tu préfères éviter l'overhead base64 (~33% de taille), tu peux aussi renvoyer directement :

```
Content-Type: <mimeType>
Content-Disposition: attachment; filename="<fileName>"
Body: <bytes bruts>
```

Côté client, on ferait `response.arrayBuffer()` au lieu de `response.json()`. Deux cas réels :
- PJ typiques 100 Ko – 2 Mo → gain négligeable.
- PJ lourdes 5-10 Mo → gain notable sur la bande passante.

**Recommandation :** partir sur la version JSON+base64 (cohérent avec `/dossiers/{id}/parties`, `/repertoires`, `/documents`). Si la taille pose problème plus tard, bascule sur le binaire direct — changement de signature tolérable à ce moment-là.

## Tests côté gateway

```bash
# Document PDF natif (doit fonctionner) — déjà OK via GetContentDocumentBase64
curl -H "X-API-Key: $KEY" \
  "https://apisecib.nplavocat.com/api/v1/documents/<UUID>/content" | jq '.data.fileName, .data.mimeType'

# Document .eml (actuellement en échec 400)
curl -H "X-API-Key: $KEY" \
  "https://apisecib.nplavocat.com/api/v1/documents/4d9aaa81-d337-4924-89e3-b42e00ed6e93/content" | jq '.data.fileName'
# → "lettre.eml" attendu, contentBase64 rempli

# Document .jpeg (actuellement en échec 400)
curl -H "X-API-Key: $KEY" \
  "https://apisecib.nplavocat.com/api/v1/documents/471ba829-e56f-48b1-af8b-b42d0185fb3b/content" | jq '.data.fileName'
# → "photo.jpeg" attendu

# Document inexistant
curl -H "X-API-Key: $KEY" \
  "https://apisecib.nplavocat.com/api/v1/documents/00000000-0000-0000-0000-000000000000/content"
# → 404
```

## Répercussion côté SECIB-Link

Dans `sidebar/secib-api.js`, remplacer :

```js
async function getDocumentContent(documentId) {
  return apiCall("GET", "/Document/GetContentDocumentBase64", { query: { documentId } });
}
```

par :

```js
async function getDocumentContent(documentId) {
  return gatewayCall(`/documents/${encodeURIComponent(documentId)}/content`);
}
```

Dans `compose/panel.js#performApply`, le consommateur actuel lit déjà `content.Content` et `content.FileName` :

```js
const content = await SecibAPI.getDocumentContent(d.DocumentId);
const base64 = content && content.Content ? content.Content : "";
const file = base64ToFile(base64, content.FileName || label, guessMime(label));
```

Pour coller au shape proposé (`contentBase64`, `fileName`, `mimeType`), adapter :

```js
const content = await SecibAPI.getDocumentContent(d.DocumentId);
const base64 = content && content.contentBase64 ? content.contentBase64 : "";
const file = base64ToFile(base64, content.fileName || label, content.mimeType || guessMime(label));
```

`guessMime` devient un fallback — la gateway pourra retourner le vrai mimeType.

## Bénéfice attendu

Aujourd'hui, sur un dossier moyen (source : logs utilisateur 2026-04-17), environ **30-40 % des documents échouent** à être joints au mail dès qu'ils ne sont pas des PDF natifs ou des formats Office. Avec cet endpoint, on couvre 100 % des formats stockés dans SECIB.

## Références

- Extrait de logs utilisateur 2026-04-17 (erreurs constatées) : voir conversation SECIB-Link.
- Endpoint SECIB actuel (à remplacer) : `GET /Document/GetContentDocumentBase64?documentId=UUID`.
- Pattern gateway existant à suivre : `npl-api-gateway/src/routes/dossiers.ts` (endpoint `/dossiers/{id}/parties` + `/repertoires`).
- MCP SECIB local : `mcp-secib/src/tools/document.ts` — contient le pattern body-on-GET éprouvé pour `GetListeDocument`, peut aussi contenir la piste pour le contenu binaire brut.
