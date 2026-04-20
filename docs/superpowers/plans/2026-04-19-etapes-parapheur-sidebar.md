# Étapes parapheur sidebar — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter deux sélecteurs couplés « Étape parapheur » + « Destinataire » (optionnels, ensemble) dans la modale d'enregistrement de la sidebar SECIB-Link, et migrer tout le flux save sidebar vers la Gateway NPL-SECIB.

**Architecture:** Nouvel endpoint Gateway `POST /api/v1/documents/save-or-update` en passe-plat vers `/Document/SaveOrUpdateDocument` côté SECIB, acceptant `EtapeParapheurId` (GUID) et `DestinataireId` (int) optionnels **ensemble**. Côté extension, les dropdowns sont chargés en parallèle des répertoires depuis des endpoints Gateway déjà existants (`/referentiel/etapes-parapheur`, `/referentiel/intervenants`). Le dropdown destinataire reste désactivé tant qu'aucune étape n'est choisie.

**Tech Stack:** TypeScript/Hono (Gateway), Vanilla JS/WebExtensions (sidebar), Vitest (Gateway tests), tests manuels (sidebar).

**Deux repos concernés :**
- Gateway : `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway` (Part A)
- SECIB-Link : working directory courant `/Volumes/KARUG/API SECIB/SECIB-Link/.claude/worktrees/interesting-shtern-f0877f` (Part B)

**Ordre d'exécution :** Part A (Gateway) → Part B (SECIB-Link). La Part B dépend du déploiement de l'endpoint Gateway.

---

## Phase 0 — Validation API SECIB

**Statut** : ✅ **Validée 2026-04-19** (voir spec, section « Findings Phase 0 »).

Findings à retenir pour l'implémentation :

- `/Document/SaveOrUpdateDocument` accepte `EtapeParapheurId` (GUID string) + `DestinataireId` (int) directement dans le body.
- Les deux champs sont **indissociables** — si un seul est fourni, SECIB renvoie `HTTP 400 "BusinessException_EtapeParapheurDestinataireIndisociable"`.
- `DestinataireId` correspond à un `UtilisateurId` tel que renvoyé par `/Utilisateur/ListIntervenant`.
- Les endpoints de lecture (`/referentiel/etapes-parapheur`, `/referentiel/intervenants`) **existent déjà** dans la Gateway avec cache 24h. Aucune modification Gateway côté lecture.

**Nettoyage à faire** : supprimer les docs de probe (`probe-A.txt`, `test-parapheur-phase0.txt`, etc.) dans le dossier TEST (DossierId 164) depuis SECIB Neo UI.

---

## Part A — Gateway NPL-SECIB

**Working directory :** `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway`

### Task A1 : Tests d'intégration failing pour POST /documents/save-or-update

**Files:**
- Modify: `tests/integration/documents.test.ts` (ajouter un bloc describe en fin de fichier)

- [ ] **Step 1: Ajouter les tests failing**

Ouvrir `tests/integration/documents.test.ts` et ajouter avant la dernière accolade fermante `});` (fin du `describe('documents routes', ...)`) :

```typescript
  describe('POST /documents/save-or-update', () => {
    const ETAPE_ID = 'c65c248e-e1b9-4f45-a0b5-b41a00d744cb'; // GUID fixture
    const DEST_ID = 3;

    it('pass-through SaveOrUpdateDocument sans étape ni destinataire', async () => {
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Document/SaveOrUpdateDocument', method: 'POST' })
        .reply(200, { DocumentId: 'f666a2db-0060-4a97-88c4-b43101810f4f', FileName: 'mail.eml' });

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
      expect(await res.json()).toEqual({
        data: { DocumentId: 'f666a2db-0060-4a97-88c4-b43101810f4f', FileName: 'mail.eml' },
      });
    });

    it('propage EtapeParapheurId + DestinataireId au body SECIB quand fournis ensemble', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Document/SaveOrUpdateDocument', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return { DocumentId: 'f666a2db-0060-4a97-88c4-b43101810f4f' };
        });

      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          FileName: 'mail.eml',
          DossierId: 1911,
          Content: 'QUFB',
          IsAnnexe: false,
          EtapeParapheurId: ETAPE_ID,
          DestinataireId: DEST_ID,
        }),
      });

      expect(res.status).toBe(200);
      expect(forwardedBody).toMatchObject({
        EtapeParapheurId: ETAPE_ID,
        DestinataireId: DEST_ID,
      });
    });

    it('400 etape_destinataire_indissociable si EtapeParapheurId sans DestinataireId', async () => {
      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          FileName: 'mail.eml',
          DossierId: 1911,
          Content: 'QUFB',
          IsAnnexe: false,
          EtapeParapheurId: ETAPE_ID,
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'etape_destinataire_indissociable' } });
    });

    it('400 etape_destinataire_indissociable si DestinataireId sans EtapeParapheurId', async () => {
      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          FileName: 'mail.eml',
          DossierId: 1911,
          Content: 'QUFB',
          IsAnnexe: false,
          DestinataireId: DEST_ID,
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'etape_destinataire_indissociable' } });
    });

    it('400 invalid_json sur body non-JSON', async () => {
      const res = await app.request('/documents/save-or-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'invalid_json' } });
    });

    it('propage 422 secib_client_error quand SECIB refuse (étape inconnue)', async () => {
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
          EtapeParapheurId: '00000000-0000-0000-0000-000000000000',
          DestinataireId: DEST_ID,
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
Expected : 6 tests FAIL (404 not found — la route n'existe pas encore).

### Task A2 : Implémenter la route avec validation both-or-neither

**Files:**
- Modify: `src/routes/documents.ts` (ajouter une route avant le `return r`)

- [ ] **Step 1: Ajouter la route dans documents.ts**

Ouvrir `src/routes/documents.ts`. Juste après la route `POST /` existante (qui map `UploadDocument`, vers ligne 104), ajouter :

```typescript
  // POST /documents/save-or-update — pass-through SaveOrUpdateDocument
  // Accepte EtapeParapheurId (GUID) + DestinataireId (int) optionnels mais indissociables.
  r.post('/save-or-update', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return fail(c, 400, 'invalid_json');
    }
    const hasEtape = body.EtapeParapheurId !== undefined && body.EtapeParapheurId !== null;
    const hasDest = body.DestinataireId !== undefined && body.DestinataireId !== null;
    if (hasEtape !== hasDest) {
      return fail(
        c,
        400,
        'etape_destinataire_indissociable',
        'EtapeParapheurId et DestinataireId doivent être fournis ensemble',
      );
    }
    const res = await deps.secib.request('POST', '/Document/SaveOrUpdateDocument', { body });
    if (!res.ok) return failSecib(c, res);
    return ok(c, res.data);
  });
```

- [ ] **Step 2: Lancer les tests — vérifier qu'ils passent**

```bash
npx vitest run tests/integration/documents.test.ts -t "POST /documents/save-or-update"
```
Expected : 6 tests PASS.

- [ ] **Step 3: Lancer la suite complète pour vérifier l'absence de régression**

```bash
npx vitest run
```
Expected : tous les tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/documents.ts tests/integration/documents.test.ts
git commit -m "feat(documents): route POST /save-or-update avec étape+destinataire"
```

### Task A3 : Documenter le nouvel endpoint

**Files:**
- Modify: `docs/INTEGRATION_GUIDE.md` (section 5.7 Documents)

- [ ] **Step 1: Ajouter l'endpoint au tableau**

Dans la section 5.7 Documents, juste après la ligne `POST | /documents | ... | Upload un document`, ajouter :

```markdown
| POST | `/documents/save-or-update` | Body SECIB `SaveOrUpdateDocument` (+ `EtapeParapheurId` GUID / `DestinataireId` int optionnels ensemble) | non | Enregistre un document avec étape parapheur + destinataire optionnels |
```

- [ ] **Step 2: Ajouter une section usage (§ 6.6)**

Juste après la fin de la section § 6.5 (contenu binaire), ajouter :

```markdown
### 6.6 Enregistrement d'un mail avec étape parapheur (`POST /documents/save-or-update`)

Utilisé par l'extension Thunderbird SECIB-Link. Permet d'enregistrer un `.eml` en l'associant optionnellement à une étape du parapheur SECIB et à un destinataire — le document apparaît ensuite dans le parapheur du collaborateur ciblé à l'étape choisie.

**Body** :
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

**Contraintes**
- `EtapeParapheurId` (GUID) et `DestinataireId` (int) sont optionnels mais **indissociables** — fournir l'un sans l'autre → `400 etape_destinataire_indissociable` (validé côté Gateway, pas d'appel SECIB).
- La liste des `EtapeParapheurId` valides se récupère via `GET /referentiel/etapes-parapheur` (cache 24h).
- La liste des `DestinataireId` valides (= `UtilisateurId` d'intervenants) se récupère via `GET /referentiel/intervenants` (cache 24h).

**Réponses :**
- `200 { data: { DocumentId, ... } }` — pass-through de la réponse SECIB.
- `400 invalid_json` — body JSON invalide.
- `400 etape_destinataire_indissociable` — un seul des deux champs parapheur fourni.
- `422 secib_client_error` — SECIB rejette (étape/destinataire inconnu, etc.) ; message SECIB dans `error.message`.
- `502 secib_upstream` — échec upstream SECIB.

**Exemple client** :

```js
const res = await fetch(`${GW}/api/v1/documents/save-or-update`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-API-Key': KEY },
  body: JSON.stringify({
    FileName, DossierId, RepertoireId, Content, IsAnnexe: false,
    EtapeParapheurId, DestinataireId,
  }),
});
```
```

- [ ] **Step 3: Commit**

```bash
git add docs/INTEGRATION_GUIDE.md
git commit -m "docs(guide): endpoint POST /documents/save-or-update avec destinataire"
```

### Task A4 : Push Gateway + PR

- [ ] **Step 1: Pousser la branche**

Depuis `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway` :

```bash
git checkout -b feat/documents-save-or-update
git push -u origin feat/documents-save-or-update
```

- [ ] **Step 2: Ouvrir la PR**

```bash
gh pr create --title "feat(documents): POST /save-or-update avec étape parapheur + destinataire" --body "$(cat <<'EOF'
## Summary

- Nouvel endpoint \`POST /api/v1/documents/save-or-update\` en passe-plat vers \`/Document/SaveOrUpdateDocument\` côté SECIB.
- Accepte les champs optionnels \`EtapeParapheurId\` (GUID) et \`DestinataireId\` (int), propagés tels quels à SECIB.
- Validation **both-or-neither** côté Gateway : erreur 400 \`etape_destinataire_indissociable\` si un seul des deux est fourni (contrainte SECIB métier, surfacée côté client sans coût d'appel upstream).
- 6 tests d'intégration : happy paths avec/sans parapheur, validation both-or-neither, body invalide, propagation 422 SECIB.

## Context

Utilisé par l'extension SECIB-Link (Thunderbird) pour associer un mail enregistré à une étape du parapheur **et** à un destinataire — permet de déléguer le traitement à un collaborateur sans quitter Thunderbird.

Phase 0 validation (2026-04-19) a confirmé :
- \`SaveOrUpdateDocument\` accepte bien les deux champs au top-level du body
- La contrainte d'indissociabilité est une règle métier SECIB (\`BusinessException_EtapeParapheurDestinataireIndisociable\`)

Voir spec SECIB-Link : \`docs/superpowers/specs/2026-04-19-etapes-parapheur-sidebar-design.md\`.

## Test plan

- [x] \`npx vitest run\` — toute la suite passe
- [ ] Test manuel en staging : appel avec EtapeParapheurId + DestinataireId valides → doc visible au parapheur du destinataire dans SECIB Neo
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

### Task B2 : Migrer saveDocument + ajouter getEtapesParapheur + getIntervenants

**Files:**
- Modify: `sidebar/secib-api.js` (fonction `saveDocument`, nouvelles `getEtapesParapheur` et `getIntervenants`, export)

- [ ] **Step 1: Remplacer saveDocument pour passer via Gateway avec étape+destinataire**

Dans `sidebar/secib-api.js`, localiser la fonction `saveDocument` (vers ligne 293). Remplacer **entièrement** la fonction par :

```javascript
  /**
   * Enregistre un document dans un dossier via la Gateway.
   * @param {object} doc - { fileName, dossierId, repertoireId?, contentBase64, isAnnexe?, etapeParapheurId?, destinataireId? }
   * Note : etapeParapheurId (GUID) et destinataireId (int) doivent être fournis ensemble ou pas du tout (contrainte SECIB).
   */
  async function saveDocument(doc) {
    const body = {
      FileName: doc.fileName,
      DossierId: doc.dossierId,
      Content: doc.contentBase64,
      IsAnnexe: doc.isAnnexe || false
    };
    if (doc.repertoireId) body.RepertoireId = doc.repertoireId;
    if (doc.etapeParapheurId && doc.destinataireId) {
      body.EtapeParapheurId = doc.etapeParapheurId;
      body.DestinataireId = doc.destinataireId;
    }

    return gatewayPost("/documents/save-or-update", body);
  }
```

- [ ] **Step 2: Ajouter getEtapesParapheur et getIntervenants**

Dans le même fichier, juste après `saveDocument`, ajouter :

```javascript
  /**
   * Liste les étapes du parapheur configurées par le cabinet via la Gateway.
   * Renvoie un tableau d'objets { EtapeParapheurId, Libelle } ou [] si cabinet sans étapes.
   */
  async function getEtapesParapheur() {
    const res = await gatewayCall("/referentiel/etapes-parapheur");
    return Array.isArray(res) ? res : [];
  }

  /**
   * Liste les intervenants (utilisateurs) du cabinet via la Gateway.
   * Renvoie un tableau d'objets { UtilisateurId, Nom, Prenom, NomComplet, Login, ... }.
   */
  async function getIntervenants() {
    const res = await gatewayCall("/referentiel/intervenants");
    return Array.isArray(res) ? res : [];
  }
```

- [ ] **Step 3: Exporter les nouvelles fonctions**

Repérer le `return { ... }` final de l'IIFE (vers ligne 305-330). Ajouter `getEtapesParapheur` et `getIntervenants` dans l'objet exporté :

```javascript
    getDocumentContent,
    getEtapesParapheur,
    getIntervenants,
    saveDocument,
```

- [ ] **Step 4: Smoke test — recharger l'extension et vérifier en console**

Dans Thunderbird : `about:debugging` → Recharger SECIB Link. Ouvrir la sidebar, DevTools, console :
```javascript
(await SecibAPI.getEtapesParapheur()).slice(0, 3)
(await SecibAPI.getIntervenants()).slice(0, 3)
```
Expected : chacun renvoie un tableau court d'objets SECIB. Sinon erreur `GATEWAY_CONFIG_MISSING` (pas configurée) ou erreur réseau.

- [ ] **Step 5: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): saveDocument via Gateway + getEtapesParapheur + getIntervenants"
```

### Task B3 : Ajouter form-groups étape + destinataire + banner (HTML)

**Files:**
- Modify: `sidebar/sidebar.html` (modale save)

- [ ] **Step 1: Ajouter les form-groups et le banner**

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
        </div>

        <div id="form-group-destinataire" class="form-group hidden">
          <label for="select-destinataire">Destinataire (requis si étape)</label>
          <select id="select-destinataire" disabled>
            <option value="">— choisir un collaborateur —</option>
          </select>
          <p id="destinataire-hint" class="field-hint hidden">Appliqué uniquement au mail, pas aux pièces jointes.</p>
        </div>
```

- [ ] **Step 2: Vérifier visuellement le rendu**

Recharger l'extension dans Thunderbird. Ouvrir la sidebar, sélectionner un mail et cliquer sur un dossier. Cliquer Enregistrer. Vérifier que :
- La modale s'ouvre
- Les deux form-groups sont présents mais cachés (classe `hidden`) — attendu à ce stade, le JS ne les montre pas encore

- [ ] **Step 3: Commit**

```bash
git add sidebar/sidebar.html
git commit -m "feat(sidebar): form-groups étape + destinataire + banner Gateway"
```

### Task B4 : Ajouter CSS field-hint, error-banner, select

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

.form-group select:disabled {
  background: #f5f5f5;
  color: #999;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Commit**

```bash
git add sidebar/sidebar.css
git commit -m "style(sidebar): classes field-hint, error-banner, select"
```

### Task B5 : Charger étapes + intervenants en parallèle et peupler les dropdowns

**Files:**
- Modify: `sidebar/sidebar.js` (refs DOM + caches + modification `openSaveModal`)

- [ ] **Step 1: Ajouter les refs DOM au début du fichier**

Ouvrir `sidebar/sidebar.js`. Dans le bloc de références DOM (vers ligne 35-50), juste après `const selectRepertoire = document.getElementById("select-repertoire");`, ajouter :

```javascript
  const selectEtapeParapheur = document.getElementById("select-etape-parapheur");
  const selectDestinataire = document.getElementById("select-destinataire");
  const formGroupEtape = document.getElementById("form-group-etape");
  const formGroupDestinataire = document.getElementById("form-group-destinataire");
  const destinataireHint = document.getElementById("destinataire-hint");
  const gatewayRequiredBanner = document.getElementById("gateway-required-banner");
```

- [ ] **Step 2: Ajouter les caches mémoire au niveau module**

Juste après le bloc des refs DOM (avant les fonctions), ajouter :

```javascript
  // Caches mémoire (durée de vie de la fenêtre)
  let etapesParapheurCache = null;
  let intervenantsCache = null;
```

- [ ] **Step 3: Ajouter helper gatewayConfigured au niveau module**

Juste après les caches, ajouter :

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

- [ ] **Step 4: Modifier openSaveModal pour charger étapes+intervenants en parallèle des répertoires**

Localiser la fonction `openSaveModal(dossier)` (ligne ~641). Remplacer **entièrement** le corps de la fonction par :

```javascript
  async function openSaveModal(dossier) {
    if (!currentMessage) {
      alert("Aucun message sélectionné.");
      return;
    }
    currentDossier = dossier;
    saveModalTitle.textContent = `Enregistrer dans ${dossier.code}`;
    saveFeedback.classList.add("hidden");

    // Nom de fichier proposé
    const safeSubject = (currentMessage.subject || "Mail")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .substring(0, 80)
      .trim();
    inputFilename.value = `${safeSubject}.eml`;

    // Reset répertoire
    selectRepertoire.innerHTML = `<option value="">Racine du dossier</option>`;
    selectRepertoire.disabled = true;

    // Reset étape + destinataire
    selectEtapeParapheur.innerHTML = `<option value="">Aucune</option>`;
    selectEtapeParapheur.disabled = true;
    selectDestinataire.innerHTML = `<option value="">— choisir un collaborateur —</option>`;
    selectDestinataire.disabled = true;
    formGroupEtape.classList.add("hidden");
    formGroupDestinataire.classList.add("hidden");
    destinataireHint.classList.add("hidden");

    // Reset mode avancé
    checkAdvanced.checked = false;
    checkStripAttachments.checked = false;
    advancedSection.classList.add("hidden");
    attachmentsTable.classList.add("hidden");
    attachmentsEmpty.classList.add("hidden");
    attachmentsLoading.classList.add("hidden");
    attachmentsTbody.innerHTML = "";
    attachmentsState = [];
    advancedLoaded = false;
    repertoireCache.clear();
    saveProgress.classList.add("hidden");
    saveProgressFill.style.width = "0%";
    saveProgressLabel.textContent = "";

    // Gateway obligatoire : si absente, bandeau + bouton Enregistrer désactivé
    const gwOk = await gatewayConfigured();
    if (!gwOk) {
      gatewayRequiredBanner.classList.remove("hidden");
      btnModalSave.disabled = true;
    } else {
      gatewayRequiredBanner.classList.add("hidden");
      btnModalSave.disabled = false;
    }

    saveModal.classList.remove("hidden");

    if (!gwOk) {
      return; // Rien à charger sans Gateway
    }

    // Charger répertoires + étapes parapheur + intervenants en parallèle
    const [repsResult, etapesResult, intervenantsResult] = await Promise.allSettled([
      SecibAPI.getRepertoiresDossier(dossier.dossierId),
      etapesParapheurCache !== null
        ? Promise.resolve(etapesParapheurCache)
        : SecibAPI.getEtapesParapheur(),
      intervenantsCache !== null
        ? Promise.resolve(intervenantsCache)
        : SecibAPI.getIntervenants(),
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

    // Étapes + intervenants : les deux doivent être OK, sinon on cache les deux form-groups
    const etapesOk = etapesResult.status === "fulfilled"
      && Array.isArray(etapesResult.value)
      && etapesResult.value.length > 0;
    const intervenantsOk = intervenantsResult.status === "fulfilled"
      && Array.isArray(intervenantsResult.value)
      && intervenantsResult.value.length > 0;

    if (etapesOk && intervenantsOk) {
      etapesParapheurCache = etapesResult.value;
      intervenantsCache = intervenantsResult.value;

      for (const e of etapesResult.value) {
        const opt = document.createElement("option");
        opt.value = e.EtapeParapheurId;
        opt.textContent = e.Libelle || `Étape ${e.EtapeParapheurId}`;
        selectEtapeParapheur.appendChild(opt);
      }
      for (const u of intervenantsResult.value) {
        const opt = document.createElement("option");
        opt.value = u.UtilisateurId;
        opt.textContent = u.NomComplet || `${u.Prenom || ""} ${u.Nom || ""}`.trim() || u.Login || `Utilisateur #${u.UtilisateurId}`;
        selectDestinataire.appendChild(opt);
      }

      formGroupEtape.classList.remove("hidden");
      formGroupDestinataire.classList.remove("hidden");
      selectEtapeParapheur.disabled = false;
      // selectDestinataire reste disabled tant qu'aucune étape n'est choisie (cf. Task B6)
    } else {
      if (etapesResult.status === "rejected") {
        console.warn("[SECIB Link] Erreur chargement étapes parapheur", etapesResult.reason);
      }
      if (intervenantsResult.status === "rejected") {
        console.warn("[SECIB Link] Erreur chargement intervenants", intervenantsResult.reason);
      }
    }
  }
```

- [ ] **Step 5: Smoke test — vérifier l'affichage**

Recharger l'extension. Sélectionner un mail, cliquer un dossier, cliquer Enregistrer. Vérifier :
- Les deux dropdowns (Étape parapheur + Destinataire) sont visibles
- Étape parapheur contient « Aucune » + les étapes du cabinet
- Destinataire est **désactivé** (gris) et contient « — choisir un collaborateur — » + la liste des intervenants (désactivé pour l'instant, activation en B6)

- [ ] **Step 6: Commit**

```bash
git add sidebar/sidebar.js
git commit -m "feat(sidebar): charger étapes + intervenants en parallèle des répertoires"
```

### Task B6 : Couplage étape ⇄ destinataire + validation au save

**Files:**
- Modify: `sidebar/sidebar.js` (listener sur selectEtapeParapheur, handler checkAdvanced, fonction performSave)

- [ ] **Step 1: Ajouter un listener qui couple étape → destinataire**

Dans `sidebar/sidebar.js`, juste après la définition de `openSaveModal` (ou à côté des autres listeners en bas du fichier), ajouter :

```javascript
  // Quand une étape est choisie, activer le select destinataire. Sinon le désactiver et vider.
  selectEtapeParapheur.addEventListener("change", () => {
    if (selectEtapeParapheur.value) {
      selectDestinataire.disabled = false;
    } else {
      selectDestinataire.disabled = true;
      selectDestinataire.value = "";
    }
  });
```

- [ ] **Step 2: Lire étape + destinataire au save + valider le couplage**

Dans `performSave` (ligne ~727), juste après `const repId = selectRepertoire.value ? parseInt(selectRepertoire.value, 10) : null;`, ajouter :

```javascript
    const etapeId = selectEtapeParapheur.value || null;
    const destinataireId = selectDestinataire.value ? parseInt(selectDestinataire.value, 10) : null;

    // Validation client-side : étape sans destinataire → erreur (contrainte SECIB)
    if (etapeId && !destinataireId) {
      showSaveFeedback("error", "Choisissez un destinataire pour l'étape parapheur");
      return;
    }
```

- [ ] **Step 3: Propager au push de l'item "mail"**

Plus bas, localiser le `uploads.push({ kind: "mail", ... })` (ligne ~744). Ajouter les champs :

```javascript
    uploads.push({
      kind: "mail",
      fileName,
      dossierId: currentDossier.dossierId,
      repertoireId: repId,
      etapeParapheurId: etapeId,
      destinataireId: destinataireId,
      stripAttachments
    });
```

**Ne PAS ajouter ces champs au push PJ** (ligne ~760) — conforme à la spec : étape+destinataire sur `.eml` uniquement.

- [ ] **Step 4: Propager au saveDocument**

Localiser l'appel `await SecibAPI.saveDocument({...})` dans la boucle `for (const item of uploads)` (ligne ~786). Modifier :

```javascript
        await SecibAPI.saveDocument({
          fileName: item.fileName,
          dossierId: item.dossierId,
          repertoireId: item.repertoireId,
          contentBase64: base64,
          isAnnexe: item.kind === "attachment",
          etapeParapheurId: item.etapeParapheurId || null,
          destinataireId: item.destinataireId || null
        });
```

Sur les items `attachment`, ces champs valent `undefined` → `null` → omis côté `saveDocument` (cf. Task B2 step 1 : `if (doc.etapeParapheurId && doc.destinataireId)`).

- [ ] **Step 5: Afficher le hint quand mode avancé est coché**

Localiser le handler `checkAdvanced.addEventListener("change", ...)` dans le fichier (chercher `checkAdvanced`). Dans le handler, après le toggle de `advancedSection`, ajouter :

```javascript
    // Hint destinataire : visible uniquement en mode avancé + dropdowns étape/destinataire visibles
    if (checkAdvanced.checked && !formGroupDestinataire.classList.contains("hidden")) {
      destinataireHint.classList.remove("hidden");
    } else {
      destinataireHint.classList.add("hidden");
    }
```

- [ ] **Step 6: Smoke test**

Recharger l'extension. Tester quatre scénarios :
1. Enregistrer mail **sans étape** (étape = Aucune) → comportement identique à avant, ni étape ni destinataire côté SECIB.
2. Choisir une étape sans destinataire → tenter Enregistrer → bandeau rouge « Choisissez un destinataire… », rien n'est envoyé.
3. Choisir étape + destinataire → Enregistrer → doc visible au parapheur du destinataire à l'étape choisie dans SECIB Neo.
4. Cocher mode avancé avec étape/destinataire choisis → hint apparaît sous le select destinataire.

- [ ] **Step 7: Commit**

```bash
git add sidebar/sidebar.js
git commit -m "feat(sidebar): couplage étape+destinataire et validation au save"
```

### Task B7 : Mettre à jour README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Ajouter la feature au README**

Ouvrir `README.md`. Dans la section `## Fonctionnalités` (ligne 5), ajouter un bullet après `- **Mode avancé pièces jointes**` :

```markdown
- **Étape parapheur + destinataire** : possibilité d'associer le mail enregistré à une étape du parapheur SECIB et à un destinataire collaborateur (le mail apparaît dans le parapheur du destinataire à l'étape choisie)
```

Dans la section `## API SECIB utilisées` (ligne 57), remplacer les lignes actuelles par :

```markdown
- `POST /Personne/Get` — recherche tiers (Coordonnees / Denomination)
- `GET /Partie/GetByPersonneId` — dossiers d'une personne
- `POST /Dossier/GetDossiers` — recherche libre de dossiers (Code / Nom)
- `GET /Document/GetListRepertoireDossier` — répertoires d'un dossier
- `GET /Document/ListeEtapeParapheur` — étapes de parapheur du cabinet (via Gateway NPL-SECIB, cache 24h)
- `GET /Utilisateur/ListIntervenant` — intervenants du cabinet (via Gateway NPL-SECIB, cache 24h)
- `POST /Document/SaveOrUpdateDocument` — enregistrement d'un document avec `EtapeParapheurId` + `DestinataireId` optionnels (via Gateway `POST /api/v1/documents/save-or-update`)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): feature étape parapheur + destinataire et migration Gateway save"
```

### Task B8 : Bumper la version

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

### Task B9 : Smoke tests manuels finaux

**But :** parcourir la checklist de tests de la spec avant d'ouvrir la PR.

- [ ] **Step 1: Test — mail sans étape**

Recharger l'extension. Sélectionner un mail, cliquer sur un dossier, cliquer Enregistrer, laisser étape = « Aucune », cliquer Enregistrer.
Expected : doc `.eml` dans le dossier SECIB, aucun parapheur associé. Tag « Enregistré SECIB » posé.

- [ ] **Step 2: Test — mail avec étape + destinataire**

Même flux, choisir étape + destinataire. Expected : doc dans le dossier + visible dans le parapheur du destinataire à l'étape choisie dans SECIB Neo.

- [ ] **Step 3: Test — étape sans destinataire (validation client-side)**

Choisir étape, ne pas choisir destinataire, cliquer Enregistrer. Expected : bandeau rouge « Choisissez un destinataire pour l'étape parapheur », aucun appel Gateway (vérifier dans l'onglet Network/console).

- [ ] **Step 4: Test — étape remise à « Aucune »**

Choisir étape → destinataire s'active → choisir destinataire → remettre étape à « Aucune ». Expected : destinataire se remet à « — choisir un collaborateur — » et se désactive automatiquement.

- [ ] **Step 5: Test — Gateway non configurée**

Paramètres → effacer URL Gateway → enregistrer. Tenter d'enregistrer un mail. Expected : bandeau rouge, bouton désactivé, dropdowns cachés.

- [ ] **Step 6: Test — cabinet sans étapes**

Difficile à reproduire sans backend de test : simuler en intercept JS console :
```javascript
SecibAPI.getEtapesParapheur = async () => [];
```
Puis rouvrir la modale. Expected : les deux dropdowns (étape + destinataire) cachés, save fonctionne sans parapheur.

- [ ] **Step 7: Test — mode avancé PJ avec étape+destinataire**

Choisir étape + destinataire, cocher mode avancé, router une PJ vers un autre dossier, enregistrer. Expected : `.eml` au parapheur du destinataire à l'étape choisie, PJ enregistrée sans parapheur dans son dossier.

- [ ] **Step 8: Test — re-enregistrement**

Sur un mail déjà enregistré, vérifier que le bandeau « Mail déjà enregistré » apparaît (inchangé).

### Task B10 : Push + PR SECIB-Link

- [ ] **Step 1: Push**

```bash
git push origin claude/interesting-shtern-f0877f
```

- [ ] **Step 2: Mettre à jour la PR existante**

La PR [#2](https://github.com/Karugency97/secib-link/pull/2) existe déjà (elle contient la spec + plan). Les nouveaux commits seront ajoutés automatiquement au push.

Mettre à jour la description de la PR pour refléter que l'implémentation est là (au-delà de la spec/plan). Marquer les cases « Test plan » selon les résultats de Task B9.

---

## Self-review checklist

**Spec coverage :**
- ✅ Dropdown étape parapheur + dropdown destinataire → Tasks B3, B5
- ✅ Couplage étape ⇄ destinataire (activation conditionnelle) → Task B6 step 1
- ✅ Validation client-side étape sans destinataire → Task B6 step 2
- ✅ Gateway obligatoire pour save → Task B5 step 4 (gatewayConfigured + banner)
- ✅ Étape+destinataire sur `.eml` uniquement, pas PJ → Task B6 steps 3-4
- ✅ Caches mémoire étapes + intervenants → Task B5 steps 2 et 4
- ✅ Endpoint Gateway POST /documents/save-or-update → Task A2
- ✅ Validation both-or-neither côté Gateway → Task A2 step 1
- ✅ Tests Gateway (happy paths, both-or-neither, 400, 422) → Task A1
- ✅ Bump version 1.2.0 → 1.3.0 → Task B8
- ✅ README + INTEGRATION_GUIDE maj → Tasks B7, A3
- ✅ Hint mode avancé → Task B6 step 5
- ✅ Reset à "Aucune" à chaque ouverture → Task B5 step 4

**Placeholders :** aucun TODO/TBD/« à adapter ». Tout le code est fourni.

**Type consistency :**
- `etapeParapheurId` (camelCase, **GUID string** côté sidebar) → `EtapeParapheurId` côté SECIB (Task B2 step 1). Gateway propage sans renommer.
- `destinataireId` (camelCase, **int** côté sidebar) → `DestinataireId` côté SECIB.
- Convention both-or-neither : `if (doc.etapeParapheurId && doc.destinataireId)` dans `saveDocument` (B2) correspond à la validation Gateway (`hasEtape !== hasDest` en A2) — si un seul falsy, les deux sont omis/rejetés.
- `selectEtapeParapheur`, `selectDestinataire`, `formGroupEtape`, `formGroupDestinataire`, `destinataireHint`, `gatewayRequiredBanner` : mêmes noms dans Tasks B3 (HTML id), B5 (JS ref), B6 (usage).
- `etapesParapheurCache`, `intervenantsCache` cohérents entre B5 step 2 et step 4.
