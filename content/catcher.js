// Registered by background.js only while "Send clicked magnet links" or
// "Send clicked .torrent files" is turned on in Settings. It never touches
// extension storage; the background script hands it the two toggles.
(() => {
  const opts = { catchMagnets: false, catchTorrents: false };
  const apply = (v) => {
    if (!v) return;
    opts.catchMagnets = v.catchMagnets === true;
    opts.catchTorrents = v.catchTorrents === true;
  };

  chrome.runtime.sendMessage({ type: "getCatchOptions" }).then(apply).catch(() => {});
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "catchOptions") apply(msg);
  });

  function torrentUrl(link) {
    const href = link.getAttribute("href");
    if (!href) return null;
    let url;
    try {
      url = new URL(href, document.baseURI);
    } catch {
      return null;
    }
    if (url.protocol === "magnet:") return opts.catchMagnets ? url.href : null;
    if (/^https?:$/.test(url.protocol) && /\.torrent$/i.test(url.pathname)) {
      return opts.catchTorrents ? url.href : null;
    }
    return null;
  }

  window.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (!chrome.runtime?.id) return; // extension was reloaded or removed
      const link = e.target instanceof Element && e.target.closest("a[href]");
      const url = link && torrentUrl(link);
      if (!url) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      chrome.runtime.sendMessage({ type: "add", url });
    },
    true
  );
})();
