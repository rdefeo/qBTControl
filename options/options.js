import { getSettings, saveSettings } from "../lib/settings.js";

const $ = (id) => document.getElementById(id);
const TEXT_FIELDS = ["serverUrl", "username", "password", "category", "savePath"];
const TOGGLES = ["startPaused", "catchMagnets", "catchTorrents"];

async function load() {
  const s = await getSettings();
  for (const k of TEXT_FIELDS) $(k).value = s[k];
  for (const k of TOGGLES) $(k).checked = s[k];
}

async function save() {
  const values = {};
  for (const k of TEXT_FIELDS) values[k] = $(k).value.trim();
  for (const k of TOGGLES) values[k] = $(k).checked;
  values.password = $("password").value; // passwords may legitimately have spaces
  const saved = await saveSettings(values);
  $("serverUrl").value = saved.serverUrl;
}

let savedTimer;
function flashSaved() {
  const el = $("saved");
  el.textContent = "Saved";
  el.classList.add("visible");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove("visible"), 1800);
}

function setStatus(kind, text) {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = text;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await save();
  flashSaved();
});

$("test").addEventListener("click", async () => {
  if (!$("serverUrl").value.trim()) {
    setStatus("error", "✗ Enter a server address first");
    $("serverUrl").focus();
    return;
  }
  const button = $("test");
  button.disabled = true;
  setStatus("pending", "Testing…");
  try {
    await save();
    const result = await chrome.runtime.sendMessage({ type: "test" });
    if (result.ok) {
      setStatus("ok", `✓ Connected to qBittorrent ${result.version}`);
      $("categories").replaceChildren(...result.categories.map((c) => new Option(c, c)));
    } else {
      setStatus("error", `✗ ${result.error}`);
    }
  } catch (e) {
    setStatus("error", `✗ ${e.message}`);
  } finally {
    button.disabled = false;
  }
});

$("togglePassword").addEventListener("click", () => {
  const input = $("password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  const button = $("togglePassword");
  button.classList.toggle("showing", show);
  button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  button.title = button.getAttribute("aria-label");
});

load();
