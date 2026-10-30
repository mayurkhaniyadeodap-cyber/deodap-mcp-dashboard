// Apply the saved theme before first paint (no dark flash for light-mode users). A file, not an
// inline <script>, so the strict Content-Security-Policy (script-src 'self') allows it.
// Mirrors the zustand theme store (lib/storageKeys); dark stays the default.
try {
  var raw = localStorage.getItem("mcp-dashboard:theme") || localStorage.getItem("deodap-theme") || "{}";
  var saved = JSON.parse(raw).state;
  if (saved && saved.theme === "light") {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  }
} catch (e) {}
