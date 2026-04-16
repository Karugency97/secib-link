// SECIB Link — Background Script
//
// Architecture : fenêtre flottante persistante (browser.windows.create type:popup).
// - Au clic sur l'icône message_display_action ou browser_action :
//   - si la fenêtre SECIB Link existe → la focus + lui pousser le mail courant
//   - sinon → la créer en passant ?messageId=… dans l'URL
// - À chaque mail affiché (onMessageDisplayed) → si la fenêtre est ouverte,
//   on lui pousse l'ID via tabs.sendMessage. La fenêtre se met à jour seule.

const SIDEBAR_URL = "sidebar/sidebar.html";
const WIN_WIDTH = 440;
const WIN_HEIGHT = 720;

let linkWindowId = null;
let linkTabId = null;

browser.runtime.onInstalled.addListener(() => {
  console.log("[SECIB Link] Extension installée.");
});

// Click sur l'icône depuis un mail affiché
browser.messageDisplayAction.onClicked.addListener((tab) => {
  openOrFocusLinkWindow(tab);
});

// Click sur l'icône depuis la barre principale (sans mail forcément sélectionné)
browser.browserAction.onClicked.addListener((tab) => {
  openOrFocusLinkWindow(tab);
});

// Quand l'utilisateur change de mail dans Thunderbird, pousser à la fenêtre ouverte
browser.messageDisplay.onMessageDisplayed.addListener((tab, message) => {
  if (linkTabId === null || !message) return;
  browser.tabs.sendMessage(linkTabId, {
    type: "secib-link/setMessage",
    messageId: message.id
  }).catch(() => {
    // La fenêtre n'a peut-être pas encore son listener prêt — ignore
  });
});

// Reset si la fenêtre flottante est fermée par l'utilisateur
browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === linkWindowId) {
    linkWindowId = null;
    linkTabId = null;
  }
});

/**
 * Ouvre la fenêtre flottante SECIB Link, ou la focus si déjà ouverte,
 * et lui passe le mail courant.
 */
async function openOrFocusLinkWindow(sourceTab) {
  let messageId = null;
  try {
    const msg = await browser.messageDisplay.getDisplayedMessage(sourceTab.id);
    if (msg) messageId = msg.id;
  } catch {
    // Pas de mail affiché dans ce tab — la fenêtre s'ouvrira en attente
  }

  // Si déjà ouverte → focus + push du nouveau mail
  if (linkWindowId !== null) {
    try {
      await browser.windows.update(linkWindowId, { focused: true });
      if (messageId !== null && linkTabId !== null) {
        browser.tabs.sendMessage(linkTabId, {
          type: "secib-link/setMessage",
          messageId
        }).catch(() => {});
      }
      return;
    } catch {
      // La fenêtre n'existe plus côté OS, on la recrée
      linkWindowId = null;
      linkTabId = null;
    }
  }

  // Création de la fenêtre flottante
  const url = browser.runtime.getURL(SIDEBAR_URL) +
    (messageId !== null ? `?messageId=${encodeURIComponent(messageId)}` : "");

  const win = await browser.windows.create({
    url,
    type: "popup",
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    allowScriptsToClose: true
  });

  linkWindowId = win.id;
  linkTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
}
