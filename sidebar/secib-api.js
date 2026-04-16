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
   * Liste les répertoires d'un dossier.
   * ⚠️ Signature API variable selon la version SECIB : on tente plusieurs
   * variantes, la première qui marche gagne. La variante v1 GET ?dossierId=N
   * est placée en tête (correspond à celle utilisée par le MCP node côté 8.1.4).
   */
  async function getRepertoiresDossier(dossierId) {
    const did = Number(dossierId);
    const tentatives = [
      { nom: "v1 GET ?dossierId=N",
        method: "GET", opts: { query: { dossierId: did } } },
      { nom: "v1 POST body {DossierId}",
        method: "POST", opts: { body: { DossierId: did } } },
      { nom: "v1 POST body {dossierId}",
        method: "POST", opts: { body: { dossierId: did } } },
      { nom: "v2 POST body {DossierId}",
        method: "POST", opts: { version: "v2", body: { DossierId: did } } },
      { nom: "v2 POST body {dossierId}",
        method: "POST", opts: { version: "v2", body: { dossierId: did } } },
      { nom: "v1 GET ?filtreRepertoire.dossierId=N",
        method: "GET", opts: { query: { "filtreRepertoire.dossierId": did } } }
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

  /**
   * Crée un répertoire dans un dossier.
   * Endpoint best-guess (pattern SaveDocument). Si l'API renvoie 404/400,
   * l'appelant (panel.js) bascule sur le fallback racine du dossier.
   */
  async function creerRepertoire(dossierId, libelle) {
    const did = Number(dossierId);
    const body = { DossierId: did, Libelle: String(libelle).trim() };
    return apiCall("POST", "/Document/SaveRepertoire", { body });
  }

  /**
   * Liste les parties d'un dossier (Client / Adversaire / Juridiction / Correspondant).
   * Chaque PartieApiDto embarque la Personne avec ses coordonnées (Email, Téléphone, ...).
   */
  async function getPartiesDossier(dossierId) {
    return apiCall("GET", "/Partie/Get", { query: { dossierId } });
  }

  /**
   * Liste les documents d'un dossier (range max 50 par appel).
   * Renvoie DocumentCompactApiDto[] : DocumentId, FileName, Extension, Date, RepertoireId, RepertoireLibelle, Type, IsAnnexe.
   *
   * ⚠️ L'API SECIB attend le filtre dans le BODY (même sur GET côté MCP Node), ce
   * qui est interdit côté browser. On tente plusieurs variantes en cascade et on
   * loggue chaque échec pour diagnostic.
   */
  async function getDocumentsDossier(dossierId, limit = 50, offset = 0) {
    const range = `${offset}-${offset + limit - 1}`;
    const did = Number(dossierId);
    const tentatives = [
      {
        nom: "v2 POST + body {DossierId}",
        method: "POST",
        opts: { version: "v2", body: { DossierId: did }, query: { range } }
      },
      {
        nom: "v2 POST + body {dossierId}",
        method: "POST",
        opts: { version: "v2", body: { dossierId: did }, query: { range } }
      },
      {
        nom: "v2 POST + body {filtreDocument:{dossierId}}",
        method: "POST",
        opts: { version: "v2", body: { filtreDocument: { dossierId: did } }, query: { range } }
      },
      {
        nom: "v2 GET + ?filtreDocument.dossierId=N",
        method: "GET",
        opts: { version: "v2", query: { "filtreDocument.dossierId": did, range } }
      },
      {
        nom: "v1 POST + body {dossierId}",
        method: "POST",
        opts: { body: { dossierId: did }, query: { range } }
      },
      {
        nom: "v1 POST + body {DossierId}",
        method: "POST",
        opts: { body: { DossierId: did }, query: { range } }
      },
      {
        nom: "v1 GET + ?dossierId=N (sans préfixe)",
        method: "GET",
        opts: { query: { dossierId: did, range } }
      },
      {
        nom: "v1 GET + ?filtreDocument.DossierId=N (PascalCase)",
        method: "GET",
        opts: { query: { "filtreDocument.DossierId": did, range } }
      },
      {
        nom: "v1 GET + ?filtreDocument.dossierId=N (camelCase swagger)",
        method: "GET",
        opts: { query: { "filtreDocument.dossierId": did, range } }
      }
    ];

    let lastErr = null;
    for (const t of tentatives) {
      try {
        const res = await apiCall(t.method, "/Document/GetListeDocument", t.opts);
        console.log(`[SECIB Link] ✓ GetListeDocument OK via "${t.nom}"`);
        return res;
      } catch (err) {
        console.warn(`[SECIB Link] ✗ "${t.nom}" → ${err.message}`);
        lastErr = err;
      }
    }
    throw lastErr || new Error("Aucune variante de GetListeDocument n'a fonctionné");
  }

  /**
   * Récupère le contenu binaire d'un document encodé en base64.
   * Renvoie DocumentContentApiDto : { DocumentId, FileName, Content (base64) }.
   */
  async function getDocumentContent(documentId) {
    return apiCall("GET", "/Document/GetContentDocumentBase64", { query: { documentId } });
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
    creerRepertoire,
    getPartiesDossier,
    getDocumentsDossier,
    getDocumentContent,
    rechercherDossiers,
    saveDocument,
    saveEmailMessage
  };
})();
