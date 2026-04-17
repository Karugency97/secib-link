# Compose — Contacts & Pièces jointes simplifiés — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructurer le panneau Compose en sections distinctes (Recherche / Dossier / Contacts / Pièces jointes / Archivage), corriger les bugs `dossierId=NaN` et basculer deux endpoints sur la gateway NPL-SECIB pour rendre le flux fonctionnel.

**Architecture:** Découpage monolithique actuel → composants à responsabilités dédiées. `tree.js` garde deux rôles (arbre de recherche, arbre PJ). Nouveau fichier `compose/contacts.js` pour la liste plate des parties. `panel.js` devient un orchestrateur fin. `background.js` gagne un listener `compose.onAfterSend` pour archiver le mail. Gateway NPL-SECIB (hors repo) gagne deux endpoints `/parties` et `/repertoires`.

**Tech Stack:** Thunderbird WebExtensions (MailExtensions API `browser.compose.*`, `browser.messages.*`, `browser.storage.session`), HTML/CSS/JS vanilla (pas de framework, pas de bundler), gateway Node.js `node:https` (hors repo).

**Contexte d'exécution:** pas de tests unitaires automatisés dans le repo (extension navigateur). Les "tests" sont manuels dans Thunderbird. Chaque tâche se termine par une vérification manuelle reproductible + commit.

**Spec source:** `docs/superpowers/specs/2026-04-17-compose-contacts-pj-simplifie-design.md`

---

## File Structure

### Fichiers créés
- `compose/contacts.js` — composant « liste plate des parties du dossier avec sélecteur À/Cc/Cci »
- `docs/gateway/2026-04-17-nouveaux-endpoints-parties-repertoires.md` — spec à transmettre au dev de la gateway NPL-SECIB

### Fichiers modifiés
- `compose/panel.html` — refonte en 5 sections
- `compose/panel.css` — styles des nouvelles sections (liste contacts, checkbox archivage)
- `compose/panel.js` — orchestration des nouveaux composants + gestion archivage
- `compose/tree.js` — retire parties + radio archivage, garde recherche et PJ
- `compose/state.js` — commentaire sur le nouveau shape (pas de code structurel)
- `sidebar/secib-api.js` — bascule `getPartiesDossier` et `getRepertoiresDossier` sur `gatewayCall`
- `background.js` — nouveau listener `browser.compose.onAfterSend` pour archivage
- `manifest.json` — vérifier permission `compose.send` si absente

### Fichiers inchangés
- `sidebar/sidebar.js`, `sidebar/sidebar.html`, `sidebar/sidebar.css`
- `compose/state.js` (mécanique, seul le payload change)
- OAuth / renouvellement token

---

## Ordre des tâches et dépendances

```
Task 1 (gateway spec, hors repo)
   │
   ├─→ Task 5 (bascule secib-api.js) — bloquée tant que gateway pas déployée
   │
Task 2 (bug DossierId) — indépendant, peut ship tout de suite
   │
Task 3 (panel.html restructure) — indépendant
Task 4 (panel.css pour nouvelles sections) — après 3
Task 6 (compose/contacts.js) — après 3, 4
Task 7 (tree.js simplifié) — après 3
Task 8 (panel.js orchestration) — après 2, 3, 6, 7
Task 9 (state.js commentaire) — petit, après 8
Task 10 (background.js onAfterSend) — après 8
Task 11 (tests manuels) — après tout le reste + gateway déployée
```

---

## Task 1 : Spec gateway — endpoints `/parties` et `/repertoires`

**Files:**
- Create: `docs/gateway/2026-04-17-nouveaux-endpoints-parties-repertoires.md`

- [ ] **Step 1: Créer le dossier `docs/gateway/` s'il n'existe pas**

```bash
mkdir -p "docs/gateway"
```

- [ ] **Step 2: Écrire la spec des deux endpoints**

Contenu du fichier `docs/gateway/2026-04-17-nouveaux-endpoints-parties-repertoires.md` :

````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add "docs/gateway/2026-04-17-nouveaux-endpoints-parties-repertoires.md"
git commit -m "docs(gateway): spec endpoints /parties et /repertoires"
```

**Note opérationnelle** : les tâches 5 (bascule `secib-api.js`) et 11 (tests manuels) supposent que cette spec a été implémentée et déployée côté gateway. Le reste du plan peut avancer en parallèle.

---

## Task 2 : Bugfix — mapping `DossierId` dans `tree.js:loadClientChildren`

**Files:**
- Modify: `compose/tree.js` (fonction `loadClientChildren`, ~ligne 234-258)

- [ ] **Step 1: Lire la fonction actuelle pour repérer le mauvais mapping**

Ouvrir `compose/tree.js` et identifier dans `loadClientChildren` le `.map((d) => ...)` qui lit `d.DossierId`. `getDossiersPersonne` appelle `/Partie/GetByPersonneId` qui renvoie des `PartieApiDto[]` — le dossier est dans `.Dossier`.

- [ ] **Step 2: Remplacer le mapping**

Dans `compose/tree.js`, fonction `loadClientChildren`, remplacer :

```js
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
```

par :

```js
return dossiers
  .map((p) => p && p.Dossier)
  .filter((d) => d && Number.isFinite(Number(d.DossierId)))
  .map((d) => ({
    id: `dossier:${d.DossierId}`,
    type: "dossier",
    label: d.Code || "—",
    sublabel: d.Nom || "",
    children: null,
    loading: false,
    expanded: false,
    data: d
  }));
```

- [ ] **Step 3: Vérification manuelle**

Recharger l'extension dans Thunderbird (`about:debugging` → SECIB Link → Recharger), ouvrir un compose, rechercher un client, déplier ses dossiers, cliquer sur un dossier. Vérifier dans la console que les appels partent avec un `dossierId` numérique (pas `NaN`).

- [ ] **Step 4: Commit**

```bash
git add compose/tree.js
git commit -m "fix(compose): DossierId depuis PartieApiDto.Dossier (client → dossiers)"
```

---

## Task 3 : Restructurer `panel.html` en 5 sections

**Files:**
- Modify: `compose/panel.html`

- [ ] **Step 1: Remplacer le contenu des sections du body**

Dans `compose/panel.html`, remplacer toute la zone entre `<body>` et `<footer class="footer">` (exclu) par :

```html
<body>
  <header class="header">
    <div class="header-brand">
      <span class="header-icon">S</span>
      <h1>SECIB Link — Compose</h1>
    </div>
    <div id="compose-subject" class="compose-subject" title=""></div>
  </header>

  <div id="error-zone" class="error-zone hidden"></div>

  <!-- §1 Recherche (arbre clients + dossiers) -->
  <section class="section">
    <h2>Rechercher un client ou un dossier SECIB</h2>
    <div class="search-bar">
      <input type="search" id="tree-search" placeholder="Nom de client, code ou nom de dossier…" autocomplete="off">
    </div>
    <div id="search-results" class="tree-container"></div>
  </section>

  <!-- §2 Dossier sélectionné -->
  <section id="dossier-section" class="section hidden">
    <div class="dossier-card">
      <div class="dossier-top">
        <span id="dc-code" class="dossier-ref"></span>
        <button type="button" id="dc-clear" class="btn-link">Changer</button>
      </div>
      <div id="dc-nom" class="dossier-title"></div>
    </div>
  </section>

  <!-- §3 Contacts -->
  <section id="contacts-section" class="section hidden">
    <h2>Contacts</h2>
    <div id="contacts-list" class="contacts-list"></div>
  </section>

  <!-- §4 Pièces jointes -->
  <section id="attachments-section" class="section hidden">
    <h2>Pièces jointes</h2>
    <div id="attachments-tree" class="tree-container"></div>
  </section>

  <!-- §5 Archivage -->
  <section id="archive-section" class="section hidden">
    <label class="archive-toggle">
      <input type="checkbox" id="archive-enabled" checked>
      <span id="archive-label">Archiver le mail dans « Email »</span>
    </label>
    <div id="archive-hint" class="ad-hint"></div>
  </section>

  <!-- Footer / actions -->
  <div id="apply-progress" class="apply-progress hidden">
    <div class="progress-bar"><div id="apply-fill" class="progress-fill"></div></div>
    <div id="apply-label" class="progress-label"></div>
  </div>
  <div id="apply-feedback" class="feedback hidden"></div>
```

Le `<footer>`, la `</body>` et les `<script>` existants restent inchangés, sauf ajout de `<script src="contacts.js"></script>` juste avant `<script src="panel.js"></script>`.

- [ ] **Step 2: Ajouter le script contacts.js dans l'ordre de chargement**

Dans `compose/panel.html`, juste avant `<script src="panel.js"></script>`, ajouter :

```html
<script src="contacts.js"></script>
```

Ordre final des scripts : `secib-api.js` → `state.js` → `tree.js` → `contacts.js` → `panel.js`.

- [ ] **Step 3: Vérification manuelle**

Recharger l'extension, ouvrir un compose. Vérifier que :
- La barre de recherche apparaît en haut.
- Aucune autre section n'est visible (toutes marquées `hidden`).
- Pas d'erreur console sur scripts manquants.

- [ ] **Step 4: Commit**

```bash
git add compose/panel.html
git commit -m "refactor(compose): panel.html en 5 sections distinctes"
```

---

## Task 4 : Styles des nouvelles sections (`panel.css`)

**Files:**
- Modify: `compose/panel.css`

- [ ] **Step 1: Identifier la fin du fichier CSS**

Ouvrir `compose/panel.css`. Les styles d'arbre existent déjà (sont utilisés par `tree.js`). On ajoute uniquement : liste contacts, checkbox archivage, et on s'assure que `#attachments-tree` / `#search-results` héritent de `.tree-container`.

- [ ] **Step 2: Ajouter les styles à la fin du fichier**

Ajouter à la fin de `compose/panel.css` :

```css
/* ─── Section Contacts (§3) ─────────────────────────────── */

.contacts-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.contacts-empty {
  padding: 8px 12px;
  color: var(--muted, #6b7280);
  font-style: italic;
}

.contact-row {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
}

.contact-row:hover { background: rgba(0, 0, 0, 0.03); }

.contact-row.no-email {
  opacity: 0.55;
}

.contact-row .contact-check {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  font-size: 11px;
  color: var(--muted, #6b7280);
  min-width: 32px;
  cursor: pointer;
  user-select: none;
}

.contact-row .contact-check input {
  margin: 0 0 2px 0;
}

.contact-row .contact-name {
  font-weight: 500;
}

.contact-row .contact-email {
  color: var(--muted, #6b7280);
  font-size: 12px;
  margin-left: 6px;
}

.contact-row .contact-noemail {
  color: var(--muted, #6b7280);
  font-style: italic;
  font-size: 12px;
}

/* ─── Section Archivage (§5) ────────────────────────────── */

.archive-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.archive-toggle input[disabled] + span {
  opacity: 0.55;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Vérification manuelle**

Recharger l'extension, ouvrir le compose, puis dans la console exécuter :

```js
document.getElementById("contacts-section").classList.remove("hidden");
document.getElementById("contacts-list").innerHTML = `
  <div class="contact-row">
    <label class="contact-check"><input type="checkbox">À</label>
    <label class="contact-check"><input type="checkbox">Cc</label>
    <label class="contact-check"><input type="checkbox">Cci</label>
    <div><span class="contact-name">Test</span><span class="contact-email">&lt;test@x.fr&gt;</span></div>
  </div>
  <div class="contact-row no-email">
    <label class="contact-check"><input type="checkbox" disabled>À</label>
    <label class="contact-check"><input type="checkbox" disabled>Cc</label>
    <label class="contact-check"><input type="checkbox" disabled>Cci</label>
    <div><span class="contact-name">Sans email</span><span class="contact-noemail">(pas d'email)</span></div>
  </div>`;
```

Vérifier visuellement : 3 cases alignées à gauche, nom + email à droite, ligne grisée pour le contact sans email.

- [ ] **Step 4: Commit**

```bash
git add compose/panel.css
git commit -m "style(compose): contacts-list et archive-toggle"
```

---

## Task 5 : Bascule `secib-api.js` sur la gateway

**Préambule :** cette tâche suppose que les endpoints `/parties` et `/repertoires` sont **déployés** côté gateway (Task 1 livrée au dev gateway + déploiement). Si pas encore déployés, la tâche peut être écrite et commitée — les appels échoueront en runtime jusqu'au déploiement.

**Files:**
- Modify: `sidebar/secib-api.js` (fonctions `getPartiesDossier` et `getRepertoiresDossier`, ~lignes 238-286)

- [ ] **Step 1: Remplacer `getRepertoiresDossier`**

Dans `sidebar/secib-api.js`, remplacer tout le bloc de la fonction `getRepertoiresDossier` (y compris le commentaire JSDoc et le tableau `tentatives`) par :

```js
  /**
   * Liste les répertoires d'un dossier via la gateway NPL-SECIB.
   * Contourne le body-on-GET de SECIB (/Document/GetListRepertoireDossier).
   */
  async function getRepertoiresDossier(dossierId) {
    return gatewayCall("/repertoires", { dossierId: Number(dossierId) });
  }
```

- [ ] **Step 2: Remplacer `getPartiesDossier`**

Remplacer le bloc de la fonction `getPartiesDossier` (y compris son commentaire) par :

```js
  /**
   * Liste les parties d'un dossier via la gateway NPL-SECIB.
   * Contourne le body-on-GET de SECIB (/Partie/Get).
   */
  async function getPartiesDossier(dossierId) {
    return gatewayCall("/parties", { dossierId: Number(dossierId) });
  }
```

- [ ] **Step 3: Vérifier que `gatewayCall` est défini plus haut dans le fichier**

Vérifier en relisant le début du fichier que la fonction `gatewayCall(path, queryParams)` existe déjà (section « Gateway NPL-SECIB ») et qu'elle est utilisée par `getDocumentsDossier`. Aucune modification de `gatewayCall` requise.

- [ ] **Step 4: Vérification manuelle**

Recharger l'extension. Dans un compose panel, sélectionner un dossier. Ouvrir la console et confirmer que :
- `[SECIB Link] Gateway https://apisecib.nplavocat.com/api/v1/parties?dossierId=<N>` apparaît sans erreur.
- `[SECIB Link] Gateway https://apisecib.nplavocat.com/api/v1/repertoires?dossierId=<N>` apparaît sans erreur.
- Aucun appel direct à `/Partie/Get` ou `/Document/GetListRepertoireDossier` sur `secibneo.secib.fr`.

Si la gateway n'est pas encore déployée, les deux appels renverront une erreur claire (`GATEWAY HTTP_404` ou équivalent) — c'est attendu tant que la gateway n'expose pas ces routes.

- [ ] **Step 5: Commit**

```bash
git add sidebar/secib-api.js
git commit -m "feat(api): getPartiesDossier et getRepertoiresDossier via gateway NPL-SECIB"
```

---

## Task 6 : Composant liste de contacts (`compose/contacts.js`)

**Files:**
- Create: `compose/contacts.js`

- [ ] **Step 1: Créer le fichier avec le squelette**

Créer `compose/contacts.js` avec le contenu suivant :

```js
// SECIB Link — Composant "liste plate des contacts (parties du dossier)".
// Responsabilités : rendu de la liste, sélecteur À/Cc/Cci mutuellement
// exclusif par ligne, notification au parent via callback onChange.

const ContactsList = (() => {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.container  Conteneur où injecter la liste.
   * @param {Function} opts.onChange      (selection: Map<emailLower, {nom, email, type}>) => void
   */
  function create({ container, onChange }) {
    let parties = [];
    // Map<emailLower, { nom, email, type: 'to'|'cc'|'bcc' }>
    const selected = new Map();

    function render() {
      container.innerHTML = "";
      if (!parties.length) {
        container.innerHTML = `<div class="contacts-empty">Aucune partie sur ce dossier.</div>`;
        return;
      }
      for (const p of parties) {
        container.appendChild(renderRow(p));
      }
    }

    function renderRow(partie) {
      const personne = partie.Personne || {};
      const nom = personne.NomComplet || personne.Nom || "—";
      const email = (personne.Email || "").trim();
      const key = email.toLowerCase();
      const currentType = email && selected.has(key) ? selected.get(key).type : null;

      const row = document.createElement("div");
      row.className = "contact-row" + (email ? "" : " no-email");

      for (const [val, lbl] of [["to", "À"], ["cc", "Cc"], ["bcc", "Cci"]]) {
        const wrap = document.createElement("label");
        wrap.className = "contact-check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = val;
        cb.disabled = !email;
        cb.checked = currentType === val;
        cb.addEventListener("change", () => handleToggle(nom, email, val, cb.checked));
        wrap.appendChild(cb);
        wrap.appendChild(document.createTextNode(lbl));
        row.appendChild(wrap);
      }

      const info = document.createElement("div");
      info.className = "contact-info";
      const nameEl = document.createElement("span");
      nameEl.className = "contact-name";
      nameEl.textContent = nom;
      info.appendChild(nameEl);
      if (email) {
        const emEl = document.createElement("span");
        emEl.className = "contact-email";
        emEl.textContent = `<${email}>`;
        info.appendChild(emEl);
      } else {
        const noEl = document.createElement("span");
        noEl.className = "contact-noemail";
        noEl.textContent = " (pas d'email)";
        info.appendChild(noEl);
      }
      row.appendChild(info);

      return row;
    }

    function handleToggle(nom, email, type, checked) {
      if (!email) return;
      const key = email.toLowerCase();
      if (checked) {
        selected.set(key, { nom, email, type });
      } else {
        selected.delete(key);
      }
      render();                         // re-render pour refléter l'exclusion
      if (onChange) onChange(new Map(selected));
    }

    function setParties(newParties) {
      parties = Array.isArray(newParties) ? newParties : [];
      selected.clear();
      render();
      if (onChange) onChange(new Map(selected));
    }

    function clear() {
      parties = [];
      selected.clear();
      render();
    }

    function getSelection() {
      return new Map(selected);
    }

    return { setParties, clear, getSelection };
  }

  return { create };
})();
```

- [ ] **Step 2: Vérifier l'exclusion mutuelle côté logique**

Relire `handleToggle` : quand `checked=true`, on `set` sur la clé email, ce qui remplace l'entrée précédente (donc le type précédent disparaît). Le re-render reflète visuellement qu'une seule case est cochée par ligne. OK.

- [ ] **Step 3: Test manuel isolé (sans backend)**

Recharger l'extension, ouvrir le compose panel, ouvrir la console et exécuter :

```js
const cl = ContactsList.create({
  container: document.getElementById("contacts-list"),
  onChange: (sel) => console.log("Sélection:", [...sel.values()])
});
document.getElementById("contacts-section").classList.remove("hidden");
cl.setParties([
  { Personne: { NomComplet: "Jean Dupont", Email: "jean@x.fr" } },
  { Personne: { NomComplet: "Marie Martin", Email: "marie@y.fr" } },
  { Personne: { Nom: "Sans Email" } }
]);
```

Vérifier :
- 3 lignes s'affichent, la 3e est grisée avec « (pas d'email) ».
- Cocher À sur Jean → console log `[{nom:"Jean Dupont", email:"jean@x.fr", type:"to"}]`.
- Cocher Cc sur Jean → À se décoche, seule Cc reste.
- Décocher Cc sur Jean → Jean disparaît de la sélection (`[]`).
- Cocher une case sur « Sans Email » → impossible (disabled).

- [ ] **Step 4: Commit**

```bash
git add compose/contacts.js
git commit -m "feat(compose): composant ContactsList avec sélecteur À/Cc/Cci exclusif"
```

---

## Task 7 : Simplifier `tree.js` (retirer parties + radio archivage)

**Files:**
- Modify: `compose/tree.js`

- [ ] **Step 1: Retirer le rendu des parties-group / partie / radio archivage**

Dans `compose/tree.js`, fonction `renderNode` : supprimer les blocs qui gèrent `node.type === "partie"` (lignes ~83-121) et `node.type === "repertoire"` concernant le radio archivage (lignes ~68-81). Garder uniquement la checkbox pour `document`.

Le `renderNode` simplifié doit conserver :
- La zone toggle (▶ / ▼) pour nœuds extensibles.
- Le label cliquable pour `dossier` (callback `onDossierSelect`).
- La checkbox pour `document` (callback `onDocumentToggle`).

Voici la version cible complète de `renderNode` :

```js
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
        toggleNode(node);
      });
      row.appendChild(toggle);

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
```

- [ ] **Step 2: Retirer la construction du `partiesGroup` dans `loadDossierChildren`**

Toujours dans `compose/tree.js`, fonction `loadDossierChildren` : supprimer l'appel à `getPartiesDossier`, supprimer la construction de `partiesGroup` et le retour `[partiesGroup, ...repNodes]` → remplacer par `return repNodes;`.

Voici la version cible :

```js
    async function loadDossierChildren(dossierNode) {
      const dossierId = dossierNode.data.DossierId;
      const [repertoires, documents] = await Promise.all([
        SecibAPI.getRepertoiresDossier(dossierId).catch(() => []),
        SecibAPI.getDocumentsDossier(dossierId).catch(() => [])
      ]);

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
          children: [], loading: false, expanded: false, data: doc
        }));
        return {
          id: `repertoire:${rid}`,
          type: "repertoire",
          label: r.Libelle || `Répertoire #${rid}`,
          sublabel: `${docs.length} document(s)`,
          _pendingDocs: docs,
          children: null,
          loading: false,
          expanded: false,
          data: r
        };
      });

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

      return repNodes;
    }
```

- [ ] **Step 3: Retirer la fonction exportée `setRepertoireRadio`**

En bas de `compose/tree.js`, retirer la fonction `setRepertoireRadio` et son export dans `return { setRootNodes, render, search, setRepertoireRadio };` → devient `return { setRootNodes, render, search };`.

- [ ] **Step 4: Vérification manuelle**

Recharger l'extension, ouvrir le compose panel. Aucune erreur console au chargement. Les types `partie`, `parties-group` ne sont plus référencés dans le code ; `grep -n "parties-group\|type.*partie" compose/tree.js` doit ne plus rien retourner.

- [ ] **Step 5: Commit**

```bash
git add compose/tree.js
git commit -m "refactor(compose): tree.js recentré sur recherche + arbre PJ"
```

---

## Task 8 : Refonte `panel.js` (orchestration)

**Files:**
- Modify: `compose/panel.js` (réécriture en grande partie)

- [ ] **Step 1: Remplacer le contenu de `panel.js` par la nouvelle orchestration**

Remplacer **toutes les lignes entre le commentaire d'en-tête et le `})();` final** (grosso modo tout le corps de l'IIFE) par :

```js
(async function () {
  const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

  // ---- Refs DOM ----
  const errorZone = document.getElementById("error-zone");
  const composeSubject = document.getElementById("compose-subject");

  const treeSearch = document.getElementById("tree-search");
  const searchResults = document.getElementById("search-results");

  const dossierSection = document.getElementById("dossier-section");
  const dcCode = document.getElementById("dc-code");
  const dcNom = document.getElementById("dc-nom");
  const dcClear = document.getElementById("dc-clear");

  const contactsSection = document.getElementById("contacts-section");
  const contactsList = document.getElementById("contacts-list");

  const attachmentsSection = document.getElementById("attachments-section");
  const attachmentsTree = document.getElementById("attachments-tree");

  const archiveSection = document.getElementById("archive-section");
  const archiveEnabled = document.getElementById("archive-enabled");
  const archiveLabel = document.getElementById("archive-label");
  const archiveHint = document.getElementById("archive-hint");

  const applyProgress = document.getElementById("apply-progress");
  const applyFill = document.getElementById("apply-fill");
  const applyLabel = document.getElementById("apply-label");
  const applyFeedback = document.getElementById("apply-feedback");
  const btnApply = document.getElementById("btn-apply");
  const btnClose = document.getElementById("btn-close");

  // ---- État ----
  let composeTabId = null;
  let currentDossier = null;            // { DossierId, Code, Nom }
  let archiveRepertoireId = null;       // null si inaccessible
  let createdAutoEmail = false;
  let partiesSelection = new Map();     // miroir de ContactsList.getSelection()
  const documentsSelected = new Map();  // key: DocumentId → DTO

  // ---- Init ----
  composeTabId = readComposeTabId();
  if (composeTabId === null) {
    showError("Aucun mail en cours de composition détecté.");
    return;
  }
  refreshComposeSubject();

  const searchTree = TreeView.create({
    container: searchResults,
    callbacks: { onDossierSelect: handleDossierSelect }
  });
  searchTree.setRootNodes([]);

  const attachmentsTreeView = TreeView.create({
    container: attachmentsTree,
    callbacks: { onDocumentToggle: handleDocumentToggle }
  });
  attachmentsTreeView.setRootNodes([]);

  const contacts = ContactsList.create({
    container: contactsList,
    onChange: (sel) => {
      partiesSelection = sel;
      updateApplyButton();
    }
  });

  await restoreState();

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
    const did = Number(st.dossierId);
    if (!Number.isFinite(did)) return;
    currentDossier = { DossierId: did, Code: st.dossierCode, Nom: st.dossierNom };
    archiveRepertoireId = st.archiveRepertoireId || null;
    createdAutoEmail = !!st.createdAutoEmail;
    archiveEnabled.checked = st.archiveEnabled !== false;
    showDossierCard();
    await loadDossierContent(did);
  }

  // ---- Recherche ----
  let searchTimer = null;
  treeSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = treeSearch.value.trim();
    searchTimer = setTimeout(() => searchTree.search(q), 300);
  });

  // ---- Sélection dossier ----
  async function handleDossierSelect(dossierDto) {
    const did = Number(dossierDto && dossierDto.DossierId);
    if (!Number.isFinite(did)) {
      showError("DossierId invalide — impossible de charger le dossier.");
      return;
    }
    currentDossier = {
      DossierId: did,
      Code: dossierDto.Code,
      Nom: dossierDto.Nom
    };
    partiesSelection.clear();
    documentsSelected.clear();
    contacts.clear();
    attachmentsTreeView.setRootNodes([]);
    showDossierCard();
    await loadDossierContent(did);
    await persistState();
    updateApplyButton();
  }

  async function loadDossierContent(dossierId) {
    // Affiche les sections en mode "chargement"
    contactsSection.classList.remove("hidden");
    attachmentsSection.classList.remove("hidden");
    archiveSection.classList.remove("hidden");

    contactsList.innerHTML = `<div class="contacts-empty">Chargement…</div>`;

    const [partiesRes, repertoiresRes, documentsRes] = await Promise.all([
      SecibAPI.getPartiesDossier(dossierId).catch((e) => ({ error: e })),
      SecibAPI.getRepertoiresDossier(dossierId).catch((e) => ({ error: e })),
      SecibAPI.getDocumentsDossier(dossierId).catch((e) => ({ error: e }))
    ]);

    // ----- Contacts -----
    if (partiesRes && partiesRes.error) {
      contactsList.innerHTML = `<div class="contacts-empty">Erreur chargement contacts : ${escapeHtml(partiesRes.error.message)}</div>`;
    } else {
      contacts.setParties(Array.isArray(partiesRes) ? partiesRes : []);
    }

    // ----- Pièces jointes -----
    const repertoires = (repertoiresRes && !repertoiresRes.error && Array.isArray(repertoiresRes)) ? repertoiresRes : [];
    const documents = (documentsRes && !documentsRes.error && Array.isArray(documentsRes)) ? documentsRes : [];
    const pjNodes = buildPJNodes(repertoires, documents, dossierId);
    attachmentsTreeView.setRootNodes(pjNodes);

    // ----- Archivage -----
    await resolveArchiveRepertoire(repertoires);
  }

  function buildPJNodes(repertoires, documents, dossierId) {
    const docsByRep = new Map();
    for (const doc of documents) {
      const rid = doc.RepertoireId ? String(doc.RepertoireId) : "__root";
      if (!docsByRep.has(rid)) docsByRep.set(rid, []);
      docsByRep.get(rid).push(doc);
    }
    const repNodes = repertoires.map((r) => {
      const rid = String(r.RepertoireId);
      const docs = (docsByRep.get(rid) || []).map((doc) => ({
        id: `document:${doc.DocumentId}`,
        type: "document",
        label: doc.FileName || doc.Libelle || "(sans nom)",
        sublabel: formatDateShort(doc.Date || doc.DateCreation),
        children: [], loading: false, expanded: false, data: doc
      }));
      return {
        id: `repertoire:${rid}`,
        type: "repertoire",
        label: r.Libelle || `Répertoire #${rid}`,
        sublabel: `${docs.length} document(s)`,
        _pendingDocs: docs,
        children: null,
        loading: false,
        expanded: false,
        data: r
      };
    });
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
        children: null, loading: false, expanded: false,
        data: { RepertoireId: null, Libelle: "(Racine)" }
      });
    }
    return repNodes;
  }

  async function resolveArchiveRepertoire(repertoires) {
    archiveLabel.textContent = `Archiver le mail dans « Email »`;
    archiveEnabled.disabled = false;
    archiveHint.textContent = "";

    const email = (repertoires || []).find((r) => (r.Libelle || "").toLowerCase() === "email");
    if (email) {
      archiveRepertoireId = email.RepertoireId;
      createdAutoEmail = false;
      await persistState();
      return;
    }
    // Créer le répertoire Email
    try {
      const created = await SecibAPI.creerRepertoire(currentDossier.DossierId, "Email");
      archiveRepertoireId = created && created.RepertoireId ? created.RepertoireId : null;
      createdAutoEmail = !!archiveRepertoireId;
      if (!archiveRepertoireId) throw new Error("Création Email : RepertoireId manquant");
      await persistState();
    } catch (err) {
      archiveRepertoireId = null;
      archiveEnabled.disabled = true;
      archiveEnabled.checked = false;
      archiveHint.textContent = "Impossible d'accéder au répertoire Email (" + err.message + ").";
      await persistState();
    }
  }

  archiveEnabled.addEventListener("change", () => {
    persistState();
  });

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
    dossierSection.classList.remove("hidden");
  }

  dcClear.addEventListener("click", async () => {
    currentDossier = null;
    archiveRepertoireId = null;
    partiesSelection.clear();
    documentsSelected.clear();
    contacts.clear();
    attachmentsTreeView.setRootNodes([]);
    dossierSection.classList.add("hidden");
    contactsSection.classList.add("hidden");
    attachmentsSection.classList.add("hidden");
    archiveSection.classList.add("hidden");
    treeSearch.value = "";
    treeSearch.focus();
    searchTree.setRootNodes([]);
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
      archiveRepertoireId,
      archiveEnabled: archiveEnabled.checked,
      createdAutoEmail
    });
  }

  // ---- Apply ----
  function updateApplyButton() {
    btnApply.disabled = partiesSelection.size === 0 && documentsSelected.size === 0;
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

    const newTo = [], newCc = [], newBcc = [];
    for (const v of partiesSelection.values()) {
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
  function formatDateShort(s) {
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
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

- [ ] **Step 2: Vérification manuelle — recherche et sélection**

Recharger l'extension. Ouvrir un compose, taper un code de dossier connu. Cliquer le dossier. Vérifier que :
- Sections Dossier / Contacts / Pièces jointes / Archivage apparaissent.
- Les contacts s'affichent (si gateway déployée).
- L'arbre PJ s'affiche avec les répertoires.
- La checkbox archivage est cochée par défaut et le label mentionne « Email ».

Si la gateway n'est pas encore déployée : les sections s'affichent avec un message d'erreur explicite dans Contacts + arbre vide — c'est attendu.

- [ ] **Step 3: Vérification manuelle — exclusion mutuelle et Apply**

Cocher À pour un contact → cocher Cc pour le même contact → À se décoche. Cocher 1 document. Cliquer « Appliquer au mail ». Retourner dans Thunderbird : vérifier que le destinataire est dans le champ approprié et que la PJ est attachée.

- [ ] **Step 4: Commit**

```bash
git add compose/panel.js
git commit -m "refactor(compose): panel.js orchestre 3 sections distinctes (contacts/PJ/archivage)"
```

---

## Task 9 : Documenter le nouveau shape dans `state.js`

**Files:**
- Modify: `compose/state.js` (commentaire d'en-tête uniquement)

- [ ] **Step 1: Remplacer l'en-tête du fichier**

Remplacer les 4 premières lignes de `compose/state.js` :

```js
// SECIB Link — Helper de persistance pour l'état compose ↔ background.
// Utilise browser.storage.session si dispo (volatile, scopé à la session
// Thunderbird), sinon fallback browser.storage.local avec clé préfixée
// et nettoyage explicite.
```

par :

```js
// SECIB Link — Helper de persistance pour l'état compose ↔ background.
// Utilise browser.storage.session si dispo (volatile, scopé à la session
// Thunderbird), sinon fallback browser.storage.local avec clé préfixée.
//
// Shape par onglet compose (clé "compose:<tabId>") :
//   {
//     dossierId: number,
//     dossierCode: string,
//     dossierNom: string,
//     archiveRepertoireId: number | null,
//     archiveEnabled: boolean,
//     createdAutoEmail: boolean
//   }
```

- [ ] **Step 2: Commit**

```bash
git add compose/state.js
git commit -m "docs(compose): nouveau shape ComposeState (archiveRepertoireId + archiveEnabled)"
```

---

## Task 10 : Listener `compose.onAfterSend` dans `background.js`

**Files:**
- Modify: `background.js` (ajout à la fin du fichier)
- Modify: `manifest.json` (si permissions manquantes)

- [ ] **Step 1: Vérifier les permissions manifest**

Ouvrir `manifest.json`. Vérifier la présence des permissions :
- `compose` (déjà présente a priori)
- `messagesRead` (nécessaire pour `messages.getRaw`)

Si `messagesRead` absent, l'ajouter dans le tableau `permissions`.

- [ ] **Step 2: Ajouter l'import des scripts SECIB dans le background**

Vérifier dans `manifest.json` la section `background.scripts`. Elle doit charger `sidebar/secib-api.js` **avant** `background.js` pour que `SecibAPI` soit disponible en background. Si ce n'est pas le cas, ajouter :

```json
"background": {
  "scripts": [
    "sidebar/secib-api.js",
    "compose/state.js",
    "background.js"
  ]
}
```

(Remplacer/étendre la liste existante selon l'actuel.)

- [ ] **Step 3: Ajouter le listener en fin de `background.js`**

Ajouter à la fin de `background.js` :

```js
// ─── Archivage post-envoi ───────────────────────────────────────────

browser.compose.onAfterSend.addListener(async (tab, sendInfo) => {
  try {
    if (!sendInfo || sendInfo.mode !== "sendNow") return;
    const st = await ComposeState.get(tab.id);
    if (!st || !st.archiveEnabled || !st.archiveRepertoireId || !st.dossierId) {
      await ComposeState.remove(tab.id);
      return;
    }

    // Récupérer le message envoyé (présent dans sendInfo.messages pour WebExtensions récents)
    const messageIds = (sendInfo.messages || []).map((m) => m.id).filter(Boolean);
    if (messageIds.length === 0) {
      console.warn("[SECIB Link] onAfterSend : aucun message à archiver");
      await ComposeState.remove(tab.id);
      return;
    }

    for (const mid of messageIds) {
      try {
        const raw = await browser.messages.getRaw(mid, { data_format: "BinaryString" });
        const emlBase64 = btoa(raw);
        const msg = await browser.messages.get(mid);
        const subject = (msg && msg.subject) || "mail";
        const fileName = `${sanitizeFileName(subject)}.eml`;

        await SecibAPI.saveEmailMessage({
          dossierId: Number(st.dossierId),
          repertoireId: Number(st.archiveRepertoireId),
          emlBase64,
          fileName
        });

        notify("SECIB Link", `Mail archivé dans ${st.dossierCode || "dossier SECIB"}`);
      } catch (err) {
        console.error("[SECIB Link] Archivage échoué :", err);
        notify("SECIB Link — archivage échoué", err.message || String(err));
      }
    }
  } finally {
    await ComposeState.remove(tab.id).catch(() => {});
  }
});

function sanitizeFileName(s) {
  return String(s || "mail")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .slice(0, 120)
    .trim() || "mail";
}

function notify(title, message) {
  try {
    browser.notifications.create({
      type: "basic",
      title,
      message,
      iconUrl: browser.runtime.getURL("icons/icon-48.png")
    });
  } catch {}
}
```

- [ ] **Step 4: Vérifier permission notifications**

Vérifier dans `manifest.json` que `notifications` est dans `permissions`. L'ajouter si absent.

- [ ] **Step 5: Vérification manuelle — archivage actif**

Recharger l'extension. Ouvrir un compose vers un destinataire quelconque, sélectionner un dossier SECIB dans le panneau, laisser la case « Archiver » cochée, envoyer le mail. Vérifier dans SECIB (via l'app web ou un autre compose panel) qu'un fichier .eml portant le sujet apparaît dans le répertoire Email du dossier.

- [ ] **Step 6: Vérification manuelle — archivage désactivé**

Rouvrir un compose, sélectionner un dossier, **décocher** la case. Envoyer. Vérifier qu'aucun fichier n'est créé dans SECIB.

- [ ] **Step 7: Commit**

```bash
git add background.js manifest.json
git commit -m "feat(background): archivage automatique du mail via compose.onAfterSend"
```

---

## Task 11 : Parcours de test manuel complet

**Files:** aucun (pure vérification).

- [ ] **Step 1: Checklist utilisateur sur un dossier réel**

Dans Thunderbird avec la gateway déployée :

1. Ouvrir un compose vierge → panneau SECIB Link.
2. Taper un **nom de client** → cliquer sur le client dans la liste → il se déplie en dossiers → cliquer sur un dossier.
3. Vérifier : sections Dossier / Contacts / Pièces jointes / Archivage apparaissent, Contacts peuplé, arbre PJ peuplé, checkbox archivage cochée, label « Archiver le mail dans « Email » ».
4. Cliquer « Changer » → tout est réinitialisé, la recherche refocus.
5. Taper directement un **code de dossier** → sélectionner → même comportement.
6. Cocher À pour le contact A, Cc pour le contact B, Cci pour le contact C. Vérifier visuellement l'exclusivité (impossible d'avoir 2 cases cochées sur la même ligne).
7. Cocher 2 documents dans l'arbre PJ.
8. Cliquer « Appliquer au mail » → retourner dans Thunderbird → vérifier les destinataires dans À/Cc/Cci et les 2 PJ attachées.
9. Envoyer le mail → notification « Mail archivé ». Vérifier dans SECIB l'apparition du .eml dans le répertoire Email du dossier.
10. Rouvrir un compose, sélectionner un dossier, **décocher** archivage, envoyer. Aucune notification d'archivage, aucun .eml créé.

- [ ] **Step 2: Cas d'erreur**

1. Désactiver temporairement la gateway (ou modifier `gateway_url` vers une URL inexistante). Sélectionner un dossier. Vérifier que Contacts affiche l'erreur (ne bloque pas l'UI), PJ vide, archivage grisé.
2. Remettre la gateway opérationnelle.

- [ ] **Step 3: Documenter l'état final**

Mettre à jour la mémoire projet pour signaler que la feature est livrée :

```bash
# (pas de commande — à faire manuellement dans la mémoire Claude si pertinent)
```

- [ ] **Step 4: Commit final / merge**

Quand tout est vert, choisir la stratégie d'intégration (merge ou PR vers `main`).

---

## Self-review (complétée par l'auteur du plan)

**Couverture spec :**
- §1 Recherche → Task 3 (HTML), inchangé côté tree.js search. ✓
- §2 Dossier sélectionné → Task 3 (HTML), Task 8 (showDossierCard). ✓
- §3 Contacts → Task 6 (composant), Task 8 (orchestration), Task 4 (styles). ✓
- §4 Pièces jointes → Task 7 (tree.js simplifié), Task 8 (buildPJNodes), Task 3 (HTML). ✓
- §5 Archivage → Task 3 (HTML), Task 4 (CSS), Task 8 (resolveArchiveRepertoire), Task 10 (onAfterSend). ✓
- Bug 1 DossierId → Task 2. ✓
- Bug 2 garde-fou → Task 8 (`handleDossierSelect` + `restoreState`). ✓
- Gateway endpoints → Task 1 (spec pour repo gateway), Task 5 (bascule secib-api.js). ✓
- ComposeState shape → Task 9 (doc), Task 8 (écriture réelle). ✓

**Cohérence types :** `archiveRepertoireId`, `archiveEnabled`, `DossierId` utilisés uniformément dans Tasks 8, 9, 10. ✓

**Placeholders :** aucun TBD / TODO / "implement later". ✓

**Ordre** : Task 5 a un préambule explicite rappelant la dépendance à la gateway déployée. Task 11 attend toutes les autres. ✓
