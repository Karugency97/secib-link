# Gateway NPL-SECIB — endpoint contenu binaire d'un document

**Statut :** ✅ Livré 2026-04-17 (Plan 6 gateway, branche `feature/plan6-document-content-binaire` — à redéployer côté Coolify).
**Demandeur :** SECIB-Link (extension Thunderbird).

## Résolution

Nouvel endpoint gateway : `GET /api/v1/documents/:id/content`.

**Shape** (comme proposé dans la spec initiale) :

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

**Caractéristiques clés** :
- Aucune conversion PDF côté SECIB — le binaire original est restitué bit-exact (validé en test avec magic bytes JPEG `FF D8 FF E0`).
- `fileName` composé depuis SECIB `Libelle` + `Extension` (sans double-suffixer si `Libelle` porte déjà l'extension).
- `mimeType` : priorité à `Content-Type` upstream SECIB s'il est spécifique, sinon dérivé de `Extension` (30 formats mappés incluant `.eml` `.msg` `.htm` `.jpeg` `.docx` etc.), fallback `application/octet-stream`.
- Authentification `X-API-Key` standard, même que les autres endpoints.

**Codes d'erreur** :
- `400 invalid_id` — `:id` pas au format UUID SECIB.
- `404 secib_client_error` — document inexistant ou inaccessible au cabinet authentifié.
- `502 secib_upstream` — SECIB 5xx ou réseau.
- `503 circuit_open` — circuit breaker ouvert.

## Pourquoi la piste SECIB était bonne

Le vrai endpoint SECIB à utiliser est `GET /Document/GetContentDocument?documentId=UUID` (sans suffixe `Base64`) — confirmé par le MCP local (`mcp-secib/src/tools/document.ts:75`), en prod. L'endpoint `GetContentDocumentBase64` que SECIB-Link appelait directement ajoute la conversion PDF côté serveur, qui échoue pour les formats non-convertibles (cause-racine des 400 observés).

Un fix annexe a été nécessaire côté gateway (`SecibClient.requestBinary`) pour préserver les octets non-UTF8 — l'ancienne route `/documents/:id/contenu` faisait `toString('utf8')` sur toute réponse non-JSON, corrompant silencieusement les binaires. Seuls les tests mockés (renvoyant du JSON `{ Base64: "..." }`) masquaient le bug. Les nouveaux tests round-trip byte-exact sur des magic bytes JPEG pour l'exclure définitivement.

## À faire côté SECIB-Link

Dans `sidebar/secib-api.js`, remplacer :

```js
async function getDocumentContent(documentId) {
  return apiCall("GET", "/Document/GetContentDocumentBase64", { query: { documentId } });
}
```

par :

```js
async function getDocumentContent(documentId) {
  const res = await fetch(
    `${GATEWAY}/api/v1/documents/${encodeURIComponent(documentId)}/content`,
    { headers: { "X-API-Key": GATEWAY_KEY } },
  );
  if (!res.ok) throw new Error(`Gateway ${res.status}`);
  const { data } = await res.json();
  return data; // { documentId, fileName, mimeType, contentBase64 }
}
```

Dans `compose/panel.js#performApply`, adapter le consommateur :

```js
const content = await SecibAPI.getDocumentContent(d.DocumentId);
const base64 = content?.contentBase64 ?? "";
const file = base64ToFile(base64, content.fileName || label, content.mimeType || guessMime(label));
```

`guessMime` reste un fallback — la gateway renverra désormais le vrai MIME dans la plupart des cas (30 formats mappés).

## Tests gateway à rejouer post-deploy

```bash
# .eml — précédemment 400
curl -H "X-API-Key: $KEY" \
  "https://apisecib.nplavocat.com/api/v1/documents/<UUID-eml>/content" \
  | jq '.data.fileName, .data.mimeType'
# → "lettre.eml", "message/rfc822"

# .jpeg — précédemment 400
curl -H "X-API-Key: $KEY" \
  "https://apisecib.nplavocat.com/api/v1/documents/<UUID-jpeg>/content" \
  | jq '.data | {fileName, mimeType, size: (.contentBase64 | length * 3 / 4 | floor)}'

# UUID invalide
curl -H "X-API-Key: $KEY" \
  "https://apisecib.nplavocat.com/api/v1/documents/not-a-uuid/content"
# → 400 invalid_id
```

## Références

- Spec initiale : ce fichier (historique `git log`).
- Plan d'implémentation gateway : `npl-api-gateway/docs/plans/2026-04-17-plan6-document-content-binaire.md`.
- Doc consommateur : `npl-api-gateway/docs/INTEGRATION_GUIDE.md § 5.7` + `§ 6.5`.
- Route : `npl-api-gateway/src/routes/documents.ts` (`/:id/content`).
- Client binaire : `npl-api-gateway/src/secib/client.ts` (`requestBinary`).
