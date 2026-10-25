import { getSettings } from "./lib/settings.js";
import { Qbt } from "./lib/qbt.js";

const MENU_ID = "add-torrent";
const SCRIPT_ID = "catcher";
const HEADER_RULE_ID = 1;
const SETTINGS_NOTIFICATION = "open-settings";

class NotConfigured extends Error {}

// Keep settings (including the password) out of reach of content scripts.
chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((e) => console.warn("qBTControl: couldn't restrict storage access", e));

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_ID, title: "Add Torrent", contexts: ["link"] });
  const cfg = await getSettings();
  await applyHeaderRule(cfg.serverUrl);
  await syncCatcher(cfg);
});

chrome.runtime.onStartup.addListener(async () => {
  const cfg = await getSettings();
  await applyHeaderRule(cfg.serverUrl);
  await syncCatcher(cfg);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const cfg = await getSettings();
  if (changes.serverUrl) await applyHeaderRule(cfg.serverUrl);
  if (changes.catchMagnets || changes.catchTorrents) {
    await syncCatcher(cfg);
    broadcastCatchOptions(cfg);
  }
});

// ---------- entry points ----------

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID && info.linkUrl) handleAdd(info.linkUrl);
});

chrome.action.onClicked.addListener(async () => {
  const { serverUrl } = await getSettings();
  if (!serverUrl) return chrome.runtime.openOptionsPage();

  const origin = new URL(serverUrl).origin;
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => {
    try {
      return new URL(t.url).origin === origin;
    } catch {
      return false;
    }
  });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: serverUrl + "/" });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === "add" && typeof msg.url === "string" && isTorrentLink(msg.url)) {
    handleAdd(msg.url);
  } else if (msg?.type === "getCatchOptions") {
    getSettings().then(({ catchMagnets, catchTorrents }) => sendResponse({ catchMagnets, catchTorrents }));
    return true;
  } else if (msg?.type === "test") {
    testConnection().then(sendResponse);
    return true;
  }
});

chrome.notifications.onClicked.addListener((id) => {
  if (id === SETTINGS_NOTIFICATION) chrome.runtime.openOptionsPage();
  chrome.notifications.clear(id);
});

// Catch torrent downloads (e.g. download.php?id=123) before they are saved,
// and send them to qBittorrent instead.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const url = item.finalUrl || item.url;
  const looksLikeTorrent = item.mime === "application/x-bittorrent" || /\.torrent$/i.test(item.filename);
  if (item.byExtensionId === chrome.runtime.id || !looksLikeTorrent || !/^https?:/i.test(url)) {
    suggest();
    return;
  }
  getSettings().then(async ({ catchTorrents }) => {
    if (!catchTorrents) return suggest();
    await chrome.downloads.cancel(item.id);
    try {
      suggest();
    } catch {
      // Already cancelled; nothing to release.
    }
    await chrome.downloads.erase({ id: item.id });
    handleAdd(url);
  });
  return true; // suggest() is called asynchronously
});

// ---------- adding torrents ----------

async function handleAdd(url) {
  try {
    const qbt = await client();
    const torrent = url.startsWith("magnet:") ? null : await fetchTorrent(url);
    await qbt.addTorrent(torrent ?? { url });
    notify("Torrent added", torrent?.name || magnetName(url) || url);
  } catch (e) {
    if (e instanceof NotConfigured) {
      notify("qBTControl isn't set up yet", "Click here to enter your qBittorrent server details.", SETTINGS_NOTIFICATION);
    } else {
      notify("Couldn't add torrent", e.message);
    }
  }
}

// Downloads a .torrent into memory using the site's cookies. Returns null if the
// response isn't a torrent, so the caller can fall back to sending the URL.
async function fetchTorrent(url) {
  if (!/^https?:/i.test(url)) return null;
  try {
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!isBencodedTorrent(bytes)) return null;
    const name = torrentName(bytes);
    return {
      blob: new Blob([bytes], { type: "application/x-bittorrent" }),
      filename: (name || "upload") + ".torrent",
      name,
    };
  } catch {
    return null;
  }
}

function isBencodedTorrent(bytes) {
  return bytes[0] === 0x64 /* "d" */ && latin1(bytes).includes("4:info");
}

// Reads the "name" key from the torrent's info dictionary.
function torrentName(bytes) {
  const text = latin1(bytes);
  const info = text.indexOf("4:info");
  const match = /4:name(\d+):/.exec(text.slice(info));
  if (!match) return "";
  const start = info + match.index + match[0].length;
  return new TextDecoder().decode(bytes.slice(start, start + Number(match[1])));
}

// One character per byte, so string offsets equal byte offsets.
function latin1(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}

function magnetName(url) {
  if (!url.startsWith("magnet:")) return "";
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("dn") || "";
}

function isTorrentLink(url) {
  return /^(magnet:|https?:)/i.test(url);
}

// ---------- connection test (called from the Settings page) ----------

async function testConnection() {
  try {
    const qbt = await client();
    await qbt.login();
    const [version, categories] = await Promise.all([qbt.version(), qbt.categories().catch(() => [])]);
    return { ok: true, version, categories };
  } catch (e) {
    return { ok: false, error: e instanceof NotConfigured ? "Enter a server address first" : e.message };
  }
}

// ---------- helpers ----------

async function client() {
  const cfg = await getSettings();
  if (!cfg.serverUrl) throw new NotConfigured();
  await applyHeaderRule(cfg.serverUrl);
  return new Qbt(cfg);
}

// qBittorrent's CSRF protection rejects requests whose Origin/Referer don't match
// the server. Requests from this service worker (tabId -1) would otherwise carry
// chrome-extension://…, so rewrite them to the server's own origin.
async function applyHeaderRule(serverUrl) {
  const addRules = [];
  if (serverUrl) {
    addRules.push({
      id: HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "set", value: new URL(serverUrl).origin },
          { header: "Referer", operation: "set", value: serverUrl + "/" },
        ],
      },
      condition: {
        urlFilter: `|${serverUrl}/`,
        tabIds: [chrome.tabs.TAB_ID_NONE],
        resourceTypes: ["xmlhttprequest"],
      },
    });
  }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [HEADER_RULE_ID], addRules });
}

// Registers the click-catching content script only while one of the toggles is on.
let catcherSync = Promise.resolve();
function syncCatcher({ catchMagnets, catchTorrents }) {
  catcherSync = catcherSync.then(async () => {
    const want = catchMagnets || catchTorrents;
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (want && registered.length === 0) {
      await chrome.scripting.registerContentScripts([
        { id: SCRIPT_ID, js: ["content/catcher.js"], matches: ["<all_urls>"], allFrames: true, runAt: "document_start" },
      ]);
    } else if (!want && registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  }).catch((e) => console.error("qBTControl: content script sync failed", e));
  return catcherSync;
}

// Tells already-open pages (every frame) about toggle changes.
async function broadcastCatchOptions({ catchMagnets, catchTorrents }) {
  for (const tab of await chrome.tabs.query({})) {
    chrome.tabs.sendMessage(tab.id, { type: "catchOptions", catchMagnets, catchTorrents }).catch(() => {});
  }
}

function notify(title, message, id = "") {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message,
  });
}
