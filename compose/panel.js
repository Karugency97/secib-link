// SECIB Link — Compose helper
// Panneau ouvert depuis la barre d'outils d'une fenêtre de composition.
// Permet de sélectionner un dossier SECIB → cocher des parties (To/Cc/Cci) et des
// documents → tout appliquer en une fois au mail en cours de rédaction.

(async function () {
  const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 Mo

  // ---- Refs DOM ----
  const errorZone = document.getElementById("error-zone");
  const composeSubject = document.getElementById("compose-subject");

  const dossierSearch = document.getElementById("dossier-search");
  const dossierResults = document.getElementById("dossier-results");
  const dossierCard = document.getElementById("dossier-card");
  const dcCode = document.getElementById("dc-code");
  const dcNom = document.getElementById("dc-nom");
  const dcMeta = document.getElementById("dc-meta");
  const dcClear = document.getElementById("dc-clear");

  const partiesSection = document.getElementById("parties-section");
  const partiesCount = document.getElementById("parties-count");
  const partiesLoader = document.getElementById("parties-loader");
  const partiesEmpty = document.getElementById("parties-empty");
  const partiesTable = document.getElementById("parties-table");
  const partiesTbody = document.getElementById("parties-tbody");
  const filterButtons = document.querySelectorAll("[data-type-filter]");

  const documentsSection = document.getElementById("documents-section");
  const documentsCount = document.getElementById("documents-count");
  const documentsLoader = document.getElementById("documents-loader");
  const documentsEmpty = document.getElementById("documents-empty");
  const documentsTable = document.getElementById("documents-table");
  const documentsTbody = document.getElementById("documents-tbody");
  const repFilter = document.getElementById("rep-filter");
  const sizeSummary = document.getElementById("size-summary");
  const sizeText = document.getElementById("size-text");

  const applyProgress = document.getElementById("apply-progress");
  const applyFill = document.getElementById("apply-fill");
  const applyLabel = document.getElementById("apply-label");
  const applyFeedback = document.getElementById("apply-feedback");
  const btnApply = document.getElementById("btn-apply");
  const btnClose = document.getElementById("btn-close");

  // ---- État ----
  let composeTabId = null;
  let currentDossier = null;
  let parties = [];          // PartieApiDto[]
  let partiesState = [];     // [{partie, included, recipientType: 'to'|'cc'|'bcc'}]
  let typeFilter = "all";    // "all" | "1" | "2" | "3" | "4"

  let documents = [];        // DocumentCompactApiDto[]
  let documentsState = [];   // [{doc, included}]
  let activeRepFilter = "all";

  // ---- Init : composeTabId via URL param ----
  function readComposeTabId() {
    const p = new URLSearchParams(window.location.search);
    const v = parseInt(p.get("composeTabId") || "", 10);
    return Number.isNaN(v) ? null : v;
  }

  composeTabId = readComposeTabId();
  if (composeTabId === null) {
    showError("Aucun mail en cours de composition détecté.");
  } else {
    refreshComposeSubject();
  }

  // Le background peut nous pousser un nouveau composeTabId (si l'utilisateur
  // clique le bouton depuis un autre compose pendant que le panel est ouvert).
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "secib-link/setComposeTab") {
      const newId = parseInt(msg.composeTabId, 10);
      if (!Number.isNaN(newId)) {
        composeTabId = newId;
        refreshComposeSubject();
      }
    }
  });

  async function refreshComposeSubject() {
    if (composeTabId === null) return;
    try {
      const details = await browser.compose.getComposeDetails(composeTabId);
      const subj = details && details.subject ? details.subject : "(sans sujet)";
      composeSubject.textContent = "Mail : " + subj;
      composeSubject.title = subj;
    } catch (e) {
      console.warn("[SECIB Link] getComposeDetails initial échoué :", e);
    }
  }

  // ---- Recherche dossier (autocomplete) ----
  let searchTimer = null;
  let lastQuery = "";

  dossierSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = dossierSearch.value.trim();
    if (q.length < 2) {
      dossierResults.classList.add("hidden");
      return;
    }
    searchTimer = setTimeout(() => runDossierSearch(q), 300);
  });

  document.addEventListener("click", (ev) => {
    if (!dossierSearch.contains(ev.target) && !dossierResults.contains(ev.target)) {
      dossierResults.classList.add("hidden");
    }
  });

  async function runDossierSearch(q) {
    if (q === lastQuery) return;
    lastQuery = q;
    dossierResults.innerHTML = `<div class="dr-empty">Recherche…</div>`;
    dossierResults.classList.remove("hidden");
    try {
      const found = await SecibAPI.rechercherDossiers(q, 12);
      dossierResults.innerHTML = "";
      if (!Array.isArray(found) || found.length === 0) {
        dossierResults.innerHTML = `<div class="dr-empty">Aucun dossier</div>`;
        return;
      }
      for (const d of found) {
        const item = document.createElement("div");
        item.className = "dr-item";
        item.innerHTML = `<span class="dr-code">${escapeHtml(d.Code || "—")}</span> · ${escapeHtml(d.Nom || "")}`;
        item.addEventListener("click", () => {
          dossierResults.classList.add("hidden");
          dossierSearch.value = "";
          selectDossier({
            dossierId: d.DossierId,
            code: d.Code,
            nom: d.Nom,
            type: d.Type,
            responsable: d.LoginResponsable
          });
        });
        dossierResults.appendChild(item);
      }
    } catch (err) {
      dossierResults.innerHTML = `<div class="dr-empty">Erreur : ${escapeHtml(err.message)}</div>`;
    }
  }

  dcClear.addEventListener("click", () => resetDossier());

  function resetDossier() {
    currentDossier = null;
    parties = [];
    partiesState = [];
    documents = [];
    documentsState = [];
    dossierCard.classList.add("hidden");
    partiesSection.classList.add("hidden");
    documentsSection.classList.add("hidden");
    dossierSearch.disabled = false;
    dossierSearch.focus();
    updateApplyButton();
  }

  async function selectDossier(d) {
    currentDossier = d;
    dcCode.textContent = d.code || "—";
    dcNom.textContent = d.nom || "Sans intitulé";
    dcMeta.textContent = [
      d.type ? d.type : "",
      d.responsable ? "Resp. " + d.responsable : ""
    ].filter(Boolean).join(" · ");
    dossierCard.classList.remove("hidden");
    dossierSearch.disabled = true;

    // Charger en parallèle parties + documents
    await Promise.all([loadParties(d.dossierId), loadDocuments(d.dossierId)]);
    updateApplyButton();
  }

  // ---- Parties ----
  async function loadParties(dossierId) {
    partiesSection.classList.remove("hidden");
    partiesLoader.classList.remove("hidden");
    partiesTable.classList.add("hidden");
    partiesEmpty.classList.add("hidden");
    partiesTbody.innerHTML = "";
    parties = [];
    partiesState = [];

    try {
      const list = await SecibAPI.getPartiesDossier(dossierId);
      parties = Array.isArray(list) ? list : [];
      partiesState = parties.map((p) => ({
        partie: p,
        included: false,
        recipientType: "to"
      }));
      partiesCount.textContent = `(${parties.length})`;
      partiesLoader.classList.add("hidden");
      if (parties.length === 0) {
        partiesEmpty.classList.remove("hidden");
        return;
      }
      partiesTable.classList.remove("hidden");
      renderParties();
    } catch (err) {
      partiesLoader.classList.add("hidden");
      partiesEmpty.textContent = "Erreur : " + err.message;
      partiesEmpty.classList.remove("hidden");
    }
  }

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      typeFilter = btn.dataset.typeFilter;
      renderParties();
    });
  });

  function renderParties() {
    partiesTbody.innerHTML = "";
    for (let i = 0; i < partiesState.length; i++) {
      const st = partiesState[i];
      const p = st.partie;
      if (typeFilter !== "all" && String(p.TypePartieId) !== typeFilter) continue;

      const personne = p.Personne || {};
      const nom = personne.Nom || personne.NomCourt || personne.NomComplet || "—";
      const email = personne.Email || "";

      const tr = document.createElement("tr");
      if (!email) tr.classList.add("disabled");
      tr.dataset.idx = String(i);

      // Checkbox
      const tdCheck = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = st.included && !!email;
      cb.disabled = !email;
      cb.addEventListener("change", () => {
        st.included = cb.checked;
        updateApplyButton();
      });
      tdCheck.appendChild(cb);

      // Nom + email + role pill
      const tdName = document.createElement("td");
      const role = getRoleLabel(p.TypePartieId);
      tdName.innerHTML = `
        <span class="row-name">${escapeHtml(nom)}</span>
        ${role ? `<span class="role-pill role-${p.TypePartieId}">${escapeHtml(role)}</span>` : ""}
        <span class="row-sub">${email ? escapeHtml(email) : "Pas d'email"}</span>
      `;

      // Radios To/Cc/Cci
      const tdRecip = document.createElement("td");
      const radios = document.createElement("div");
      radios.className = "recipient-radios";
      const groupName = `recip-${i}`;
      for (const [val, lbl] of [["to", "À"], ["cc", "Cc"], ["bcc", "Cci"]]) {
        const wrapper = document.createElement("label");
        const r = document.createElement("input");
        r.type = "radio";
        r.name = groupName;
        r.value = val;
        r.checked = st.recipientType === val;
        r.disabled = !email;
        r.addEventListener("change", () => {
          if (r.checked) st.recipientType = val;
        });
        wrapper.appendChild(r);
        wrapper.appendChild(document.createTextNode(lbl));
        radios.appendChild(wrapper);
      }
      tdRecip.appendChild(radios);

      tr.appendChild(tdCheck);
      tr.appendChild(tdName);
      tr.appendChild(tdRecip);
      partiesTbody.appendChild(tr);
    }
  }

  // ---- Documents ----
  async function loadDocuments(dossierId) {
    documentsSection.classList.remove("hidden");
    documentsLoader.classList.remove("hidden");
    documentsTable.classList.add("hidden");
    documentsEmpty.classList.add("hidden");
    sizeSummary.classList.add("hidden");
    documentsTbody.innerHTML = "";
    documents = [];
    documentsState = [];
    repFilter.innerHTML = `<option value="all">Tous les répertoires</option>`;

    try {
      const list = await SecibAPI.getDocumentsDossier(dossierId, 50);
      documents = Array.isArray(list) ? list : [];
      documentsState = documents.map((d) => ({ doc: d, included: false }));
      documentsCount.textContent = `(${documents.length})`;
      documentsLoader.classList.add("hidden");
      if (documents.length === 0) {
        documentsEmpty.classList.remove("hidden");
        return;
      }
      // Construire la liste des répertoires distincts
      const reps = new Map();
      for (const d of documents) {
        if (d.RepertoireId) reps.set(d.RepertoireId, d.RepertoireLibelle || `Répertoire #${d.RepertoireId}`);
      }
      for (const [id, label] of reps.entries()) {
        const opt = document.createElement("option");
        opt.value = String(id);
        opt.textContent = label;
        repFilter.appendChild(opt);
      }
      documentsTable.classList.remove("hidden");
      renderDocuments();
      updateSizeSummary();
    } catch (err) {
      documentsLoader.classList.add("hidden");
      documentsEmpty.textContent = "Erreur : " + err.message;
      documentsEmpty.classList.remove("hidden");
    }
  }

  repFilter.addEventListener("change", () => {
    activeRepFilter = repFilter.value;
    renderDocuments();
  });

  function renderDocuments() {
    documentsTbody.innerHTML = "";
    for (let i = 0; i < documentsState.length; i++) {
      const st = documentsState[i];
      const d = st.doc;
      if (activeRepFilter !== "all" && String(d.RepertoireId) !== activeRepFilter) continue;

      const tr = document.createElement("tr");
      tr.dataset.idx = String(i);

      const tdCheck = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = st.included;
      cb.addEventListener("change", () => {
        st.included = cb.checked;
        updateSizeSummary();
        updateApplyButton();
      });
      tdCheck.appendChild(cb);

      const tdName = document.createElement("td");
      const fname = d.FileName || d.Libelle || "(sans nom)";
      const ext = d.Extension ? `.${d.Extension.replace(/^\./, "")}` : "";
      const repLbl = d.RepertoireLibelle ? ` · ${d.RepertoireLibelle}` : "";
      tdName.innerHTML = `
        <span class="row-name">${escapeHtml(fname)}</span>
        <span class="row-doc-meta">${escapeHtml(ext)}${escapeHtml(repLbl)}</span>
      `;

      const tdMeta = document.createElement("td");
      tdMeta.textContent = formatDateShort(d.Date || d.DateCreation || d.DateModification);

      tr.appendChild(tdCheck);
      tr.appendChild(tdName);
      tr.appendChild(tdMeta);
      documentsTbody.appendChild(tr);
    }
  }

  /**
   * Met à jour le récap "Total : X.X Mo" en bas de section documents.
   * NB : DocumentCompactApiDto n'expose pas la taille — on compte donc le NOMBRE de
   * documents sélectionnés et on récupère la taille réelle au moment du téléchargement.
   * En attendant on affiche un compteur. La vérification > 25 Mo se fait côté apply.
   */
  function updateSizeSummary() {
    const selected = documentsState.filter((s) => s.included);
    if (selected.length === 0) {
      sizeSummary.classList.add("hidden");
      return;
    }
    sizeSummary.classList.remove("hidden");
    sizeText.textContent = `${selected.length} document(s) sélectionné(s)`;
    sizeSummary.classList.remove("over-limit");
  }

  // ---- Bouton Apply ----
  function updateApplyButton() {
    const hasParties = partiesState.some((s) => s.included);
    const hasDocs = documentsState.some((s) => s.included);
    btnApply.disabled = !(hasParties || hasDocs);
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
    showError(null);

    // 1. Préparer les destinataires
    const newTo = [], newCc = [], newBcc = [];
    for (const st of partiesState) {
      if (!st.included) continue;
      const personne = st.partie.Personne || {};
      const email = (personne.Email || "").trim();
      if (!email) continue;
      const nom = personne.Nom || personne.NomCourt || personne.NomComplet || "";
      const formatted = nom ? `${nom} <${email}>` : email;
      if (st.recipientType === "to") newTo.push(formatted);
      else if (st.recipientType === "cc") newCc.push(formatted);
      else newBcc.push(formatted);
    }

    // 2. Vérifier que le compose tab existe encore
    let currentDetails;
    try {
      currentDetails = await browser.compose.getComposeDetails(composeTabId);
    } catch (e) {
      showApplyFeedback("error", "La fenêtre de composition n'est plus ouverte.");
      btnApply.disabled = false;
      return;
    }

    // 3. Fusionner avec les destinataires existants (déduplication par email lower-case)
    const fusedTo  = mergeRecipients(currentDetails.to,  newTo);
    const fusedCc  = mergeRecipients(currentDetails.cc,  newCc);
    const fusedBcc = mergeRecipients(currentDetails.bcc, newBcc);

    try {
      await browser.compose.setComposeDetails(composeTabId, {
        to:  fusedTo,
        cc:  fusedCc,
        bcc: fusedBcc
      });
    } catch (e) {
      showApplyFeedback("error", "Échec mise à jour destinataires : " + e.message);
      btnApply.disabled = false;
      return;
    }

    // 4. Télécharger et joindre les documents séquentiellement
    const docsToFetch = documentsState.filter((s) => s.included);
    const errors = [];
    let totalBytes = 0;
    let done = 0;

    if (docsToFetch.length > 0) {
      applyProgress.classList.remove("hidden");
      updateProgress(0, docsToFetch.length, "");

      for (const st of docsToFetch) {
        const d = st.doc;
        const label = d.FileName || d.Libelle || "(sans nom)";
        updateProgress(done, docsToFetch.length, label);
        try {
          const content = await SecibAPI.getDocumentContent(d.DocumentId);
          const base64 = content && content.Content ? content.Content : "";
          if (!base64) throw new Error("Contenu vide");
          const file = base64ToFile(base64, content.FileName || label, guessMime(label));

          // Vérification cumulative 25 Mo
          totalBytes += file.size;
          if (totalBytes > MAX_TOTAL_BYTES) {
            errors.push(`${label} : limite 25 Mo dépassée, ignoré`);
            continue;
          }

          await browser.compose.addAttachment(composeTabId, { file });
          done++;
          updateProgress(done, docsToFetch.length, label);
        } catch (err) {
          console.error("[SECIB Link] Erreur upload doc", d.DocumentId, err);
          errors.push(`${label} : ${err.message}`);
        }
      }
    }

    // 5. Récap final
    const recipMsg = (newTo.length + newCc.length + newBcc.length) > 0
      ? `${newTo.length + newCc.length + newBcc.length} destinataire(s) ajouté(s)`
      : "";
    const docsMsg = done > 0 ? `${done}/${docsToFetch.length} pièce(s) jointe(s)` : "";
    const summary = [recipMsg, docsMsg].filter(Boolean).join(" · ");

    if (errors.length === 0) {
      showApplyFeedback("success", `✓ ${summary || "Appliqué"}`);
    } else {
      showApplyFeedback("error", `${summary} — Erreurs : ${errors.join(" · ")}`);
    }
    btnApply.disabled = false;
  }

  function mergeRecipients(existing, additions) {
    const out = [];
    const seen = new Set();
    const push = (raw) => {
      if (!raw) return;
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const r of arr) {
        const s = typeof r === "string" ? r : (r && r.value ? r.value : "");
        if (!s) {
          if (typeof r === "object") { out.push(r); }
          continue;
        }
        const email = extractEmail(s).toLowerCase();
        if (email && seen.has(email)) continue;
        if (email) seen.add(email);
        out.push(s);
      }
    };
    push(existing);
    push(additions);
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
    if (!type) {
      applyFeedback.classList.add("hidden");
      return;
    }
    applyFeedback.className = "feedback " + type;
    applyFeedback.textContent = message;
    applyFeedback.classList.remove("hidden");
  }

  function showError(message) {
    if (!message) {
      errorZone.classList.add("hidden");
      errorZone.textContent = "";
    } else {
      errorZone.textContent = message;
      errorZone.classList.remove("hidden");
    }
  }

  // ---- Helpers ----

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function getRoleLabel(typePartieId) {
    const roles = { 1: "Client", 2: "Adversaire", 3: "Juridiction", 4: "Correspondant" };
    return roles[typePartieId] || "";
  }

  function formatDateShort(s) {
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  /**
   * Décode une chaîne base64 en File pour browser.compose.addAttachment.
   */
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
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      txt: "text/plain",
      eml: "message/rfc822",
      msg: "application/vnd.ms-outlook",
      zip: "application/zip"
    };
    return map[ext] || "application/octet-stream";
  }
})();
