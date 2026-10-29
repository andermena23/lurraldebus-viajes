/* Tema: auto (sistema) / claro / oscuro. Se recuerda en localStorage. Se carga en <head> para evitar el parpadeo. */
(function () {
  var MODES = ["auto", "light", "dark"];
  var LABEL = { auto: "◐ Auto", light: "☀ Claro", dark: "☾ Oscuro" };
  var mode = "auto";
  try { mode = localStorage.getItem("theme") || "auto"; } catch (e) {}
  if (MODES.indexOf(mode) < 0) mode = "auto";

  function apply() {
    if (mode === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    var b = document.getElementById("theme");
    if (b) {
      b.textContent = LABEL[mode];
      b.title = "Tema: " + { auto: "automático (según el sistema)", light: "claro", dark: "oscuro" }[mode] + ". Pulsa para cambiar.";
    }
  }
  apply();
  document.addEventListener("DOMContentLoaded", function () {
    apply();
    document.getElementById("theme").addEventListener("click", function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem("theme", mode); } catch (e) {}
      apply();
    });
  });
})();
