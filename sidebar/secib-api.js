// SECIB Link — Module API (via Gateway NPL-SECIB uniquement)
// Auth : X-API-Key sur toutes les requêtes.
// Base URL : configurable dans les settings (https://apisecib.nplavocat.com par défaut).

const SecibAPI = (() => {
  // ─── Gateway NPL-SECIB ──────────────────────────────────────────
  // Contourne les endpoints SECIB qui exigent body-on-GET (impossibles en fetch).
  // Config : browser.storage.local { gateway_url, gateway_api_key }

  async function getGatewayConfig() {
    const stored = await browser.storage.local.get(["gateway_url", "gateway_api_key"]);
    if (!stored.gateway_url || !stored.gateway_api_key) {
      throw new Error("GATEWAY_CONFIG_MISSING");
    }
    return {
      baseUrl: stored.gateway_url.replace(/\/+$/, ""),
      apiKey: stored.gateway_api_key.trim()
    };
  }

  /**
   * Appel générique vers la gateway NPL-SECIB (https://apisecib.nplavocat.com/api/v1).
   * La gateway unwrap SECIB et renvoie { data: <payload> } — on extrait `.data`.
   */
  async function gatewayCall(path, queryParams) {
    const config = await getGatewayConfig();
    const url = new URL(`${config.baseUrl}/api/v1${path}`);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    }
    console.log(`[SECIB Link] Gateway ${url.toString()}`);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-Key": config.apiKey,
        "Accept": "application/json"
      }
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

  // ─── Méthodes publiques ──────────────────────────────────────────

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

  /** Raccourci : recherche par email/téléphone via le filtre Coordonnees */
  async function rechercherParCoordonnees(coordonnees, limit = 10) {
    return rechercherPersonne({ coordonnees }, limit);
  }

  /** Raccourci : recherche par dénomination (nom/raison sociale) */
  async function rechercherParDenomination(denomination, limit = 10) {
    return rechercherPersonne({ denomination }, limit);
  }

  /** Détail personne physique via Gateway */
  async function getPersonnePhysique(personneId) {
    return gatewayCall(`/personnes/${encodeURIComponent(personneId)}`, { type: "PP" });
  }

  /** Détail personne morale via Gateway */
  async function getPersonneMorale(personneId) {
    return gatewayCall(`/personnes/${encodeURIComponent(personneId)}`, { type: "PM" });
  }

  /** Liste les dossiers où une personne est partie (via Gateway) */
  async function getDossiersPersonne(personneId) {
    return gatewayCall(`/personnes/${encodeURIComponent(personneId)}/dossiers`);
  }

  /** Détail d'un dossier via Gateway */
  async function getDossierDetail(dossierId) {
    return gatewayCall(`/dossiers/${Number(dossierId)}`);
  }

  /**
   * Liste les répertoires d'un dossier via la gateway NPL-SECIB.
   * Endpoint : GET /api/v1/dossiers/{dossierId}/repertoires.
   */
  async function getRepertoiresDossier(dossierId) {
    return gatewayCall(`/dossiers/${Number(dossierId)}/repertoires`);
  }

  /**
   * Liste les parties d'un dossier via la gateway NPL-SECIB.
   * Endpoint : GET /api/v1/dossiers/{dossierId}/parties.
   */
  async function getPartiesDossier(dossierId) {
    return gatewayCall(`/dossiers/${Number(dossierId)}/parties`);
  }

  /**
   * Liste les documents d'un dossier via la gateway NPL-SECIB.
   * Renvoie DocumentCompactApiDto[] : DocumentId, Libelle, Extension, Date, RepertoireId, RepertoireLibelle, Type, DossierId, DossierCode, DossierNom.
   *
   * L'endpoint SECIB /Document/GetListeDocument attend ses filtres dans le body JSON
   * d'une requête GET, ce que le navigateur refuse. La gateway (Node.js) fait le
   * passe-plat via node:https et expose une API REST classique.
   */
  async function getDocumentsDossier(dossierId) {
    return gatewayCall("/documents", { dossierId: Number(dossierId) });
  }

  /**
   * Récupère le contenu binaire brut d'un document via la gateway NPL-SECIB.
   * Endpoint : GET /api/v1/documents/{documentId}/content.
   * Renvoie { documentId, fileName, mimeType, contentBase64 } — pas de conversion
   * PDF côté serveur, tous les formats stockés dans SECIB sont supportés.
   */
  async function getDocumentContent(documentId) {
    return gatewayCall(`/documents/${encodeURIComponent(documentId)}/content`);
  }

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

  /**
   * Enregistre un document dans un dossier (et un répertoire si fourni) via la Gateway.
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

  return {
    getGatewayConfig,
    rechercherPersonne,
    rechercherParCoordonnees,
    rechercherParDenomination,
    getPersonnePhysique,
    getPersonneMorale,
    getDossiersPersonne,
    getDossierDetail,
    getRepertoiresDossier,
    getPartiesDossier,
    getDocumentsDossier,
    getDocumentContent,
    getEtapesParapheur,
    getIntervenants,
    rechercherDossiers,
    saveDocument
  };
})();
