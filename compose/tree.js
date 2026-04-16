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
            node.children = await loadDossierChildren(node);
          } else if (node.type === "repertoire") {
            node.children = node._pendingDocs || [];
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
          children: null,
          loading: false,
          expanded: false,
          data: r
        };
      });

      // Documents hors répertoire → pseudo-répertoire "Racine"
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

    function escapeHtml(s) {
      if (s === null || s === undefined) return "";
      const d = document.createElement("div");
      d.textContent = String(s);
      return d.innerHTML;
    }

    function setRepertoireRadio(repertoireId) {
      const radios = root.querySelectorAll(".tree-radio-archive");
      const target = repertoireId === null ? "" : String(repertoireId);
      radios.forEach((r) => {
        r.checked = r.dataset.repertoireId === target;
      });
    }

    return { setRootNodes, render, search, setRepertoireRadio };
  }

  return { create };
})();
