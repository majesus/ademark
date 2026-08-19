// Acordeones del apartado "Gestión Administrativa y Docente" (sin onclick inline).
(function () {
  const buttons = document.querySelectorAll("button.ga-accordion-btn[data-accordion-target]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-accordion-target");
      const panel = document.getElementById(targetId);
      if (!panel) return;

      panel.classList.toggle("hidden");
      const expanded = !panel.classList.contains("hidden");
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  });
})();
