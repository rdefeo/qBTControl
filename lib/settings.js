export const DEFAULTS = {
  serverUrl: "",
  username: "",
  password: "",
  category: "",
  savePath: "",
  startPaused: false,
  catchMagnets: false,
  catchTorrents: false,
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}

export async function saveSettings(values) {
  const patch = { ...values };
  if ("serverUrl" in patch) patch.serverUrl = normalizeUrl(patch.serverUrl);
  await chrome.storage.local.set(patch);
  return patch;
}

// "192.168.1.10:8080/" -> "http://192.168.1.10:8080". A path is kept so a
// WebUI behind a reverse proxy (e.g. https://host/qbittorrent) still works.
export function normalizeUrl(raw) {
  let s = (raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return s.replace(/\/+$/, "");
  }
}
