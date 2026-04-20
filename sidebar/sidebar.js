// SECIB Link — Popup Logic
// À l'ouverture, récupère le message affiché dans l'onglet courant
// puis interroge SECIB pour afficher les dossiers liés à l'expéditeur.

(async function () {
  // ---- Références DOM ----
  const senderInfo = document.getElementById("sender-info");
  const results = document.getElementById("results");
  const loader = document.getElementById("loader");
  const errorZone = document.getElementById("error-zone");
  const settingsPanel = document.getElementById("settings-panel");
  const btnSettings = document.getElementById("btn-settings");
  const btnSave = document.getElementById("btn-save-settings");
  const btnCancel = document.getElementById("btn-cancel-settings");
  const inputBaseUrl = document.getElementById("input-base-url");
  const inputCabinetId = document.getElementById("input-cabinet-id");
  const inputClientId = document.getElementById("input-client-id");
  const inputClientSecret = document.getElementById("input-client-secret");
  const inputGatewayUrl = document.getElementById("input-gateway-url");
  const inputGatewayApiKey = document.getElementById("input-gateway-api-key");
  const settingsFeedback = document.getElementById("settings-feedback");

  // Bandeau "déjà enregistré"
  const savedBanner = document.getElementById("saved-banner");

  // Barre de recherche manuelle
  const searchInput = document.getElementById("search-input");
  const btnSearchClear = document.getElementById("btn-search-clear");

  // Tag SECIB
  const SECIB_TAG_KEY = "secib-saved";
  const SECIB_TAG_LABEL = "Enregistré SECIB";
  const SECIB_TAG_COLOR = "#059669";

  // Modale enregistrement
  const saveModal = document.getElementById("save-modal");
  const saveModalTitle = document.getElementById("save-modal-title");
  const selectRepertoire = document.getElementById("select-repertoire");
  const selectEtapeParapheur = document.getElementById("select-etape-parapheur");
  const selectDestinataire = document.getElementById("select-destinataire");
  const formGroupEtape = document.getElementById("form-group-etape");
  const formGroupDestinataire = document.getElementById("form-group-destinataire");
  const destinataireHint = document.getElementById("destinataire-hint");
  const gatewayRequiredBanner = document.getElementById("gateway-required-banner");
  const inputFilename = document.getElementById("input-filename");
  const saveFeedback = document.getElementById("save-feedback");
  const btnModalClose = document.getElementById("btn-modal-close");
  const btnModalCancel = document.getElementById("btn-modal-cancel");
  const btnModalSave = document.getElementById("btn-modal-save");
  const checkAdvanced = document.getElementById("check-advanced");
  const advancedSection = document.getElementById("advanced-section");
  const checkStripAttachments = document.getElementById("check-strip-attachments");
  const attachmentsLoading = document.getElementById("attachments-loading");
  const attachmentsEmpty = document.getElementById("attachments-empty");
  const attachmentsTable = document.getElementById("attachments-table");
  const attachmentsTbody = document.getElementById("attachments-tbody");
  const saveProgress = document.getElementById("save-progress");
  const saveProgressFill = document.getElementById("save-progress-fill");
  const saveProgressLabel = document.getElementById("save-progress-label");

  // Caches mémoire (durée de vie de la fenêtre)
  let etapesParapheurCache = null;
  let intervenantsCache = null;

  async function gatewayConfigured() {
    try {
      const stored = await browser.storage.local.get(["gateway_url", "gateway_api_key"]);
      return Boolean(stored.gateway_url && stored.gateway_api_key);
    } catch {
      return false;
    }
  }

  // Contexte du mail courant
  let currentMessage = null; // { id, subject, author, date }
  let currentDossier = null; // dossier sélectionné pour l'enregistrement
  let dossiersTiers = []; // dossiers du tiers (pour pré-remplir les sélecteurs PJ)
  let attachmentsState = []; // [{ partName, name, size, contentType, isInline, included, dossierId, repertoireId, repertoires }]
  let advancedLoaded = false; // évite de recharger la liste des PJ à chaque toggle
  let pendingMessageId = null; // mail à charger au prochain init() (poussé par le background)
  let searchMode = false; // true quand l'utilisateur a saisi une recherche manuelle
  let searchTimer = null;

  // Écoute les notifications du background : changement de mail dans Thunderbird
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "secib-link/setMessage") {
      const newId = parseInt(msg.messageId, 10);
      if (Number.isNaN(newId)) return;
      // Si on est en train d'enregistrer (modale ouverte), on ne perturbe pas
      if (saveModal && !saveModal.classList.contains("hidden")) {
        pendingMessageId = newId;
        return;
      }
      // Si c'est déjà le mail courant, rien à faire
      if (currentMessage && currentMessage.id === newId) return;
      // En mode recherche manuelle : on garde les résultats, on actualise juste l'expéditeur
      if (searchMode) {
        updateCurrentMessage(newId).catch((e) =>
          console.warn("[SECIB Link] updateCurrentMessage :", e));
        return;
      }
      pendingMessageId = newId;
      init().catch((e) => console.error("[SECIB Link] init après setMessage :", e));
    }
  });

  /**
   * Met à jour le mail courant (sender + bandeau) sans toucher aux résultats.
   * Utilisé en mode recherche manuelle pour ne pas écraser la liste affichée.
   */
  async function updateCurrentMessage(messageId) {
    try {
      const msg = await browser.messages.get(messageId);
      if (!msg) return;
      currentMessage = msg;
      const parsed = parseFromHeader(msg.author || "");
      renderSender(parsed.name, parsed.email, msg.subject);
      await refreshSavedBanner();
    } catch (e) {
      console.warn("[SECIB Link] updateCurrentMessage a échoué :", e);
    }
  }

  // ---- Gestion des paramètres ----

  // Affiche le panneau ET pré-charge les valeurs si déjà sauvegardées
  async function openSettings() {
    settingsPanel.classList.remove("hidden");
    settingsFeedback.classList.add("hidden");
    try {
      const stored = await browser.storage.local.get([
        "secib_base_url", "secib_cabinet_id", "secib_client_id", "secib_client_secret",
        "gateway_url", "gateway_api_key"
      ]);
      inputBaseUrl.value = stored.secib_base_url || "https://secibneo.secib.fr/8.2.1";
      inputCabinetId.value = stored.secib_cabinet_id || "";
      inputClientId.value = stored.secib_client_id || "";
      inputClientSecret.value = stored.secib_client_secret || "";
      inputGatewayUrl.value = stored.gateway_url || "https://apisecib.nplavocat.com";
      inputGatewayApiKey.value = stored.gateway_api_key || "";
      console.log("[SECIB Link] Settings chargés :", {
        url: stored.secib_base_url,
        cabinetId: stored.secib_cabinet_id ? "(défini)" : "(vide)",
        clientId: stored.secib_client_id ? "(défini)" : "(vide)",
        secret: stored.secib_client_secret ? "(défini)" : "(vide)"
      });
    } catch (e) {
      console.error("[SECIB Link] Erreur chargement settings :", e);
      showFeedback("error", "Erreur lecture stockage : " + e.message);
    }
  }

  function closeSettings() {
    settingsPanel.classList.add("hidden");
    settingsFeedback.classList.add("hidden");
  }

  btnSettings.addEventListener("click", () => {
    if (settingsPanel.classList.contains("hidden")) openSettings();
    else closeSettings();
  });

  // Sauvegarde manuelle via le bouton Enregistrer
  btnSave.addEventListener("click", async (ev) => {
    ev.preventDefault();
    await saveSettings(true);
  });

  btnCancel.addEventListener("click", closeSettings);

  // Auto-sauvegarde au changement de chaque champ (filet de sécurité
  // si le popup se ferme avant un clic sur Enregistrer)
  for (const input of [inputBaseUrl, inputCabinetId, inputClientId, inputClientSecret, inputGatewayUrl, inputGatewayApiKey]) {
    input.addEventListener("change", () => saveSettings(false));
    input.addEventListener("blur", () => saveSettings(false));
  }

  /**
   * Sauvegarde les paramètres dans browser.storage.local.
   * @param {boolean} verbose - Si true, affiche le feedback à l'utilisateur.
   */
  async function saveSettings(verbose) {
    const payload = {
      secib_base_url: inputBaseUrl.value.trim(),
      secib_cabinet_id: inputCabinetId.value.trim(),
      secib_client_id: inputClientId.value.trim(),
      secib_client_secret: inputClientSecret.value.trim(),
      gateway_url: inputGatewayUrl.value.trim().replace(/\/+$/, ""),
      gateway_api_key: inputGatewayApiKey.value.trim()
    };

    try {
      await browser.storage.local.set(payload);
      console.log("[SECIB Link] Paramètres sauvegardés :", {
        url: payload.secib_base_url,
        cabinetId: payload.secib_cabinet_id ? "(défini)" : "(vide)",
        clientId: payload.secib_client_id ? "(défini)" : "(vide)",
        secret: payload.secib_client_secret ? "(défini)" : "(vide)"
      });

      // Vérification immédiate par relecture
      const check = await browser.storage.local.get([
        "secib_base_url", "secib_cabinet_id", "secib_client_id", "secib_client_secret"
      ]);

      if (verbose) {
        if (check.secib_base_url && check.secib_cabinet_id &&
            check.secib_client_id && check.secib_client_secret) {
          showFeedback("success", "✓ Paramètres enregistrés avec succès");
          showError(null);
          setTimeout(() => init(), 800);
        } else {
          showFeedback("error", "Tous les champs sont obligatoires");
        }
      }
    } catch (e) {
      console.error("[SECIB Link] Erreur sauvegarde :", e);
      if (verbose) {
        showFeedback("error", "Erreur sauvegarde : " + e.message);
      }
    }
  }

  function showFeedback(type, message) {
    settingsFeedback.className = "settings-feedback " + type;
    settingsFeedback.textContent = message;
  }

  // ---- Recherche manuelle de dossier ----
  searchInput.addEventListener("input", () => {
    const term = searchInput.value.trim();
    btnSearchClear.classList.toggle("hidden", term.length === 0);

    clearTimeout(searchTimer);
    if (term.length === 0) {
      // Sortie du mode recherche → réinitialise l'auto-détection
      if (searchMode) {
        searchMode = false;
        init().catch((e) => console.error("[SECIB Link] Retour auto :", e));
      }
      return;
    }
    if (term.length < 2) return; // attend au moins 2 caractères
    searchTimer = setTimeout(() => runManualDossierSearch(term), 300);
  });

  btnSearchClear.addEventListener("click", () => {
    searchInput.value = "";
    btnSearchClear.classList.add("hidden");
    if (searchMode) {
      searchMode = false;
      init().catch((e) => console.error("[SECIB Link] Retour auto :", e));
    }
    searchInput.focus();
  });

  /**
   * Recherche libre de dossiers via SECIB et affiche les résultats.
   * On reste sur le mail courant : les résultats permettent d'enregistrer
   * le mail dans n'importe quel dossier trouvé.
   */
  async function runManualDossierSearch(term) {
    searchMode = true;
    showError(null);
    showLoader(true);
    results.innerHTML = "";
    try {
      const found = await SecibAPI.rechercherDossiers(term, 20);
      showLoader(false);
      const dossiers = (Array.isArray(found) ? found : []).map((d) => ({
        dossierId: d.DossierId,
        code: d.Code,
        nom: d.Nom,
        type: d.Type,
        responsable: d.LoginResponsable,
        confidentiel: d.Confidentiel,
        roleLabel: "",
        references: "",
        personneNom: ""
      }));
      // Note : on conserve les dossiers du tiers pour l'autocomplete des PJ,
      // mais la recherche peut renvoyer des dossiers hors-tiers
      renderManualSearchResults(dossiers, term);
    } catch (err) {
      showLoader(false);
      console.error("[SECIB Link] Recherche dossier échouée :", err);
      showError("Recherche dossier échouée : " + err.message);
    }
  }

  function renderManualSearchResults(dossiers, term) {
    if (dossiers.length === 0) {
      results.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon">&#128269;</div>
          <p>Aucun dossier ne correspond à<br><strong>${escapeHtml(term)}</strong></p>
        </div>`;
      return;
    }
    const header = `${dossiers.length} dossier${dossiers.length > 1 ? "s" : ""} pour « ${term} »`;
    results.innerHTML = `<div class="results-header">${escapeHtml(header)}</div>`;
    for (const d of dossiers) {
      const card = document.createElement("div");
      card.className = "dossier-card";
      card.innerHTML = `
        <div class="dossier-top">
          <span class="dossier-ref">${escapeHtml(d.code || "—")}</span>
          ${d.confidentiel ? `<span class="dossier-status status-archive">Confidentiel</span>` : ""}
        </div>
        <div class="dossier-title">${escapeHtml(d.nom || "Sans intitulé")}</div>
        <div class="dossier-meta">
          ${d.type ? `<span>${escapeHtml(d.type)}</span>` : ""}
          ${d.responsable ? `<span>Resp. ${escapeHtml(d.responsable)}</span>` : ""}
        </div>
        <div class="dossier-actions">
          <button type="button" class="btn-save-doc">
            <span>↓</span> Enregistrer le mail
          </button>
        </div>
      `;
      const btn = card.querySelector(".btn-save-doc");
      btn.addEventListener("click", () => {
        if (!currentMessage) {
          alert("Sélectionne un mail dans Thunderbird avant d'enregistrer.");
          return;
        }
        openSaveModal(d);
      });
      results.appendChild(card);
    }
  }

  // ---- Init au chargement du popup ----
  await init();

  /**
   * Récupère le message affiché et lance la recherche SECIB.
   */
  async function init() {
    showError(null);
    results.innerHTML = "";

    try {
      // Vérifier la config
      await SecibAPI.getConfig();
    } catch (e) {
      showLoader(false);
      renderSenderPlaceholder();
      showError("Configuration manquante. Cliquez sur l'engrenage pour configurer l'accès API SECIB.");
      return;
    }

    // Récupérer le message courant
    // Priorité : pendingMessageId (poussé par le background) > param URL ?messageId=...
    let message = null;
    try {
      let mid = pendingMessageId;
      pendingMessageId = null;
      if (mid === null) {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get("messageId");
        if (fromUrl) mid = parseInt(fromUrl, 10);
      }
      if (mid !== null && !Number.isNaN(mid)) {
        message = await browser.messages.get(mid);
      }
    } catch (e) {
      console.warn("[SECIB Link] Impossible de récupérer le message :", e);
    }

    if (!message) {
      renderSenderPlaceholder();
      showError("Sélectionne un mail dans Thunderbird pour afficher ses dossiers SECIB.");
      return;
    }

    // Stocker le message courant pour l'enregistrement ultérieur
    currentMessage = message;

    // Parser l'expéditeur
    const fromHeader = message.author || "";
    const parsed = parseFromHeader(fromHeader);

    renderSender(parsed.name, parsed.email, message.subject);

    // S'assurer que le tag SECIB existe, puis afficher le bandeau si déjà appliqué
    await ensureSecibTag();
    await refreshSavedBanner();

    // Lancer la recherche
    showLoader(true);
    try {
      const { personnes, tentatives } = await searchPersonne(parsed.email, parsed.name);
      console.log("[SECIB Link] Tentatives :", tentatives);

      if (personnes.length === 0) {
        showLoader(false);
        renderNoResults(parsed.email, tentatives);
        return;
      }

      // Récupérer les parties (= participations dans des dossiers) de chaque personne
      // PartieApiDto = { Dossier: {Code, Nom, ...}, Personne, TypePartieId, References, ... }
      // On dédoublonne par DossierId au cas où plusieurs personnes pointent le même dossier.
      const dossiersById = new Map();
      for (const personne of personnes) {
        try {
          const parties = await SecibAPI.getDossiersPersonne(personne.PersonneId);
          if (!Array.isArray(parties)) continue;

          for (const partie of parties) {
            const d = partie.Dossier;
            if (!d || !d.DossierId) continue;
            if (dossiersById.has(d.DossierId)) continue; // dédoublonnage

            dossiersById.set(d.DossierId, {
              dossierId: d.DossierId,
              code: d.Code,
              nom: d.Nom,
              type: d.Type,
              responsable: d.LoginResponsable,
              confidentiel: d.Confidentiel,
              roleLabel: getRoleLabel(partie.TypePartieId),
              references: partie.References,
              personneNom: personne.Nom || personne.NomCourt || personne.NomComplet
            });
          }
        } catch (err) {
          console.warn("[SECIB Link] Erreur récupération parties", personne.PersonneId, err);
        }
      }
      const allDossiers = Array.from(dossiersById.values());
      dossiersTiers = allDossiers;

      showLoader(false);

      if (allDossiers.length === 0) {
        // Personnes trouvées mais aucun dossier rattaché
        renderPersonnesSansDossiers(personnes);
      } else {
        renderDossiers(allDossiers, personnes);
      }
    } catch (err) {
      showLoader(false);
      if (err.message.includes("AUTH_FAILED")) {
        showError("Authentification SECIB échouée. Vérifiez vos identifiants.");
      } else if (err.message.includes("API_ERROR")) {
        showError(`Erreur API SECIB : ${err.message}`);
      } else {
        showError(`Erreur inattendue : ${err.message}`);
      }
    }
  }

  /**
   * Recherche en cascade : email exact (Coordonnees) → domaine → dénomination par nom.
   * Retourne { personnes, strategie } pour information de debug.
   */
  async function searchPersonne(email, name) {
    const tentatives = [];

    // Stratégie 1 : email complet via Coordonnees
    let results = await SecibAPI.rechercherParCoordonnees(email, 10);
    tentatives.push(`Email "${email}" → ${arrLen(results)} résultat(s)`);
    if (hasResults(results)) return { personnes: results, tentatives };

    // Stratégie 2 : domaine de l'email via Coordonnees (ex: securitepros.com)
    const domain = email.split("@")[1];
    if (domain) {
      results = await SecibAPI.rechercherParCoordonnees(domain, 10);
      tentatives.push(`Domaine "${domain}" → ${arrLen(results)} résultat(s)`);
      if (hasResults(results)) return { personnes: results, tentatives };

      // Stratégie 3 : nom du domaine sans extension via Denomination
      const domainName = domain.split(".")[0];
      if (domainName && domainName.length > 2) {
        results = await SecibAPI.rechercherParDenomination(domainName, 10);
        tentatives.push(`Nom domaine "${domainName}" → ${arrLen(results)} résultat(s)`);
        if (hasResults(results)) return { personnes: results, tentatives };
      }
    }

    // Stratégie 4 : nom de l'expéditeur (header From) via Denomination
    const nameParts = name.split(/\s+/).filter((p) => p.length > 2);
    if (nameParts.length > 0) {
      const term = nameParts.slice(0, 2).join(" ");
      results = await SecibAPI.rechercherParDenomination(term, 10);
      tentatives.push(`Nom "${term}" → ${arrLen(results)} résultat(s)`);
      if (hasResults(results)) return { personnes: results, tentatives };
    }

    // Stratégie 5 : partie locale de l'email (avant @)
    const localPart = email.split("@")[0].replace(/[._-]/g, " ");
    if (localPart && localPart.length > 2 && localPart !== name) {
      results = await SecibAPI.rechercherParDenomination(localPart, 10);
      tentatives.push(`Local "${localPart}" → ${arrLen(results)} résultat(s)`);
      if (hasResults(results)) return { personnes: results, tentatives };
    }

    return { personnes: [], tentatives };
  }

  function hasResults(r) { return Array.isArray(r) && r.length > 0; }
  function arrLen(r) { return Array.isArray(r) ? r.length : 0; }

  // ---- Rendu ----

  function renderSenderPlaceholder() {
    senderInfo.innerHTML = `<div class="sender-placeholder"><p>Sélectionnez un message pour afficher les informations SECIB.</p></div>`;
  }

  function renderSender(name, email, subject) {
    senderInfo.innerHTML = `
      <div class="sender-detail">
        <span class="sender-name">${escapeHtml(name)}</span>
        <span class="sender-email">${escapeHtml(email)}</span>
        ${subject ? `<span class="sender-subject" title="${escapeHtml(subject)}">${escapeHtml(subject)}</span>` : ""}
      </div>
    `;
  }

  function renderDossiers(dossiers, personnes = []) {
    const noms = personnes.map(p => p.Nom || p.NomCourt || p.NomComplet).filter(Boolean);
    const header = noms.length
      ? `${dossiers.length} dossier${dossiers.length > 1 ? "s" : ""} · ${noms.slice(0, 2).join(", ")}${noms.length > 2 ? "…" : ""}`
      : `Dossiers (${dossiers.length})`;
    results.innerHTML = `<div class="results-header">${escapeHtml(header)}</div>`;

    for (const d of dossiers) {
      const card = document.createElement("div");
      card.className = "dossier-card";
      card.innerHTML = `
        <div class="dossier-top">
          <span class="dossier-ref">${escapeHtml(d.code || "—")}</span>
          ${d.confidentiel ? `<span class="dossier-status status-archive">Confidentiel</span>` : ""}
        </div>
        <div class="dossier-title">${escapeHtml(d.nom || "Sans intitulé")}</div>
        <div class="dossier-meta">
          ${d.type ? `<span>${escapeHtml(d.type)}</span>` : ""}
          ${d.responsable ? `<span>Resp. ${escapeHtml(d.responsable)}</span>` : ""}
          ${d.references ? `<span>Réf. ${escapeHtml(d.references)}</span>` : ""}
        </div>
        ${d.roleLabel ? `<span class="dossier-role">${escapeHtml(d.roleLabel)}</span>` : ""}
        <div class="dossier-actions">
          <button type="button" class="btn-save-doc" data-dossier-id="${d.dossierId}">
            <span>↓</span> Enregistrer le mail
          </button>
        </div>
      `;
      // Brancher le bouton
      const btn = card.querySelector(".btn-save-doc");
      btn.addEventListener("click", () => openSaveModal(d));
      results.appendChild(card);
    }
  }

  function renderNoResults(email, tentatives = []) {
    const tentativesHtml = tentatives.length
      ? `<details class="tentatives">
           <summary>Détails des recherches (${tentatives.length})</summary>
           <ul>${tentatives.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
         </details>`
      : "";

    results.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">&#128269;</div>
        <p>Aucun tiers trouvé dans SECIB pour<br><strong>${escapeHtml(email)}</strong></p>
        ${tentativesHtml}
      </div>
    `;
  }

  function renderPersonnesSansDossiers(personnes) {
    let html = `<div class="results-header">Tiers trouvé${personnes.length > 1 ? "s" : ""} (${personnes.length}) — sans dossier rattaché</div>`;
    for (const p of personnes) {
      const nom = p.Nom || p.NomCourt || p.NomComplet || "—";
      const type = p.TypePersonne === "PM" ? "Personne morale" : "Personne physique";
      const ville = p.Commune ? ` · ${p.Commune}` : "";
      html += `
        <div class="dossier-card">
          <div class="dossier-title">${escapeHtml(nom)}</div>
          <div class="dossier-meta"><span>${escapeHtml(type)}${escapeHtml(ville)}</span></div>
        </div>`;
    }
    results.innerHTML = html;
  }

  // ---- Helpers ----

  function parseFromHeader(raw) {
    const emailMatch = raw.match(/<([^>]+)>/);
    const email = emailMatch ? emailMatch[1] : raw.trim();
    let name = raw.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
    if (!name || name === email) {
      name = email.split("@")[0].replace(/[._-]/g, " ");
    }
    return { email: email.toLowerCase(), name };
  }

  function showLoader(visible) {
    loader.classList.toggle("hidden", !visible);
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

  function getStatusClass(statut) {
    if (!statut) return "";
    const s = statut.toString().toLowerCase();
    if (s.includes("ouvert") || s.includes("cours")) return "status-ouvert";
    if (s.includes("ferm") || s.includes("clos")) return "status-ferme";
    if (s.includes("archiv")) return "status-archive";
    return "";
  }

  function getRoleLabel(typePartieId) {
    const roles = { 1: "Client", 2: "Adversaire", 3: "Juridiction", 4: "Correspondant" };
    return roles[typePartieId] || "";
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ============================================================
  // ENREGISTREMENT D'UN MAIL DANS UN DOSSIER SECIB
  // ============================================================

  btnModalClose.addEventListener("click", closeSaveModal);
  btnModalCancel.addEventListener("click", closeSaveModal);
  btnModalSave.addEventListener("click", performSave);

  // Toggle mode avancé : afficher la section et charger les PJ à la demande
  checkAdvanced.addEventListener("change", async () => {
    if (checkAdvanced.checked) {
      advancedSection.classList.remove("hidden");
      if (!advancedLoaded) {
        advancedLoaded = true;
        await loadAttachments();
      }
    } else {
      advancedSection.classList.add("hidden");
    }
  });

  /**
   * Ouvre la modale, charge les répertoires du dossier et propose un nom de fichier.
   */
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

  /**
   * Détecte un nom de répertoire dédié aux emails.
   * Matche : "Mail", "Mails", "Email", "Emails", "E-mail", "E-mails", "Courriel(s)".
   */
  function isEmailRepertoireName(name) {
    if (!name) return false;
    return /^(e[-\s]?mails?|courriels?)$/i.test(name.trim());
  }

  function closeSaveModal() {
    saveModal.classList.add("hidden");
    currentDossier = null;
    // Si un changement de mail a été reçu pendant que la modale était ouverte,
    // rafraîchir maintenant.
    if (pendingMessageId !== null) {
      init().catch((e) => console.error("[SECIB Link] init après close modale :", e));
    }
  }

  /**
   * Construit la liste d'items à uploader (mail + PJ éventuelles) puis les
   * envoie à SECIB séquentiellement avec une barre de progression. Le tag
   * "Enregistré SECIB" n'est posé que si TOUT a réussi.
   */
  async function performSave() {
    if (!currentMessage || !currentDossier) return;

    const fileName = inputFilename.value.trim();
    if (!fileName) {
      showSaveFeedback("error", "Le nom du fichier est obligatoire");
      return;
    }

    const repId = selectRepertoire.value ? parseInt(selectRepertoire.value, 10) : null;
    const isAdvanced = checkAdvanced.checked;
    const stripAttachments = isAdvanced && checkStripAttachments.checked;

    // Construire la liste des uploads
    const uploads = [];

    // 1. Le mail lui-même
    uploads.push({
      kind: "mail",
      fileName,
      dossierId: currentDossier.dossierId,
      repertoireId: repId,
      stripAttachments
    });

    // 2. Les PJ incluses en mode avancé
    if (isAdvanced) {
      for (const att of attachmentsState) {
        if (!att.included) continue;
        if (!att.dossierId) {
          showSaveFeedback("error", `Sélectionne un dossier pour la pièce jointe "${att.name}"`);
          return;
        }
        uploads.push({
          kind: "attachment",
          partName: att.partName,
          fileName: att.name,
          dossierId: att.dossierId,
          repertoireId: att.repertoireId || null
        });
      }
    }

    btnModalSave.disabled = true;
    btnModalSave.textContent = "Envoi en cours…";
    showSaveFeedback(null);
    saveProgress.classList.remove("hidden");
    updateProgress(0, uploads.length, "");

    const errors = [];
    let done = 0;

    for (const item of uploads) {
      const label = item.kind === "mail"
        ? `Mail (${item.fileName})`
        : `PJ : ${item.fileName}`;
      updateProgress(done, uploads.length, label);
      try {
        const base64 = await encodeUploadItem(item);
        await SecibAPI.saveDocument({
          fileName: item.fileName,
          dossierId: item.dossierId,
          repertoireId: item.repertoireId,
          contentBase64: base64,
          isAnnexe: item.kind === "attachment"
        });
        done++;
        updateProgress(done, uploads.length, label);
      } catch (err) {
        console.error(`[SECIB Link] Erreur upload ${item.kind}`, item.fileName, err);
        errors.push(`${item.fileName} : ${err.message}`);
      }
    }

    btnModalSave.disabled = false;
    btnModalSave.textContent = "Enregistrer";

    if (errors.length === 0) {
      // Tag SECIB uniquement si tout est OK
      try {
        await tagMessageAsSaved(currentMessage.id);
        await refreshSavedBanner();
      } catch (tagErr) {
        console.warn("[SECIB Link] Tag non appliqué :", tagErr);
      }
      const summary = uploads.length === 1
        ? `✓ Mail enregistré dans ${currentDossier.code}`
        : `✓ ${uploads.length} fichiers enregistrés (${currentDossier.code} + PJ)`;
      showSaveFeedback("success", summary);
      setTimeout(closeSaveModal, 1800);
    } else if (errors.length < uploads.length) {
      showSaveFeedback("error",
        `Partiel : ${done}/${uploads.length} enregistrés. Échecs : ${errors.join(" · ")}`);
    } else {
      showSaveFeedback("error", `Échec total : ${errors[0]}`);
    }
  }

  /**
   * Encode l'item à uploader en base64 (mail brut ou PJ).
   */
  async function encodeUploadItem(item) {
    if (item.kind === "mail") {
      if (item.stripAttachments) {
        const eml = await buildStrippedEml(currentMessage.id);
        return await toBase64(eml);
      }
      const raw = await browser.messages.getRaw(currentMessage.id);
      return await toBase64(raw);
    }
    // attachment
    const file = await browser.messages.getAttachmentFile(currentMessage.id, item.partName);
    return await toBase64(file);
  }

  function updateProgress(done, total, label) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    saveProgressFill.style.width = pct + "%";
    saveProgressLabel.textContent = label
      ? `${done}/${total} — ${label}`
      : `${done}/${total}`;
  }

  function showSaveFeedback(type, message) {
    if (!type) {
      saveFeedback.classList.add("hidden");
      return;
    }
    saveFeedback.className = "settings-feedback " + type;
    saveFeedback.textContent = message;
    saveFeedback.classList.remove("hidden");
  }

  // ============================================================
  // MODE AVANCÉ — LISTING DES PIÈCES JOINTES
  // ============================================================

  // Cache local des répertoires par dossierId pour éviter les appels redondants
  const repertoireCache = new Map();

  async function getRepertoiresFor(dossierId) {
    if (repertoireCache.has(dossierId)) return repertoireCache.get(dossierId);
    let reps = [];
    try {
      reps = await SecibAPI.getRepertoiresDossier(dossierId);
      if (!Array.isArray(reps)) reps = [];
    } catch (e) {
      console.warn("[SECIB Link] Erreur chargement répertoires", dossierId, e);
    }
    repertoireCache.set(dossierId, reps);
    return reps;
  }

  /**
   * Charge la liste des PJ du mail courant et alimente le tableau.
   * Détecte les images inline (Content-ID référencés dans le corps HTML).
   */
  async function loadAttachments() {
    if (!currentMessage) return;
    attachmentsLoading.classList.remove("hidden");
    attachmentsTable.classList.add("hidden");
    attachmentsEmpty.classList.add("hidden");

    try {
      const list = await browser.messages.listAttachments(currentMessage.id);
      const inlineKeys = await detectInlineParts(currentMessage.id);

      attachmentsState = (Array.isArray(list) ? list : []).map((a) => {
        const isInline = inlineKeys.has(a.partName) ||
          inlineKeys.has(a.contentId || "") ||
          /^smime\.p7s$/i.test(a.name || "");
        return {
          partName: a.partName,
          name: a.name || `piece-${a.partName}`,
          size: a.size || 0,
          contentType: a.contentType || "",
          isInline,
          included: !isInline, // les inline sont décochées par défaut
          dossierId: currentDossier ? currentDossier.dossierId : null,
          repertoireId: null
        };
      });

      attachmentsLoading.classList.add("hidden");

      if (attachmentsState.length === 0) {
        attachmentsEmpty.classList.remove("hidden");
        return;
      }

      attachmentsTable.classList.remove("hidden");
      await renderAttachmentsTable();
    } catch (err) {
      console.error("[SECIB Link] Erreur listing PJ", err);
      attachmentsLoading.classList.add("hidden");
      attachmentsEmpty.textContent = "Impossible de lister les pièces jointes : " + err.message;
      attachmentsEmpty.classList.remove("hidden");
    }
  }

  /**
   * Récupère l'arborescence MIME via getFull et retourne l'ensemble des
   * "partName" considérés comme inline (Content-Disposition inline OU
   * Content-ID référencé dans un body HTML).
   */
  async function detectInlineParts(messageId) {
    const inlineKeys = new Set();
    try {
      const full = await browser.messages.getFull(messageId);
      const allCids = [];
      const htmlBodies = [];
      walkMimeParts(full, (part) => {
        const headers = part.headers || {};
        const disp = headerValue(headers, "content-disposition");
        const cid = stripBrackets(headerValue(headers, "content-id"));
        const ct = (part.contentType || "").toLowerCase();

        if (cid) allCids.push({ cid, partName: part.partName });
        if (ct.startsWith("text/html") && part.body) htmlBodies.push(part.body);

        if (disp && /inline/i.test(disp) && part.partName) {
          inlineKeys.add(part.partName);
        }
      });

      // Marquer comme inline tout cid effectivement référencé dans un HTML body
      for (const { cid, partName } of allCids) {
        const cidLower = cid.toLowerCase();
        const referenced = htmlBodies.some((html) =>
          html.toLowerCase().includes(`cid:${cidLower}`)
        );
        if (referenced && partName) inlineKeys.add(partName);
      }
    } catch (e) {
      console.warn("[SECIB Link] detectInlineParts a échoué :", e);
    }
    return inlineKeys;
  }

  function walkMimeParts(part, visit) {
    if (!part) return;
    visit(part);
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) walkMimeParts(child, visit);
    }
  }

  function headerValue(headers, key) {
    const v = headers[key.toLowerCase()];
    if (Array.isArray(v) && v.length > 0) return v[0];
    if (typeof v === "string") return v;
    return "";
  }

  function stripBrackets(s) {
    return (s || "").trim().replace(/^<|>$/g, "");
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  /**
   * Rend une ligne par PJ dans le tableau. Chaque ligne pré-remplit le
   * sélecteur de dossier avec les dossiers du tiers + une option "Autre…"
   * qui bascule en mode autocomplete via SecibAPI.rechercherDossiers.
   */
  async function renderAttachmentsTable() {
    attachmentsTbody.innerHTML = "";

    // Pré-charger les répertoires du dossier en cours pour pré-sélection rapide
    const baseReps = currentDossier
      ? await getRepertoiresFor(currentDossier.dossierId)
      : [];

    for (let i = 0; i < attachmentsState.length; i++) {
      const att = attachmentsState[i];
      const tr = document.createElement("tr");
      tr.dataset.idx = String(i);

      // Colonne 1 : checkbox include
      const tdCheck = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = att.included;
      cb.addEventListener("change", () => {
        att.included = cb.checked;
      });
      tdCheck.appendChild(cb);

      // Colonne 2 : nom + taille + badge inline
      const tdName = document.createElement("td");
      tdName.className = "att-name";
      tdName.title = att.name;
      tdName.textContent = att.name;
      if (att.isInline) {
        const badge = document.createElement("span");
        badge.className = "att-inline-badge";
        badge.textContent = "inline";
        badge.title = "Image embarquée dans le corps du mail (souvent une signature)";
        tdName.appendChild(badge);
      }
      const sizeSpan = document.createElement("span");
      sizeSpan.className = "att-size";
      sizeSpan.textContent = formatSize(att.size);
      tdName.appendChild(sizeSpan);

      // Colonne 3 : sélecteur de dossier (avec autocomplete via "Autre…")
      const tdDossier = document.createElement("td");
      const dossierSelect = buildDossierSelect(att);
      tdDossier.appendChild(dossierSelect.element);

      // Colonne 4 : sélecteur de répertoire
      const tdRep = document.createElement("td");
      const repSelect = document.createElement("select");
      repSelect.innerHTML = `<option value="">Racine</option>`;
      tdRep.appendChild(repSelect);

      // Helper pour peupler le select de répertoires
      const populateReps = async (dossierId) => {
        repSelect.innerHTML = `<option value="">Racine</option>`;
        if (!dossierId) return;
        const reps = await getRepertoiresFor(dossierId);
        for (const r of reps) {
          const opt = document.createElement("option");
          opt.value = r.RepertoireId;
          opt.textContent = r.Nom || r.Libelle || `Répertoire #${r.RepertoireId}`;
          repSelect.appendChild(opt);
        }
        // Pré-sélection "Email/Documents" selon disposition
        const emailRep = reps.find((r) => isEmailRepertoireName(r.Nom || r.Libelle));
        if (emailRep) repSelect.value = String(emailRep.RepertoireId);
      };

      repSelect.addEventListener("change", () => {
        att.repertoireId = repSelect.value ? parseInt(repSelect.value, 10) : null;
      });

      // Initialiser avec le dossier courant
      if (att.dossierId === (currentDossier && currentDossier.dossierId)) {
        for (const r of baseReps) {
          const opt = document.createElement("option");
          opt.value = r.RepertoireId;
          opt.textContent = r.Nom || r.Libelle || `Répertoire #${r.RepertoireId}`;
          repSelect.appendChild(opt);
        }
        const emailRep = baseReps.find((r) => isEmailRepertoireName(r.Nom || r.Libelle));
        if (emailRep) repSelect.value = String(emailRep.RepertoireId);
        att.repertoireId = repSelect.value ? parseInt(repSelect.value, 10) : null;
      } else if (att.dossierId) {
        populateReps(att.dossierId);
      }

      // Quand le dossier change → recharger les répertoires
      dossierSelect.onChange = async (newDossierId) => {
        att.dossierId = newDossierId;
        att.repertoireId = null;
        await populateReps(newDossierId);
      };

      tr.appendChild(tdCheck);
      tr.appendChild(tdName);
      tr.appendChild(tdDossier);
      tr.appendChild(tdRep);
      attachmentsTbody.appendChild(tr);
    }
  }

  /**
   * Construit un sélecteur de dossier alimenté par les dossiers du tiers
   * + option "Autre…" qui transforme la cellule en input d'autocomplete.
   * Retourne { element, onChange }.
   */
  function buildDossierSelect(att) {
    const wrapper = document.createElement("div");
    const select = document.createElement("select");

    if (currentDossier) {
      const opt = document.createElement("option");
      opt.value = String(currentDossier.dossierId);
      opt.textContent = `${currentDossier.code} (en cours)`;
      select.appendChild(opt);
    }
    for (const d of dossiersTiers) {
      if (currentDossier && d.dossierId === currentDossier.dossierId) continue;
      const opt = document.createElement("option");
      opt.value = String(d.dossierId);
      opt.textContent = `${d.code || "—"} · ${truncate(d.nom || "", 26)}`;
      select.appendChild(opt);
    }
    const optOther = document.createElement("option");
    optOther.value = "__other__";
    optOther.textContent = "Autre dossier…";
    select.appendChild(optOther);

    if (att.dossierId) select.value = String(att.dossierId);

    let onChangeCb = null;
    const wrapperApi = {
      element: wrapper,
      get onChange() { return onChangeCb; },
      set onChange(fn) { onChangeCb = fn; }
    };

    select.addEventListener("change", () => {
      if (select.value === "__other__") {
        // Bascule en mode autocomplete
        wrapper.innerHTML = "";
        const auto = buildDossierAutocomplete(att, (chosen) => {
          // Re-construit le select normal avec le dossier choisi
          att.dossierId = chosen.dossierId;
          // Re-render la ligne entière pour refléter
          rebuildAttachmentRow(att);
        });
        wrapper.appendChild(auto);
      } else {
        const newId = parseInt(select.value, 10);
        if (onChangeCb) onChangeCb(newId);
      }
    });

    wrapper.appendChild(select);
    return wrapperApi;
  }

  /**
   * Re-render une ligne du tableau (utilisé après sélection autocomplete).
   */
  async function rebuildAttachmentRow(att) {
    // Trouver l'index de l'attachement
    const idx = attachmentsState.indexOf(att);
    if (idx < 0) return;
    // Re-render tout le tableau (plus simple et fiable que reconstruire 1 ligne)
    await renderAttachmentsTable();
  }

  /**
   * Input + dropdown d'autocomplete sur SecibAPI.rechercherDossiers.
   * onSelect reçoit { dossierId, code, nom }.
   */
  function buildDossierAutocomplete(att, onSelect) {
    const container = document.createElement("div");
    container.className = "dossier-search-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "dossier-search-input";
    input.placeholder = "Code ou nom du dossier…";
    container.appendChild(input);

    const results = document.createElement("div");
    results.className = "dossier-search-results hidden";
    container.appendChild(results);

    let timer = null;
    let lastQuery = "";

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) {
        results.classList.add("hidden");
        return;
      }
      timer = setTimeout(async () => {
        if (q === lastQuery) return;
        lastQuery = q;
        results.innerHTML = "";
        results.classList.remove("hidden");
        results.innerHTML = `<div class="dsr-empty">Recherche…</div>`;
        try {
          const found = await SecibAPI.rechercherDossiers(q, 10);
          results.innerHTML = "";
          if (!Array.isArray(found) || found.length === 0) {
            results.innerHTML = `<div class="dsr-empty">Aucun résultat</div>`;
            return;
          }
          for (const d of found) {
            const item = document.createElement("div");
            item.className = "dsr-item";
            item.innerHTML = `<span class="dsr-code">${escapeHtml(d.Code || "—")}</span> · ${escapeHtml(d.Nom || "")}`;
            item.addEventListener("click", () => {
              results.classList.add("hidden");
              onSelect({
                dossierId: d.DossierId,
                code: d.Code,
                nom: d.Nom
              });
            });
            results.appendChild(item);
          }
        } catch (err) {
          console.warn("[SECIB Link] Recherche dossier échouée :", err);
          results.innerHTML = `<div class="dsr-empty">Erreur : ${escapeHtml(err.message)}</div>`;
        }
      }, 300);
    });

    // Fermer le dropdown si clic hors zone
    document.addEventListener("click", (ev) => {
      if (!container.contains(ev.target)) results.classList.add("hidden");
    });

    return container;
  }

  function truncate(s, n) {
    s = s || "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // ============================================================
  // RECONSTRUCTION D'UN .EML ALLÉGÉ (sans pièces jointes)
  // ============================================================

  /**
   * Reconstruit un .eml minimal depuis getFull : headers principaux + body
   * (HTML préféré, fallback texte). Aucun multipart, aucune PJ.
   */
  async function buildStrippedEml(messageId) {
    const full = await browser.messages.getFull(messageId);
    const headers = full.headers || {};

    let htmlBody = null;
    let textBody = null;
    walkMimeParts(full, (part) => {
      const ct = (part.contentType || "").toLowerCase();
      if (!part.body) return;
      if (ct.startsWith("text/html") && htmlBody === null) htmlBody = part.body;
      else if (ct.startsWith("text/plain") && textBody === null) textBody = part.body;
    });

    const useHtml = htmlBody !== null;
    const body = useHtml ? htmlBody : (textBody || "");
    const contentType = useHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";

    const wantedHeaders = ["from", "to", "cc", "bcc", "subject", "date", "message-id", "reply-to", "in-reply-to", "references"];
    const lines = [];
    for (const h of wantedHeaders) {
      const v = headerValue(headers, h);
      if (v) lines.push(`${capitalizeHeader(h)}: ${v}`);
    }
    lines.push("MIME-Version: 1.0");
    lines.push(`Content-Type: ${contentType}`);
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("X-SECIB-Link: stripped-attachments");
    lines.push("");
    lines.push(body);

    return lines.join("\r\n");
  }

  function capitalizeHeader(h) {
    return h.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("-");
  }

  // ============================================================
  // TAG THUNDERBIRD "Enregistré SECIB"
  // ============================================================

  /**
   * Crée le tag "secib-saved" s'il n'existe pas déjà dans Thunderbird.
   * Fait silencieusement le tour des deux API possibles (TB 115/128).
   */
  async function ensureSecibTag() {
    try {
      const tags = await listTags();
      if (tags.some((t) => t.key === SECIB_TAG_KEY)) return;
      await createTag(SECIB_TAG_KEY, SECIB_TAG_LABEL, SECIB_TAG_COLOR);
      console.log("[SECIB Link] Tag créé :", SECIB_TAG_KEY);
    } catch (e) {
      console.warn("[SECIB Link] Impossible de créer le tag SECIB :", e);
    }
  }

  async function listTags() {
    if (browser.messages.tags && typeof browser.messages.tags.list === "function") {
      return await browser.messages.tags.list();
    }
    if (typeof browser.messages.listTags === "function") {
      return await browser.messages.listTags();
    }
    return [];
  }

  async function createTag(key, label, color) {
    if (browser.messages.tags && typeof browser.messages.tags.create === "function") {
      return await browser.messages.tags.create(key, label, color);
    }
    if (typeof browser.messages.createTag === "function") {
      return await browser.messages.createTag(key, label, color);
    }
    throw new Error("API de création de tag indisponible");
  }

  /**
   * Affiche ou cache le bandeau "déjà enregistré" selon les tags du mail courant.
   */
  async function refreshSavedBanner() {
    if (!savedBanner) return;
    if (!currentMessage) {
      savedBanner.classList.add("hidden");
      return;
    }
    try {
      const fresh = await browser.messages.get(currentMessage.id);
      const tags = Array.isArray(fresh && fresh.tags) ? fresh.tags : [];
      savedBanner.classList.toggle("hidden", !tags.includes(SECIB_TAG_KEY));
    } catch (e) {
      console.warn("[SECIB Link] Lecture des tags échouée :", e);
      savedBanner.classList.add("hidden");
    }
  }

  /**
   * Ajoute le tag SECIB au mail (sans écraser les tags existants).
   */
  async function tagMessageAsSaved(messageId) {
    const fresh = await browser.messages.get(messageId);
    const existing = Array.isArray(fresh && fresh.tags) ? fresh.tags : [];
    if (existing.includes(SECIB_TAG_KEY)) return;
    const next = [...existing, SECIB_TAG_KEY];
    await browser.messages.update(messageId, { tags: next });
  }

  /**
   * Encode différentes formes de données binaires en base64.
   * Thunderbird messages.getRaw() peut renvoyer un File, un Blob, un ArrayBuffer ou une string.
   */
  async function toBase64(data) {
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof ArrayBuffer) {
      blob = new Blob([data]);
    } else if (typeof data === "string") {
      // String binary "raw" : convertir char par char en bytes
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      blob = new Blob([bytes]);
    } else {
      throw new Error("Format de données inconnu pour l'encodage base64");
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // dataURL : "data:application/octet-stream;base64,XXXX"
        const result = reader.result;
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
})();
