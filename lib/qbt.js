// Minimal client for the qBittorrent WebUI API (v2).
// The SID session cookie lives in the browser's cookie jar (credentials: "include").

export class QbtError extends Error {}

export class Qbt {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = cfg.serverUrl;
  }

  async #fetch(path, init = {}) {
    try {
      return await fetch(this.base + path, { credentials: "include", cache: "no-store", ...init });
    } catch {
      throw new QbtError(`Can't reach the server at ${this.base}`);
    }
  }

  // Calls an API endpoint, logging in once and retrying if the session has expired.
  async #api(path, init) {
    let res = await this.#fetch(path, init);
    if (res.status === 403) {
      await this.login();
      res = await this.#fetch(path, init);
    }
    if (res.status === 403) throw new QbtError("qBittorrent refused the request (not logged in)");
    return res;
  }

  async login() {
    const { username, password } = this.cfg;
    const res = await this.#fetch("/api/v2/auth/login", {
      method: "POST",
      body: new URLSearchParams({ username, password }),
    });
    const text = (await res.text()).trim();
    if (res.status === 403) throw new QbtError("Too many failed logins: your IP is temporarily banned by qBittorrent");
    if (res.status === 401) throw new QbtError("Request rejected by qBittorrent's security checks (CSRF / host header validation)");
    if (res.status === 404) throw new QbtError("No qBittorrent WebUI found at this address");
    if (!res.ok) throw new QbtError(`Login failed (HTTP ${res.status})`);
    if (text !== "Ok.") throw new QbtError("Wrong username or password");
  }

  async version() {
    const res = await this.#api("/api/v2/app/version");
    if (!res.ok) throw new QbtError(`Couldn't read the qBittorrent version (HTTP ${res.status})`);
    return (await res.text()).trim();
  }

  async categories() {
    const res = await this.#api("/api/v2/torrents/categories");
    if (!res.ok) return [];
    return Object.keys(await res.json()).sort((a, b) => a.localeCompare(b));
  }

  // Pass either { url } (magnet or http link) or { blob, filename } (.torrent contents).
  async addTorrent({ url, blob, filename }) {
    const form = new FormData();
    if (blob) form.append("torrents", blob, filename || "upload.torrent");
    else form.append("urls", url);

    const { category, savePath, startPaused } = this.cfg;
    if (category) form.append("category", category);
    if (savePath) form.append("savepath", savePath);
    if (startPaused) {
      form.append("paused", "true"); // qBittorrent 4.x
      form.append("stopped", "true"); // qBittorrent 5.x
    }

    const res = await this.#api("/api/v2/torrents/add", { method: "POST", body: form });
    const text = (await res.text()).trim();
    if (res.status === 415) throw new QbtError("qBittorrent says the torrent file is not valid");
    if (!res.ok || text === "Fails.") {
      throw new QbtError(text && text !== "Fails." ? text : "qBittorrent rejected the torrent (it may already be in your list)");
    }
  }
}
