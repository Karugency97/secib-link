// SECIB Link — Helper de persistance pour l'état compose ↔ background.
// Utilise browser.storage.session si dispo (volatile, scopé à la session
// Thunderbird), sinon fallback browser.storage.local avec clé préfixée.
//
// Shape par onglet compose (clé "compose:<tabId>") :
//   {
//     dossierId: number,
//     dossierCode: string,
//     dossierNom: string
//   }

const ComposeState = (() => {
  const PREFIX = "compose:";

  function hasSession() {
    return typeof browser !== "undefined" &&
           browser.storage &&
           browser.storage.session &&
           typeof browser.storage.session.get === "function";
  }

  function area() {
    return hasSession() ? browser.storage.session : browser.storage.local;
  }

  function key(tabId) {
    return PREFIX + String(tabId);
  }

  async function get(tabId) {
    const k = key(tabId);
    const res = await area().get(k);
    return res[k] || null;
  }

  async function set(tabId, value) {
    const k = key(tabId);
    await area().set({ [k]: value });
  }

  async function patch(tabId, partial) {
    const existing = (await get(tabId)) || {};
    return set(tabId, { ...existing, ...partial });
  }

  async function remove(tabId) {
    const k = key(tabId);
    await area().remove(k);
  }

  async function clearAll() {
    // Utile au démarrage background pour purger les tabs morts.
    const all = await area().get(null);
    const toRemove = Object.keys(all).filter((k) => k.startsWith(PREFIX));
    if (toRemove.length) await area().remove(toRemove);
  }

  return { get, set, patch, remove, clearAll, hasSession };
})();
