# Full Gateway migration — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Router 100 % des appels API de l'extension SECIB-Link via la Gateway NPL-SECIB, supprimer l'OAuth2 client-side, simplifier la config à 2 champs (Gateway URL + API Key), bump 1.3.0 → 2.0.0.

**Architecture:** Deux étapes. Part C ajoute 4 query params optionnels à deux routes Gateway existantes (`GET /personnes` avec `coordonnees` + `denomination`, `GET /dossiers` avec `code` + `nom`) en préservant la backward-compat (`?q=` toujours supporté). Part D migre les 8 fonctions sidebar encore sur OAuth2 direct vers Gateway, supprime le code OAuth2 mort, et simplifie la settings UI.

**Tech Stack:** TypeScript/Hono/Vitest (Gateway), Vanilla JS/WebExtensions (sidebar), tests manuels (extension).

**Deux repos concernés :**
- Gateway : `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway` (Part C)
- SECIB-Link : working directory courant (Part D)

**Ordre d'exécution :** Part C (Gateway) → merge + deploy → Part D (extension).

**Branche Part D :** `claude/interesting-shtern-f0877f` (continue sur la même branche que parapheur, même PR #2).

---

## Part C — Gateway v2 enhancements

**Working directory :** `/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway`
**Branche :** nouvelle `feat/gateway-search-filters` (depuis `main` post-Part-A-mergée).

### Task C1 : Tests failing pour filtres `/personnes`

**Files:**
- Modify: `tests/integration/personnes.test.ts`

- [ ] **Step 1 : Ajouter les tests**

Dans le `describe` existant de `personnes.test.ts`, ajouter un bloc :

```typescript
  describe('filtres spécifiques (coordonnees, denomination)', () => {
    it('GET /personnes?coordonnees=a@b.com — passe Coordonnees au body SECIB', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Personne/Get', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      const res = await app.request('/personnes?coordonnees=a%40b.com&limit=5');
      expect(res.status).toBe(200);
      expect(forwardedBody).toMatchObject({ Coordonnees: 'a@b.com', NbMax: 5 });
      expect(forwardedBody).not.toHaveProperty('RechercheGenerique');
      expect(forwardedBody).not.toHaveProperty('Denomination');
    });

    it('GET /personnes?denomination=Dupont — passe Denomination au body SECIB', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Personne/Get', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      const res = await app.request('/personnes?denomination=Dupont&limit=10');
      expect(res.status).toBe(200);
      expect(forwardedBody).toMatchObject({ Denomination: 'Dupont', NbMax: 10 });
    });

    it('GET /personnes?coordonnees=a&denomination=b&q=c — coordonnees gagne', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Personne/Get', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      await app.request('/personnes?coordonnees=a&denomination=b&q=c');
      expect(forwardedBody).toMatchObject({ Coordonnees: 'a' });
      expect(forwardedBody).not.toHaveProperty('Denomination');
      expect(forwardedBody).not.toHaveProperty('RechercheGenerique');
    });

    it('GET /personnes?q=Dupont — comportement existant inchangé', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Personne/Get', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      await app.request('/personnes?q=Dupont&limit=20');
      expect(forwardedBody).toMatchObject({ RechercheGenerique: 'Dupont', NbMax: 20 });
      expect(forwardedBody).not.toHaveProperty('Coordonnees');
      expect(forwardedBody).not.toHaveProperty('Denomination');
    });
  });
```

- [ ] **Step 2 : Lancer — vérifier qu'ils échouent**

```bash
cd "/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway"
git checkout -b feat/gateway-search-filters
npx vitest run tests/integration/personnes.test.ts -t "filtres spécifiques"
```
Expected : 4 tests FAIL (le code actuel passe toujours `RechercheGenerique`).

### Task C2 : Implémenter filtres `/personnes`

**Files:**
- Modify: `src/routes/personnes.ts` (route `GET /`)

- [ ] **Step 1 : Remplacer la route `GET /`**

Dans `src/routes/personnes.ts`, remplacer le handler `r.get('/', async (c) => { ... })` par :

```typescript
  // GET /personnes — recherche, avec filtres spécifiques optionnels (précédence : coordonnees > denomination > q)
  r.get('/', async (c) => {
    const coordonnees = c.req.query('coordonnees');
    const denomination = c.req.query('denomination');
    const q = c.req.query('q');
    const type = c.req.query('type') ?? 'PP';
    const limit = Number.parseInt(c.req.query('limit') ?? '20', 10);

    const body: Record<string, unknown> = { TypePersonne: type, NbMax: limit };
    if (coordonnees) {
      body.Coordonnees = coordonnees;
    } else if (denomination) {
      body.Denomination = denomination;
    } else {
      body.RechercheGenerique = q ?? '';
    }

    const res = await deps.secib.request('POST', '/Personne/Get', { body });
    if (!res.ok) return failSecib(c, res);
    return ok(c, res.data);
  });
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils passent**

```bash
npx vitest run tests/integration/personnes.test.ts -t "filtres spécifiques"
```
Expected : 4 tests PASS.

- [ ] **Step 3 : Suite complète**

```bash
npx vitest run
```
Expected : tous PASS (aucune régression sur les tests existants).

- [ ] **Step 4 : Commit**

```bash
git add src/routes/personnes.ts tests/integration/personnes.test.ts
git commit -m "feat(personnes): filtres coordonnees + denomination avec précédence"
```

Heredoc + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

### Task C3 : Tests failing pour filtres `/dossiers`

**Files:**
- Modify: `tests/integration/dossiers.test.ts`

- [ ] **Step 1 : Ajouter les tests**

Dans `tests/integration/dossiers.test.ts`, ajouter un `describe` :

```typescript
  describe('filtres spécifiques (code, nom)', () => {
    it('GET /dossiers?code=DOS-2104.0167 — passe Code au body GetDossiers', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Dossier/GetDossiers', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      const res = await app.request('/dossiers?code=DOS-2104.0167&limit=5');
      expect(res.status).toBe(200);
      expect(forwardedBody).toMatchObject({ Code: 'DOS-2104.0167' });
      expect(forwardedBody).not.toHaveProperty('RechercheGenerique');
      expect(forwardedBody).not.toHaveProperty('Nom');
    });

    it('GET /dossiers?nom=Dossier%20TEST — passe Nom au body GetDossiers', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Dossier/GetDossiers', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      await app.request('/dossiers?nom=Dossier%20TEST&limit=15');
      expect(forwardedBody).toMatchObject({ Nom: 'Dossier TEST' });
    });

    it('GET /dossiers?code=X&nom=Y&q=Z — code gagne', async () => {
      let forwardedBody: unknown = null;
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Dossier/GetDossiers', method: 'POST' })
        .reply(200, (req) => {
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      await app.request('/dossiers?code=X&nom=Y&q=Z');
      expect(forwardedBody).toMatchObject({ Code: 'X' });
      expect(forwardedBody).not.toHaveProperty('Nom');
      expect(forwardedBody).not.toHaveProperty('RechercheGenerique');
    });

    it('GET /dossiers?q=Dupont — comportement existant inchangé (Dossier/Get + RechercheGenerique)', async () => {
      let forwardedBody: unknown = null;
      let calledPath = '';
      agent.get('https://secib.test')
        .intercept({ path: '/8.1.4/cab/api/v1/Dossier/Get', method: 'POST' })
        .reply(200, (req) => {
          calledPath = '/Dossier/Get';
          forwardedBody = JSON.parse(req.body as string);
          return [];
        });

      await app.request('/dossiers?q=Dupont&limit=20');
      expect(calledPath).toBe('/Dossier/Get');
      expect(forwardedBody).toMatchObject({ RechercheGenerique: 'Dupont', NbMax: 20 });
    });
  });
```

- [ ] **Step 2 : Lancer — vérifier qu'ils échouent**

```bash
npx vitest run tests/integration/dossiers.test.ts -t "filtres spécifiques"
```
Expected : les tests `code=` et `nom=` FAIL (route frappe `/Dossier/Get` au lieu de `/Dossier/GetDossiers`). Le test `?q=` PASS (comportement existant).

### Task C4 : Implémenter filtres `/dossiers` avec routage conditionnel

**Files:**
- Modify: `src/routes/dossiers.ts` (route `GET /`)

- [ ] **Step 1 : Remplacer la route `GET /`**

Dans `src/routes/dossiers.ts`, remplacer le handler `r.get('/', ...)` par :

```typescript
  // GET /dossiers — recherche ; si code/nom fournis → /Dossier/GetDossiers (match exact), sinon /Dossier/Get (RechercheGenerique)
  r.get('/', async (c) => {
    const code = c.req.query('code');
    const nom = c.req.query('nom');
    const q = c.req.query('q') ?? '';
    const limit = Number.parseInt(c.req.query('limit') ?? '20', 10);

    if (code || nom) {
      const body: Record<string, unknown> = {};
      if (code) body.Code = code;
      else if (nom) body.Nom = nom;
      const range = `0-${limit - 1}`;
      const res = await deps.secib.request('POST', '/Dossier/GetDossiers', {
        body,
        params: { range },
      });
      if (!res.ok) return failSecib(c, res);
      return ok(c, res.data);
    }

    // Comportement existant : RechercheGenerique via /Dossier/Get
    const res = await deps.secib.request('POST', '/Dossier/Get', {
      body: { RechercheGenerique: q, NbMax: limit },
    });
    if (!res.ok) return failSecib(c, res);
    return ok(c, res.data);
  });
```

- [ ] **Step 2 : Lancer les tests**

```bash
npx vitest run tests/integration/dossiers.test.ts -t "filtres spécifiques"
```
Expected : 4 tests PASS.

- [ ] **Step 3 : Suite complète**

```bash
npx vitest run
```
Expected : tous PASS.

- [ ] **Step 4 : Commit**

```bash
git add src/routes/dossiers.ts tests/integration/dossiers.test.ts
git commit -m "feat(dossiers): filtres code + nom via /Dossier/GetDossiers"
```

Heredoc + trailer.

### Task C5 : Documentation INTEGRATION_GUIDE

**Files:**
- Modify: `docs/INTEGRATION_GUIDE.md`

- [ ] **Step 1 : Ajouter les filtres à la doc section 5.2 (personnes)**

Repérer la description existante de `GET /personnes` dans `docs/INTEGRATION_GUIDE.md` section 5.2. Ajouter sous la ligne existante ou modifier le tableau pour inclure les nouveaux query params :

```markdown
| GET | `/personnes` | `?coordonnees=`, `?denomination=`, `?q=`, `?type=PP|PM`, `?limit=` | non | Recherche tiers — filtres coordonnees/denomination/q (précédence dans cet ordre) |
```

Ajouter en dessous un court paragraphe :

```markdown
**Filtres de recherche** : `coordonnees` (email/tel — filtre SECIB `Coordonnees`), `denomination` (nom/raison sociale — `Denomination`), `q` (recherche libre — `RechercheGenerique`). Si plusieurs fournis, la précédence est `coordonnees > denomination > q` — un seul filtre atteint SECIB.
```

- [ ] **Step 2 : Ajouter les filtres à la doc section 5.5 (dossiers)**

Pareil pour `GET /dossiers` :

```markdown
| GET | `/dossiers` | `?code=`, `?nom=`, `?q=`, `?limit=` | non | Recherche dossiers — filtres code/nom (match exact via `/Dossier/GetDossiers`) ou q (RechercheGenerique via `/Dossier/Get`) |
```

Puis :

```markdown
**Filtres de recherche** : `code` (code exact — filtre SECIB `Code` sur endpoint `/Dossier/GetDossiers`), `nom` (filtre `Nom` sur `/Dossier/GetDossiers`), `q` (recherche libre via `/Dossier/Get` + `RechercheGenerique`). Si plusieurs fournis, la précédence est `code > nom > q`.
```

- [ ] **Step 3 : Commit**

```bash
git add docs/INTEGRATION_GUIDE.md
git commit -m "docs(guide): filtres personnes (coordonnees/denomination) + dossiers (code/nom)"
```

Heredoc + trailer.

### Task C6 : Push + PR Gateway

- [ ] **Step 1 : Push**

```bash
cd "/Volumes/KARUG/API GATEWAY SECIB NPL/npl-api-gateway"
git push -u origin feat/gateway-search-filters
```

- [ ] **Step 2 : Créer la PR**

```bash
gh pr create --title "feat(personnes,dossiers): filtres spécifiques pour recherche Gateway" --body "$(cat <<'EOF'
## Summary

- `GET /personnes` accepte désormais les filtres optionnels \`coordonnees\` et \`denomination\` (en plus de \`q\`).
- \`GET /dossiers\` accepte les filtres optionnels \`code\` et \`nom\` ; quand l'un des deux est fourni, la requête SECIB passe sur \`/Dossier/GetDossiers\` (match exact) au lieu de \`/Dossier/Get\` (RechercheGenerique générique, peu fiable sur les codes).
- Précédence quand plusieurs filtres sont fournis : \`coordonnees > denomination > q\` pour personnes, \`code > nom > q\` pour dossiers. Un seul filtre atteint SECIB.
- Comportement \`?q=\` existant inchangé — backwards compat préservée pour les autres clients (recouvrement, dorothy, portail-cabinet).
- 8 tests d'intégration ajoutés (4 par endpoint).

## Context

Nécessaire pour la migration complète de l'extension SECIB-Link (Thunderbird) vers la Gateway. Les cas d'usage critiques :
- Recherche par email de l'expéditeur du mail → \`?coordonnees=a@b.com\`
- Recherche de dossier par code exact (ex. \`DOS-2104.0167\`) → \`?code=DOS-2104.0167\`

Spec : \`docs/superpowers/specs/2026-04-19-gateway-full-migration-design.md\` (dans le repo SECIB-Link).

## Test plan

- [x] \`npx vitest run\` — toute la suite passe
- [ ] Test manuel en staging après déploiement : curl \`/personnes?coordonnees=...\` et \`/dossiers?code=DOS-2104.0167\`
EOF
)"
```

Attendre **merge + déploiement** avant de lancer Part D.

---

## Part D — Extension full-Gateway migration

**Working directory :** `/Volumes/KARUG/API SECIB/SECIB-Link/.claude/worktrees/interesting-shtern-f0877f` (même worktree que parapheur).
**Branche :** `claude/interesting-shtern-f0877f` (continue, pas de nouvelle branche).

### Task D1 : Migrer la recherche personne (rechercherPersonne + variants)

**Files:**
- Modify: `sidebar/secib-api.js` (3 fonctions)

- [ ] **Step 1 : Remplacer `rechercherPersonne`**

Dans `sidebar/secib-api.js`, localiser `rechercherPersonne(criteres, limit, offset)` (ligne ~225). Remplacer entièrement par :

```javascript
  /**
   * Recherche de personnes via la Gateway (filtre selon criteres).
   * @param {object} criteres - { denomination?, coordonnees?, type? }
   * @param {number} limit
   * @param {number} offset - ignoré (Gateway ne gère pas offset)
   */
  async function rechercherPersonne(criteres, limit = 20, offset = 0) {
    const query = { limit: String(limit) };
    if (criteres.coordonnees) query.coordonnees = criteres.coordonnees;
    else if (criteres.denomination) query.denomination = criteres.denomination;
    if (criteres.type) query.type = criteres.type;
    return gatewayCall("/personnes", query);
  }
```

Les fonctions `rechercherParCoordonnees(coord, limit)` et `rechercherParDenomination(denom, limit)` qui suivent passent déjà par `rechercherPersonne` — **ne rien changer côté ces deux-là**, elles fonctionneront automatiquement.

- [ ] **Step 2 : Syntax check**

```bash
node -c sidebar/secib-api.js
```
Expected : exit 0.

- [ ] **Step 3 : Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): rechercherPersonne via Gateway /personnes avec filtres"
```

Heredoc + trailer.

### Task D2 : Migrer les détails personne (getPersonnePhysique + getPersonneMorale)

**Files:**
- Modify: `sidebar/secib-api.js`

- [ ] **Step 1 : Remplacer les deux fonctions**

Localiser `getPersonnePhysique` et `getPersonneMorale` (lignes ~242-248). Remplacer :

```javascript
  /** Détail personne physique via Gateway */
  async function getPersonnePhysique(personneId) {
    return gatewayCall(`/personnes/${encodeURIComponent(personneId)}`, { type: "PP" });
  }

  /** Détail personne morale via Gateway */
  async function getPersonneMorale(personneId) {
    return gatewayCall(`/personnes/${encodeURIComponent(personneId)}`, { type: "PM" });
  }
```

- [ ] **Step 2 : Syntax check**

```bash
node -c sidebar/secib-api.js
```

- [ ] **Step 3 : Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): getPersonnePhysique + getPersonneMorale via Gateway"
```

### Task D3 : Migrer `getDossiersPersonne`

**Files:**
- Modify: `sidebar/secib-api.js`

- [ ] **Step 1 : Remplacer la fonction**

Localiser `getDossiersPersonne` (ligne ~253) :

```javascript
  /** Liste les dossiers où une personne est partie (via Gateway) */
  async function getDossiersPersonne(personneId) {
    return gatewayCall(`/personnes/${encodeURIComponent(personneId)}/dossiers`);
  }
```

- [ ] **Step 2 : Syntax check + commit**

```bash
node -c sidebar/secib-api.js
git add sidebar/secib-api.js
git commit -m "feat(api): getDossiersPersonne via Gateway /personnes/{id}/dossiers"
```

### Task D4 : Migrer `getDossierDetail` + `rechercherDossiers`

**Files:**
- Modify: `sidebar/secib-api.js`

- [ ] **Step 1 : Remplacer les deux fonctions**

Localiser `getDossierDetail` (ligne ~258) et `rechercherDossiers` (ligne ~275). Remplacer :

```javascript
  /** Détail d'un dossier via Gateway */
  async function getDossierDetail(dossierId) {
    return gatewayCall(`/dossiers/${Number(dossierId)}`);
  }
```

```javascript
  /**
   * Recherche libre de dossiers via la Gateway (filtre Code ou Nom).
   * Si le terme ressemble à un code (majuscules/chiffres/ponctuation), on privilégie Code ; sinon Nom.
   * Renvoie DossierDetailApiDto[].
   */
  async function rechercherDossiers(terme, limit = 15) {
    const t = (terme || "").trim();
    if (!t) return [];
    const query = { limit: String(limit) };
    if (/^[A-Z0-9._\-/]+$/i.test(t) && /\d/.test(t)) {
      query.code = t;
    } else {
      query.nom = t;
    }
    return gatewayCall("/dossiers", query);
  }
```

- [ ] **Step 2 : Syntax check + commit**

```bash
node -c sidebar/secib-api.js
git add sidebar/secib-api.js
git commit -m "feat(api): getDossierDetail + rechercherDossiers via Gateway"
```

### Task D5 : Supprimer le code OAuth2 mort

**Files:**
- Modify: `sidebar/secib-api.js`

À ce point toutes les fonctions appellent `gatewayCall` ou `gatewayPost`. Plus aucune référence à `apiCall` / `authenticate` / `getConfig` / `buildUrl` / `_token` / `_tokenExpiry`.

- [ ] **Step 1 : Vérifier que tout le code OAuth2 est bien mort**

```bash
grep -n "apiCall\|authenticate\|getConfig(\|buildUrl\|_token\b\|_tokenExpiry" sidebar/secib-api.js
```

Toutes les occurrences restantes doivent être **les définitions elles-mêmes**, pas des call sites. Si un call site reste, STOP — une des tâches D1-D4 a oublié quelque chose.

- [ ] **Step 2 : Supprimer les définitions**

Dans `sidebar/secib-api.js`, supprimer :

1. Les variables module-level `let _token = null; let _tokenExpiry = 0;` (lignes ~6-7).
2. La fonction `getConfig()` (lignes ~14-31).
3. La fonction `authenticate()` (lignes ~37-68).
4. La fonction `buildUrl()` (lignes ~73-83).
5. La fonction `apiCall()` (lignes ~88-130).

- [ ] **Step 3 : Mettre à jour le commentaire d'en-tête**

Remplacer les lignes 1-4 par :

```javascript
// SECIB Link — Module API (via Gateway NPL-SECIB uniquement)
// Auth : X-API-Key sur toutes les requêtes.
// Base URL : configurable dans les settings (https://apisecib.nplavocat.com par défaut).
```

- [ ] **Step 4 : Vérifier exports**

`getConfig` et `authenticate` sont-ils exportés dans le `return { ... }` de l'IIFE ? Si oui, les retirer. Grep :

```bash
grep -n "getConfig\|authenticate" sidebar/secib-api.js
```

Doit renvoyer 0 matches après nettoyage.

- [ ] **Step 5 : Syntax check**

```bash
node -c sidebar/secib-api.js
```

- [ ] **Step 6 : Commit**

```bash
git add sidebar/secib-api.js
git commit -m "refactor(api): supprimer OAuth2 client-side (Gateway unifiée)"
```

### Task D6 : Simplifier la settings UI + storage migration

**Files:**
- Modify: `sidebar/sidebar.html` (settings panel)
- Modify: `sidebar/sidebar.js` (refs DOM settings + save/load logic)
- Modify: `background.js` (cleanup des clés obsolètes au startup)

- [ ] **Step 1 : Simplifier le settings panel HTML**

Dans `sidebar/sidebar.html`, localiser `<section id="settings-panel" ...>`. Remplacer son contenu par :

```html
  <!-- Panneau de configuration (masqué par défaut) -->
  <section id="settings-panel" class="settings-panel hidden">
    <h2>Configuration Gateway NPL-SECIB</h2>
    <p class="settings-hint">La Gateway sert de pont unique vers SECIB Neo. Elle est obligatoire.</p>

    <div class="form-group">
      <label for="input-gateway-url">URL Gateway</label>
      <input type="url" id="input-gateway-url" placeholder="https://apisecib.nplavocat.com">
    </div>
    <div class="form-group">
      <label for="input-gateway-api-key">API Key</label>
      <input type="password" id="input-gateway-api-key" placeholder="gw_sl_...">
    </div>

    <div class="form-actions">
      <button type="button" id="btn-save-settings" class="btn btn-primary">Enregistrer</button>
      <button type="button" id="btn-cancel-settings" class="btn btn-secondary">Fermer</button>
    </div>
    <div id="settings-feedback" class="settings-feedback hidden"></div>
  </section>
```

(Seuls les 4 form-groups SECIB sont supprimés — tout le reste du panel est conservé.)

- [ ] **Step 2 : Adapter sidebar.js (settings)**

Dans `sidebar/sidebar.js`, localiser le bloc des refs settings (en haut du fichier). Supprimer :

```javascript
  const inputBaseUrl = document.getElementById("input-base-url");
  const inputCabinetId = document.getElementById("input-cabinet-id");
  const inputClientId = document.getElementById("input-client-id");
  const inputClientSecret = document.getElementById("input-client-secret");
```

Localiser la fonction `openSettings()` (ligne ~108). Supprimer les lignes qui lisent/écrivent `secib_base_url`, `secib_cabinet_id`, `secib_client_id`, `secib_client_secret` dans `browser.storage.local.get(...)` et pré-remplissent les inputs.

Localiser le handler `btnSave.addEventListener(...)` pour le save settings. Supprimer la validation et l'écriture des 4 champs SECIB. Ajouter une validation explicite que Gateway URL + API Key sont remplies :

```javascript
    if (!inputGatewayUrl.value.trim() || !inputGatewayApiKey.value.trim()) {
      showSettingsFeedback("error", "L'URL Gateway et l'API Key sont obligatoires");
      return;
    }
```

- [ ] **Step 3 : Cleanup storage au startup dans background.js**

Ouvrir `background.js`. Ajouter au tout début (avant tout listener) :

```javascript
// Migration v2.0.0 : supprimer les clés OAuth2 SECIB obsolètes
browser.runtime.onStartup.addListener(async () => {
  try {
    await browser.storage.local.remove([
      "secib_base_url", "secib_cabinet_id",
      "secib_client_id", "secib_client_secret"
    ]);
  } catch (e) {
    console.warn("[SECIB Link] Cleanup storage v2.0.0 :", e);
  }
});

// Même chose sur installation/mise-à-jour
browser.runtime.onInstalled.addListener(async () => {
  try {
    await browser.storage.local.remove([
      "secib_base_url", "secib_cabinet_id",
      "secib_client_id", "secib_client_secret"
    ]);
  } catch (e) {
    console.warn("[SECIB Link] Cleanup storage install v2.0.0 :", e);
  }
});
```

- [ ] **Step 4 : Syntax check**

```bash
node -c sidebar/sidebar.js
node -c background.js
```

- [ ] **Step 5 : Commit**

```bash
git add sidebar/sidebar.html sidebar/sidebar.js background.js
git commit -m "feat(settings): simplifier la config (Gateway uniquement) + cleanup storage"
```

Heredoc + trailer.

### Task D7 : Mettre à jour README + bump version 2.0.0

**Files:**
- Modify: `README.md`
- Modify: `manifest.json`
- Modify: `updates.json`

- [ ] **Step 1 : Simplifier l'installation dans README.md**

Remplacer le bloc "Installation (utilisateur final)" (lignes 16-26) par :

```markdown
## Installation (utilisateur final)

1. Télécharger le `.xpi` depuis la dernière [Release](../../releases)
2. Dans Thunderbird : **Outils → Modules complémentaires et thèmes**
3. Engrenage ⚙️ en haut à droite → **"Installer un module depuis un fichier"**
4. Choisir le `.xpi` téléchargé
5. Configurer la Gateway : ouvrir SECIB Link, cliquer sur l'icône engrenage, renseigner :
   - URL Gateway (ex. `https://apisecib.nplavocat.com`)
   - API Key (fournie par l'administrateur)

L'extension n'a plus besoin de credentials SECIB directs — la Gateway NPL-SECIB sert de pont vers SECIB Neo.
```

Mettre à jour la section `## API SECIB utilisées` pour clarifier que tous les appels passent par la Gateway :

```markdown
## API SECIB utilisées (toutes via la Gateway NPL-SECIB)

- `POST /Personne/Get` — recherche tiers (filtres `Coordonnees` / `Denomination` / `RechercheGenerique`)
- `GET /Personne/GetPersonnePhysique` / `GetPersonneMorale` — détail personne
- `GET /Partie/GetByPersonneId` — dossiers d'une personne
- `POST /Dossier/GetDossiers` — recherche dossiers (Code / Nom exacts)
- `POST /Dossier/Get` — recherche libre (RechercheGenerique)
- `GET /Dossier/GetDossierById` — détail dossier
- `GET /Document/GetListRepertoireDossier` — répertoires d'un dossier
- `GET /Document/ListeEtapeParapheur` — étapes de parapheur (cache 24h)
- `GET /Utilisateur/ListIntervenant` — intervenants du cabinet (cache 24h)
- `POST /Document/SaveOrUpdateDocument` — enregistrement d'un document (avec `EtapeParapheurId` + `DestinataireId` optionnels)

Authentification : `X-API-Key` sur toutes les requêtes. La Gateway gère l'OAuth2 SECIB côté serveur.
```

Supprimer la mention "Authentification OAuth2 client_credentials sur https://api.secib.fr/..." (ligne 65).

Mettre à jour la section `## Permissions requises` pour retirer `https://secibneo.secib.fr/*` et `https://api.secib.fr/*` (plus besoin de ces hosts côté extension) :

```markdown
## Permissions requises

- `messagesRead`, `messagesUpdate`, `messagesTags`, `accountsRead`, `storage`
- `https://apisecib.nplavocat.com/*` (Gateway NPL-SECIB)
```

Note importante : le `manifest.json` doit être synchronisé avec ces permissions (voir step 2).

- [ ] **Step 2 : Mettre à jour manifest.json**

Dans `manifest.json` :
- Remplacer `"version": "1.3.0"` par `"version": "2.0.0"`.
- Dans `"host_permissions"` (ou `"permissions"` selon le format manifest V2/V3 utilisé), retirer `https://secibneo.secib.fr/*` et `https://api.secib.fr/*`. Garder `https://apisecib.nplavocat.com/*`.

Si le manifest est signé pour ATN (cf. commit `82f38bf`), vérifier que les métadonnées ATN ne bloquent pas la suppression des hosts.

- [ ] **Step 3 : Mettre à jour updates.json**

Dans `updates.json`, remplacer l'entry `1.3.0` par `2.0.0` (version + URL `v2.0.0/secib_link-2.0.0-tb.xpi`). Conserver l'historique 1.0.1 comme précédemment.

- [ ] **Step 4 : Commit**

```bash
git add README.md manifest.json updates.json
git commit -m "chore(release): bump 2.0.0 + simplification install doc"
```

Heredoc + trailer.

### Task D8 : Smoke tests manuels + push + update PR

**But :** valider bout en bout la migration avant merge, puis pousser tous les commits accumulés et mettre à jour la PR #2.

- [ ] **Step 1 : Smoke tests dans Thunderbird**

Charger le worktree comme module temporaire (cf. README section Installation dev). Config Gateway déjà OK. Tester dans l'ordre :

1. **Settings simplifiées** : ouvrir les paramètres → seuls URL Gateway + API Key visibles.
2. **Recherche par email expéditeur** : ouvrir un mail, la sidebar affiche l'expéditeur et ses dossiers (appel `/personnes?coordonnees=`).
3. **Recherche par nom (barre sidebar)** : taper `Dupont`, résultats cohérents.
4. **Recherche par code dossier** : taper `DOS-2104.0167` dans la barre, le dossier TEST apparaît (appel `/dossiers?code=`).
5. **Enregistrement simple d'un mail** : sans étape parapheur (régression).
6. **Enregistrement avec étape + destinataire** : régression de la feature parapheur.
7. **Compose panel** : ouvrir la rédaction d'un mail, taper un nom, le panel doit trouver des clients/dossiers (via Gateway).
8. **DevTools → Network** : aucune requête vers `secibneo.secib.fr` ou `api.secib.fr` — **que** des requêtes vers `apisecib.nplavocat.com`.
9. **DevTools → Storage** : après redémarrage Thunderbird, les clés `secib_base_url`, `secib_cabinet_id`, `secib_client_id`, `secib_client_secret` doivent avoir disparu.

- [ ] **Step 2 : Si bug, fix + recommit**

Pour chaque bug trouvé, créer un commit dédié (`fix(...):`) avec heredoc + trailer. Re-tester.

- [ ] **Step 3 : Push**

```bash
cd "/Volumes/KARUG/API SECIB/SECIB-Link/.claude/worktrees/interesting-shtern-f0877f"
git push origin claude/interesting-shtern-f0877f
```

- [ ] **Step 4 : Mettre à jour la PR #2**

Éditer la description de [PR #2](https://github.com/Karugency97/secib-link/pull/2) pour refléter le nouveau scope :

```bash
gh pr edit 2 --title "feat(v2.0.0): étape parapheur + migration complète Gateway" --body "$(cat <<'EOF'
## Summary

Deux features livrées ensemble dans la v2.0.0 :

### 1. Étape parapheur à l'enregistrement (sidebar)
- Sélecteurs couplés "Étape parapheur" + "Destinataire" dans la modale d'enregistrement.
- Propagés à \`SaveOrUpdateDocument\` via l'endpoint Gateway \`POST /api/v1/documents/save-or-update\` (déjà mergée côté Gateway).

### 2. Migration complète vers la Gateway NPL-SECIB
- Tous les appels sidebar + compose passent désormais par la Gateway (auth \`X-API-Key\`).
- Suppression de tout le code OAuth2 client-side.
- Settings simplifiées : 2 champs (URL Gateway + API Key) au lieu de 6.
- Cleanup des anciennes clés SECIB du \`browser.storage.local\` au startup.
- Dépend de la PR Gateway \`feat/gateway-search-filters\` (filtres \`coordonnees\`/\`denomination\` sur /personnes, \`code\`/\`nom\` sur /dossiers) — mergée + déployée.

## Breaking

- Version **2.0.0** (major). Les utilisateurs doivent s'assurer que la Gateway est configurée après upgrade.
- L'extension ne fonctionne plus sans la Gateway NPL-SECIB (plus de fallback OAuth2 direct).

## Test plan

- [x] Tests unitaires Gateway (deux PRs : étape parapheur + filtres recherche)
- [x] Smoke tests manuels (voir checklist Task D8)
EOF
)"
```

---

## Self-review checklist

### Coverage spec Part C (Gateway v2)
- ✅ `/personnes` accepte `coordonnees`, `denomination`, `q` — précédence claire → C1 + C2
- ✅ `/dossiers` accepte `code`, `nom`, `q` — routage conditionnel vers `/Dossier/GetDossiers` → C3 + C4
- ✅ Backwards compat `?q=` sur les deux endpoints → tests explicites dans C1/C3
- ✅ Docs mises à jour → C5
- ✅ PR Gateway séparée → C6

### Coverage spec Part D (extension)
- ✅ 8 fonctions `SecibAPI.*` migrées → D1, D2, D3, D4
- ✅ Code OAuth2 mort supprimé (state + 4 fonctions) → D5
- ✅ Settings UI simplifiée (4 form-groups retirés) → D6
- ✅ Storage migration (`browser.storage.local.remove`) → D6
- ✅ README simplifié → D7
- ✅ manifest.json : version + host_permissions mis à jour → D7
- ✅ updates.json : version bumpée → D7
- ✅ Smoke tests bout-en-bout → D8
- ✅ Push + update PR #2 (titre + body) → D8

### Placeholders
Aucun TBD/TODO. Tout le code et toutes les commandes sont fournis.

### Type consistency
- Params Gateway : `coordonnees`, `denomination`, `q`, `code`, `nom`, `limit`, `type` — cohérents entre spec / plan C / plan D.
- Filtres SECIB côté body : `Coordonnees`, `Denomination`, `RechercheGenerique`, `Code`, `Nom`, `TypePersonne`, `NbMax` — PascalCase cohérent.
- Endpoints : `GET /personnes`, `GET /personnes/:id`, `GET /personnes/:id/dossiers`, `GET /dossiers`, `GET /dossiers/:id`, `GET /dossiers/:id/repertoires` — cohérents.
