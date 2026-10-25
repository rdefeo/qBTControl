# qBTControl

A Brave/Chromium extension that sends torrents and magnet links to a qBittorrent server through its WebUI.

## Features
- **Right-click → Add Torrent** on any magnet or `.torrent` link. `.torrent` files are fetched in memory using your browser's cookies, so private trackers work. They are uploaded to qBittorrent and never saved to your Downloads folder.
- **Toolbar icon** opens your qBittorrent WebUI, or switches to its tab if one is already open.
- **Optional click catching** (off by default):
  - *Send clicked magnet links*: a left-click on a magnet link adds it to qBittorrent.
  - *Send clicked .torrent files*: left-clicked `.torrent` links, and any download that turns out to be a torrent, go to qBittorrent instead of your Downloads folder.
- **Default options** for new torrents: category, save path, start paused.
- A desktop notification reports whether each add succeeded.

## Install
1. Open `brave://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. The Settings page opens from the extension's **Details → Extension options**. Until a server is configured, clicking the toolbar icon also opens it.
4. Enter your server address (for example `http://192.168.1.10:8080`), username and password, then click **Test Connection**.

## qBittorrent setup
- Turn on the WebUI under *Tools → Options → Web UI*.
- CSRF protection can stay enabled. The extension sets the `Origin`/`Referer` headers on its own API requests so they pass the check.
- If you use HTTPS with a self-signed certificate, open the server address in a tab once and accept the certificate.

## Notes
- Settings, including the password, are stored locally in the browser's extension storage (`chrome.storage.local`) and are not synced. Storage is restricted to the extension's own pages, so the click-catching script that runs on websites can't read it; it gets only the two on/off toggles from the background script.
- The extension needs access to all sites. That lets it reach whatever server address you enter, fetch `.torrent` files from any site with your cookies, and run the optional click catcher.
