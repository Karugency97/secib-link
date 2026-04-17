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
