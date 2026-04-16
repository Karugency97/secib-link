# SECIB Link — Refonte panneau composition : arbre global + archivage mail — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer la v1.2.0 de SECIB Link : fix API répertoires (400), refonte du panneau compose en arbre unifié Client→Dossier→Répertoires avec recherche, et archivage automatique du mail envoyé dans SECIB.

**Architecture:** Découpage modulaire. `sidebar/secib-api.js` accueille les nouveaux endpoints (fix + création répertoire + archivage). Un nouveau `compose/tree.js` encapsule la vue arbre (lazy-load, search, sélection). `compose/panel.js` devient un orchestrateur léger. Un nouveau `compose/state.js` centralise la persistance `storage.session` (fallback `storage.local`). `background.js` écoute `compose.onAfterSend` et pipe le mail vers SECIB.

**Tech Stack:** Vanilla JavaScript, Thunderbird WebExtension API (MV2, TB 115+), API REST SECIB Neo (OAuth2 client_credentials). Pas de framework, pas de build step, pas de test framework — vérification manuelle structurée par checklist.

**Note test :** Le projet n'a **pas** de framework de test. Chaque tâche remplace l'étape "test rouge" de TDD par une **vérification manuelle explicite** (commande ou scénario à exécuter dans Thunderbird / console `about:debugging`). L'exigence reste : vérifier avant de commit.

**Branche de travail :** `feat/compose-arbre-archive` (à créer en tâche 0).

---

## Phase 0 — Préparation

### Task 0 : Créer la branche de travail

**Files:** aucun code

- [ ] **Step 1: Créer la branche**

```bash
cd "/Users/mkstudio/Desktop/API SECIB/SECIB-Link"
git checkout -b feat/compose-arbre-archive
```

- [ ] **Step 2: Vérification**

```bash
git branch --show-current
```
Attendu : `feat/compose-arbre-archive`

- [ ] **Step 3: Vérifier que le spec est committé**

```bash
git log --oneline -5
```
Attendu : voir le commit `docs(specs): design refonte compose (arbre global + archivage mail)`.

---

### Task 1 : Identifier la signature correcte de `GetListRepertoireDossier` via MCP SECIB

**Files:** aucun code, recherche uniquement

Cette tâche est une découverte API : elle évite de coder 9 variantes en cascade alors qu'une seule marche.

- [ ] **Step 1: Appeler le MCP SECIB pour lister les répertoires d'un dossier connu**

Via le MCP tool `mcp__secib__secib_document_repertoires` avec un `dossierId` valide pris depuis `rechercherDossiers("Martin")` ou équivalent.

- [ ] **Step 2: Observer la requête réelle émise**

Dans les logs du MCP server ou sa réponse, noter précisément :
- méthode HTTP (GET vs POST)
- version API (v1 vs v2)
- format du paramètre `dossierId` : query (`?dossierId=N`, `?filtreRepertoire.dossierId=N`…) ou body (`{DossierId}`, `{dossierId}`, `{filtreRepertoire:{dossierId}}`)

- [ ] **Step 3: Écrire la signature retenue dans un commentaire**

Créer un fichier temporaire `/tmp/secib-getlistrepertoire-signature.md` avec le résultat, à intégrer en Task 2.

- [ ] **Step 4: Aucun commit (découverte uniquement)**

---

### Task 2 : Identifier l'endpoint de création de répertoire via MCP SECIB

**Files:** aucun code, recherche uniquement

- [ ] **Step 1: Chercher un endpoint de création dans le schéma SECIB**

Via `mcp__secib__secib_query_schema` ou équivalent, chercher des endpoints contenant `Repertoire` avec méthode POST/PUT.

Candidats à tester :
- `POST /Document/SaveRepertoire` body `{ DossierId, Libelle }`
- `POST /Dossier/AddRepertoire` body `{ DossierId, Libelle }`
- `POST /Repertoire/Save` body `{ DossierId, Libelle }`

- [ ] **Step 2: Tester la création via le MCP sur un dossier de test**

Appeler l'endpoint retenu avec un libellé `"__test_create_repertoire"` et un `dossierId` de test. Vérifier que :
- la réponse renvoie un `RepertoireId` exploitable
- le répertoire apparaît bien dans `GetListRepertoireDossier`

- [ ] **Step 3: Nettoyer le répertoire de test si possible**

Si un endpoint de suppression existe, supprimer `__test_create_repertoire`. Sinon documenter dans `/tmp/secib-create-repertoire-signature.md` que le répertoire de test reste et demander à l'utilisateur comment le purger.

- [ ] **Step 4: Si AUCUN endpoint de création n'existe**

Replier le plan : supprimer les Tasks 5 et 19 et remplacer par une Task "Dropdown sélection répertoire obligatoire" (plus de création auto). Prévenir l'utilisateur avant de continuer.

- [ ] **Step 5: Aucun commit (découverte uniquement)**

---

## Phase 1 — API SECIB : fixes et ajouts

### Task 3 : Fix `getRepertoiresDossier` avec cascade

**Files:**
- Modify: `sidebar/secib-api.js` (fonction `getRepertoiresDossier`, lignes 184-187)

- [ ] **Step 1: Remplacer la fonction par une cascade, variante identifiée en Task 1 en premier**

Dans `sidebar/secib-api.js`, remplacer :

```js
  async function getRepertoiresDossier(dossierId) {
    return apiCall("GET", "/Document/GetListRepertoireDossier", { query: { dossierId } });
  }
```

Par :

```js
  /**
   * Liste les répertoires d'un dossier.
   * ⚠️ Signature API variable selon la version SECIB : on tente plusieurs
   * variantes, la première qui marche gagne. La variante identifiée via
   * MCP SECIB est placée en tête pour court-circuiter la cascade.
   */
  async function getRepertoiresDossier(dossierId) {
    const did = Number(dossierId);
    const tentatives = [
      // ⬇⬇ REMPLACER la 1ère entrée par la variante identifiée en Task 1 ⬇⬇
      { nom: "v1 POST body {DossierId}",
        method: "POST", opts: { body: { DossierId: did } } },
      { nom: "v1 POST body {dossierId}",
        method: "POST", opts: { body: { dossierId: did } } },
      { nom: "v2 POST body {DossierId}",
        method: "POST", opts: { version: "v2", body: { DossierId: did } } },
      { nom: "v2 POST body {dossierId}",
        method: "POST", opts: { version: "v2", body: { dossierId: did } } },
      { nom: "v1 GET ?filtreRepertoire.dossierId=N",
        method: "GET", opts: { query: { "filtreRepertoire.dossierId": did } } },
      { nom: "v1 GET ?dossierId=N",
        method: "GET", opts: { query: { dossierId: did } } }
    ];

    let lastErr = null;
    for (const t of tentatives) {
      try {
        const res = await apiCall(t.method, "/Document/GetListRepertoireDossier", t.opts);
        console.log(`[SECIB Link] ✓ GetListRepertoireDossier OK via "${t.nom}"`);
        return res;
      } catch (err) {
        console.warn(`[SECIB Link] ✗ "${t.nom}" → ${err.message}`);
        lastErr = err;
      }
    }
    throw lastErr || new Error("Aucune variante de GetListRepertoireDossier n'a fonctionné");
  }
```

- [ ] **Step 2: Vérification manuelle**

Charger l'extension en mode debug (`about:debugging` → "Ce Thunderbird" → "Charger un module temporaire" → `manifest.json`).

Ouvrir la sidebar principale sur un mail reçu, cliquer sur un dossier. Observer la console de l'extension (`about:debugging` → bouton "Inspecter" de l'extension).

Attendu : un log `[SECIB Link] ✓ GetListRepertoireDossier OK via "…"` et plus de 400. Si la variante en tête fail et qu'une autre réussit, noter laquelle (à remonter en haut de la cascade en amélioration future).

- [ ] **Step 3: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "fix(api): cascade de variantes pour GetListRepertoireDossier (400)"
```

---

### Task 4 : Exposer `rechercherPersonne` dans l'API publique

**Files:**
- Modify: `sidebar/secib-api.js` (bloc `return` final, ligne ~313)

La fonction existe déjà (ligne 141) mais n'est pas dans l'export. On l'ajoute.

- [ ] **Step 1: Vérifier l'export actuel**

Ouvrir `sidebar/secib-api.js` et repérer le bloc `return { ... }` final. Confirmer que `rechercherPersonne` n'y est pas.

- [ ] **Step 2: Ajouter `rechercherPersonne` à l'export**

Remplacer :

```js
  return {
    getConfig,
    authenticate,
    rechercherPersonne,
    rechercherParCoordonnees,
```

(Si déjà présent comme ci-dessus, ne rien faire.) Sinon, insérer `rechercherPersonne,` après `authenticate,`.

- [ ] **Step 3: Vérification manuelle**

Dans la console de l'extension, taper :

```js
SecibAPI.rechercherPersonne({ denomination: "Martin" }, 5)
```

Attendu : une Promise qui résout avec un tableau de personnes (ou un tableau vide si aucun "Martin"), pas `undefined is not a function`.

- [ ] **Step 4: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "refactor(api): expose rechercherPersonne"
```

---

### Task 5 : Ajouter `creerRepertoire(dossierId, libelle)`

**Files:**
- Modify: `sidebar/secib-api.js` (ajout après `getRepertoiresDossier`, export final)

**Prérequis :** Task 2 a identifié l'endpoint exact. Si aucun endpoint n'existe, cette tâche est **supprimée** et la Task 19 utilisera un dropdown obligatoire à la place.

- [ ] **Step 1: Ajouter la fonction après `getRepertoiresDossier`**

```js
  /**
   * Crée un répertoire dans un dossier.
   * Endpoint confirmé via MCP SECIB : <REMPLACER par endpoint Task 2>
   */
  async function creerRepertoire(dossierId, libelle) {
    const did = Number(dossierId);
    const body = { DossierId: did, Libelle: String(libelle).trim() };
    // ⬇⬇ REMPLACER le path par celui identifié en Task 2 ⬇⬇
    return apiCall("POST", "/Document/SaveRepertoire", { body });
  }
```

- [ ] **Step 2: Ajouter à l'export**

Dans le `return { ... }` final, ajouter `creerRepertoire,` après `getRepertoiresDossier,`.

- [ ] **Step 3: Vérification manuelle**

Dans la console :

```js
SecibAPI.creerRepertoire(<dossierIdTest>, "__plan_test_rep")
  .then(r => console.log("Créé:", r))
```

Attendu : un objet `{ RepertoireId: N, Libelle: "__plan_test_rep" }`. Vérifier ensuite via `getRepertoiresDossier(<dossierIdTest>)` que le répertoire apparaît.

Nettoyer : supprimer le répertoire de test manuellement depuis SECIB Neo ou via une autre API.

- [ ] **Step 4: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): ajoute creerRepertoire pour création dynamique"
```

---

### Task 6 : Ajouter `saveEmailMessage({ dossierId, repertoireId, emlBase64, fileName })`

**Files:**
- Modify: `sidebar/secib-api.js` (ajout après `saveDocument`, export final)

- [ ] **Step 1: Ajouter la fonction après `saveDocument`**

```js
  /**
   * Enregistre un mail RFC822 (.eml) dans un dossier SECIB.
   * Thin wrapper sur saveDocument — expose l'intention dans le code appelant.
   */
  async function saveEmailMessage({ dossierId, repertoireId, emlBase64, fileName }) {
    return saveDocument({
      fileName,
      dossierId,
      repertoireId,
      contentBase64: emlBase64,
      isAnnexe: false
    });
  }
```

- [ ] **Step 2: Ajouter à l'export**

Dans le `return { ... }` final, ajouter `saveEmailMessage,` après `saveDocument,`.

- [ ] **Step 3: Vérification manuelle (smoke test)**

Dans la console, créer un mini-eml base64 et tenter l'upload :

```js
const fakeEml = btoa("From: test@test.fr\r\nTo: a@b.fr\r\nSubject: test plan\r\n\r\nCorps\r\n");
SecibAPI.saveEmailMessage({
  dossierId: <dossierIdTest>,
  repertoireId: null,
  emlBase64: fakeEml,
  fileName: "2026-04-16_test-plan.eml"
}).then(r => console.log("OK:", r))
```

Attendu : pas d'erreur, le fichier apparaît dans SECIB Neo sous le dossier test (racine si `repertoireId: null`). Supprimer le fichier de test après vérification.

- [ ] **Step 4: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): ajoute saveEmailMessage pour archivage .eml"
```

---

## Phase 2 — Module d'état partagé

### Task 7 : Créer `compose/state.js` (storage.session avec fallback)

**Files:**
- Create: `compose/state.js`

- [ ] **Step 1: Écrire le module**

Créer `compose/state.js` :

```js
// SECIB Link — Helper de persistance pour l'état compose ↔ background.
// Utilise browser.storage.session si dispo (volatile, scopé à la session
// Thunderbird), sinon fallback browser.storage.local avec clé préfixée
// et nettoyage explicite.

const ComposeState = (() => {
  const PREFIX = "compose:";

  function hasSession() {
    return typeof browser !== "undefined" &&
           browser.storage &&
           browser.storage.session &&
           typeof browser.storage.session.get === "function";
  }

  function area() {
    return hasSession() ? browser.storage.session : browser.storage.local;
  }

  function key(tabId) {
    return PREFIX + String(tabId);
  }

  async function get(tabId) {
    const k = key(tabId);
    const res = await area().get(k);
    return res[k] || null;
  }

  async function set(tabId, value) {
    const k = key(tabId);
    await area().set({ [k]: value });
  }

  async function patch(tabId, partial) {
    const existing = (await get(tabId)) || {};
    return set(tabId, { ...existing, ...partial });
  }

  async function remove(tabId) {
    const k = key(tabId);
    await area().remove(k);
  }

  async function clearAll() {
    // Utile au démarrage background pour purger les tabs morts.
    const all = await area().get(null);
    const toRemove = Object.keys(all).filter((k) => k.startsWith(PREFIX));
    if (toRemove.length) await area().remove(toRemove);
  }

  return { get, set, patch, remove, clearAll, hasSession };
})();
```

- [ ] **Step 2: Exposer le module dans `panel.html` et `background.js`**

On le référencera aux Tasks 15 et 20. Pour l'instant, juste vérifier que le fichier est chargeable :

Ouvrir `compose/panel.html`, vérifier la section `<script>` en bas. Elle sera modifiée en Task 15.

- [ ] **Step 3: Vérification manuelle**

Recharger l'extension dans Thunderbird. Ouvrir la console de background (`about:debugging` → Inspecter background). Si non chargé dans background, pas d'erreur attendue encore (module sera inclus en Task 20). Vérifier qu'aucune régression sur l'ouverture de la sidebar.

- [ ] **Step 4: Commit**

```bash
git add compose/state.js
git commit -m "feat(compose): module ComposeState (storage.session + fallback)"
```

---

## Phase 3 — Module `TreeView` (`compose/tree.js`)

### Task 8 : Squelette `TreeView` — rendu d'un nœud racine

**Files:**
- Create: `compose/tree.js`

- [ ] **Step 1: Écrire le module minimal (rendu, sans API ni interactions)**

```js
// SECIB Link — Composant arbre pour le panneau de composition.
// Responsabilités : rendu, lazy-load, recherche, sélection dossier, overrides.
// Dépendance : SecibAPI (global, chargé avant).

const TreeView = (() => {
  /**
   * @typedef {Object} TreeNode
   * @property {string} id          // ex. "dossier:456"
   * @property {string} type        // client | dossier | repertoire | document | parties-group | partie
   * @property {string} label
   * @property {string} [sublabel]
   * @property {?TreeNode[]} children  // null = pas chargé (lazy)
   * @property {boolean} loading
   * @property {boolean} expanded
   * @property {Object} data        // DTO brut SECIB
   */

  function create({ container, callbacks }) {
    const root = document.createElement("div");
    root.className = "tree-root";
    container.innerHTML = "";
    container.appendChild(root);

    let nodes = [];   // TreeNode[] au niveau racine

    function render() {
      root.innerHTML = "";
      if (nodes.length === 0) {
        root.innerHTML = `<div class="tree-empty">Aucun résultat. Tapez un client ou un code/nom de dossier.</div>`;
        return;
      }
      for (const n of nodes) {
        root.appendChild(renderNode(n, 0));
      }
    }

    function renderNode(node, depth) {
      const el = document.createElement("div");
      el.className = `tree-node depth-${depth} type-${node.type}`;
      if (node.loading) el.classList.add("loading");

      const row = document.createElement("div");
      row.className = "tree-row";

      const toggle = document.createElement("span");
      toggle.className = "tree-toggle";
      const expandable = node.children !== null || ["client", "dossier", "repertoire"].includes(node.type);
      toggle.textContent = expandable ? (node.expanded ? "▼" : "▶") : " ";
      if (expandable) toggle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // L'expansion sera branchée à la Task 11
      });
      row.appendChild(toggle);

      const label = document.createElement("span");
      label.className = "tree-label";
      label.innerHTML = `<span class="tn-label">${escapeHtml(node.label)}</span>` +
        (node.sublabel ? `<span class="tn-sub">${escapeHtml(node.sublabel)}</span>` : "");
      row.appendChild(label);

      el.appendChild(row);

      if (node.expanded && Array.isArray(node.children)) {
        const kids = document.createElement("div");
        kids.className = "tree-children";
        for (const c of node.children) {
          kids.appendChild(renderNode(c, depth + 1));
        }
        el.appendChild(kids);
      }

      return el;
    }

    function setRootNodes(list) {
      nodes = list;
      render();
    }

    function escapeHtml(s) {
      if (s === null || s === undefined) return "";
      const d = document.createElement("div");
      d.textContent = String(s);
      return d.innerHTML;
    }

    return { setRootNodes, render };
  }

  return { create };
})();
```

- [ ] **Step 2: Vérification manuelle (ciblée, sans intégration)**

Ouvrir `about:debugging` → Inspecter le panel compose (après Task 15 le chargera). Pour l'instant, pas de test possible — on valide uniquement qu'il n'y a **pas** d'erreur de syntaxe JS :

```bash
node --check compose/tree.js
```

Attendu : aucun output (syntaxe OK).

- [ ] **Step 3: Commit**

```bash
git add compose/tree.js
git commit -m "feat(tree): squelette TreeView — rendu nœuds + lazy markers"
```

---

### Task 9 : `TreeView.search(q)` — recherche client + dossier en parallèle

**Files:**
- Modify: `compose/tree.js`

- [ ] **Step 1: Ajouter la méthode `search` et la fusion**

Dans `compose/tree.js`, à l'intérieur du closure `create`, avant le `return { setRootNodes, render }` final, ajouter :

```js
    async function search(q) {
      const term = (q || "").trim();
      if (term.length < 2) {
        setRootNodes([]);
        return;
      }
      root.innerHTML = `<div class="tree-loading">Recherche…</div>`;

      let dossiers = [], personnes = [];
      try {
        [dossiers, personnes] = await Promise.all([
          SecibAPI.rechercherDossiers(term, 15).catch(() => []),
          SecibAPI.rechercherPersonne({ denomination: term }, 10).catch(() => [])
        ]);
      } catch (err) {
        root.innerHTML = `<div class="tree-error">Erreur : ${escapeHtml(err.message)}</div>`;
        return;
      }

      const list = [];
      // Clients en premier (niveau 1, children: null → lazy)
      for (const p of (personnes || [])) {
        list.push({
          id: `client:${p.PersonneId}`,
          type: "client",
          label: p.NomComplet || p.Denomination || p.Nom || "—",
          sublabel: p.Email || p.Telephone || "",
          children: null,
          loading: false,
          expanded: false,
          data: p
        });
      }
      // Dossiers ensuite (niveau 1 aussi, children: null → lazy)
      for (const d of (dossiers || [])) {
        list.push({
          id: `dossier:${d.DossierId}`,
          type: "dossier",
          label: d.Code || "—",
          sublabel: d.Nom || "",
          children: null,
          loading: false,
          expanded: false,
          data: d
        });
      }
      setRootNodes(list);
    }
```

Puis mettre à jour le `return` final :

```js
    return { setRootNodes, render, search };
```

- [ ] **Step 2: Vérification manuelle**

```bash
node --check compose/tree.js
```

Attendu : aucun output.

Vérification fonctionnelle repoussée à Task 16 (branchement au panel).

- [ ] **Step 3: Commit**

```bash
git add compose/tree.js
git commit -m "feat(tree): recherche client + dossier en parallèle"
```

---

### Task 10 : `TreeView` — expansion lazy d'un client (dossiers)

**Files:**
- Modify: `compose/tree.js`

- [ ] **Step 1: Implémenter l'expansion**

Dans `compose/tree.js`, remplacer le handler `toggle.addEventListener` par une vraie implémentation. Remplacer la section :

```js
      if (expandable) toggle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // L'expansion sera branchée à la Task 11
      });
```

par :

```js
      if (expandable) toggle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleNode(node);
      });
```

Ajouter la fonction `toggleNode` et `loadClientChildren` dans le closure `create`, avant `return` :

```js
    async function toggleNode(node) {
      if (node.expanded) {
        node.expanded = false;
        render();
        return;
      }
      if (node.children === null) {
        node.loading = true;
        render();
        try {
          if (node.type === "client") {
            node.children = await loadClientChildren(node);
          } else if (node.type === "dossier") {
            node.children = await loadDossierChildren(node);   // Task 11
          } else if (node.type === "repertoire") {
            node.children = node._pendingDocs || [];           // Task 12
          } else {
            node.children = [];
          }
        } catch (err) {
          node.children = [];
          node._error = err.message;
        } finally {
          node.loading = false;
        }
      }
      node.expanded = true;
      render();
    }

    async function loadClientChildren(clientNode) {
      const personneId = clientNode.data.PersonneId;
      const dossiers = await SecibAPI.getDossiersPersonne(personneId);
      if (!Array.isArray(dossiers) || dossiers.length === 0) {
        return [{
          id: `empty:${clientNode.id}`,
          type: "empty",
          label: "Aucun dossier pour ce client",
          children: [],
          loading: false,
          expanded: false,
          data: {}
        }];
      }
      return dossiers.map((d) => ({
        id: `dossier:${d.DossierId}`,
        type: "dossier",
        label: d.Code || "—",
        sublabel: d.Nom || "",
        children: null,
        loading: false,
        expanded: false,
        data: d
      }));
    }
```

`loadDossierChildren` sera ajouté en Task 11 ; pour l'instant le handler appellera la fonction qui n'existe pas encore → mais puisqu'on teste seulement `node.type === "client"` dans la Task actuelle, c'est ok.

- [ ] **Step 2: Vérification manuelle**

```bash
node --check compose/tree.js
```

Attendu : aucun output.

Test fonctionnel : reporté à Task 16.

- [ ] **Step 3: Commit**

```bash
git add compose/tree.js
git commit -m "feat(tree): expansion lazy d'un client → dossiers"
```

---

### Task 11 : `TreeView` — expansion d'un dossier (parties + répertoires + documents)

**Files:**
- Modify: `compose/tree.js`

- [ ] **Step 1: Ajouter `loadDossierChildren`**

Dans `compose/tree.js`, ajouter la fonction après `loadClientChildren` :

```js
    async function loadDossierChildren(dossierNode) {
      const dossierId = dossierNode.data.DossierId;
      const [parties, repertoires, documents] = await Promise.all([
        SecibAPI.getPartiesDossier(dossierId).catch(() => []),
        SecibAPI.getRepertoiresDossier(dossierId).catch(() => []),
        SecibAPI.getDocumentsDossier(dossierId, 50).catch(() => [])
      ]);

      // Groupe "parties"
      const partiesGroup = {
        id: `parties:${dossierId}`,
        type: "parties-group",
        label: `Parties (${(parties || []).length})`,
        children: (parties || []).map((p, i) => ({
          id: `partie:${dossierId}:${i}`,
          type: "partie",
          label: ((p.Personne || {}).Nom) || ((p.Personne || {}).NomComplet) || "—",
          sublabel: ((p.Personne || {}).Email) || "Pas d'email",
          children: [],
          loading: false,
          expanded: false,
          data: p
        })),
        loading: false,
        expanded: false,
        data: { dossierId }
      };

      // Répertoires (avec docs pré-chargés en _pendingDocs)
      const docsByRep = new Map();
      for (const doc of (documents || [])) {
        const rid = doc.RepertoireId ? String(doc.RepertoireId) : "__root";
        if (!docsByRep.has(rid)) docsByRep.set(rid, []);
        docsByRep.get(rid).push(doc);
      }

      const repNodes = (repertoires || []).map((r) => {
        const rid = String(r.RepertoireId);
        const docs = (docsByRep.get(rid) || []).map((doc) => ({
          id: `document:${doc.DocumentId}`,
          type: "document",
          label: doc.FileName || doc.Libelle || "(sans nom)",
          sublabel: formatDateShort(doc.Date || doc.DateCreation),
          children: [],
          loading: false,
          expanded: false,
          data: doc
        }));
        return {
          id: `repertoire:${rid}`,
          type: "repertoire",
          label: r.Libelle || `Répertoire #${rid}`,
          sublabel: `${docs.length} document(s)`,
          _pendingDocs: docs,
          children: null,  // lazy : on n'affiche les docs qu'à l'expansion
          loading: false,
          expanded: false,
          data: r
        };
      });

      // Si documents hors répertoire, ajouter pseudo-répertoire "Racine"
      const rootDocs = docsByRep.get("__root") || [];
      if (rootDocs.length > 0) {
        repNodes.unshift({
          id: `repertoire-root:${dossierId}`,
          type: "repertoire",
          label: "(Racine du dossier)",
          sublabel: `${rootDocs.length} document(s)`,
          _pendingDocs: rootDocs.map((doc) => ({
            id: `document:${doc.DocumentId}`,
            type: "document",
            label: doc.FileName || doc.Libelle || "(sans nom)",
            sublabel: formatDateShort(doc.Date),
            children: [], loading: false, expanded: false, data: doc
          })),
          children: null,
          loading: false,
          expanded: false,
          data: { RepertoireId: null, Libelle: "(Racine)" }
        });
      }

      return [partiesGroup, ...repNodes];
    }

    function formatDateShort(s) {
      if (!s) return "";
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    }
```

- [ ] **Step 2: Vérification manuelle**

```bash
node --check compose/tree.js
```

Attendu : aucun output.

- [ ] **Step 3: Commit**

```bash
git add compose/tree.js
git commit -m "feat(tree): expansion dossier → parties + répertoires + documents"
```

---

### Task 12 : `TreeView` — sélection dossier + callbacks

**Files:**
- Modify: `compose/tree.js`

- [ ] **Step 1: Brancher clic sur label dossier → callback `onDossierSelect`**

Dans `renderNode`, après la création de `label` et avant l'append au `row`, ajouter un handler :

Remplacer :

```js
      const label = document.createElement("span");
      label.className = "tree-label";
      label.innerHTML = `<span class="tn-label">${escapeHtml(node.label)}</span>` +
        (node.sublabel ? `<span class="tn-sub">${escapeHtml(node.sublabel)}</span>` : "");
      row.appendChild(label);
```

Par :

```js
      const label = document.createElement("span");
      label.className = "tree-label";
      label.innerHTML = `<span class="tn-label">${escapeHtml(node.label)}</span>` +
        (node.sublabel ? `<span class="tn-sub">${escapeHtml(node.sublabel)}</span>` : "");
      if (node.type === "dossier" && callbacks && callbacks.onDossierSelect) {
        label.classList.add("selectable");
        label.addEventListener("click", (ev) => {
          ev.stopPropagation();
          callbacks.onDossierSelect(node.data);
        });
      }
      row.appendChild(label);
```

- [ ] **Step 2: Ajouter radio "Archiver ici" sur les répertoires**

Après `row.appendChild(label)` dans `renderNode`, ajouter :

```js
      if (node.type === "repertoire" && callbacks && callbacks.onRepertoireOverride) {
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "rep-archive-target";
        radio.className = "tree-radio-archive";
        radio.title = "Archiver le mail ici";
        const rid = node.data ? (node.data.RepertoireId || null) : null;
        radio.dataset.repertoireId = rid === null ? "" : String(rid);
        radio.addEventListener("change", (ev) => {
          if (radio.checked) callbacks.onRepertoireOverride(rid, node.data);
          ev.stopPropagation();
        });
        row.appendChild(radio);
      }
```

- [ ] **Step 3: Exposer une méthode `setRepertoireRadio(repertoireId)` pour cocher programmatiquement**

Après `setRootNodes`, ajouter :

```js
    function setRepertoireRadio(repertoireId) {
      const radios = root.querySelectorAll(".tree-radio-archive");
      const target = repertoireId === null ? "" : String(repertoireId);
      radios.forEach((r) => {
        r.checked = r.dataset.repertoireId === target;
      });
    }
```

Et l'ajouter au `return` : `{ setRootNodes, render, search, setRepertoireRadio }`.

- [ ] **Step 4: Vérification manuelle**

```bash
node --check compose/tree.js
```

- [ ] **Step 5: Commit**

```bash
git add compose/tree.js
git commit -m "feat(tree): sélection dossier + radio override répertoire"
```

---

### Task 13 : `TreeView` — checkboxes parties (To/Cc/Cci) + documents (PJ)

**Files:**
- Modify: `compose/tree.js`

- [ ] **Step 1: Ajouter la checkbox + radios dans `renderNode` pour le type `partie`**

Dans `renderNode`, après la gestion du radio répertoire, ajouter :

```js
      if (node.type === "partie" && callbacks && callbacks.onPartyToggle) {
        const email = ((node.data.Personne || {}).Email || "").trim();
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tree-party-check";
        cb.disabled = !email;
        cb.checked = !!node._selected;
        cb.addEventListener("change", (ev) => {
          ev.stopPropagation();
          node._selected = cb.checked;
          callbacks.onPartyToggle(node.data, cb.checked, node._recipient || "to");
        });
        row.insertBefore(cb, row.firstChild);

        const radios = document.createElement("span");
        radios.className = "tree-party-radios";
        for (const [val, lbl] of [["to", "À"], ["cc", "Cc"], ["bcc", "Cci"]]) {
          const w = document.createElement("label");
          const r = document.createElement("input");
          r.type = "radio";
          r.name = `party-${node.id}`;
          r.value = val;
          r.disabled = !email;
          r.checked = (node._recipient || "to") === val;
          r.addEventListener("change", (ev) => {
            ev.stopPropagation();
            if (r.checked) {
              node._recipient = val;
              if (node._selected && callbacks.onPartyToggle) {
                callbacks.onPartyToggle(node.data, true, val);
              }
            }
          });
          w.appendChild(r);
          w.appendChild(document.createTextNode(lbl));
          radios.appendChild(w);
        }
        row.appendChild(radios);
      }
```

- [ ] **Step 2: Ajouter checkbox pour les documents**

Dans `renderNode`, ajouter après le bloc `partie` :

```js
      if (node.type === "document" && callbacks && callbacks.onDocumentToggle) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tree-doc-check";
        cb.checked = !!node._selected;
        cb.addEventListener("change", (ev) => {
          ev.stopPropagation();
          node._selected = cb.checked;
          callbacks.onDocumentToggle(node.data, cb.checked);
        });
        row.insertBefore(cb, row.firstChild);
      }
```

- [ ] **Step 3: Vérification manuelle**

```bash
node --check compose/tree.js
```

- [ ] **Step 4: Commit**

```bash
git add compose/tree.js
git commit -m "feat(tree): checkboxes parties (To/Cc/Cci) + documents (PJ)"
```

---

## Phase 4 — Refonte du panneau compose

### Task 14 : Styles CSS pour le composant arbre

**Files:**
- Modify: `compose/panel.css`

- [ ] **Step 1: Ajouter les styles pour `.tree-*` à la fin du fichier**

Ouvrir `compose/panel.css`, ajouter à la fin :

```css
/* ─── TreeView ───────────────────────────────────────────── */

.tree-root {
  font-size: 13px;
}
.tree-empty,
.tree-loading,
.tree-error {
  padding: 12px;
  color: #666;
  font-style: italic;
}
.tree-error { color: #c00; }

.tree-node {
  padding: 2px 0;
}
.tree-node.depth-0 { margin-top: 4px; }
.tree-node .tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
}
.tree-node .tree-row:hover {
  background: #f4f6fa;
}
.tree-toggle {
  display: inline-block;
  width: 14px;
  color: #888;
  cursor: pointer;
  user-select: none;
  font-size: 10px;
}
.tree-label {
  flex: 1;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.tree-label.selectable {
  cursor: pointer;
}
.tree-label.selectable:hover .tn-label {
  text-decoration: underline;
  color: #0055b3;
}
.tn-label { font-weight: 500; }
.tn-sub { font-size: 11px; color: #777; }

.tree-children {
  margin-left: 16px;
  border-left: 1px dashed #dde2ea;
  padding-left: 8px;
}

.tree-node.type-dossier > .tree-row .tn-label { color: #0055b3; }
.tree-node.type-repertoire > .tree-row .tn-label { color: #5b3e00; }
.tree-node.type-partie > .tree-row .tn-label,
.tree-node.type-document > .tree-row .tn-label { font-weight: 400; }

.tree-node.loading > .tree-row::after {
  content: " …";
  color: #888;
}

.tree-radio-archive {
  margin-left: 8px;
}
.tree-party-radios {
  display: inline-flex;
  gap: 6px;
  margin-left: 8px;
}
.tree-party-radios label {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

/* Bloc "Destination enregistrement mail" */
.archive-destination {
  margin-top: 12px;
  padding: 10px 12px;
  background: #f0f7ff;
  border: 1px solid #cfe2ff;
  border-radius: 6px;
  font-size: 13px;
}
.archive-destination .ad-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.archive-destination .ad-target {
  font-family: monospace;
  color: #0055b3;
}
.archive-destination.warn {
  background: #fff7e6;
  border-color: #ffe0a6;
}
.archive-destination.disabled {
  background: #f4f6fa;
  border-color: #e0e4ec;
  color: #888;
}
```

- [ ] **Step 2: Vérification manuelle**

Ouvrir `compose/panel.css` dans un éditeur CSS-aware ou recharger l'extension, vérifier qu'aucune erreur n'est loguée à l'ouverture du panel existant.

- [ ] **Step 3: Commit**

```bash
git add compose/panel.css
git commit -m "style(compose): styles TreeView + bloc destination archivage"
```

---

### Task 15 : Refonte de `compose/panel.html`

**Files:**
- Modify: `compose/panel.html`

- [ ] **Step 1: Remplacer les deux sections parties + documents par un conteneur arbre**

Ouvrir `compose/panel.html`. Remplacer l'intégralité du contenu entre `<!-- Bloc 2 : parties -->` et la fin du `<!-- Bloc 3 : documents -->` (incluant les deux `<section>`), par :

```html
  <!-- Bloc 2 : arbre unifié Client → Dossier → Répertoires -->
  <section id="tree-section" class="section hidden">
    <h2>Dossier, parties et documents</h2>
    <div id="tree-container" class="tree-container"></div>
  </section>

  <!-- Bloc 3 : destination archivage mail -->
  <section id="archive-section" class="section archive-destination disabled">
    <div class="ad-title">Archivage du mail envoyé</div>
    <div id="archive-target" class="ad-target">Sélectionnez un dossier ci-dessus</div>
    <div id="archive-hint" class="ad-hint"></div>
  </section>
```

- [ ] **Step 2: Remplacer la section 1 (recherche dossier) pour qu'elle pilote l'arbre**

Remplacer la section existante `<!-- Bloc 1 : recherche dossier -->` entière par :

```html
  <!-- Bloc 1 : recherche arbre (client ou dossier) -->
  <section class="section">
    <h2>Rechercher un client ou un dossier SECIB</h2>
    <div class="search-bar">
      <input type="search" id="tree-search" placeholder="Nom de client, code ou nom de dossier…" autocomplete="off">
    </div>
    <div id="dossier-card" class="dossier-card hidden">
      <div class="dossier-top">
        <span id="dc-code" class="dossier-ref"></span>
        <button type="button" id="dc-clear" class="btn-link">Changer</button>
      </div>
      <div id="dc-nom" class="dossier-title"></div>
      <div id="dc-meta" class="dossier-meta"></div>
    </div>
  </section>
```

- [ ] **Step 3: Mettre à jour les scripts chargés en bas de page**

Remplacer :

```html
  <script src="../sidebar/secib-api.js"></script>
  <script src="panel.js"></script>
```

Par :

```html
  <script src="../sidebar/secib-api.js"></script>
  <script src="state.js"></script>
  <script src="tree.js"></script>
  <script src="panel.js"></script>
```

- [ ] **Step 4: Vérification manuelle**

Recharger l'extension, ouvrir une fenêtre de composition, cliquer sur l'icône SECIB Link. Le panel doit s'ouvrir **sans erreur console** (il sera non-fonctionnel en attendant Task 16, c'est normal).

- [ ] **Step 5: Commit**

```bash
git add compose/panel.html
git commit -m "refactor(compose): HTML panel → arbre unifié + bloc archivage"
```

---

### Task 16 : Réécriture de `compose/panel.js` — orchestrateur

**Files:**
- Modify: `compose/panel.js` (réécriture complète, ~200 LOC au lieu de 614)

- [ ] **Step 1: Remplacer le contenu entier de `compose/panel.js` par :**

```js
// SECIB Link — Compose helper (orchestrateur)
// Monte le TreeView, gère l'état sélection, pilote l'application au mail
// et la persistance (ComposeState) pour l'archivage à l'envoi.

(async function () {
  const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

  // ---- Refs DOM ----
  const errorZone = document.getElementById("error-zone");
  const composeSubject = document.getElementById("compose-subject");

  const treeSearch = document.getElementById("tree-search");
  const dossierCard = document.getElementById("dossier-card");
  const dcCode = document.getElementById("dc-code");
  const dcNom = document.getElementById("dc-nom");
  const dcMeta = document.getElementById("dc-meta");
  const dcClear = document.getElementById("dc-clear");

  const treeSection = document.getElementById("tree-section");
  const treeContainer = document.getElementById("tree-container");

  const archiveSection = document.getElementById("archive-section");
  const archiveTarget = document.getElementById("archive-target");
  const archiveHint = document.getElementById("archive-hint");

  const applyProgress = document.getElementById("apply-progress");
  const applyFill = document.getElementById("apply-fill");
  const applyLabel = document.getElementById("apply-label");
  const applyFeedback = document.getElementById("apply-feedback");
  const btnApply = document.getElementById("btn-apply");
  const btnClose = document.getElementById("btn-close");

  // ---- État ----
  let composeTabId = null;
  let currentDossier = null;
  const partiesSelected = new Map();   // key: email.lower → { nom, email, type: 'to'|'cc'|'bcc' }
  const documentsSelected = new Map(); // key: documentId → DTO
  let tree = null;
  let repertoireIdDefault = null;
  let repertoireIdOverride = null;
  let createdAutoEmail = false;

  // ---- Init ----
  composeTabId = readComposeTabId();
  if (composeTabId === null) {
    showError("Aucun mail en cours de composition détecté.");
    return;
  }
  refreshComposeSubject();
  await restoreState();

  tree = TreeView.create({
    container: treeContainer,
    callbacks: {
      onDossierSelect: handleDossierSelect,
      onRepertoireOverride: handleRepertoireOverride,
      onPartyToggle: handlePartyToggle,
      onDocumentToggle: handleDocumentToggle
    }
  });

  treeSection.classList.remove("hidden");
  tree.setRootNodes([]);

  // ---- Handlers ----
  function readComposeTabId() {
    const p = new URLSearchParams(window.location.search);
    const v = parseInt(p.get("composeTabId") || "", 10);
    return Number.isNaN(v) ? null : v;
  }

  browser.runtime.onMessage.addListener(async (msg) => {
    if (!msg) return;
    if (msg.type === "secib-link/setComposeTab") {
      const newId = parseInt(msg.composeTabId, 10);
      if (!Number.isNaN(newId)) {
        composeTabId = newId;
        await restoreState();
        refreshComposeSubject();
      }
    }
    if (msg.type === "secib-link/archiveResult") {
      showApplyFeedback(msg.success ? "success" : "error", msg.message);
    }
  });

  async function refreshComposeSubject() {
    if (composeTabId === null) return;
    try {
      const details = await browser.compose.getComposeDetails(composeTabId);
      const subj = details && details.subject ? details.subject : "(sans sujet)";
      composeSubject.textContent = "Mail : " + subj;
      composeSubject.title = subj;
    } catch {}
  }

  async function restoreState() {
    const st = await ComposeState.get(composeTabId);
    if (!st || !st.dossierId) return;
    currentDossier = { DossierId: st.dossierId, Code: st.dossierCode, Nom: st.dossierNom };
    repertoireIdDefault = st.repertoireIdDefault;
    repertoireIdOverride = st.repertoireIdOverride;
    createdAutoEmail = !!st.createdAutoEmail;
    showDossierCard();
    updateArchiveBlock(st.repertoireLabelDefault || "Email");
  }

  // ---- Recherche ----
  let searchTimer = null;
  treeSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = treeSearch.value.trim();
    searchTimer = setTimeout(() => tree.search(q), 300);
  });

  // ---- Sélection dossier ----
  async function handleDossierSelect(dossierDto) {
    currentDossier = dossierDto;
    showDossierCard();

    // Chercher/créer répertoire "Email"
    archiveSection.classList.remove("disabled", "warn");
    archiveTarget.textContent = "Préparation…";
    archiveHint.textContent = "";

    try {
      const reps = await SecibAPI.getRepertoiresDossier(dossierDto.DossierId);
      const email = (reps || []).find((r) => (r.Libelle || "").toLowerCase() === "email");
      if (email) {
        repertoireIdDefault = email.RepertoireId;
        createdAutoEmail = false;
        updateArchiveBlock("Email");
      } else {
        try {
          const created = await SecibAPI.creerRepertoire(dossierDto.DossierId, "Email");
          repertoireIdDefault = created.RepertoireId;
          createdAutoEmail = true;
          updateArchiveBlock("Email", "auto-créé");
        } catch (err) {
          repertoireIdDefault = null;
          updateArchiveBlock("(Racine)", "fallback", true);
        }
      }
      repertoireIdOverride = null;
      tree.setRepertoireRadio(repertoireIdDefault);
    } catch (err) {
      repertoireIdDefault = null;
      updateArchiveBlock("—", "erreur lecture répertoires", true);
    }

    await persistState();
    updateApplyButton();
  }

  function handleRepertoireOverride(repertoireId, repertoireDto) {
    repertoireIdOverride = repertoireId;
    const lbl = (repertoireDto && repertoireDto.Libelle) || "Racine";
    updateArchiveBlock(lbl, "override");
    persistState();
  }

  function handlePartyToggle(partieDto, included, recipientType) {
    const personne = partieDto.Personne || {};
    const email = (personne.Email || "").trim();
    if (!email) return;
    const key = email.toLowerCase();
    if (included) {
      partiesSelected.set(key, {
        nom: personne.Nom || personne.NomComplet || "",
        email,
        type: recipientType || "to"
      });
    } else {
      partiesSelected.delete(key);
    }
    updateApplyButton();
  }

  function handleDocumentToggle(docDto, included) {
    if (included) {
      documentsSelected.set(docDto.DocumentId, docDto);
    } else {
      documentsSelected.delete(docDto.DocumentId);
    }
    updateApplyButton();
  }

  // ---- UI helpers ----
  function showDossierCard() {
    if (!currentDossier) return;
    dcCode.textContent = currentDossier.Code || "—";
    dcNom.textContent = currentDossier.Nom || "Sans intitulé";
    dcMeta.textContent = "";
    dossierCard.classList.remove("hidden");
  }

  function updateArchiveBlock(repertoireLabel, badge, warn) {
    archiveSection.classList.remove("disabled");
    archiveSection.classList.toggle("warn", !!warn);
    const dossierLbl = currentDossier ? (currentDossier.Code || "—") : "—";
    archiveTarget.textContent = `${dossierLbl} / ${repertoireLabel}`;
    archiveHint.textContent = badge ? `(${badge})` : "";
  }

  dcClear.addEventListener("click", async () => {
    currentDossier = null;
    partiesSelected.clear();
    documentsSelected.clear();
    repertoireIdDefault = null;
    repertoireIdOverride = null;
    dossierCard.classList.add("hidden");
    archiveSection.classList.add("disabled");
    archiveSection.classList.remove("warn");
    archiveTarget.textContent = "Sélectionnez un dossier ci-dessus";
    archiveHint.textContent = "";
    treeSearch.value = "";
    treeSearch.focus();
    tree.setRootNodes([]);
    await ComposeState.remove(composeTabId);
    updateApplyButton();
  });

  // ---- Persist ----
  async function persistState() {
    if (!currentDossier) return;
    await ComposeState.set(composeTabId, {
      dossierId: currentDossier.DossierId,
      dossierCode: currentDossier.Code,
      dossierNom: currentDossier.Nom,
      repertoireIdDefault,
      repertoireIdOverride,
      repertoireLabelDefault: "Email",
      createdAutoEmail
    });
  }

  // ---- Apply ----
  function updateApplyButton() {
    btnApply.disabled = partiesSelected.size === 0 && documentsSelected.size === 0;
  }

  btnClose.addEventListener("click", () => window.close());
  btnApply.addEventListener("click", performApply);

  async function performApply() {
    if (composeTabId === null) {
      showApplyFeedback("error", "Aucun mail en cours de composition.");
      return;
    }
    btnApply.disabled = true;
    showApplyFeedback(null);

    // Destinataires
    const newTo = [], newCc = [], newBcc = [];
    for (const v of partiesSelected.values()) {
      const formatted = v.nom ? `${v.nom} <${v.email}>` : v.email;
      if (v.type === "cc") newCc.push(formatted);
      else if (v.type === "bcc") newBcc.push(formatted);
      else newTo.push(formatted);
    }

    let currentDetails;
    try {
      currentDetails = await browser.compose.getComposeDetails(composeTabId);
    } catch {
      showApplyFeedback("error", "La fenêtre de composition n'est plus ouverte.");
      return;
    }

    try {
      await browser.compose.setComposeDetails(composeTabId, {
        to: mergeRecipients(currentDetails.to, newTo),
        cc: mergeRecipients(currentDetails.cc, newCc),
        bcc: mergeRecipients(currentDetails.bcc, newBcc)
      });
    } catch (e) {
      showApplyFeedback("error", "Échec destinataires : " + e.message);
      btnApply.disabled = false;
      return;
    }

    // Pièces jointes
    const docs = Array.from(documentsSelected.values());
    const errors = [];
    let totalBytes = 0, done = 0;
    if (docs.length > 0) {
      applyProgress.classList.remove("hidden");
      updateProgress(0, docs.length, "");
      for (const d of docs) {
        const label = d.FileName || d.Libelle || "(sans nom)";
        updateProgress(done, docs.length, label);
        try {
          const content = await SecibAPI.getDocumentContent(d.DocumentId);
          const base64 = content && content.Content ? content.Content : "";
          if (!base64) throw new Error("Contenu vide");
          const file = base64ToFile(base64, content.FileName || label, guessMime(label));
          totalBytes += file.size;
          if (totalBytes > MAX_TOTAL_BYTES) {
            errors.push(`${label} : limite 25 Mo dépassée`);
            continue;
          }
          await browser.compose.addAttachment(composeTabId, { file });
          done++;
          updateProgress(done, docs.length, label);
        } catch (err) {
          errors.push(`${label} : ${err.message}`);
        }
      }
    }

    const msg = [
      (newTo.length + newCc.length + newBcc.length) > 0
        ? `${newTo.length + newCc.length + newBcc.length} destinataire(s)` : "",
      done > 0 ? `${done}/${docs.length} pièce(s) jointe(s)` : ""
    ].filter(Boolean).join(" · ");

    if (errors.length === 0) {
      showApplyFeedback("success", `✓ ${msg || "Appliqué"}`);
    } else {
      showApplyFeedback("error", `${msg} — ${errors.join(" · ")}`);
    }
    btnApply.disabled = false;
  }

  // ---- Helpers ----
  function mergeRecipients(existing, additions) {
    const out = [], seen = new Set();
    const push = (raw) => {
      if (!raw) return;
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const r of arr) {
        const s = typeof r === "string" ? r : (r && r.value ? r.value : "");
        if (!s) { if (typeof r === "object") out.push(r); continue; }
        const email = extractEmail(s).toLowerCase();
        if (email && seen.has(email)) continue;
        if (email) seen.add(email);
        out.push(s);
      }
    };
    push(existing); push(additions);
    return out;
  }
  function extractEmail(s) {
    const m = s.match(/<([^>]+)>/);
    return m ? m[1].trim() : s.trim();
  }
  function updateProgress(done, total, label) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    applyFill.style.width = pct + "%";
    applyLabel.textContent = label ? `${done}/${total} — ${label}` : `${done}/${total}`;
  }
  function showApplyFeedback(type, message) {
    if (!type) { applyFeedback.classList.add("hidden"); return; }
    applyFeedback.className = "feedback " + type;
    applyFeedback.textContent = message;
    applyFeedback.classList.remove("hidden");
  }
  function showError(message) {
    if (!message) { errorZone.classList.add("hidden"); errorZone.textContent = ""; }
    else { errorZone.textContent = message; errorZone.classList.remove("hidden"); }
  }
  function base64ToFile(base64, fileName, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
    return new File([blob], fileName || "document", { type: mimeType || "application/octet-stream" });
  }
  function guessMime(filename) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    const map = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", txt: "text/plain", eml: "message/rfc822",
      msg: "application/vnd.ms-outlook", zip: "application/zip"
    };
    return map[ext] || "application/octet-stream";
  }
})();
```

- [ ] **Step 2: Vérification manuelle**

Recharger l'extension. Ouvrir une fenêtre de composition, cliquer sur l'icône SECIB Link.

Checklist :
- [ ] Panel s'ouvre, aucun log d'erreur dans la console
- [ ] Taper "Martin" (ou un nom connu) dans la barre → arbre se peuple (clients + dossiers)
- [ ] Cliquer sur `▶` d'un client → dossiers chargés
- [ ] Cliquer sur label d'un dossier → carte "Dossier sélectionné" apparaît en haut, bloc "Archivage" devient actif avec `CodeDossier / Email`
- [ ] Cliquer sur `▶` du dossier → parties + répertoires chargés
- [ ] Cliquer sur `▶` d'un répertoire → documents affichés
- [ ] Cocher une partie avec email + cocher un document → bouton "Appliquer au mail" s'active
- [ ] Cliquer "Appliquer" → destinataire ajouté dans la fenêtre compose, PJ attachée
- [ ] Cocher radio "Archiver ici" sur un autre répertoire → bloc archivage affiche le nouveau répertoire (override)

Si un point ne fonctionne pas, débugger avant de commit.

- [ ] **Step 3: Commit**

```bash
git add compose/panel.js
git commit -m "refactor(compose): panel.js réécrit en orchestrateur léger (TreeView)"
```

---

## Phase 5 — Pipeline d'archivage dans `background.js`

### Task 17 : Ajouter le listener `onAfterSend` et helpers

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Inclure le module `ComposeState` dans le background**

Dans `manifest.json`, remplacer :

```json
  "background": {
    "scripts": ["background.js"]
  },
```

Par :

```json
  "background": {
    "scripts": ["sidebar/secib-api.js", "compose/state.js", "background.js"]
  },
```

- [ ] **Step 2: Ajouter le listener dans `background.js`**

À la fin de `background.js`, ajouter :

```js
// ─── Archivage automatique du mail envoyé ───────────────────────────

browser.compose.onAfterSend.addListener(async ({ tab, messageId, mode }) => {
  if (mode && mode !== "sendNow") return;
  const ctx = await ComposeState.get(tab.id);
  if (!ctx || !ctx.dossierId) return;

  try {
    const rawBlob = await browser.messages.getRaw(messageId);
    const emlBase64 = await blobToBase64(rawBlob);
    const msg = await browser.messages.get(messageId);
    const subject = (msg && msg.subject) || "(sans sujet)";
    const fileName = `${formatDateIso(new Date())}_${sanitize(subject)}.eml`;
    const repertoireId = ctx.repertoireIdOverride || ctx.repertoireIdDefault || null;

    console.log(`[SECIB Link] Archivage mail → dossier ${ctx.dossierId} répertoire ${repertoireId} nom=${fileName}`);

    await SecibAPI.saveEmailMessage({
      dossierId: ctx.dossierId,
      repertoireId,
      emlBase64,
      fileName
    });

    notify("success", `Mail archivé dans ${ctx.dossierCode}`);
    postToPanel(tab.id, { success: true, message: `✓ Archivé dans ${ctx.dossierCode}` });
  } catch (err) {
    console.error("[SECIB Link] Archivage échoué", err);
    notify("error", `Archivage SECIB échoué : ${err.message}`);
    postToPanel(tab.id, { success: false, message: `Archivage échoué : ${err.message}` });
    try {
      await browser.storage.local.set({
        [`pending_archive:${messageId}`]: {
          ...ctx,
          messageId,
          error: err.message,
          at: Date.now()
        }
      });
    } catch {}
  } finally {
    await ComposeState.remove(tab.id);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  try { await ComposeState.remove(tabId); } catch {}
});

// ---- Helpers archivage ----

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(new Error("Lecture blob échouée"));
    fr.readAsDataURL(blob);
  });
}

function formatDateIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sanitize(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
}

function notify(kind, message) {
  try {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-48.png"),
      title: kind === "success" ? "SECIB Link" : "SECIB Link — Erreur",
      message
    });
  } catch {}
}

function postToPanel(composeTabId, payload) {
  if (composePanelTabId === null) return;
  browser.tabs.sendMessage(composePanelTabId, {
    type: "secib-link/archiveResult",
    ...payload,
    composeTabId
  }).catch(() => {});
}
```

- [ ] **Step 3: Ajouter la permission `notifications` au manifest**

Dans `manifest.json`, dans le bloc `"permissions"`, ajouter `"notifications"` après `"storage"` :

```json
  "permissions": [
    "messagesRead",
    "messagesUpdate",
    "messagesTags",
    "accountsRead",
    "compose",
    "storage",
    "notifications",
    "https://secibneo.secib.fr/*",
    "https://api.secib.fr/*"
  ],
```

- [ ] **Step 4: Vérification manuelle**

Recharger l'extension. Dans Thunderbird :

1. Rédiger un nouveau mail
2. Ouvrir SECIB Link, sélectionner un dossier, attendre que bloc archivage affiche `Code / Email`
3. Envoyer le mail
4. **Attendu :** notification système "Mail archivé dans {Code}", log console `[SECIB Link] Archivage mail → dossier X...`, le fichier `YYYY-MM-DD_sujet.eml` apparaît dans SECIB Neo sous le répertoire "Email" du dossier

5. Répéter sans sélectionner de dossier → **aucune notification**, aucun upload (stop silencieux)
6. Répéter en coupant le wifi juste avant envoi → notification "Archivage SECIB échoué", entrée `pending_archive:*` dans `storage.local` (vérifier via `browser.storage.local.get(null)` dans la console background)

- [ ] **Step 5: Commit**

```bash
git add background.js manifest.json
git commit -m "feat(background): archivage auto du mail envoyé dans SECIB (onAfterSend)"
```

---

## Phase 6 — Release

### Task 18 : Bump version et mise à jour du fichier `updates.json`

**Files:**
- Modify: `manifest.json`
- Modify: `updates.json`

- [ ] **Step 1: Bump version dans `manifest.json`**

Dans `manifest.json`, remplacer :

```json
  "version": "1.1.1",
```

Par :

```json
  "version": "1.2.0",
```

- [ ] **Step 2: Mettre à jour `updates.json`**

Remplacer le contenu entier de `updates.json` par :

```json
{
  "addons": {
    "secib-link@cabinet-npl.fr": {
      "updates": [
        {
          "version": "1.0.1",
          "update_link": "https://github.com/Karugency97/secib-link/releases/download/v1.0.1/secib_link-1.0.1-tb.xpi"
        },
        {
          "version": "1.2.0",
          "update_link": "https://github.com/Karugency97/secib-link/releases/download/v1.2.0/secib-link-1.2.0.xpi"
        }
      ]
    }
  }
}
```

Note : le nom du `.xpi` produit par le workflow CI est `secib-link-{version}.xpi` (cf. commande du README `zip -r ../secib-link-$(version).xpi`). Vérifier le nom exact dans `.github/workflows/` avant commit et ajuster si différent.

- [ ] **Step 3: Vérification manuelle**

```bash
grep '"version"' manifest.json
cat updates.json
```

Attendu : `"version": "1.2.0"` dans `manifest.json` ET entrée `1.2.0` présente dans `updates.json`.

- [ ] **Step 4: Commit**

```bash
git add manifest.json updates.json
git commit -m "chore(release): bump version 1.2.0"
```

---

### Task 19 : Passe complète de la checklist manuelle (spec §10)

**Files:** aucun code

Exécuter **l'intégralité** de la checklist du spec (`docs/superpowers/specs/2026-04-16-compose-arbre-archive-design.md` §10). Voici la reprise exhaustive :

- [ ] **A. Fix API répertoires**
  - [ ] Sélectionner un dossier SECIB → les répertoires s'affichent (plus de 400)
  - [ ] Logs console : variante API utilisée loguée clairement

- [ ] **B. Arbre et recherche**
  - [ ] Taper un code dossier → dossier match seul
  - [ ] Taper un nom de client → clients matchants affichés, expansion lazy OK
  - [ ] Taper un mot commun (≥3 matches) → fusion propre, pas de doublon
  - [ ] Expansion dossier → parties + répertoires + documents chargés
  - [ ] Expansion répertoire → documents du répertoire affichés

- [ ] **C. Sélection et apply**
  - [ ] Cocher parties (To/Cc/Cci) + docs → "Appliquer au mail" injecte correctement
  - [ ] Rouvrir le panneau après fermeture → dossier sélectionné restauré
  - [ ] Ouvrir une 2ᵉ fenêtre compose → état cloisonné par `composeTabId`

- [ ] **D. Répertoire "Email" auto**
  - [ ] Dossier sans répertoire "Email" → création auto, badge "auto-créé"
  - [ ] Création "Email" échoue (simuler 403) → fallback racine + badge "Racine"
  - [ ] Override : cocher autre répertoire → c'est celui-là qui est utilisé à l'envoi

- [ ] **E. Enregistrement à l'envoi**
  - [ ] Envoyer un mail avec dossier sélectionné → `.eml` uploadé, nom `YYYY-MM-DD_sujet.eml`, contenu complet
  - [ ] Envoyer un mail **sans** dossier sélectionné → aucun upload, pas d'erreur
  - [ ] Envoi avec override répertoire → mail dans le bon répertoire
  - [ ] Notification succès affichée
  - [ ] Sujet avec caractères spéciaux (`/`, `:`, accents) → sanitize OK
  - [ ] Enregistrement "Brouillon" (mode `draft`) → ignoré
  - [ ] Simuler échec réseau pendant upload → notification erreur, mail quand même envoyé, state en `pending_archive:*`

- [ ] **F. Régressions**
  - [ ] Sidebar principale (contexte mail reçu) continue de fonctionner
  - [ ] `compose_action` toujours disponible dans barre compose
  - [ ] Token OAuth expiré pendant session → refresh automatique OK

**Si une case ne passe pas :** créer un fix (nouvelle tâche / nouveau commit), ne pas tagger tant que tout n'est pas vert.

- [ ] **Validation :** noter dans le PR ou commit message que la checklist complète a été passée.

---

### Task 20 : Merge et tag `v1.2.0`

**Files:** aucun code, opérations git

- [ ] **Step 1: Pousser la branche et ouvrir une PR**

```bash
git push -u origin feat/compose-arbre-archive
```

Puis via l'UI GitHub (ou `gh pr create`) : ouvrir une PR vers `main` avec titre `feat: refonte compose (arbre + archivage mail) — v1.2.0`, corps résumant spec + checklist passée.

- [ ] **Step 2: Merger la PR** (squash ou merge simple selon convention repo)

- [ ] **Step 3: Créer et pousser le tag**

```bash
git checkout main
git pull
git tag v1.2.0
git push origin v1.2.0
```

- [ ] **Step 4: Vérification**

Le workflow GitHub Actions (`b9c24f4`) doit produire le `.xpi` automatiquement sur tag. Vérifier que la Release `v1.2.0` est créée avec le `.xpi` attaché, et que `updates.json` pointe dessus.

Tester la MAJ auto : sur une instance Thunderbird équipée de la v1.1.1 déjà installée, vérifier que Thunderbird propose la mise à jour vers 1.2.0 au prochain check.

---

## Notes pour l'implémenteur

1. **Ordre strict des tâches :** Tasks 1 et 2 (découverte API) sont des **bloqueurs** pour la suite. Ne pas sauter.
2. **Si Task 2 révèle qu'aucun endpoint de création de répertoire n'existe :** stopper, remonter à l'utilisateur, ajuster le plan (Task 5 supprimée, Task 16 modifié pour exposer un dropdown au lieu de création auto).
3. **Pas de test automatisé :** la rigueur vient de la discipline de checklist. Ne pas commit sans avoir coché la vérif manuelle de chaque tâche.
4. **Commits fréquents :** un commit par Task minimum. Jamais deux features dans un commit.
5. **Sur rejet de Task 19 :** créer un fix immédiat, ne pas avancer à Task 20 tant que la checklist §10 n'est pas 100 % verte.
6. **Rollback :** chaque tâche étant un commit séparé, un `git revert <sha>` suffit à annuler une modification problématique sans perdre le reste.
