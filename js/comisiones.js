// Utilidades compartidas (mantiene el HTML/IDs intactos).
const utils = {
  esc(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  },
};

/**
 * Carga y renderiza comisiones desde json/comisiones.json.
 * - NO incrusta datos en el HTML (solo los vuelca dinámicamente).
 * - Mantiene estilo (cards, bordes, tipografías, separadores).
 */
(async function loadComisiones() {
  const statusEl = document.getElementById("comisiones-status");
  const containerEl = document.getElementById("comisiones-container");
  if (!statusEl || !containerEl) return;

  const JSON_URL = "json/comisiones.json";
  const esc = utils.esc;

  function renderMiembros(miembros) {
    if (!Array.isArray(miembros) || miembros.length === 0) {
      return `<p class="text-sm text-gray-500">Sin miembros definidos.</p>`;
    }
    return `
    <ul class="space-y-3">
        ${miembros
          .map(
            (m) => `
            <li class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-t border-gray-50 pt-3 first:border-t-0 first:pt-0">
                <span class="text-gray-900 font-medium">${esc(m.nombre)}</span>
                <span class="text-sm text-gray-500">${esc(m.rol)}${m.funcion ? ` · ${esc(m.funcion)}` : ""}</span>
            </li>
        `,
          )
          .join("")}
    </ul>
`;
  }

  function renderBloque(titulo, items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    return `
    <div class="space-y-4">
        <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-us-red"></div>
            <h4 class="text-lg font-bold text-gray-900">${esc(titulo)}</h4>
        </div>

        <div class="grid md:grid-cols-2 gap-6">
            ${items
              .map(
                (c) => `
                <div class="bg-gray-50/60 rounded-2xl p-6 border border-gray-100">
                    <h5 class="font-bold text-gray-900 mb-3">${esc(c.nombre)}</h5>
                    ${renderMiembros(c.miembros)}
                </div>
            `,
              )
              .join("")}
        </div>
    </div>
`;
  }

  try {
    const res = await fetch(JSON_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();

    const html = [
      renderBloque("Comisiones estatutarias", data.estatutarias),
      renderBloque("Comisiones delegadas", data.delegadas),
      renderBloque("Representantes", data.representantes),
    ]
      .filter(Boolean)
      .join("");

    containerEl.innerHTML =
      html ||
      `<p class="text-sm text-gray-500">No hay comisiones para mostrar.</p>`;
    statusEl.textContent = "  ";
  } catch (err) {
    console.error("Error cargando comisiones:", err);
    statusEl.innerHTML = `
    <div class="text-sm text-red-600 flex items-center gap-2">
        <i data-lucide="alert-triangle" class="w-4 h-4"></i>
        No se pudo cargar ${JSON_URL}. Revisa la ruta y que el JSON sea válido.
    </div>
`;
    containerEl.innerHTML = "";
  }

  // Si estás usando Lucide, re-render de iconos tras inyectar HTML.
  if (
    window.lucide &&
    typeof window.lucide.createIcons === "function"
  ) {
    window.lucide.createIcons();
  }
})();
