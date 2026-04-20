// SECIB Link — Module API SECIB
// OAuth2 client_credentials sur api.secib.fr/forward/{cabinetId}/ApiToken
// Appels API sur secibneo.secib.fr/{version}/{cabinetId}/api/v1/...

const SecibAPI = (() => {
  let _token = null;
  let _tokenExpiry = 0;

  /**
   * Récupère la configuration stockée.
   * baseUrl : ex "https://secibneo.secib.fr/8.2.1"
   * cabinetId : GUID du cabinet (utilisé dans le path API et dans l'URL token)
   */
  async function getConfig() {
    const stored = await browser.storage.local.get([
      "secib_base_url",
      "secib_cabinet_id",
      "secib_client_id",
      "secib_client_secret"
    ]);
    if (!stored.secib_base_url || !stored.secib_cabinet_id ||
        !stored.secib_client_id || !stored.secib_client_secret) {
      throw new Error("CONFIG_MISSING");
    }
    return {
      baseUrl: stored.secib_base_url.replace(/\/+$/, ""),
      cabinetId: stored.secib_cabinet_id.trim(),
      clientId: stored.secib_client_id.trim(),
      clientSecret: stored.secib_client_secret.trim()
    };
  }

  /**
   * Obtient un token OAuth2 client_credentials.
   * Endpoint : https://api.secib.fr/forward/{cabinetId}/ApiToken
   */
  async function authenticate() {
    if (_token && Date.now() < _tokenExpiry - 60000) return _token;

    const config = await getConfig();
    const tokenUrl = `https://api.secib.fr/forward/${config.cabinetId}/ApiToken`;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret
    });

    console.log("[SECIB Link] Token request →", tokenUrl);

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[SECIB Link] Auth failed", response.status, text);
      throw new Error(`AUTH_FAILED: ${response.status} — ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    _token = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    console.log("[SECIB Link] Token obtenu, expire dans", data.expires_in, "s");
    return _token;
  }

  /**
   * Construit l'URL complète : {baseUrl}/{cabinetId}/api/{version}{path}
   */
  function buildUrl(config, path, version, queryParams) {
    const url = new URL(`${config.baseUrl}/${config.cabinetId}/api/${version}${path}`);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    }
    return url.toString();
  }

  /**
   * Appel API générique.
   */
  async function apiCall(method, path, options = {}) {
    const config = await getConfig();
    const token = await authenticate();
    const version = options.version || "v1";

    const url = buildUrl(config, path, version, options.query);

    const headers = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }

    console.log(`[SECIB Link] ${method} ${url}`, options.body || "");

    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    if (response.status === 401) {
      _token = null;
      _tokenExpiry = 0;
      return apiCall(method, path, options);
    }

    const text = await response.text();

    if (!response.ok) {
      console.error(`[SECIB Link] API error ${response.status}`, text.slice(0, 500));
      throw new Error(`API_ERROR: ${response.status} — ${text.slice(0, 200)}`);
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

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
   * Recherche de personnes via POST /Personne/Get
   * Body : FiltrePersonneApiDto { Denomination, Coordonnees, FiltreType, ... }
   * @param {object} criteres - { denomination?, coordonnees?, type? }
   * @param {number} limit
   * @param {number} offset
   */
  async function rechercherPersonne(criteres, limit = 20, offset = 0) {
    const body = {};
    if (criteres.denomination) body.Denomination = criteres.denomination;
    if (criteres.coordonnees) body.Coordonnees = criteres.coordonnees;
    if (criteres.type) body.FiltreType = criteres.type;

    const range = `${offset}-${offset + limit - 1}`;
    return apiCall("POST", "/Personne/Get", {
      body,
      query: { range }
    });
  }

  /** Raccourci : recherche par email/téléphone via le filtre Coordonnees */
  async function rechercherParCoordonnees(coordonnees, limit = 10) {
    return rechercherPersonne({ coordonnees }, limit);
  }

  /** Raccourci : recherche par dénomination (nom/raison sociale) */
  async function rechercherParDenomination(denomination, limit = 10) {
    return rechercherPersonne({ denomination }, limit);
  }

  /** Détail personne physique */
  async function getPersonnePhysique(personneId) {
    return apiCall("GET", "/Personne/GetPersonnePhysique", { query: { personneId } });
  }

  /** Détail personne morale */
  async function getPersonneMorale(personneId) {
    return apiCall("GET", "/Personne/GetPersonneMorale", { query: { personneId } });
  }

  /** Liste les dossiers où une personne est partie (GET /Partie/GetByPersonneId) */
  async function getDossiersPersonne(personneId) {
    return apiCall("GET", "/Partie/GetByPersonneId", { query: { personneId } });
  }

  /** Détail d'un dossier */
  async function getDossierDetail(dossierId) {
    return apiCall("GET", "/Dossier/GetDossierById", { query: { dossierId } });
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
   * Recherche libre de dossiers via POST /Dossier/GetDossiers (filtre Nom OU Code).
   * Si le terme est numérique on tente Code exact, sinon recherche par Nom.
   * Renvoie DossierDetailApiDto[].
   */
  async function rechercherDossiers(terme, limit = 15) {
    const body = {};
    const t = (terme || "").trim();
    if (!t) return [];
    if (/^[A-Z0-9._\-/]+$/i.test(t) && /\d/.test(t)) {
      body.Code = t;
    } else {
      body.Nom = t;
    }
    const range = `0-${limit - 1}`;
    return apiCall("POST", "/Dossier/GetDossiers", { body, query: { range } });
  }

  /**
   * Enregistre un document dans un dossier (et un répertoire si fourni).
   * @param {object} doc - { fileName, dossierId, repertoireId?, contentBase64, isAnnexe? }
   * Note : on utilise SaveOrUpdateDocument car SaveDocument ignore RepertoireId.
   */
  async function saveDocument(doc) {
    const body = {
      FileName: doc.fileName,
      DossierId: doc.dossierId,
      Content: doc.contentBase64,
      IsAnnexe: doc.isAnnexe || false
    };
    if (doc.repertoireId) body.RepertoireId = doc.repertoireId;

    return apiCall("POST", "/Document/SaveOrUpdateDocument", { body });
  }

  return {
    getConfig,
    authenticate,
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
    rechercherDossiers,
    saveDocument
  };
})();
