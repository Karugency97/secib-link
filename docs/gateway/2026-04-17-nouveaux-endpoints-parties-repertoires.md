# Gateway NPL-SECIB — endpoints `/parties` et `/repertoires`

**Statut :** ✅ Résolu 2026-04-17 — aucun changement gateway nécessaire.
**Destinataire :** équipe SECIB-Link (Thunderbird).

## Résolution

Les deux endpoints demandés existent **déjà en production** sous une forme différente de celle proposée dans la spec initiale. Ils sont en place depuis Plan 2 (commit `cac0ece`, `feat(dossiers)`) et documentés dans `npl-api-gateway/docs/INTEGRATION_GUIDE.md:175,177`.

| Besoin spec initiale | Endpoint existant à utiliser |
|---|---|
| `GET /api/v1/parties?dossierId=N` | `GET /api/v1/dossiers/{N}/parties` |
| `GET /api/v1/repertoires?dossierId=N` | `GET /api/v1/dossiers/{N}/repertoires` |

Les deux :
- Sont mappés respectivement sur `/Partie/Get` et `/Document/GetListRepertoireDossier` côté SECIB.
- Utilisent **query params** (pas de body-on-GET) — aucun contournement `node:https` requis côté gateway ou client.
- Renvoient le format attendu : `200 { "data": PartieApiDto[] }` / `200 { "data": RepertoireApiDto[] }`.
- Passent par le même `X-API-Key` que le reste de la gateway.

## Pourquoi le body-on-GET n'est pas nécessaire

La spec initiale généralisait à tort le pattern de `/Document/GetListeDocument` (seul endpoint SECIB *vraiment* body-on-GET) à `/Partie/Get` et `/Document/GetListRepertoireDossier`. Ces deux derniers acceptent `?dossierId=N` en query string — comportement confirmé par le MCP SECIB local (`mcp-secib/src/tools/partie.ts:38`, `mcp-secib/src/tools/document.ts:137`), utilisé en production.

## À faire côté SECIB-Link

Remplacer les appels prévus :
```js
// Avant (spec initiale)
fetch(`${GATEWAY}/api/v1/parties?dossierId=${id}`, { headers: { 'X-API-Key': key } })
fetch(`${GATEWAY}/api/v1/repertoires?dossierId=${id}`, { headers: { 'X-API-Key': key } })

// Après
fetch(`${GATEWAY}/api/v1/dossiers/${id}/parties`, { headers: { 'X-API-Key': key } })
fetch(`${GATEWAY}/api/v1/dossiers/${id}/repertoires`, { headers: { 'X-API-Key': key } })
```

`fetch` browser-standard fonctionne — pas besoin de passe-plat dédié.

## Tests

```bash
curl -H "X-API-Key: $GATEWAY_KEY" "https://apisecib.nplavocat.com/api/v1/dossiers/42/parties"
curl -H "X-API-Key: $GATEWAY_KEY" "https://apisecib.nplavocat.com/api/v1/dossiers/42/repertoires"
```

Les deux doivent renvoyer `200 { "data": [...] }`.

## Références

- Source gateway : `npl-api-gateway/src/routes/dossiers.ts:40-65`
- Doc consommateur : `npl-api-gateway/docs/INTEGRATION_GUIDE.md:175,177,487`
- Exemple client : `INTEGRATION_GUIDE.md:487` (`getDossierParties`)
