# Étapes parapheur sidebar — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un sélecteur « Étape parapheur » (optionnel) dans la modale d'enregistrement de la sidebar SECIB-Link, et migrer tout le flux save sidebar vers la Gateway NPL-SECIB.

**Architecture:** Nouvel endpoint Gateway `POST /api/v1/documents/save-or-update` en passe-plat vers `/Document/SaveOrUpdateDocument` côté SECIB, acceptant un `EtapeParapheurId` optionnel. Côté extension, le dropdown étape est chargé en parallèle des répertoires, caché si cabinet sans étapes. Gateway devient prérequis dur du save : si absente, bouton Enregistrer désactivé avec bandeau explicite.

**Tech Stack:** TypeScript/Hono (Gateway), Vanilla JS/WebExtensions (sidebar), Vitest (Gateway tests), tests manuels (sidebar).

**Deux repos concernés :**
- Gateway : `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway` (Part A)
- SECIB-Link : working directory courant `/Volumes/KARUG/API SECIB/SECIB-Link/.claude/worktrees/interesting-shtern-f0877f` (Part B)

**Ordre d'exécution :** Phase 0 → Part A (Gateway) → Part B (SECIB-Link). La Part B dépend du déploiement de l'endpoint Gateway.

---

## Phase 0 — Validation manuelle de l'hypothèse A

**But :** Confirmer que `/Document/SaveOrUpdateDocument` accepte le champ `EtapeParapheurId` dans son body. Si cette hypothèse tombe, reprendre le design (hypothèse B = 2 appels).

- [ ] **Step 1: Récupérer un EtapeParapheurId valide**

Via la Gateway déjà en place :
```bash
curl -s -H "X-API-Key: $GW_KEY" \
  "https://apisecib.nplavocat.com/api/v1/referentiel/etapes-parapheur" | jq '.data[0]'
```
Expected : JSON `{ "Id": <int>, "Libelle": "<str>", ... }`. Noter `Id` pour l'étape suivante.

- [ ] **Step 2: Tenter un SaveOrUpdateDocument avec EtapeParapheurId**

Via le MCP SECIB local ou un outil interne d'appel SECIB (hors périmètre Gateway pour ce test) :
```bash
# Construire un body minimal de test :
# { FileName: "test-parapheur.txt", DossierId: <id dossier test>,
#   Content: "<base64 d'un 'hello'>", IsAnnexe: false,
#   EtapeParapheurId: <Id récupéré step 1> }
```
Appeler `POST /Document/SaveOrUpdateDocument` côté SECIB avec ce body.

- [ ] **Step 3: Vérifier dans SECIB Neo**

Ouvrir SECIB Neo → aller sur le dossier de test → vérifier que `test-parapheur.txt` apparaît dans le parapheur à l'étape attendue. Vérifier via `/Document/GetInfosDocument?documentId=<Id>` que le champ EtapeParapheur est bien renseigné.

**Décision :**
- ✅ Si OK → continuer avec Part A
- ❌ Si refusé / ignoré → stopper le plan, rouvrir la spec pour basculer sur hypothèse B

---

## Part A — Gateway NPL-SECIB

**Working directory :** `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway`

### Task A1 : Test d'intégration failing pour POST /documents/save-or-update

**Files:**
- Modify: `tests/integration/documents.test.ts` (ajouter un bloc describe en fin de fichier)

- [ ] **Step 1: Ajouter les tests failing**

Ouvrir `tests/integration/documents.test.ts` et ajouter avant la dernière accolade fermante `});` (fin du `describe('documents routes', ...)`) :

```typescript
  describe('POST /documents/save-or-update', () => {
    it('pass-through SaveOrUpdateDocument sans EtapeParapheurId', async () => {
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Document/SaveOrUpdateDocument', method: 'POST' })
        .reply(200, { DocumentId: 123, Nom: 'mail.eml' });

      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          FileName: 'mail.eml',
          DossierId: 1911,
          RepertoireId: 42,
          Content: 'QUFB',
          IsAnnexe: false,
        }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { DocumentId: 123, Nom: 'mail.eml' } });
    });

    it('propage EtapeParapheurId au body SECIB quand fourni', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Document/SaveOrUpdateDocument', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return { DocumentId: 124 };
        });

      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          FileName: 'mail.eml',
          DossierId: 1911,
          Content: 'QUFB',
          IsAnnexe: false,
          EtapeParapheurId: 7,
        }),
      });

      expect(res.status).toBe(200);
      expect(forwardedBody).toMatchObject({ EtapeParapheurId: 7 });
    });

    it('400 invalid_json sur body vide', async () => {
      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'invalid_json' } });
    });

    it('422 secib_client_error quand SECIB refuse EtapeParapheurId', async () => {
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Document/SaveOrUpdateDocument', method: 'POST' })
        .reply(422, { message: 'EtapeParapheurId invalide' });

      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          FileName: 'mail.eml',
          DossierId: 1911,
          Content: 'QUFB',
          IsAnnexe: false,
          EtapeParapheurId: 999999,
        }),
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { code: 'secib_client_error' } });
    });
  });
```

- [ ] **Step 2: Lancer les tests — vérifier qu'ils échouent**

```bash
cd "/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway"
npx vitest run tests/integration/documents.test.ts -t "POST /documents/save-or-update"
```
Expected : 4 tests FAIL (404 not found — la route n'existe pas encore).

### Task A2 : Implémenter la route

**Files:**
- Modify: `src/routes/documents.ts` (ajouter une route avant le `return r`)

- [ ] **Step 1: Ajouter la route dans documents.ts**

Ouvrir `src/routes/documents.ts`. Juste après la route `POST /` existante (qui map `UploadDocument`, vers ligne 104), ajouter :

```typescript
  // POST /documents/save-or-update — pass-through SaveOrUpdateDocument avec EtapeParapheurId optionnel
  r.post('/save-or-update', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null) return fail(c, 400, 'invalid_json');
    const res = await deps.secib.request('POST', '/Document/SaveOrUpdateDocument', { body });
    if (!res.ok) return failSecib(c, res);
    return ok(c, res.data);
  });
```

- [ ] **Step 2: Lancer les tests — vérifier qu'ils passent**

```bash
npx vitest run tests/integration/documents.test.ts -t "POST /documents/save-or-update"
```
Expected : 4 tests PASS.

- [ ] **Step 3: Lancer la suite complète pour vérifier l'absence de régression**

```bash
npx vitest run
```
Expected : tous les tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/documents.ts tests/integration/documents.test.ts
git commit -m "feat(documents): route POST /save-or-update avec EtapeParapheurId"
```

### Task A3 : Documenter le nouvel endpoint

**Files:**
- Modify: `docs/INTEGRATION_GUIDE.md` (section 5.7 Documents, tableau)

- [ ] **Step 1: Ajouter l'endpoint au tableau**

Ouvrir `docs/INTEGRATION_GUIDE.md`, repérer le tableau dans la section 5.7 Documents. Ajouter une ligne juste après la ligne `POST | /documents | ... | Upload un document` :

```markdown
| POST | `/documents/save-or-update` | Body SECIB `SaveOrUpdateDocument` (+ `EtapeParapheurId` optionnel) | non | Enregistre un document avec étape parapheur optionnelle |
```

- [ ] **Step 2: Ajouter une section usage (§ 6.6)**

Repérer la fin de la section § 6.5 (contenu binaire). Ajouter juste après :

```markdown
### 6.6 Enregistrement d'un mail avec étape parapheur (`POST /documents/save-or-update`)

Utilisé par l'extension Thunderbird SECIB-Link. Permet d'enregistrer un `.eml` (ou tout document) en l'associant optionnellement à une étape du parapheur SECIB — visible ensuite dans le parapheur du collaborateur ciblé.

**Body** :
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

`EtapeParapheurId` est omis si l'utilisateur n'a pas choisi d'étape. La liste des `Id` valides se récupère via `GET /referentiel/etapes-parapheur` (cache 24h).

**Réponses :**
- `200 { data: { DocumentId, ... } }` — pass-through de la réponse SECIB.
- `400 invalid_json` — body JSON invalide.
- `422 secib_client_error` — `EtapeParapheurId` inconnu côté SECIB (message dans `error.message`).
- `502 secib_upstream` — échec upstream SECIB.

**Exemple client** :

```js
const res = await fetch(`${GW}/api/v1/documents/save-or-update`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-API-Key': KEY },
  body: JSON.stringify({ FileName, DossierId, RepertoireId, Content, IsAnnexe: false, EtapeParapheurId }),
});
```
```

- [ ] **Step 3: Commit**

```bash
git add docs/INTEGRATION_GUIDE.md
git commit -m "docs(guide): endpoint POST /documents/save-or-update"
```

### Task A4 : Push Gateway + PR

- [ ] **Step 1: Pousser la branche**

La Gateway est sur sa propre branche. Depuis `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway` :

```bash
git checkout -b feat/documents-save-or-update
git push -u origin feat/documents-save-or-update
```

- [ ] **Step 2: Ouvrir la PR**

```bash
gh pr create --title "feat(documents): POST /save-or-update avec EtapeParapheurId" --body "$(cat <<'EOF'
## Summary

- Nouvel endpoint \`POST /api/v1/documents/save-or-update\` en passe-plat vers \`/Document/SaveOrUpdateDocument\` côté SECIB.
- Accepte un champ \`EtapeParapheurId\` optionnel dans le body, propagé tel quel à SECIB.
- Tests d'intégration ajoutés : happy path avec/sans étape, body invalide, propagation d'erreur SECIB 422.

## Context

Utilisé par l'extension SECIB-Link (Thunderbird) pour associer un mail enregistré à une étape du parapheur — permet de déléguer le traitement à un collaborateur sans quitter Thunderbird. Voir spec SECIB-Link : \`docs/superpowers/specs/2026-04-19-etapes-parapheur-sidebar-design.md\`.

## Test plan

- [x] \`npx vitest run\` — toute la suite passe
- [ ] Test manuel en staging : appel avec EtapeParapheurId valide → doc visible à l'étape dans SECIB Neo
EOF
)"
```

Attendre **merge + déploiement** de cette PR Gateway avant de lancer Part B.

---

## Part B — SECIB-Link sidebar

**Working directory :** `/Volumes/KARUG/API SECIB/SECIB-Link/.claude/worktrees/interesting-shtern-f0877f` (worktree courant, branche `claude/interesting-shtern-f0877f`).

### Task B1 : Helper POST Gateway dans secib-api.js

**Files:**
- Modify: `sidebar/secib-api.js` (ajouter `gatewayPost` juste après `gatewayCall`)

- [ ] **Step 1: Ajouter le helper gatewayPost**

Ouvrir `sidebar/secib-api.js`. Juste après la fin de la fonction `gatewayCall` (fermeture `}` ligne ~178), avant le commentaire `// ─── Méthodes publiques`, insérer :

```javascript
  /**
   * POST générique vers la gateway NPL-SECIB.
   * @param {string} path - chemin relatif à /api/v1, ex: "/documents/save-or-update"
   * @param {object} body - body JSON
   */
  async function gatewayPost(path, body) {
    const config = await getGatewayConfig();
    const url = `${config.baseUrl}/api/v1${path}`;
    console.log(`[SECIB Link] Gateway POST ${url}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": config.apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!response.ok) {
      const code = payload && payload.error && payload.error.code ? payload.error.code : `HTTP_${response.status}`;
      const msg = payload && payload.error && payload.error.message ? payload.error.message : text.slice(0, 200);
      throw new Error(`GATEWAY ${code}: ${msg}`);
    }
    return payload && "data" in payload ? payload.data : payload;
  }
```

- [ ] **Step 2: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): helper gatewayPost pour appels POST via Gateway"
```

### Task B2 : Migrer saveDocument + ajouter getEtapesParapheur

**Files:**
- Modify: `sidebar/secib-api.js` (fonction `saveDocument`, nouvelle fonction `getEtapesParapheur`, export)

- [ ] **Step 1: Remplacer saveDocument pour passer via Gateway**

Dans `sidebar/secib-api.js`, localiser la fonction `saveDocument` (vers ligne 293). Remplacer **entièrement** la fonction par :

```javascript
  /**
   * Enregistre un document dans un dossier (et un répertoire si fourni) via la Gateway.
   * @param {object} doc - { fileName, dossierId, repertoireId?, contentBase64, isAnnexe?, etapeParapheurId? }
   */
  async function saveDocument(doc) {
    const body = {
      FileName: doc.fileName,
      DossierId: doc.dossierId,
      Content: doc.contentBase64,
      IsAnnexe: doc.isAnnexe || false
    };
    if (doc.repertoireId) body.RepertoireId = doc.repertoireId;
    if (doc.etapeParapheurId) body.EtapeParapheurId = doc.etapeParapheurId;

    return gatewayPost("/documents/save-or-update", body);
  }
```

- [ ] **Step 2: Ajouter getEtapesParapheur**

Dans le même fichier, juste après `saveDocument`, ajouter :

```javascript
  /**
   * Liste les étapes du parapheur configurées par le cabinet via la Gateway.
   * Renvoie un tableau d'objets { Id, Libelle, ... } ou [] si cabinet sans étapes.
   */
  async function getEtapesParapheur() {
    const res = await gatewayCall("/referentiel/etapes-parapheur");
    return Array.isArray(res) ? res : [];
  }
```

- [ ] **Step 3: Exporter getEtapesParapheur**

Repérer le `return { ... }` final de l'IIFE (vers ligne 305-330). Ajouter `getEtapesParapheur` dans l'objet exporté, à côté de `saveDocument` :

```javascript
    getDocumentContent,
    getEtapesParapheur,
    saveDocument,
```

- [ ] **Step 4: Smoke test — recharger l'extension et vérifier en console**

Dans Thunderbird : `about:debugging` → Recharger SECIB Link. Ouvrir la sidebar, DevTools, console :
```javascript
await SecibAPI.getEtapesParapheur()
```
Expected : tableau d'étapes `[{ Id, Libelle, ... }]` OU `[]` si cabinet sans étapes OU erreur `GATEWAY_CONFIG_MISSING` si Gateway pas configurée.

- [ ] **Step 5: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): saveDocument via Gateway + getEtapesParapheur"
```

### Task B3 : Ajouter form-group étape parapheur + banner Gateway requise (HTML)

**Files:**
- Modify: `sidebar/sidebar.html` (modale save)

- [ ] **Step 1: Ajouter le form-group étape parapheur et le banner**

Ouvrir `sidebar/sidebar.html`. Dans la modale save (`<div id="save-modal">`), localiser la section `<div class="modal-body">` (ligne 102). **Juste après** l'ouverture `<div class="modal-body">`, insérer le banner Gateway requise :

```html
        <div id="gateway-required-banner" class="error-banner hidden">
          La Gateway NPL-SECIB n'est pas configurée. Ouvrez les paramètres (⚙️) pour la configurer avant d'enregistrer un mail.
        </div>
```

Puis, **entre** le form-group Répertoire (qui se termine ligne ~108) et le form-group Nom du fichier (qui commence ligne ~109), insérer :

```html
        <div id="form-group-etape" class="form-group hidden">
          <label for="select-etape-parapheur">Étape parapheur (optionnel)</label>
          <select id="select-etape-parapheur">
            <option value="">Aucune</option>
          </select>
          <p id="etape-hint" class="field-hint hidden">Appliqué uniquement au mail, pas aux pièces jointes.</p>
        </div>
```

- [ ] **Step 2: Vérifier visuellement le rendu**

Recharger l'extension dans Thunderbird. Ouvrir la sidebar, sélectionner un mail et cliquer sur un dossier. Cliquer Enregistrer. Vérifier que :
- La modale s'ouvre
- Le form-group étape est présent mais caché (classe `hidden`) — attendu à ce stade, le JS ne le montre pas encore

- [ ] **Step 3: Commit**

```bash
git add sidebar/sidebar.html
git commit -m "feat(sidebar): form-group étape parapheur + banner Gateway"
```

### Task B4 : Ajouter CSS field-hint et error-banner

**Files:**
- Modify: `sidebar/sidebar.css`

- [ ] **Step 1: Ajouter les classes CSS**

Ouvrir `sidebar/sidebar.css`. À la fin du fichier, ajouter :

```css
/* Hint sous un champ de formulaire */
.field-hint {
  font-size: 11px;
  color: var(--color-text-muted, #888);
  margin: 3px 0 0;
  line-height: 1.4;
  font-style: italic;
}

/* Bandeau d'erreur persistant en haut d'une modale */
.error-banner {
  background: var(--color-error-bg, #fee2e2);
  color: var(--color-error, #b91c1c);
  border: 1px solid #fecaca;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 12px;
  margin-bottom: 10px;
  line-height: 1.4;
}

/* Style select dans form-group (aligné sur input) */
.form-group select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  background: #fff;
}

.form-group select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-light);
}
```

- [ ] **Step 2: Commit**

```bash
git add sidebar/sidebar.css
git commit -m "style(sidebar): classes field-hint, error-banner, select"
```

### Task B5 : Charger étapes parapheur + montrer dropdown dans openSaveModal

**Files:**
- Modify: `sidebar/sidebar.js` (fonction `openSaveModal`, ajouter refs DOM + cache étapes)

- [ ] **Step 1: Ajouter les refs DOM au début du fichier**

Ouvrir `sidebar/sidebar.js`. Dans le bloc de références DOM (vers ligne 35-50), juste après `const selectRepertoire = document.getElementById("select-repertoire");`, ajouter :

```javascript
  const selectEtapeParapheur = document.getElementById("select-etape-parapheur");
  const formGroupEtape = document.getElementById("form-group-etape");
  const etapeHint = document.getElementById("etape-hint");
  const gatewayRequiredBanner = document.getElementById("gateway-required-banner");
```

- [ ] **Step 2: Ajouter un cache mémoire étapes au niveau module**

Juste après le bloc des refs DOM (avant les fonctions), ajouter :

```javascript
  // Cache mémoire des étapes parapheur (durée de vie de la fenêtre)
  let etapesParapheurCache = null;
```

- [ ] **Step 3: Modifier openSaveModal pour charger étapes en parallèle des répertoires**

Localiser la fonction `openSaveModal(dossier)` (ligne ~641). Remplacer le bloc `// Charger les répertoires en arrière-plan` jusqu'au `finally` par :

```javascript
    // Reset étape parapheur
    selectEtapeParapheur.innerHTML = `<option value="">Aucune</option>`;
    selectEtapeParapheur.disabled = true;
    formGroupEtape.classList.add("hidden");
    etapeHint.classList.add("hidden");

    // Charger répertoires + étapes parapheur en parallèle
    const [repsResult, etapesResult] = await Promise.allSettled([
      SecibAPI.getRepertoiresDossier(dossier.dossierId),
      etapesParapheurCache !== null
        ? Promise.resolve(etapesParapheurCache)
        : SecibAPI.getEtapesParapheur(),
    ]);

    // Répertoires
    if (repsResult.status === "fulfilled" && Array.isArray(repsResult.value)) {
      for (const r of repsResult.value) {
        const opt = document.createElement("option");
        opt.value = r.RepertoireId;
        opt.textContent = r.Nom || r.Libelle || `Répertoire #${r.RepertoireId}`;
        selectRepertoire.appendChild(opt);
      }
      const emailRep = repsResult.value.find((r) => isEmailRepertoireName(r.Nom || r.Libelle));
      if (emailRep) {
        selectRepertoire.value = String(emailRep.RepertoireId);
        console.log("[SECIB Link] Répertoire Email pré-sélectionné :", emailRep.Nom || emailRep.Libelle);
      }
    } else if (repsResult.status === "rejected") {
      console.warn("[SECIB Link] Erreur chargement répertoires", repsResult.reason);
    }
    selectRepertoire.disabled = false;

    // Étapes parapheur
    if (etapesResult.status === "fulfilled" && Array.isArray(etapesResult.value) && etapesResult.value.length > 0) {
      etapesParapheurCache = etapesResult.value;
      for (const e of etapesResult.value) {
        const opt = document.createElement("option");
        opt.value = e.Id;
        opt.textContent = e.Libelle || `Étape #${e.Id}`;
        selectEtapeParapheur.appendChild(opt);
      }
      formGroupEtape.classList.remove("hidden");
      selectEtapeParapheur.disabled = false;
    } else if (etapesResult.status === "rejected") {
      console.warn("[SECIB Link] Erreur chargement étapes parapheur", etapesResult.reason);
    }
  }
```

**⚠️** Supprimer l'ancien bloc try/catch/finally sur `getRepertoiresDossier` remplacé ci-dessus. Le dernier `}` correspond à la fermeture de `openSaveModal`.

- [ ] **Step 4: Smoke test — vérifier l'affichage**

Recharger l'extension. Ouvrir la sidebar, sélectionner un mail, cliquer sur un dossier, cliquer Enregistrer. Vérifier :
- Si cabinet a des étapes configurées → dropdown « Étape parapheur (optionnel) » visible avec « Aucune » + étapes
- Si cabinet sans étapes → dropdown caché, modale inchangée
- Si Gateway KO (URL injoignable) → dropdown caché, log console d'erreur

- [ ] **Step 5: Commit**

```bash
git add sidebar/sidebar.js
git commit -m "feat(sidebar): charger étapes parapheur en parallèle des répertoires"
```

### Task B6 : Lire l'étape au save + afficher hint en mode avancé

**Files:**
- Modify: `sidebar/sidebar.js` (fonction `performSave`, handler `checkAdvanced`)

- [ ] **Step 1: Lire l'étape au save**

Dans `performSave` (ligne ~727), juste après la ligne `const repId = selectRepertoire.value ? parseInt(selectRepertoire.value, 10) : null;`, ajouter :

```javascript
    const etapeId = selectEtapeParapheur.value ? parseInt(selectEtapeParapheur.value, 10) : null;
```

- [ ] **Step 2: Propager etapeParapheurId sur l'item "mail" uniquement**

Plus bas, localiser le `uploads.push({ kind: "mail", ... })` (ligne ~744). Ajouter le champ :

```javascript
    uploads.push({
      kind: "mail",
      fileName,
      dossierId: currentDossier.dossierId,
      repertoireId: repId,
      etapeParapheurId: etapeId,
      stripAttachments
    });
```

**Ne PAS ajouter etapeParapheurId au push PJ** (ligne ~760) — conforme à la spec : étape sur .eml uniquement.

- [ ] **Step 3: Propager au saveDocument**

Localiser l'appel `await SecibAPI.saveDocument({...})` dans la boucle `for (const item of uploads)` (ligne ~786). Modifier :

```javascript
        await SecibAPI.saveDocument({
          fileName: item.fileName,
          dossierId: item.dossierId,
          repertoireId: item.repertoireId,
          contentBase64: base64,
          isAnnexe: item.kind === "attachment",
          etapeParapheurId: item.etapeParapheurId || null
        });
```

Sur les items `attachment`, `item.etapeParapheurId` vaut `undefined` → `null` → champ omis côté `saveDocument` (cf. Task B2 step 1 : `if (doc.etapeParapheurId)` garde de falsy).

- [ ] **Step 4: Afficher le hint quand mode avancé est coché**

Localiser le handler `checkAdvanced.addEventListener("change", ...)` dans le fichier (chercher `checkAdvanced`). Dans le handler, après le toggle de `advancedSection`, ajouter :

```javascript
    // Hint étape parapheur : visible uniquement en mode avancé + dropdown étape visible
    if (checkAdvanced.checked && !formGroupEtape.classList.contains("hidden")) {
      etapeHint.classList.remove("hidden");
    } else {
      etapeHint.classList.add("hidden");
    }
```

- [ ] **Step 5: Smoke test**

Recharger l'extension. Tester trois scénarios :
1. Enregistrer un mail **sans étape** → comportement identique à avant (doc dans le dossier sans étape)
2. Enregistrer un mail **avec étape** → vérifier dans SECIB Neo que le doc apparaît à l'étape choisie du parapheur
3. Cocher mode avancé **avec étape choisie** → hint « Appliqué uniquement au mail… » apparaît sous le select

- [ ] **Step 6: Commit**

```bash
git add sidebar/sidebar.js
git commit -m "feat(sidebar): propager EtapeParapheurId au save du mail"
```

### Task B7 : Banner Gateway requise + désactivation bouton Enregistrer

**Files:**
- Modify: `sidebar/sidebar.js` (fonction `openSaveModal`)

- [ ] **Step 1: Ajouter helper gatewayConfigured**

Dans `sidebar/sidebar.js`, juste après le bloc `let etapesParapheurCache = null;` (du Task B5 step 2), ajouter :

```javascript
  async function gatewayConfigured() {
    try {
      const stored = await browser.storage.local.get(["gateway_url", "gateway_api_key"]);
      return Boolean(stored.gateway_url && stored.gateway_api_key);
    } catch {
      return false;
    }
  }
```

- [ ] **Step 2: Vérifier la config au début d'openSaveModal**

Dans `openSaveModal(dossier)`, juste après le bloc de reset de la modale (après la ligne `saveProgressLabel.textContent = "";`, avant `saveModal.classList.remove("hidden");`), ajouter :

```javascript
    // Gateway obligatoire : si absente, bandeau + bouton Enregistrer désactivé
    const gwOk = await gatewayConfigured();
    if (!gwOk) {
      gatewayRequiredBanner.classList.remove("hidden");
      btnModalSave.disabled = true;
    } else {
      gatewayRequiredBanner.classList.add("hidden");
      btnModalSave.disabled = false;
    }
```

Puis, dans le bloc qui charge répertoires + étapes en parallèle (Task B5), **emballer** le `Promise.allSettled` dans un `if (gwOk)` pour ne pas tenter d'appels inutiles :

```javascript
    if (!gwOk) {
      return;  // Rien à charger sans Gateway
    }

    const [repsResult, etapesResult] = await Promise.allSettled([ ... ]);
    // ... reste du code chargement
```

- [ ] **Step 3: Smoke test**

Dans Thunderbird, ouvrir les paramètres SECIB Link et **effacer** l'URL Gateway (laisser vide + enregistrer). Recharger, sélectionner un mail, cliquer un dossier, cliquer Enregistrer. Vérifier :
- Bandeau rouge « La Gateway NPL-SECIB n'est pas configurée… » affiché
- Bouton Enregistrer grisé/désactivé
- Remettre l'URL → modale fonctionne à nouveau

- [ ] **Step 4: Commit**

```bash
git add sidebar/sidebar.js
git commit -m "feat(sidebar): banner Gateway requise + save désactivé si absente"
```

### Task B8 : Mettre à jour README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Ajouter la feature au README**

Ouvrir `README.md`. Dans la section `## Fonctionnalités` (ligne 5), ajouter un bullet après `- **Mode avancé pièces jointes**` :

```markdown
- **Étape parapheur** : possibilité d'associer le mail enregistré à une étape du parapheur SECIB (visible par le collaborateur concerné dans son parapheur Neo)
```

Dans la section `## API SECIB utilisées` (ligne 57), ajouter :

```markdown
- `GET /Document/ListeEtapeParapheur` — étapes de parapheur du cabinet (via Gateway NPL-SECIB)
- `POST /Document/SaveOrUpdateDocument` — enregistrement d'un document avec `EtapeParapheurId` optionnel (via Gateway `POST /api/v1/documents/save-or-update`)
```

Supprimer l'ancienne ligne `- POST /Document/SaveOrUpdateDocument — enregistrement d'un fichier dans un dossier+répertoire` devenue obsolète.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): feature étape parapheur + migration Gateway save"
```

### Task B9 : Bumper la version

**Files:**
- Modify: `manifest.json`
- Modify: `updates.json` (si présent et référence la version)

- [ ] **Step 1: Bump manifest**

Ouvrir `manifest.json`. Remplacer `"version": "1.2.0"` par `"version": "1.3.0"`.

- [ ] **Step 2: Vérifier updates.json**

```bash
grep -n "version" updates.json
```

Si une version `1.2.0` y figure, la remplacer par `1.3.0` (format du fichier à suivre — structure SemVer standard de web-ext).

- [ ] **Step 3: Commit**

```bash
git add manifest.json updates.json
git commit -m "chore(release): bump 1.2.0 → 1.3.0"
```

### Task B10 : Smoke tests manuels finaux

**But :** parcourir la checklist de tests de la spec avant d'ouvrir la PR.

- [ ] **Step 1: Test — mail sans étape**

Recharger l'extension. Sélectionner un mail, cliquer sur un dossier, cliquer Enregistrer, **ne pas choisir d'étape**, cliquer Enregistrer.
Expected : doc `.eml` dans le dossier SECIB, aucune étape parapheur associée. Tag « Enregistré SECIB » posé.

- [ ] **Step 2: Test — mail avec étape**

Même flux, choisir une étape parapheur. Expected : doc dans le dossier + visible dans le parapheur SECIB Neo à l'étape choisie.

- [ ] **Step 3: Test — Gateway non configurée**

Paramètres → effacer URL Gateway → enregistrer. Tenter d'enregistrer un mail. Expected : bandeau rouge, bouton désactivé.

- [ ] **Step 4: Test — cabinet sans étapes**

Difficile à reproduire sans backend de test : simuler en intercept JS console :
```javascript
SecibAPI.getEtapesParapheur = async () => [];
```
Puis rouvrir la modale. Expected : dropdown étape caché, save fonctionne.

- [ ] **Step 5: Test — mode avancé PJ avec étape**

Choisir une étape, cocher mode avancé, router une PJ vers un autre dossier, enregistrer. Expected : `.eml` à l'étape choisie, PJ enregistrée sans étape dans son dossier.

- [ ] **Step 6: Test — re-enregistrement**

Sur un mail déjà enregistré, vérifier que le bandeau « Mail déjà enregistré » apparaît (inchangé).

- [ ] **Step 7: Test — étape invalide entre chargement et save**

Difficile à reproduire sans coup de main côté SECIB. Considéré couvert par le test intégration Gateway (Task A1 step 1, test 422).

### Task B11 : Push + PR SECIB-Link

- [ ] **Step 1: Push**

```bash
git push origin claude/interesting-shtern-f0877f
```

- [ ] **Step 2: Ouvrir/mettre à jour la PR**

Si la PR [#2](https://github.com/Karugency97/secib-link/pull/2) existe déjà (elle contient la spec), les commits seront ajoutés automatiquement. Sinon, créer la PR avec `gh pr create`.

Mettre à jour la description de la PR pour refléter que l'implémentation est là (au-delà de la spec). Marquer les cases « Test plan » de la PR selon les résultats de Task B10.

---

## Self-review checklist

**Spec coverage :**
- ✅ Dropdown étape parapheur optionnel dans modale save → Tasks B3, B5
- ✅ Gateway obligatoire pour save → Task B7
- ✅ Étape sur `.eml` uniquement, pas PJ → Task B6 step 2-3
- ✅ Cache mémoire étapes côté sidebar → Task B5 step 2-3
- ✅ Endpoint Gateway POST /documents/save-or-update → Task A2
- ✅ Tests Gateway (happy path + 400 + 422) → Task A1
- ✅ Bump version 1.2.0 → 1.3.0 → Task B9
- ✅ README + INTEGRATION_GUIDE maj → Tasks B8, A3
- ✅ Hint mode avancé → Task B6 step 4
- ✅ Reset à "Aucune" à chaque ouverture → Task B5 step 3

**Placeholders :** aucun TODO/TBD/« à adapter ». Tout le code est fourni.

**Type consistency :**
- `etapeParapheurId` (camelCase côté sidebar) → mappé vers `EtapeParapheurId` (PascalCase côté SECIB) dans `saveDocument` (Task B2 step 1). Gateway propage le body sans le renommer (passe-plat). OK.
- `selectEtapeParapheur`, `formGroupEtape`, `etapeHint`, `gatewayRequiredBanner` : mêmes noms dans Tasks B3 (HTML id), B5 (JS ref), B6-B7 (usage). OK.
- `etapesParapheurCache` cohérent entre B5 step 2 (declaration) et B5 step 3 (usage).
