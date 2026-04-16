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
        // L'expansion sera branchée à la Task 10
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

    return { setRootNodes, render, search };
  }

  return { create };
})();
