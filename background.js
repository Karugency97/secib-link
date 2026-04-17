// SECIB Link — Background Script
//
// Deux fenêtres flottantes distinctes :
// 1. Sidebar de lecture (message_display_action / browser_action) : panneau "dossiers liés à l'expéditeur"
// 2. Compose helper (compose_action) : panneau "destinataires + PJ depuis un dossier SECIB"
//
// Chaque fenêtre est trackée séparément, peut être focus si déjà ouverte, et reçoit
// le tabId du contexte courant via URL param + tabs.sendMessage.

const SIDEBAR_URL = "sidebar/sidebar.html";
const COMPOSE_PANEL_URL = "compose/panel.html";

const SIDEBAR_W = 440, SIDEBAR_H = 720;
const COMPOSE_W = 520, COMPOSE_H = 760;

// Sidebar lecture
let linkWindowId = null;
let linkTabId = null;

// Compose helper
let composeWindowId = null;
let composePanelTabId = null;

browser.runtime.onInstalled.addListener(() => {
  console.log("[SECIB Link] Extension installée.");
});

// ─── Sidebar lecture ─────────────────────────────────────────────────

browser.messageDisplayAction.onClicked.addListener((tab) => {
  openOrFocusLinkWindow(tab);
});

browser.browserAction.onClicked.addListener((tab) => {
  openOrFocusLinkWindow(tab);
});

browser.messageDisplay.onMessageDisplayed.addListener((tab, message) => {
  if (linkTabId === null || !message) return;
  browser.tabs.sendMessage(linkTabId, {
    type: "secib-link/setMessage",
    messageId: message.id
  }).catch(() => {});
});

async function openOrFocusLinkWindow(sourceTab) {
  let messageId = null;
  try {
    const msg = await browser.messageDisplay.getDisplayedMessage(sourceTab.id);
    if (msg) messageId = msg.id;
  } catch {}

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
      linkWindowId = null;
      linkTabId = null;
    }
  }

  const url = browser.runtime.getURL(SIDEBAR_URL) +
    (messageId !== null ? `?messageId=${encodeURIComponent(messageId)}` : "");

  const win = await browser.windows.create({
    url,
    type: "popup",
    width: SIDEBAR_W,
    height: SIDEBAR_H,
    allowScriptsToClose: true
  });

  linkWindowId = win.id;
  linkTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
}

// ─── Compose helper ──────────────────────────────────────────────────

browser.composeAction.onClicked.addListener((tab) => {
  openOrFocusComposeHelper(tab.id);
});

async function openOrFocusComposeHelper(composeTabId) {
  // Si déjà ouverte → focus + bascule sur le compose actif
  if (composeWindowId !== null) {
    try {
      await browser.windows.update(composeWindowId, { focused: true });
      if (composePanelTabId !== null) {
        browser.tabs.sendMessage(composePanelTabId, {
          type: "secib-link/setComposeTab",
          composeTabId
        }).catch(() => {});
      }
      return;
    } catch {
      composeWindowId = null;
      composePanelTabId = null;
    }
  }

  const url = browser.runtime.getURL(COMPOSE_PANEL_URL) +
    `?composeTabId=${encodeURIComponent(composeTabId)}`;

  const win = await browser.windows.create({
    url,
    type: "popup",
    width: COMPOSE_W,
    height: COMPOSE_H,
    allowScriptsToClose: true
  });

  composeWindowId = win.id;
  composePanelTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
}

// ─── Reset si l'utilisateur ferme une fenêtre ────────────────────────

browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === linkWindowId) {
    linkWindowId = null;
    linkTabId = null;
  }
  if (windowId === composeWindowId) {
    composeWindowId = null;
    composePanelTabId = null;
  }
});

// ─── Archivage post-envoi ───────────────────────────────────────────

browser.compose.onAfterSend.addListener(async (tab, sendInfo) => {
  try {
    if (!sendInfo || sendInfo.mode !== "sendNow") return;
    const st = await ComposeState.get(tab.id);
    if (!st || !st.archiveEnabled || !st.archiveRepertoireId || !st.dossierId) {
      await ComposeState.remove(tab.id);
      return;
    }

    const messageIds = (sendInfo.messages || []).map((m) => m.id).filter(Boolean);
    if (messageIds.length === 0) {
      console.warn("[SECIB Link] onAfterSend : aucun message à archiver");
      await ComposeState.remove(tab.id);
      return;
    }

    for (const mid of messageIds) {
      try {
        const raw = await browser.messages.getRaw(mid, { data_format: "BinaryString" });
        const emlBase64 = btoa(raw);
        const msg = await browser.messages.get(mid);
        const subject = (msg && msg.subject) || "mail";
        const fileName = `${sanitizeFileName(subject)}.eml`;

        await SecibAPI.saveEmailMessage({
          dossierId: Number(st.dossierId),
          repertoireId: Number(st.archiveRepertoireId),
          emlBase64,
          fileName
        });

        notify("SECIB Link", `Mail archivé dans ${st.dossierCode || "dossier SECIB"}`);
      } catch (err) {
        console.error("[SECIB Link] Archivage échoué :", err);
        notify("SECIB Link — archivage échoué", err.message || String(err));
      }
    }
  } finally {
    await ComposeState.remove(tab.id).catch(() => {});
  }
});

function sanitizeFileName(s) {
  return String(s || "mail")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .slice(0, 120)
    .trim() || "mail";
}

function notify(title, message) {
  try {
    browser.notifications.create({
      type: "basic",
      title,
      message,
      iconUrl: browser.runtime.getURL("icons/icon-48.png")
    });
  } catch {}
}
