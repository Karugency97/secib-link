// SECIB Link — Compose helper
// Panneau ouvert depuis la barre d'outils d'une fenêtre de composition.
// Permet de sélectionner un dossier SECIB → cocher des parties (To/Cc/Cci) et des
// documents → tout appliquer en une fois au mail en cours de rédaction.

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
    contactsSection.classList.remove("hidden");
    attachmentsSection.classList.remove("hidden");
    archiveSection.classList.remove("hidden");

    contactsList.innerHTML = `<div class="contacts-empty">Chargement…</div>`;

    const [partiesRes, repertoiresRes, documentsRes] = await Promise.all([
      SecibAPI.getPartiesDossier(dossierId).catch((e) => ({ error: e })),
      SecibAPI.getRepertoiresDossier(dossierId).catch((e) => ({ error: e })),
      SecibAPI.getDocumentsDossier(dossierId).catch((e) => ({ error: e }))
    ]);

    if (partiesRes && partiesRes.error) {
      contactsList.innerHTML = `<div class="contacts-empty">Erreur chargement contacts : ${escapeHtml(partiesRes.error.message)}</div>`;
    } else {
      contacts.setParties(Array.isArray(partiesRes) ? partiesRes : []);
    }

    const repertoires = (repertoiresRes && !repertoiresRes.error && Array.isArray(repertoiresRes)) ? repertoiresRes : [];
    const documents = (documentsRes && !documentsRes.error && Array.isArray(documentsRes)) ? documentsRes : [];
    const pjNodes = buildPJNodes(repertoires, documents, dossierId);
    attachmentsTreeView.setRootNodes(pjNodes);

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
    updateApplyButton();
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
