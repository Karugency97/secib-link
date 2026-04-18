# Reprise SECIB-Link — en attente de la Gateway NPL-SECIB

**Date de mise en pause :** 2026-04-16
**Branche :** `feat/compose-arbre-archive`
**Dernier commit :** `5c6162c refactor(compose): HTML panel → arbre unifié + bloc archivage`
**Plan de référence :** `docs/superpowers/plans/2026-04-16-compose-arbre-archive.md` (21 tâches)

---

## 1. Pourquoi on s'arrête

### Le blocage technique

L'endpoint `GET /api/v1/Document/GetListeDocument` attend ses filtres **dans le body JSON** d'une requête **GET**. Exemple qui marche (MCP Node.js) :

```
GET /Document/GetListeDocument?range=0-49
Body: { "dossierId": 2062 }
```

- **Node.js** peut envoyer un body sur GET via `https.request()` (et c'est ce que fait `mcp-secib/src/lib/secib-client.ts:197-229`).
- **Le navigateur refuse** : la spec Fetch + XMLHttpRequest strippent silencieusement tout body sur GET/HEAD. Aucun contournement côté client.

### Ce qu'on a tenté (9 variantes, toutes KO)

| # | Méthode | Résultat |
|---|---------|----------|
| 1 | `POST v2 body {DossierId}` | 400 UnsupportedApiVersion |
| 2 | `POST v2 body {dossierId}` | 400 UnsupportedApiVersion |
| 3 | `POST v2 body {filtreDocument:{dossierId}}` | 400 UnsupportedApiVersion |
| 4 | `GET v2 ?filtreDocument.dossierId=N` | 400 UnsupportedApiVersion |
| 5 | `POST v1 body {dossierId}` | 405 Method Not Allowed |
| 6 | `POST v1 body {DossierId}` | 405 Method Not Allowed |
| 7 | `GET v1 ?dossierId=N` | 400 "Le filtre de recherche n'est pas renseigné !" |
| 8 | `GET v1 ?filtreDocument.DossierId=N` | 400 "Le filtre de recherche n'est pas renseigné !" |
| 9 | `GET v1 ?filtreDocument.dossierId=N` | 400 "Le filtre de recherche n'est pas renseigné !" |

→ le swagger liste bien `filtreDocument.dossierId` en query (v1 GET), mais le serveur ne bind pas et renvoie 400. Seul le body-on-GET fonctionne réellement.

### Autres endpoints potentiellement impactés

Probablement tous les endpoints SECIB qui prennent un DTO complexe en GET. À auditer au moment de l'intégration gateway. Dans le scope actuel de Compose, seul `GetListeDocument` est bloquant (les autres endpoints utilisés fonctionnent en query simple).

---

## 2. État de la feature `feat/compose-arbre-archive`

### Ce qui marche (validé en test manuel 2026-04-16)

- Recherche client + dossier en parallèle, fusion dans l'arbre
- Expansion lazy client → dossiers
- Expansion dossier → parties **avec emails visibles** (gris, sous le nom) ✓
- Expansion dossier → répertoires listés (`1-Correspondances`, `E-mail`, etc.)
- Sélection dossier → carte "Dossier sélectionné" + auto-détection/création du répertoire `Email`
- Radio "Archiver ici" par répertoire (override de destination d'archivage)
- Checkboxes parties (To/Cc/Cci) → branchent sur `partiesSelected`
- `panel.js` réécrit en orchestrateur léger (385 LOC, syntaxe OK)

### Ce qui NE marche pas à cause du blocage

- Chaque répertoire affiche **"0 document(s)"** → aucun document chargeable
- Impossible de cocher un document comme pièce jointe → le bouton "Appliquer" ne peut pas attacher de PJ SECIB

### Commits déjà en place sur la branche

```
5c6162c refactor(compose): HTML panel → arbre unifié + bloc archivage     (Task 15)
d4aeff5 style(compose): styles TreeView + bloc destination archivage       (Task 14)
7c2d7c5 feat(tree): checkboxes parties (To/Cc/Cci) + documents (PJ)        (Task 13)
b43b28f feat(tree): sélection dossier + radio override répertoire          (Task 12)
053d4ab feat(tree): expansion dossier → parties + répertoires + documents  (Task 11)
1ead492 feat(tree): expansion lazy d'un client → dossiers                  (Task 10)
7a8debd feat(tree): recherche client + dossier en parallèle                (Task 9)
3234c77 feat(tree): squelette TreeView — rendu nœuds + lazy markers        (Task 8)
4104896 feat(compose): module ComposeState (storage.session + fallback)    (Task 7)
f6c443d feat(api): ajoute saveEmailMessage pour archivage .eml             (Task 6)
b2240c6 feat(api): ajoute creerRepertoire pour création dynamique          (Task 5)
5668d88 fix(api): cascade de variantes pour GetListRepertoireDossier (400) (Task 3)
dabf190 chore: bump version 1.1.0 → 1.1.1
ba34dc4 fix(api): cascade de variantes pour GetListeDocument               (tentative KO)
eb442fd docs(plans): plan d'implémentation compose arbre + archivage v1.2.0
```

Task 4 (`rechercherPersonne`) : export déjà présent (ligne 373 de `secib-api.js`), pas de commit dédié nécessaire.

### Modifications non committées

- `compose/panel.js` : réécrit (Task 16 Step 1), non committé car vérif manuelle a révélé le blocage documents.
- Décision : **ne pas commit `panel.js` maintenant** — il faudra vraisemblablement l'adapter pour taper sur la gateway. On repartira du même point une fois la gateway en place.

### Backup du WIP

Pour parer à toute perte accidentelle (`git reset --hard`, `git clean -f`, switch de branche mal négocié), un patch du `panel.js` WIP est sauvegardé ici :

```
docs/superpowers/reprises/panel.js.task16-wip.patch
```

**Pour restaurer le WIP si le working tree est perdu :**

```bash
cd "/Users/mkstudio/Desktop/API SECIB/SECIB-Link"
git checkout feat/compose-arbre-archive
git apply docs/superpowers/reprises/panel.js.task16-wip.patch
# Vérifier : git diff compose/panel.js doit remontrer ~500 lignes de diff
```

Le patch est tracké par git (committé avec ce dossier de reprise), donc garanti persistant tant que la branche existe.

### Tasks restantes du plan (en attente gateway)

| Task | Objet | Impact gateway |
|------|-------|----------------|
| 16 | Réécriture `panel.js` orchestrateur | Ajuster URL documents → gateway |
| 17 | Listener `onAfterSend` dans `background.js` | `saveEmailMessage` peut aussi migrer |
| 18 | Bump version 1.2.0 + `updates.json` | Indépendant |
| 19 | Passe checklist manuelle complète | Bloqué tant que docs pas chargés |
| 20 | Merge + tag `v1.2.0` | Fin de chaîne |

---

## 3. Ce que la gateway doit fournir pour débloquer

### Endpoint minimal requis

```
GET /api/v1/documents?dossierId=2062&range=0-49
→ relaie vers: GET /8.1.4/{cabinetId}/api/v1/Document/GetListeDocument
   avec body { dossierId: 2062 } et query { range: "0-49" }
→ retourne: DocumentCompactApiDto[]
```

**Paramètres optionnels utiles :**
- `repertoireId` (numérique) : filtre par répertoire si on veut paginer par répertoire
- `libelle` : recherche plein-texte éventuelle

### Spécifique au plan gateway existant

Le plan `../plan-api-gateway-npl-secib.md` prévoit déjà (ligne 149) :
```
### Documents
GET /api/v1/documents               → /Document/GetListeDocument (body-on-GET)
```

→ **Priorité absolue pour SECIB-Link** : avoir cette route opérationnelle avant toute autre. Tout le reste peut attendre.

### Authentification

Une **API key** côté extension (stockée dans `browser.storage.local`, à ajouter dans la page Options). Header `X-API-Key: xxx` à chaque appel gateway.

### Fallback pendant la transition

Garder les appels SECIB directs pour les endpoints qui marchent (GetDossiers, Partie/Get, GetListRepertoireDossier, GetContentDocument, SaveDocument, Personne/Get). Seuls les endpoints body-on-GET passent par la gateway.

---

## 4. Checklist de reprise une fois la gateway opérationnelle

### Étape 1 — Vérifier la gateway

- [ ] `GET https://api-secib.nplavocat.com/api/v1/documents?dossierId=2062&range=0-49` renvoie bien un tableau de documents
- [ ] Header `X-API-Key: …` requis
- [ ] CORS autorise l'extension Thunderbird (origin `moz-extension://…`)
- [ ] Latence acceptable (< 500 ms pour 50 docs)

### Étape 2 — Ajouter la config gateway dans l'extension

- [ ] Dans `options/options.html` + `options/options.js` : champ "URL gateway" + "API key"
- [ ] Stocker dans `browser.storage.local` (clés `gatewayUrl`, `gatewayApiKey`)
- [ ] Valeurs par défaut sensées (prod URL + placeholder clé)

### Étape 3 — Adapter `secib-api.js`

- [ ] Créer `gatewayCall(path, params)` qui construit l'URL gateway + injecte `X-API-Key`
- [ ] Remplacer `getDocumentsDossier()` : au lieu de la cascade, un seul appel `gatewayCall('/api/v1/documents', { dossierId, range })`
- [ ] Supprimer `ba34dc4` (le "fix cascade GetListeDocument") ou le garder en backup comme fallback si la gateway est DOWN
- [ ] Garder les autres fonctions SECIB inchangées (elles marchent en direct)

### Étape 4 — Reprendre le plan là où on s'est arrêté

- [ ] Task 16 Step 1 : `panel.js` est déjà prêt dans le worktree (non committé). Vérifier qu'il utilise bien la nouvelle `getDocumentsDossier` via gateway.
- [ ] Task 16 Step 2 : refaire la vérification manuelle complète. Cette fois les documents doivent remonter.
- [ ] Task 16 Step 3 : committer `panel.js` + fichiers gateway-config (options) en un commit bien isolé.
- [ ] Tasks 17 → 20 : dérouler normalement.

### Étape 5 — Documentation

- [ ] Mettre à jour le `README` pour préciser que la gateway est requise
- [ ] Documenter la procédure d'obtention de l'API key côté cabinet

---

## 5. Pointeurs utiles

| Ressource | Chemin |
|-----------|--------|
| Plan feature Compose | `docs/superpowers/plans/2026-04-16-compose-arbre-archive.md` |
| Spec feature Compose | `docs/superpowers/specs/2026-04-16-compose-arbre-archive-design.md` |
| Plan gateway (global) | `../plan-api-gateway-npl-secib.md` |
| Code MCP qui prouve body-on-GET | `../mcp-secib/src/tools/document.ts:22-32` |
| Code MCP client Node | `../mcp-secib/src/lib/secib-client.ts:197-229` |
| Swagger SECIB | `../secib-swagger.json` (chercher `GetListeDocument`) |
| Screenshot du blocage | Capture du 2026-04-16 ~21h06 (conversation Claude) |
