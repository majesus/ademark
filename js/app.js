      /**
       * =====================================================================================
       * JS PRINCIPAL (archivo único, refuerzo de la interfaz).
       * -------------------------------------------------------------------------------------
       * - NO cambia diseño, HTML estático ni clases CSS.
       * - Solo refuerza estructura, robustez y mantenibilidad.
       * - Mantiene compatibilidad con handlers inline (onclick="...").
       * =====================================================================================
       */
      (function () {
        "use strict";

        // ---------------------------------------------------------------------------------
        // Utilidades mínimas (sin impacto visual).
        // ---------------------------------------------------------------------------------

        /** Atajo seguro para getElementById (devuelve null si no existe).*/
        function $id(id) {
          return document.getElementById(id);
        }

        /**
         * Re-render de iconos Lucide, si está disponible.
         * (Evita errores si la librería no ha cargado por cualquier motivo.).
         */
        function refreshIcons() {
          if (
            window.lucide &&
            typeof window.lucide.createIcons === "function"
          ) {
            window.lucide.createIcons();
          }
        }

        /** Normaliza a array (defensivo).*/
        function toArray(value) {
          return Array.isArray(value) ? value : [];
        }

        // --- 1. VARIABLES "GLOBALES" DE LA APP (encapsuladas en IIFE) ---.

        let CSV_PROFESORES = [];
        let CSV_PROFESORES_PERFIL = [];
        let CSV_PROFESORES_CENTROS = [];
        let CSV_PROFESORES_ASIGNATURAS = [];
        let CSV_INVESTIGADORES = [];
        let PROFESORES_EXTRA = { ocultos: [], manuales: [] };
        let NEWS_DATA = [];
        let NEWS_INDEX = {
          evento: [],
          noticia: [],
          investig: [],
          estudiantes: [],
          other: [],
        };
        let MASTERES_DATA = [];
        let GRADOS_DATA = []; // Variable nueva para Grados
        let DOCTORADOS_DATA = [];
        let NORMATIVAS_DATA = [];

        // Orden del menú: Se incluyen 'Instalaciones' y 'Administración' antes de 'Contacto'.
        const MENU_ITEMS = [
          { id: "inicio", label: "Inicio" },
          { id: "oferta", label: "Oferta" },
          { id: "estudiantes", label: "Estudiantes" },
          { id: "profesorado", label: "Profesorado" },
          { id: "investigacion", label: "Investigación" },
          { id: "instalaciones", label: "Instalaciones" },
          { id: "comunidad", label: "Comunidad" },
          { id: "administracion", label: "Administración" },
          { id: "contacto", label: "Contacto" },
        ];

        // --- 2. CARGA DE DATOS (FETCH) ---.

        async function loadAllData() {
          try {
            // Se ejecutan todas las peticiones en paralelo. Incluye GRADOS.CSV.
            const results = await Promise.all([
              fetchCsv("out/profesores.csv"),
              fetchCsv("out/profesores_perfil.csv"),
              fetchCsv("out/profesores_centros.csv"),
              fetchCsv("out/profesores_asignaturas.csv"),
              fetchCsv("out/investigadores.csv"),
              fetchJson("json/noticias.json"),
              fetchCsv("out/masteres.csv"),
              fetchCsv("out/doctorados.csv"),
              fetchCsv("out/normativas_simplificado.csv"),
              fetchJson("json/grados.json").catch(() => []),
              fetch("json/profesores_extra.json").then((r) => r.ok ? r.json() : ({})).catch(() => ({})),
            ]);

            // Asignamos a las variables globales.
            CSV_PROFESORES = results[0];
            CSV_PROFESORES_PERFIL = results[1];
            CSV_PROFESORES_CENTROS = results[2];
            CSV_PROFESORES_ASIGNATURAS = results[3];
            CSV_INVESTIGADORES = results[4];

            // Nota IMPORTANTE: Asignamos un ID único a cada noticia para poder abrirla luego.
            NEWS_DATA = results[5].map((item, index) => ({
              ...item,
              _id: index,
            }));

            MASTERES_DATA = results[6];
            DOCTORADOS_DATA = results[7];
            NORMATIVAS_DATA = results[8];
            GRADOS_DATA = results[9];
            const extra = results[10] || {};
            PROFESORES_EXTRA = {
              ocultos: Array.isArray(extra.ocultos) ? extra.ocultos : [],
              manuales: Array.isArray(extra.manuales) ? extra.manuales : [],
            };

            // Ocultar loading screen
            const loading = document.getElementById("loading-screen");
            const main = document.getElementById("main-content");
            loading.classList.add("fade-out");
            loading.style.display = "none";
            main.classList.remove("hidden");

            // Inicializar la App
            initApp();
          } catch (error) {
            console.error("Error cargando los CSV:", error);
            document.getElementById("loading-screen").innerHTML = `
                    <div class="text-center p-8">
                        <p class="text-us-red font-bold text-xl mb-2">Error cargando datos</p>
                        <p class="text-gray-600 mb-4">Asegúrate de ejecutar esto en un servidor local (Live Server/Python).</p>
                        <p class="text-xs text-gray-400 font-mono">${error.message}</p>
                    </div>
                `;
          }
        }

        // Parsea una cadena que representa una fila CSV (con posibles campos entre comillas).
        function parseCsvRowString(str) {
          const fields = [];
          let field = '';
          let inQuotes = false;
          for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (inQuotes) {
              if (ch === '"') {
                if (str[i + 1] === '"') { field += '"'; i++; } // "" → "
                else { inQuotes = false; }
              } else {
                field += ch;
              }
            } else if (ch === '"') {
              inQuotes = true;
            } else if (ch === ',') {
              fields.push(field); field = '';
            } else {
              field += ch;
            }
          }
          fields.push(field);
          return fields;
        }

        // Algunos CSVs (profesores_perfil.csv) tienen cada fila envuelta en comillas externas
        // (bug del generador). PapaParse RFC-4180 las trata como UN solo campo en url_abs.
        // Esta función detecta ese caso y re-parsea la fila correctamente.
        function fixMalformedCsvRow(row) {
          const content = row.url_abs || '';
          if (!content.includes(',')) return row; // Fila normal: url_abs es solo la URL
          // Toda la fila aterrizó en url_abs: re-parseamos
          const COLS = ['url_abs', 'nombre', 'categoria', 'telefono', 'email',
                        'departamento', 'area_conocimiento', 'perfil_prisma_url',
                        'content_hash', 'scraped_at'];
          const fields = parseCsvRowString(content);
          const fixed = {};
          COLS.forEach((col, i) => { fixed[col] = fields[i] !== undefined ? fields[i] : ''; });
          return fixed;
        }

        // encoding opcional: p.ej. 'latin1' para profesores_perfil.csv (latin-1, no UTF-8).
        async function fetchCsv(url, encoding) {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`No se pudo cargar ${url}`);
          let text;
          if (encoding) {
            const buffer = await response.arrayBuffer();
            text = new TextDecoder(encoding).decode(buffer);
          } else {
            text = await response.text();
          }
          // Usamos PapaParse para parsear el CSV (maneja comillas y saltos de línea).
          return new Promise((resolve) => {
            Papa.parse(text, {
              header: true,
              skipEmptyLines: true,
              complete: (results) => resolve(results.data.map(fixMalformedCsvRow)),
            });
          });
        }

        async function fetchJson(url) {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`No se pudo cargar ${url}`);
          const data = await response.json();
          // Defensivo: aseguramos array
          return Array.isArray(data) ? data : [];
        }

        // --- Carga dinámica: Instalaciones / Comunidad (JSON con estructura idéntica) ---.

        /**
         * Renderiza un grid de tarjetas (imagen + título + ubicación + descripción) desde un JSON.
         * Estructura esperada:
         * { "items": [ { "titulo","imagen","alt","ubicacion","descripcion" }, ... ] }.
         * También se admite un array directo: [ ... ] por compatibilidad.
         *
         * Nota: NO cambia el diseño (mismas clases Tailwind), solo elimina HTML duplicado.
         */
        async function loadCardGridFromJson(opts) {
          const gridEl = document.getElementById(opts.gridId);
          const statusEl = document.getElementById(opts.statusId);

          if (!gridEl) return;

          const JSON_URL = opts.jsonUrl;
          const esc = utils.esc;

          function cardHtml(item) {
            const titulo = esc(item.titulo);
            const imagen = esc(item.imagen);
            const alt = esc(item.alt || item.titulo || "");
            const ubicacion = esc(item.ubicacion);
            const descripcion = esc(item.descripcion);

            // Mantiene la estética original; incorpora loading=lazy + onerror defensivo sin afectar al layout.
            return `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden group hover:shadow-lg transition-all hover-card">
                        <div class="h-48 bg-gray-200 relative overflow-hidden">
                            <img
                                src="${imagen}"
                                alt="${alt}"
                                loading="lazy"
                                onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23e5e7eb%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2216%22 fill=%22%239ca3af%22 text-anchor=%22middle%22%3EImagen no disponible%3C/text%3E%3C/svg%3E'"
                                class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <div class="absolute inset-0 bg-black/10"></div>
                        </div>
                        <div class="p-6">
                            <h3 class="font-bold text-xl text-gray-900 mb-2">${titulo}</h3>
                            <div class="space-y-2 text-sm text-gray-500">
                                <div class="flex items-center gap-2">
                                    <i data-lucide="map-pin" class="w-4 h-4 text-us-red"></i>
                                    <span>${ubicacion}</span>
                                </div>
                                <div class="flex items-center gap-2">
                                    <i data-lucide="info" class="w-4 h-4 text-blue-600"></i>
                                    <span>${descripcion}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
          }

          try {
            if (statusEl)
              statusEl.textContent = opts.loadingText || "Cargando...";
            const res = await fetch(JSON_URL, { cache: "no-store" });
            if (!res.ok) throw new Error("HTTP " + res.status);

            const data = await res.json();
            const items = Array.isArray(data)
              ? data
              : Array.isArray(data.items)
                ? data.items
                : [];

            if (!items || items.length === 0) {
              gridEl.innerHTML = `<p class="text-gray-500 italic col-span-full">${esc(opts.emptyText || "No hay elementos para mostrar.")}</p>`;
            } else {
              gridEl.innerHTML = items.map(cardHtml).join("");
            }

            if (statusEl) statusEl.textContent = "";
          } catch (err) {
            console.error("Error cargando grid JSON:", JSON_URL, err);

            if (statusEl) {
              statusEl.innerHTML = `
                        <div class="text-sm text-red-600 flex items-center gap-2">
                            <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                            No se pudo cargar ${esc(JSON_URL)}. Revisa la ruta y que el JSON sea válido.
                        </div>
                    `;
            }
            gridEl.innerHTML = "";
          }

          refreshIcons();
        }

        // --- 3. INICIALIZACIÓN ---.

        document.addEventListener("DOMContentLoaded", () => {
          const yearEl = $id("year");
          if (yearEl) yearEl.textContent = String(new Date().getFullYear());
          refreshIcons();
          loadAllData(); // Iniciar carga
        });

        function initApp() {
          // Filtrado previo: indexar por tipo y ordenar por fecha (recorre el CSV completo).
          NEWS_INDEX = buildNewsIndex();

          renderMenu();

          // Cargar secciones con tarjetas desde JSON (sin HTML duplicado).
          loadCardGridFromJson({
            gridId: "instalaciones-grid",
            statusId: "instalaciones-status",
            jsonUrl: "json/instalaciones.json",
            loadingText: "Cargando instalaciones...",
            emptyText: "No hay instalaciones para mostrar.",
          });
          loadCardGridFromJson({
            gridId: "comunidad-grid",
            statusId: "comunidad-status",
            jsonUrl: "json/comunidad.json",
            loadingText: "Cargando comunidad...",
            emptyText: "No hay elementos de comunidad para mostrar.",
          });
          renderOfertaMasteresDoctorados();
          renderInvestigacionGrupos(); // Modificado con filtro SEJ y diseño nuevo
          renderInvestigacionNews(); // NUEVO: 3 Noticias en investigación
          renderNoticias(); // Modificado filtro estudiantes (Slider)
          renderHomeNewsAndEvents(); // Home
          renderNormativas();

          const profesoresCompletos = joinProfessorData();
          renderProfessorsGrid(profesoresCompletos);

          // LOGICA BUSCADOR MEJORADA (Nota 1 y 2).
          const searchInput = document.getElementById("profesor-search");
          const clearBtn = document.getElementById("clear-search");

          searchInput.addEventListener("input", (e) => {
            const term = e.target.value.toLowerCase();

            // Mostrar/Ocultar botón X
            if (term.length > 0) {
              clearBtn.classList.remove("hidden");
            } else {
              clearBtn.classList.add("hidden");
            }

            const filtered = profesoresCompletos.filter((p) => {
              // Preparamos los textos de búsqueda.
              const nombre = (p.nombre_listado || "").toLowerCase();
              let area = (p.area_conocimiento || "").toLowerCase();
              const categoria = (p.categoria || "").toLowerCase();

              // Nota: Si el área es Comercialización, se incluye explícitamente "marketing" a la cadena de búsqueda.
              if (
                area.includes("comercialización") ||
                area.includes("comercializacion")
              ) {
                area += " marketing";
              }

              return (
                nombre.includes(term) ||
                area.includes(term) ||
                categoria.includes(term)
              );
            });
            renderProfessorsGrid(filtered);
          });

          // Re-render icons if needed.
          refreshIcons();

          // Abrir la sección indicada en la URL (si la hay) en lugar de forzar
          // siempre Inicio; permite refrescar la página sin perder el módulo actual.
          switchSection(getSectionFromHash(), { skipHistory: true });
        }

        // Función para limpiar buscador.
        function clearSearch() {
          const input = document.getElementById("profesor-search");
          input.value = "";
          input.dispatchEvent(new Event("input")); // Disparar evento para resetear grid
          input.focus();
        }

        // Navega a Profesorado ya filtrado por área (desde las tarjetas de Inicio
        // "Organización de Empresas" / "Comercialización e Inv. Mercados").
        // Reutiliza el buscador existente de Profesorado: escribe el término
        // en el campo de búsqueda y dispara el mismo filtrado que ya usa el usuario.
        function showProfesoradoArea(areaTerm) {
          switchSection("profesorado");
          const input = document.getElementById("profesor-search");
          if (!input) return;
          input.value = areaTerm;
          input.dispatchEvent(new Event("input"));
        }

        // --- 4. FUNCIONES DE NAVEGACIÓN Y UI ---.

        function switchSection(sectionId, options) {
          options = options || {};

          document.querySelectorAll(".section-layer").forEach((el) => {
            el.classList.add("hidden-section");
          });

          const target = document.getElementById(sectionId);
          if (target) {
            target.classList.remove("hidden-section");
            target.classList.remove("fade-in");
            void target.offsetWidth;
            target.classList.add("fade-in");
          }

          // Al entrar en Profesorado se parte siempre del listado completo
          // (menú, logo, botones...). showProfesoradoArea() aplica su propio
          // filtro justo después de esta misma llamada, así que el resultado
          // final para las tarjetas de Inicio sigue siendo el filtrado por área.
          if (sectionId === "profesorado") {
            const searchInput = document.getElementById("profesor-search");
            if (searchInput) {
              searchInput.value = "";
              searchInput.dispatchEvent(new Event("input"));
            }
          }

          updateActiveMenu(sectionId);
          document.getElementById("mobile-menu").classList.add("hidden");
          document.body.classList.remove("overflow-hidden");
          document
            .getElementById("mobile-menu")
            .setAttribute("aria-hidden", "true");
          window.scrollTo({ top: 0, behavior: "smooth" });

          // Persistimos la sección actual en la URL (hash) para que un refresco
          // del navegador mantenga al usuario en el mismo módulo, en lugar de
          // volver siempre a Inicio. options.skipHistory evita duplicar entradas
          // en el historial cuando la navegación viene de popstate o de la carga inicial.
          if (!options.skipHistory) {
            const newHash = "#" + sectionId;
            if (window.location.hash !== newHash) {
              history.pushState({ section: sectionId }, "", newHash);
            }
          }
        }

        // Determina la sección inicial a partir de location.hash, validando
        // que corresponda a un módulo real del menú (o a "inicio" por defecto).
        function getSectionFromHash() {
          const hash = (window.location.hash || "").replace(/^#/, "");
          const valid = MENU_ITEMS.some((item) => item.id === hash);
          return valid ? hash : "inicio";
        }

        // Soporte de navegación con los botones Atrás/Adelante del navegador.
        window.addEventListener("popstate", () => {
          switchSection(getSectionFromHash(), { skipHistory: true });
        });

        function updateActiveMenu(activeId) {
          const links = document.querySelectorAll("#desktop-nav button");
          links.forEach((btn) => {
            if (btn.dataset.target === activeId) {
              btn.classList.add("text-gray-900", "bg-gray-100");
              btn.classList.remove("text-gray-500", "hover:text-us-red");
            } else {
              btn.classList.remove("text-gray-900", "bg-gray-100");
              btn.classList.add("text-gray-500", "hover:text-us-red");
            }
          });

          const mobileLinks = document.querySelectorAll(
            "#mobile-nav-items button",
          );
          mobileLinks.forEach((btn) => {
            if (btn.dataset.target === activeId) {
              btn.classList.add("text-us-red");
              btn.classList.remove("text-gray-400");
            } else {
              btn.classList.remove("text-us-red");
              btn.classList.add("text-gray-400");
            }
          });
        }

        function toggleMobileMenu() {
          const menu = document.getElementById("mobile-menu");
          const isHidden = menu.classList.contains("hidden");

          // Abrir/cerrar overlay
          menu.classList.toggle("hidden");

          // Bloquear scroll del documento cuando el menú está abierto
          // (evita que se desplace la página por debajo y que parezca que "baja" mientras el menú no).
          document.body.classList.toggle("overflow-hidden", isHidden);

          // Accesibilidad mínima
          menu.setAttribute("aria-hidden", String(!isHidden));
        }

        // Defensivo: si se redimensiona a escritorio con el menú abierto, desbloquear scroll.
        function ensureBodyScrollUnlockedOnResize() {
          const menu = document.getElementById("mobile-menu");
          if (!menu) return;
          // En XL el overlay está oculto por CSS, así que garantizamos que body pueda scrollear.
          if (window.matchMedia("(min-width: 1280px)").matches) {
            document.body.classList.remove("overflow-hidden");
            menu.classList.add("hidden");
            menu.setAttribute("aria-hidden", "true");
          }
        }
        window.addEventListener("resize", ensureBodyScrollUnlockedOnResize);

        function renderMenu() {
          const desktopContainer = document.getElementById("desktop-nav");
          const mobileContainer = document.getElementById("mobile-nav-items");

          // Limpiar por si se llama varias veces.
          desktopContainer.innerHTML = "";
          mobileContainer.innerHTML = "";

          MENU_ITEMS.forEach((item) => {
            const btn = document.createElement("button");
            btn.textContent = item.label;
            btn.dataset.target = item.id;
            btn.onclick = () => switchSection(item.id);
            // Estilo ligeramente diferente para resaltar Administración si se quiere, pero mantenemos consistencia.
            btn.className = `px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${item.id === "inicio" ? "text-gray-900 bg-gray-100" : "text-gray-500 hover:text-us-red hover:bg-gray-50"}`;
            desktopContainer.appendChild(btn);

            const mBtn = document.createElement("button");
            mBtn.textContent = item.label;
            mBtn.dataset.target = item.id;
            mBtn.onclick = () => switchSection(item.id);
            mBtn.className = `text-left text-3xl font-bold py-2 ${item.id === "inicio" ? "text-us-red" : "text-gray-400"}`;
            mobileContainer.appendChild(mBtn);
          });
        }

        // --- 5. LÓGICA DE DATOS Y RENDERIZADO ---.

        function joinProfessorData() {
          if (!CSV_PROFESORES || CSV_PROFESORES.length === 0) return [];

          const ocultos = new Set(PROFESORES_EXTRA.ocultos || []);

          // Solo se muestran profesores con perfil activo en la web del departamento.
          // Los históricos (ya no aparecen en el listado) no tienen entrada en
          // profesores_perfil.csv y se excluyen silenciosamente.
          // Los incluidos en ocultos se filtran explícitamente.
          const fromCsv = CSV_PROFESORES
            .filter((base) =>
              !ocultos.has(base.url_abs) &&
              CSV_PROFESORES_PERFIL.some((p) => p.url_abs === base.url_abs)
            )
            .map((base) => {
              const perfil =
                CSV_PROFESORES_PERFIL.find((p) => p.url_abs === base.url_abs) ||
                {};
              // Cruzar con investigadores para obtener grupo de investigación.
              const prismaUrl = (perfil.perfil_prisma_url || "").trim();
              // Buscar en investigadores por URL exacta o por coincidencia parcial
              // (cubre el caso en que la URL almacenada es la de email-redirect
              // en lugar de la canónica con ID numérico).
              const inv = prismaUrl
                ? (CSV_INVESTIGADORES.find((i) => i.url === prismaUrl) ||
                   CSV_INVESTIGADORES.find((i) =>
                     i.url && prismaUrl && (
                       i.url.includes(prismaUrl) || prismaUrl.includes(i.url)
                     )
                   ) || {})
                : {};
              return {
                ...base,
                ...perfil,
                // area_conocimiento: preferimos el de perfil; si está vacío usamos inv.
                area_conocimiento: (perfil.area_conocimiento && perfil.area_conocimiento !== "No disponible")
                  ? perfil.area_conocimiento
                  : (inv.area_conocimiento && inv.area_conocimiento !== "No disponible" ? inv.area_conocimiento : ""),
                categoria: (perfil.categoria && perfil.categoria !== "No disponible")
                  ? perfil.categoria
                  : (inv.categoria && inv.categoria !== "No disponible" ? inv.categoria : ""),
                grupo: (inv.grupo && inv.grupo !== "No disponible") ? inv.grupo : "",
                url_grupo: (inv.url_grupo && inv.url_grupo !== "No disponible") ? inv.url_grupo : "",
              };
            });

          // Añadir profesores manuales que no estén ya en el listado del CSV.
          const manuales = (PROFESORES_EXTRA.manuales || [])
            .filter((m) => m.url_abs && !ocultos.has(m.url_abs))
            .map((m) => ({
              // Valores por defecto para campos opcionales no declarados.
              email: "", telefono: "", perfil_prisma_url: "",
              grupo: "", url_grupo: "", dpto_code: "manual",
              nombre_listado: m.nombre || "",
              ...m,
            }));

          return [...fromCsv, ...manuales].sort((a, b) => {
            const na = (a.nombre_listado || a.nombre || "").toUpperCase();
            const nb = (b.nombre_listado || b.nombre || "").toUpperCase();
            return na.localeCompare(nb, "es");
          });
        }

        // Función para obtener icono por ÁREA (MODIFICADA: Naranja/Verde).
        function getAreaIcon(areaName) {
          const area = (areaName || "").toLowerCase();

          if (area.includes("organi")) {
            // Organización -> Naranja
            return '<i data-lucide="user" class="text-orange-500 w-full h-full p-2"></i>';
          } else if (area.includes("comercia") || area.includes("marketing")) {
            // Marketing/Comercialización -> Verde
            return '<i data-lucide="user" class="text-green-600 w-full h-full p-2"></i>';
          }

          // Default -> Gris
          return '<i data-lucide="user" class="text-gray-400 w-full h-full p-2"></i>';
        }

        function renderProfessorsGrid(data) {
          const container = document.getElementById("profesores-grid");
          container.innerHTML = "";

          if (!data || data.length === 0) {
            container.innerHTML =
              '<div class="col-span-full text-center py-12"><div class="inline-block p-4 bg-gray-50 rounded-full mb-3"><i data-lucide="search-x" class="text-gray-400 w-8 h-8"></i></div><p class="text-gray-500">No se encontraron profesores.</p></div>';
            refreshIcons();
            return;
          }

          data.forEach((prof) => {
            const card = document.createElement("div");
            card.className =
              "bg-white p-6 border border-gray-100 rounded-2xl hover-card cursor-pointer group flex flex-col h-full shadow-sm relative overflow-hidden";
            card.onclick = () => openProfessorModal(prof);

            // Procesar área de conocimiento.
            let areaClean = "Docente";
            if (prof.area_conocimiento) {
              areaClean = prof.area_conocimiento
                .replace(
                  "Comercialización e Investigación de Mercados",
                  "Marketing",
                )
                .replace("Organización de Empresas", "Organización");
            }

            const areaTag = prof.area_conocimiento
              ? `<div class="mt-3 inline-block px-2 py-1 bg-gray-50 text-gray-500 text-[10px] font-bold uppercase tracking-wide rounded-md">${areaClean}</div>`
              : "";

            // FOTO LOGIC: no existe pipeline que genere out/fotos/*.png; se muestra siempre el icono
            // por área (evita peticiones 404 en cada tarjeta).
            const imageUrl = null;
            // Usamos el área para el color del icono.
            const defaultIcon = getAreaIcon(prof.area_conocimiento);

            card.innerHTML = `
                    <div class="flex items-center gap-4 mb-4">
                         <div class="w-16 h-16 rounded-full bg-gray-100 flex-shrink-0 overflow-hidden border-2 border-white shadow-sm relative">
                            <!-- Capa 1: Icono (Fondo). -->
                            <div class="absolute inset-0 flex items-center justify-center bg-gray-100 z-0">
                                ${defaultIcon}
                            </div>
                            <!-- Capa 2: Imagen (Frente). -->
                            ${
                              imageUrl
                                ? `<img src="${imageUrl}" class="absolute inset-0 w-full h-full object-cover z-10" onerror="this.style.display='none'">`
                                : ""
                            }
                         </div>
                         <div>
                            <h4 class="font-bold text-gray-900 group-hover:text-us-red transition-colors text-base leading-tight">
                                ${toTitleCase(prof.nombre_listado)}
                            </h4>
                            <p class="text-xs text-gray-400 font-mono mt-1">${trimProfesor(prof.categoria) || "PDI"}</p>
                         </div>
                    </div>
                    <div class="mt-auto border-t border-gray-50 pt-3 flex justify-between items-center">
                        ${areaTag}
                        <i data-lucide="plus-circle" class="text-gray-200 group-hover:text-us-red w-5 h-5 transition-colors"></i>
                    </div>
                `;
            container.appendChild(card);
          });
          refreshIcons();
        }

        function toTitleCase(str) {
          if (!str) return "";
          const titled = str.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
          });
          return restoreAccents(titled);
        }

        // Restaura tildes palabra a palabra en nombres propios españoles.
        // Aplica solo sobre coincidencias exactas de palabra completa (word boundary).
        // Para ampliar la lista, añadir entradas al objeto ACCENTS.
        function restoreAccents(str) {
          const ACCENTS = {
            "Jose": "José", "Gonzalez": "González", "Rodriguez": "Rodríguez",
            "Gaitan": "Gaitán", "Sanchez": "Sánchez", "Maria": "María",
            "Benitez": "Benítez", "Cristobal": "Cristóbal", "Carrion": "Carrión",
            "Cortes": "Cortés", "Perez": "Pérez", "Garcia": "García",
            "Rosalia": "Rosalía", "Diaz": "Díaz", "Fernandez": "Fernández",
            "Dominguez": "Domínguez", "Espasandin": "Espasandín", "Florez": "Flórez",
            "Galan": "Galán", "Angeles": "Ángeles", "Candon": "Candón",
            "Gomez": "Gómez", "Chacon": "Chacón", "Hernandez": "Hernández",
            "Rendon": "Rendón", "Concepcion": "Concepción", "Rocio": "Rocío",
            "Millan": "Millán", "Lopez": "López", "Belen": "Belén",
            "Marquez": "Márquez", "Martin": "Martín", "Nicolas": "Nicolás",
            "Martinez": "Martínez", "Menendez": "Menéndez", "Gutierrez": "Gutiérrez",
            "Picon": "Picón", "Encarnacion": "Encarnación", "Roman": "Román",
            "Rondan": "Rondán", "Roldan": "Roldán", "Rio": "Río",
            "Jesus": "Jesús", "Mejias": "Mejías", "Suarez": "Suárez",
            "Joaquin": "Joaquín", "Vazquez": "Vázquez", "Rios": "Ríos",
            "Angel": "Ángel", "Perinan": "Periñán",
          };
          const pattern = new RegExp(
            "\\b(" + Object.keys(ACCENTS).join("|") + ")\\b", "g"
          );
          return str.replace(pattern, (match) => ACCENTS[match] || match);
        }

        // Elimina el prefijo "Profesor/a" de la categoría para mostrar solo el resto.
        // Ej: "Profesor Ayudante Doctor" → "Ayudante Doctor"
        //     "Profesora Titular de Universidad" → "Titular de Universidad"
        //     "Catedrático de Universidad" → sin cambio (no hay prefijo).
        function trimProfesor(cat) {
          if (!cat) return cat;
          return cat.replace(/^Profesora?\s+/i, "").trim();
        }

        // ---------------------------------------------------------------------------------
        // Identificadores académicos (desde investigadores.csv) para el modal de Profesorado.
        // ---------------------------------------------------------------------------------

        /** Devuelve el primer valor existente de una lista de posibles nombres de columna.*/
        function getFirstField(obj, candidates) {
          if (!obj) return "";
          const keys = Object.keys(obj);
          const map = {};
          for (const k of keys) map[k.toLowerCase().trim()] = k;
          for (const c of candidates) {
            const kk = map[String(c).toLowerCase().trim()];
            if (kk && obj[kk] != null && String(obj[kk]).trim() !== "")
              return String(obj[kk]).trim();
          }
          return "";
        }

        /**
         * Fallback: devuelve el primer campo cuyo nombre de columna CONTIENE alguno de los patrones.
         * Útil cuando las cabeceras del CSV cambian (p.ej. "ORCID (id)", "Scopus AuthorID").
         */
        function getFirstFieldByContains(obj, patterns) {
          if (!obj) return "";
          const keys = Object.keys(obj);
          const lowerKeys = keys.map((k) => ({
            k,
            lk: String(k).toLowerCase(),
          }));
          for (const p of patterns || []) {
            const lp = String(p).toLowerCase();
            const hit = lowerKeys.find((x) => x.lk.includes(lp));
            if (hit) {
              const val = obj[hit.k];
              if (val != null && String(val).trim() !== "")
                return String(val).trim();
            }
          }
          return "";
        }

        /**
         * Normaliza URLs de perfil para poder comparar aunque cambien protocolo/dominio/barra final.
         * (No afecta a la navegación: solo se usa para emparejar registros.).
         */
        function normalizeProfileUrl(u) {
          const s = String(u || "").trim();
          if (!s) return "";
          // Quita protocolo y www, y elimina barra final.
          return s
            .replace(/^https?:\/\//i, "")
            .replace(/^www\./i, "")
            .replace(/\/$/, "")
            .trim()
            .toLowerCase();
        }

        /** Extrae el identificador numérico de `pdi=XXXX` de una URL (si existe).*/
        function extractPdiIdFromUrl(url) {
          const s = String(url || "");
          const m = s.match(/pdi=(\d+)/i);
          return m && m[1] ? m[1] : "";
        }

        /** Normaliza emails para comparación (minúsculas + trim).*/
        function normalizeEmail(e) {
          return String(e || "")
            .trim()
            .toLowerCase();
        }

        /** Normaliza nombres para comparación (minúsculas, sin tildes, sin puntuación, espacios colapsados).*/
        function normalizeName(s) {
          return String(s || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }

        /**
         * Match laxo por nombre:
         * - Normaliza ambos nombres.
         * - Compara por igualdad o por inclusión de tokens (evita fallos por orden "Apellido, Nombre").
         */
        function looseNameMatch(a, b) {
          const na = normalizeName(a);
          const nb = normalizeName(b);
          if (!na || !nb) return false;
          if (na === nb) return true;
          const ta = na.split(" ").filter(Boolean);
          const tb = nb.split(" ").filter(Boolean);
          if (ta.length === 0 || tb.length === 0) return false;
          // Se considera match si todos los tokens del más corto están contenidos en el más largo.
          const [shorter, longer] =
            ta.length <= tb.length ? [ta, tb] : [tb, ta];
          const setLong = new Set(longer);
          return shorter.every((t) => setLong.has(t));
        }

        /**
         * Encuentra el registro de investigadores.csv correspondiente a un profesor.
         * Estrategia (robusta, sin cambiar UI):
         * 1) Match por EMAIL (más estable en la práctica).
         * 2) Match por URL de perfil (normalizada).
         * 3) Fallback por parámetro "pdi" (si existe) en la URL.
         * 4) Último recurso: match por nombre normalizado.
         */
        function findInvestigadorForProfesor(prof) {
          if (!prof) return null;

          // 1) Match por email.
          const profEmail = normalizeEmail(
            getFirstField(prof, [
              "email",
              "correo",
              "mail",
              "e-mail",
              "correo_us",
              "email_us",
              "emailcontacto",
              "correo_contacto",
            ]),
          );
          if (profEmail) {
            const byEmail = toArray(CSV_INVESTIGADORES).find((r) => {
              const invEmail = normalizeEmail(
                getFirstField(r, [
                  "email",
                  "correo",
                  "mail",
                  "e-mail",
                  "correo_us",
                  "email_us",
                  "emailcontacto",
                  "correo_contacto",
                ]),
              );
              return invEmail && invEmail === profEmail;
            });
            if (byEmail) return byEmail;
          }

          // 2) Match por URL (si existe en profesor).
          const profUrlRaw = getFirstField(prof, [
            "url_abs",
            "url",
            "enlace",
            "perfil",
            "ficha",
          ]);
          const profUrl = normalizeProfileUrl(profUrlRaw);
          if (profUrl) {
            const byUrl = toArray(CSV_INVESTIGADORES).find((r) => {
              const invUrlRaw = getFirstField(r, [
                "url_abs",
                "url",
                "enlace",
                "perfil",
                "ficha",
              ]);
              return normalizeProfileUrl(invUrlRaw) === profUrl;
            });
            if (byUrl) return byUrl;
          }

          // 3) Fallback por "pdi" (si ambos URLs lo contienen).
          const profPdi = extractPdiIdFromUrl(profUrlRaw);
          if (profPdi) {
            const byPdi = toArray(CSV_INVESTIGADORES).find((r) => {
              const invUrlRaw = getFirstField(r, [
                "url_abs",
                "url",
                "enlace",
                "perfil",
                "ficha",
              ]);
              return extractPdiIdFromUrl(invUrlRaw) === profPdi;
            });
            if (byPdi) return byPdi;
          }

          // 4) Último recurso: nombre.
          const profNameRaw = getFirstField(prof, [
            "nombre",
            "nombre_listado",
            "nombre_completo",
          ]);
          if (profNameRaw) {
            const byName = toArray(CSV_INVESTIGADORES).find((r) => {
              const invNameRaw = getFirstField(r, [
                "nombre",
                "nombre_listado",
                "nombre_completo",
              ]);
              return looseNameMatch(invNameRaw, profNameRaw);
            });
            if (byName) return byName;
          }

          return null;
        }

        /** Construye URLs a partir de IDs (si ya viene URL, se respeta).*/
        function normalizeIdUrl(kind, value) {
          const v = String(value || "").trim();
          if (!v) return "";
          if (/^https?:\/\//i.test(v)) return v;

          switch (kind) {
            case "orcid":
              return `https://orcid.org/${encodeURIComponent(v)}`;
            case "scopus":
              return `https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(v)}`;
            case "researchid":
              // ResearcherID (Web of Science). Si tu CSV ya trae URL, se usará tal cual.
              return `https://www.webofscience.com/wos/author/record/${encodeURIComponent(v)}`;
            case "scholar":
              return `https://scholar.google.com/citations?user=${encodeURIComponent(v)}`;
            case "idus":
              // idUS: no construir URL aquí; debe venir como idus_url (URL directa).
              return "";
            default:
              return "";
          }
        }

        /** Normaliza una URL directa: si ya es http(s) se respeta; si no, se asume https.*/
        function normalizeDirectUrl(value) {
          const v = String(value || "").trim();
          if (!v) return "";
          if (/^https?:\/\//i.test(v)) return v;
          return `https://${v}`;
        }

        /** Devuelve true si el valor del identificador es utilizable (no vacio, no 'NO DISPONIBLE', etc.).*/
        function isValidIdentifierValue(value) {
          if (value === null || value === undefined) return false;
          const s = String(value).trim();
          if (!s) return false;
          const low = s.toLowerCase();
          // Variantes habituales en los CSV.
          if (low === "-" || low === "n/a" || low === "na") return false;
          if (low.includes("no disponible")) return false;
          if (low.includes("no-disponible")) return false;
          if (low.includes("no aplica")) return false;
          return true;
        }

        /** Renderiza (si procede) el bloque de identificadores con estilo coherente con Asignaturas.*/
        function buildIdentificadoresHtml(prof) {
          const inv = findInvestigadorForProfesor(prof);
          if (!inv) return "";

          // Candidatos amplios para blindar diferencias de cabeceras entre CSVs.
          // 1) Intento por nombres exactos habituales.
          // 2) Fallback por "contiene" (por si el CSV trae cabeceras tipo "ORCID (id)" o "Scopus AuthorID").
          const orcid =
            getFirstField(inv, [
              "orcid",
              "orcid_id",
              "id_orcid",
              "orcid iD",
              "orcid-id",
            ]) || getFirstFieldByContains(inv, ["orcid"]);
          const scopus =
            getFirstField(inv, [
              "scopus",
              "scopus_id",
              "scopusid",
              "id_scopus",
              "authorid",
              "author_id",
              "scopus_author_id",
              "scopus author id",
            ]) || getFirstFieldByContains(inv, ["scopus", "authorid"]);
          const researchid =
            getFirstField(inv, [
              "researchid",
              "research_id",
              "researcherid",
              "researcher_id",
              "researcher id",
              "rid",
              "wos",
              "wos_id",
            ]) ||
            getFirstFieldByContains(inv, ["research", "researcherid", "rid"]);
          const scholar =
            getFirstField(inv, [
              "googlescholar",
              "google_scholar",
              "google scholar",
              "scholar",
              "scholar_id",
              "google_scholar_id",
              "google_scholar_user",
              "scholar_user",
            ]) || getFirstFieldByContains(inv, ["scholar", "google"]);
          const idus_url =
            getFirstField(inv, [
              "idus_url",
              "idUS_url",
              "id_us_url",
              "idus link",
              "enlace_idus",
              "url_idus",
              "link_idus",
            ]) ||
            getFirstFieldByContains(inv, ["idus_url", "idus url", "url idus"]);

          const items = [];

          if (isValidIdentifierValue(orcid)) {
            items.push({
              label: "ORCID",
              url: normalizeIdUrl("orcid", orcid),
              iconHtml: '<i class="ai ai-orcid" aria-hidden="true"></i>',
            });
          }
          if (isValidIdentifierValue(scopus)) {
            items.push({
              label: "Scopus",
              url: normalizeIdUrl("scopus", scopus),
              iconHtml: '<i class="ai ai-scopus" aria-hidden="true"></i>',
            });
          }
          if (isValidIdentifierValue(researchid)) {
            items.push({
              label: "ResearchID",
              url: normalizeIdUrl("researchid", researchid),
              iconHtml: '<i class="ai ai-researcherid" aria-hidden="true"></i>',
            });
          }
          if (isValidIdentifierValue(scholar)) {
            items.push({
              label: "Google Scholar",
              url: normalizeIdUrl("scholar", scholar),
              iconHtml:
                '<i class="ai ai-google-scholar" aria-hidden="true"></i>',
            });
          }
          if (isValidIdentifierValue(idus_url)) {
            // idUS: usar SIEMPRE la URL directa (idus_url). No usar sisiius_url.
            items.push({
              label: "idUS",
              url: normalizeDirectUrl(idus_url),
              iconHtml: '<i class="ai ai-open-access" aria-hidden="true"></i>',
            });
          }

          if (items.length == 0) return "";

          const pills = items
            .map(
              (it) => `
                <a href="${it.url}" target="_blank" rel="noopener noreferrer"
                   class="px-4 py-2 bg-gray-50 text-gray-700 text-sm rounded-lg font-medium border border-gray-100 hover:border-gray-300 transition-colors inline-flex items-center gap-2"
                   title="${it.label}">
                   ${it.iconHtml}
                   <span>${it.label}</span>
                </a>
            `,
            )
            .join("");

          return `
                <div class="mt-6">
                    <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Identificadores</h3>
                    <div class="flex flex-wrap gap-2">${pills}</div>
                </div>
            `;
        }

        // --- 6. MODAL (Lógica de cierre en el HTML via onclick="closeModal(event)") ---.

        function closeModal(event) {
          // Esta función se llama al hacer click en el background.
          closeModalDirect();
        }

        function openProfessorModal(prof) {
          const modal = document.getElementById("profesor-modal");
          const content = document.getElementById("modal-body-content");
          const modalBox = document.getElementById("modal-content");

          const centros = CSV_PROFESORES_CENTROS.filter(
            (c) => c.url_abs === prof.url_abs,
          );
          const asignaturas = CSV_PROFESORES_ASIGNATURAS.filter(
            (a) => a.url_abs === prof.url_abs,
          );

          let centrosHtml =
            '<p class="text-sm text-gray-400 italic">Información no disponible</p>';
          if (centros.length > 0) {
            centrosHtml = `<ul class="text-sm text-gray-600 space-y-2">${centros.map((c) => `<li class="flex items-start gap-2"><div class="w-1.5 h-1.5 rounded-full bg-us-red mt-1.5 flex-shrink-0"></div>${toTitleCase(c.centro)}</li>`).join("")}</ul>`;
          }

          let asignaturasHtml =
            '<p class="text-sm text-gray-400 italic">No hay asignaturas registradas.</p>';
          if (asignaturas.length > 0) {
            asignaturasHtml = `<div class="flex flex-wrap gap-2">${asignaturas.map((a) => {
              const label = a.asignatura;
              const url   = (a.asignatura_url || "").trim();
              return url
                ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="px-4 py-2 bg-gray-50 text-gray-700 text-sm rounded-lg font-medium border border-gray-100 hover:border-us-red hover:text-us-red transition-colors flex items-center gap-1">${label}<i data-lucide="external-link" class="w-3 h-3 opacity-50"></i></a>`
                : `<span class="px-4 py-2 bg-gray-50 text-gray-700 text-sm rounded-lg font-medium border border-gray-100">${label}</span>`;
            }).join("")}</div>`;
          }

          // FOTO LOGIC FOR MODAL: sin pipeline de fotos disponible, se usa siempre el icono.
          const imageUrl = null;
          const displayName = toTitleCase(prof.nombre || prof.nombre_listado);
          const defaultIcon = getAreaIcon(prof.area_conocimiento);

          content.innerHTML = `
                <div class="flex flex-col md:flex-row items-center md:items-start gap-6 mb-8 text-center md:text-left">
                     <div class="w-24 h-24 rounded-2xl bg-gray-100 overflow-hidden shadow-lg shadow-gray-200 flex-shrink-0 flex items-center justify-center relative">
                        <!-- Capa 1: Icono -->
                        <div class="absolute inset-0 flex items-center justify-center bg-gray-100 z-0">
                             ${defaultIcon}
                        </div>
                        <!-- Capa 2: Imagen -->
                        ${
                          imageUrl
                            ? `<img src="${imageUrl}" class="absolute inset-0 w-full h-full object-cover z-10" onerror="this.style.display='none'">`
                            : ""
                        }
                     </div>
                     <div>
                        <h2 class="text-2xl font-bold text-gray-900 leading-tight">${displayName}</h2>
                        <p class="text-us-red font-medium mt-1">${trimProfesor(prof.categoria) || "Docente"}</p>
                        ${prof.dpto_code ? `<p class="text-xs text-gray-400 mt-2 font-mono bg-gray-100 inline-block px-2 py-1 rounded">ID: ${prof.dpto_code}</p>` : ""}
                     </div>
                </div>

                <div class="grid md:grid-cols-2 gap-10">
                    <div class="space-y-6">
                        <div>
                            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Contacto</h3>
                            <div class="space-y-3">
                                ${prof.email ? `<a href="mailto:${prof.email}" class="flex items-center gap-3 text-gray-700 hover:text-us-red transition-colors p-3 bg-gray-50 rounded-lg"><i data-lucide="mail" class="w-4 h-4 text-gray-400"></i><span class="font-medium">${prof.email}</span></a>` : '<p class="text-sm text-gray-400 italic pl-3">Email no disponible</p>'}
                                ${prof.telefono ? `<div class="flex items-center gap-3 text-gray-700 p-3 bg-gray-50 rounded-lg"><i data-lucide="phone" class="w-4 h-4 text-gray-400"></i><span>${prof.telefono}</span></div>` : '<p class="text-sm text-gray-400 italic pl-3">Teléfono no disponible</p>'}
                            </div>
                        </div>
                        
                         ${
                           prof.perfil_prisma_url &&
                           prof.perfil_prisma_url !== "#"
                             ? `
                            <a href="${prof.perfil_prisma_url}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between w-full p-4 border border-gray-200 rounded-xl hover:border-us-red hover:text-us-red transition-all group">
                                <span class="font-bold text-sm">Ver Perfil Investigador (PRISMA)</span>
                                <i data-lucide="external-link" class="w-4 h-4 text-gray-400 group-hover:text-us-red"></i>
                            </a>
                        `
                             : ""
                         }
                    </div>

                    <div class="space-y-6">
                        <div>
                            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Centros</h3>
                            ${centrosHtml}
                        </div>
                        ${prof.grupo && prof.grupo !== "No disponible" ? `
                        <div>
                            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Grupo de Investigación</h3>
                            ${prof.url_grupo && prof.url_grupo !== "No disponible"
                              ? `<a href="${prof.url_grupo}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:border-us-red hover:text-us-red border border-gray-100 transition-all group text-sm font-medium text-gray-700"><i data-lucide="flask-conical" class="w-4 h-4 text-gray-400 group-hover:text-us-red flex-shrink-0"></i><span>${prof.grupo}</span><i data-lucide="external-link" class="w-3 h-3 ml-auto opacity-40 group-hover:opacity-100"></i></a>`
                              : `<p class="text-sm text-gray-700 pl-1">${prof.grupo}</p>`
                            }
                        </div>` : ""}
                    </div>
                </div>

                <div class="mt-8 pt-8 border-t border-gray-100">
                    <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Asignaturas Impartidas</h3>
                    ${asignaturasHtml}
                </div>
                ${buildIdentificadoresHtml(prof)}
            `;

          modal.classList.remove("hidden");
          setTimeout(() => {
            modal.classList.remove("opacity-0");
            modalBox.classList.remove("scale-95");
            modalBox.classList.add("scale-100");
          }, 10);

          refreshIcons();
        }

        function closeModalDirect() {
          const modal = document.getElementById("profesor-modal");
          const modalBox = document.getElementById("modal-content");

          modal.classList.add("opacity-0");
          modalBox.classList.remove("scale-100");
          modalBox.classList.add("scale-95");

          setTimeout(() => {
            modal.classList.add("hidden");
          }, 300);
        }

        // --- 7. RENDERIZADO DE OTRAS SECCIONES ---.

        // Función generalizada para el Scroll Horizontal (Sirve para Investigación y Estudiantes).
        function scrollContainer(containerId, direction) {
          const container = document.getElementById(containerId);
          const scrollAmount = 350; // Ancho aproximado de tarjeta
          if (container) {
            container.scrollBy({
              left: direction * scrollAmount,
              behavior: "smooth",
            });
          }
        }

        // ---------------------------------------------------------------------------------
        // GRADOS (UI curada + ordenación inteligente + modal coherente).
        // ---------------------------------------------------------------------------------

        function escHtml(str) {
          return String(str ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
        }

        function sanitizeRichHtml(input) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = String(input ?? "");

          wrapper
            .querySelectorAll("script, style, iframe, object, embed")
            .forEach((n) => n.remove());

          wrapper.querySelectorAll("*").forEach((el) => {
            Array.from(el.attributes).forEach((attr) => {
              const name = attr.name.toLowerCase();
              const value = String(attr.value || "").trim();
              if (name.startsWith("on")) {
                el.removeAttribute(attr.name);
                return;
              }
              if (
                (name === "href" || name === "src") &&
                /^javascript:/i.test(value)
              ) {
                el.removeAttribute(attr.name);
              }
            });
          });

          return wrapper.innerHTML;
        }

        function uniqueSorted(arr) {
          return Array.from(new Set(arr))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, "es"));
        }

        // Title case español con "palabras vacías" en minúscula (y, en, de, del, la, ...).

        function smartTitleEs(input) {
          const s = String(input || "").trim();
          if (!s) return "";

          const stop = new Set([
            "y",
            "e",
            "o",
            "u",
            "en",
            "de",
            "del",
            "la",
            "las",
            "el",
            "los",
            "a",
            "al",
            "por",
            "para",
            "con",
            "sin",
            "sobre",
            "entre",
          ]);

          const tokens = s.split(/\s+/);

          return tokens
            .map((tok, i) => {
              if (!tok) return tok;

              // Si el token viene como acrónimo (todo mayúsculas) o mezcla con puntos/guiones, lo Se preserva en mayúsculas.
              const lettersOnly = tok.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
              const isAllCaps =
                lettersOnly &&
                lettersOnly === lettersOnly.toUpperCase() &&
                lettersOnly !== lettersOnly.toLowerCase();
              const hasDot = tok.includes(".");
              const hasDash = tok.includes("-");

              if (
                isAllCaps ||
                hasDot ||
                (hasDash && tok.toUpperCase() === tok)
              ) {
                return tok.toUpperCase();
              }

              const low = tok.toLowerCase();
              if (stop.has(low) && i !== 0) return low;

              return low.charAt(0).toUpperCase() + low.slice(1);
            })
            .join(" ")
            .replace(/\bIi\b/g, "II")
            .replace(/\bIii\b/g, "III");
        }

        // Formatea lista de centros separada por ';'.
        function formatCentros(centrosRaw) {
          const raw = String(centrosRaw || "").trim();
          if (!raw) return "";
          return raw
            .split(";")
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => smartTitleEs(p))
            .join("; ");
        }

        function normalizeGradoItem(item) {
          const nombre =
            String(item.grado ?? item.nombre ?? "").trim() ||
            "Grado (sin nombre)";
          const rama =
            String(item["Rama de conocimiento"] ?? item.rama ?? "").trim() ||
            "Sin rama";
          const tipoEns =
            String(item["Tipo de enseñanza"] ?? item.modalidad ?? "").trim() ||
            "Sin modalidad";
          const centrosRaw =
            String(
              item["Centro(s) responsable(s) del título"] ?? item.centro ?? "",
            ).trim() || "Centro no especificado";
          const centros = formatCentros(centrosRaw) || "Centro no especificado";
          const duracion =
            String(
              item["Duración del programa"] ?? item.duracion ?? "",
            ).trim() || "Duración no especificada";
          const url = String(item.url ?? "").trim();

          const isDoble =
            /^Doble\s+Grado/i.test(nombre) || /\(Doble/i.test(nombre);
          const ectsMatch = duracion.match(/(\d+(\.\d+)?)\s*ECTS/i);
          const ects = ectsMatch ? Number(ectsMatch[1]) : null;

          const yearMatch = nombre.match(/\((\d{4})\)/);
          const year = yearMatch ? yearMatch[1] : null;

          return {
            nombre,
            rama,
            tipoEns,
            centros,
            duracion,
            url,
            isDoble,
            ects,
            year,
            raw: item,
          };
        }

        function buildBadge(text, tone = "gray") {
          const toneMap = {
            gray: "bg-gray-50 text-gray-600 border-gray-100",
            red: "bg-red-50 text-us-red border-red-100",
            blue: "bg-blue-50 text-blue-600 border-blue-100",
            green: "bg-green-50 text-green-600 border-green-100",
            amber: "bg-amber-50 text-amber-700 border-amber-100",
            violet: "bg-violet-50 text-violet-700 border-violet-100",
          };
          const cls = toneMap[tone] || toneMap.gray;
          return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}">${escHtml(text)}</span>`;
        }

        function openGradoModal(grado) {
          const modal = document.getElementById("grado-modal");
          const modalBox = document.getElementById("grado-modal-content");
          const body = document.getElementById("grado-modal-body");
          if (!modal || !modalBox || !body) return;

          body.innerHTML = `
                <div class="mb-6">
                    <span class="inline-block bg-red-50 text-us-red text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3 border border-red-100">
                        Detalle del grado
                    </span>
                    <h2 class="text-3xl font-bold text-gray-900 leading-tight mb-2">${escHtml(grado.nombre)}</h2>
                </div>

                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-gray-50/60 rounded-2xl p-6 border border-gray-100">
                        <p class="text-xs font-bold uppercase tracking-widest text-gray-400">Rama</p>
                        <p class="font-semibold text-gray-900 mt-1">${escHtml(grado.rama)}</p>
                    </div>
                    <div class="bg-gray-50/60 rounded-2xl p-6 border border-gray-100">
                        <p class="text-xs font-bold uppercase tracking-widest text-gray-400">Modalidad</p>
                        <p class="font-semibold text-gray-900 mt-1">${escHtml(grado.tipoEns)}</p>
                    </div>
                    <div class="bg-gray-50/60 rounded-2xl p-6 border border-gray-100 md:col-span-2">
                        <p class="text-xs font-bold uppercase tracking-widest text-gray-400">Centro(s) responsable(s)</p>
                        <p class="font-semibold text-gray-900 mt-1 leading-relaxed">${escHtml(grado.centros)}</p>
                    </div>
                    <div class="bg-gray-50/60 rounded-2xl p-6 border border-gray-100 md:col-span-2">
                        <p class="text-xs font-bold uppercase tracking-widest text-gray-400">Duración</p>
                        <p class="font-semibold text-gray-900 mt-1">${escHtml(grado.duracion)}</p>
                    </div>
                </div>

                ${
                  grado.url
                    ? `
                    <div class="mt-8 pt-6 border-t border-gray-100">
                        <a href="${escHtml(grado.url)}" target="_blank" rel="noopener noreferrer"
                           class="inline-flex items-center gap-2 text-white bg-gray-900 px-6 py-3 rounded-lg hover:bg-us-red transition-colors font-medium">
                            Ver ficha oficial <i data-lucide="external-link" class="w-4 h-4"></i>
                        </a>
                    </div>
                `
                    : ""
                }
            `;

          modal.classList.remove("hidden");
          setTimeout(() => {
            modal.classList.remove("opacity-0");
            modalBox.classList.remove("scale-95");
            modalBox.classList.add("scale-100");
          }, 10);

          refreshIcons();
        }

        function closeGradoModal(event) {
          closeGradoModalDirect();
        }

        function closeGradoModalDirect() {
          const modal = document.getElementById("grado-modal");
          const modalBox = document.getElementById("grado-modal-content");
          if (!modal || !modalBox) return;

          modal.classList.add("opacity-0");
          modalBox.classList.remove("scale-100");
          modalBox.classList.add("scale-95");

          setTimeout(() => {
            modal.classList.add("hidden");
          }, 300);
        }

        function renderGradosUI(gradosRaw) {
          const wrapper = document.getElementById("grados-wrapper");
          const container = document.getElementById("grados-container");
          if (!wrapper || !container) return;

          const grados = (Array.isArray(gradosRaw) ? gradosRaw : []).map(
            normalizeGradoItem,
          );

          wrapper.classList.remove("hidden");

          if (grados.length === 0) {
            container.innerHTML = `
                    <div class="bg-white rounded-2xl border border-gray-100 p-8 md:p-10 hover-card">
                        <h4 class="text-lg font-extrabold text-gray-900 mb-2">Grados Universitarios</h4>
                        <p class="text-gray-500 leading-relaxed">
                            No se han podido cargar los <span class="font-semibold text-gray-700">grados</span>.
                            Revisa que el archivo exista en <span class="font-mono text-gray-700">json/grados.json</span>.
                        </p>
                    </div>
                `;
            refreshIcons();
            return;
          }

          const ramas = uniqueSorted(grados.map((g) => g.rama));
          const centrosUnique = uniqueSorted(grados.map((g) => g.centros));
          const modalidades = uniqueSorted(grados.map((g) => g.tipoEns));

          container.innerHTML = `
                <div class="bg-white rounded-2xl border border-gray-100 p-6 md:p-7 hover-card mb-4">
                    <div class="flex flex-col lg:flex-row gap-4 lg:items-end lg:justify-between">
                        <div class="flex-1">
                            <label class="text-xs font-bold uppercase tracking-widest text-gray-400">Buscar</label>
                            <div class="relative mt-2">
                                <input id="grados-q" type="text" placeholder="Busca por titulación o centro..."
                                    class="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-xl focus:border-us-red focus:ring-4 focus:ring-red-50 transition-all outline-none shadow-sm text-gray-700 placeholder-gray-400">
                                <div class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                    <i data-lucide="search" width="20" height="20"></i>
                                </div>
                            </div>
                        </div>

                        <div class="flex flex-wrap gap-2">
                            <button id="grados-reset"
                                class="px-4 py-4 rounded-xl border border-gray-200 text-gray-600 bg-white hover:border-us-red hover:text-us-red transition-all text-sm font-semibold">
                                Limpiar
                            </button>

                            <label class="px-4 py-4 rounded-xl border border-gray-200 text-gray-600 bg-white hover:border-gray-300 transition-all text-sm font-semibold inline-flex items-center gap-2 cursor-pointer">
                                <input id="grados-group" type="checkbox" class="accent-[#B30A1B]" checked>
                                Agrupar por rama
                            </label>
                        </div>
                    </div>

                    <div class="mt-5 grid md:grid-cols-3 gap-3">
                        <div>
                            <label class="text-xs font-bold uppercase tracking-widest text-gray-400">Rama</label>
                            <select id="grados-rama"
                                class="mt-2 w-full py-3 px-3 bg-white border border-gray-200 rounded-xl text-gray-700 shadow-sm focus:border-us-red focus:ring-4 focus:ring-red-50 outline-none">
                                <option value="">Todas</option>
                                ${ramas.map((r) => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join("")}
                            </select>
                        </div>

                        <div>
                            <label class="text-xs font-bold uppercase tracking-widest text-gray-400">Centro</label>
                            <select id="grados-centro"
                                class="mt-2 w-full py-3 px-3 bg-white border border-gray-200 rounded-xl text-gray-700 shadow-sm focus:border-us-red focus:ring-4 focus:ring-red-50 outline-none">
                                <option value="">Todos</option>
                                ${centrosUnique.map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join("")}
                            </select>
                        </div>

                        <div>
                            <label class="text-xs font-bold uppercase tracking-widest text-gray-400">Modalidad</label>
                            <select id="grados-mod"
                                class="mt-2 w-full py-3 px-3 bg-white border border-gray-200 rounded-xl text-gray-700 shadow-sm focus:border-us-red focus:ring-4 focus:ring-red-50 outline-none">
                                <option value="">Todas</option>
                                ${modalidades.map((m) => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join("")}
                            </select>
                        </div>
                    </div>

                    <div class="mt-5 flex flex-wrap gap-2 text-xs">
                        ${buildBadge("Grados", "gray")}
                        ${buildBadge("Doble grado", "violet")}
                        ${buildBadge("Ficha oficial", "red")}
                    </div>
                </div>

                <div id="grados-results" class="space-y-4"></div>
            `;

          const els = {
            q: document.getElementById("grados-q"),
            rama: document.getElementById("grados-rama"),
            centro: document.getElementById("grados-centro"),
            mod: document.getElementById("grados-mod"),
            group: document.getElementById("grados-group"),
            reset: document.getElementById("grados-reset"),
            results: document.getElementById("grados-results"),
          };

          // =====================
          // Boolean query parsing (AND / OR). Si no hay operador explícito -> OR.
          // Soporta: "derecho economia" (OR), "derecho AND economia", "derecho OR economia",.
          // y mixto: "derecho AND economia OR finanzas" => (derecho AND economia) OR finanzas.
          function parseBooleanQuery(raw) {
            const s = (raw || "").trim();
            if (!s) return { groups: [], hasOps: false, raw: "" };

            const tokens = s.split(/\s+/).filter(Boolean);
            const hasOps = tokens.some((t) => /^(and|or)$/i.test(t));

            // Sin operadores: OR por defecto (cada término es un grupo).
            if (!hasOps) {
              return { groups: tokens.map((t) => [t]), hasOps: false, raw: s };
            }

            // Con operadores: OR separa grupos; dentro del grupo todo es AND (implícito).
            const groups = [];
            let current = [];
            for (const tok of tokens) {
              if (/^or$/i.test(tok)) {
                if (current.length) groups.push(current);
                current = [];
                continue;
              }
              if (/^and$/i.test(tok)) continue;
              current.push(tok);
            }
            if (current.length) groups.push(current);

            // Si todo eran operadores o quedó vacío, devolvemos OR por defecto de tokens no-op.
            if (!groups.length) {
              const terms = tokens.filter((t) => !/^(and|or)$/i.test(t));
              return { groups: terms.map((t) => [t]), hasOps: false, raw: s };
            }

            return { groups, hasOps: true, raw: s };
          }

          function boolMatch(textLower, parsed) {
            if (!parsed || !parsed.groups || parsed.groups.length === 0)
              return true;
            return parsed.groups.some((group) =>
              group.every((term) => textLower.includes(term.toLowerCase())),
            );
          }

          // "Qué tan bien" encaja: menor es mejor. Para AND, penaliza si algún término aparece tarde.
          function boolBestPos(textLower, parsed) {
            if (!parsed || !parsed.groups || parsed.groups.length === 0)
              return Number.POSITIVE_INFINITY;

            let best = Number.POSITIVE_INFINITY;
            for (const group of parsed.groups) {
              const positions = group.map((t) =>
                textLower.indexOf(t.toLowerCase()),
              );
              if (positions.some((p) => p < 0)) continue; // este grupo no matchea
              const score = Math.max(...positions); // AND: todos deben aparecer "pronto"
              if (score < best) best = score;
            }
            return best;
          }

          function renderDegreeRow(g, idx) {
            const badges = [
              g.isDoble
                ? buildBadge("Doble grado", "violet")
                : buildBadge("Grado", "gray"),
              g.tipoEns ? buildBadge(g.tipoEns, "blue") : "",
              g.ects ? buildBadge(`${g.ects} ECTS`, "amber") : "",
              g.year ? buildBadge(`Plan ${g.year}`, "green") : "",
            ]
              .filter(Boolean)
              .join(" ");

            return `
                    <div class="bg-white rounded-2xl border border-gray-100 hover-card p-6 md:p-7">
                        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                            <div class="min-w-0">
                                <h4 class="text-lg md:text-xl font-bold text-gray-900 leading-snug">${escHtml(g.nombre)}</h4>
                                <p class="text-gray-500 mt-1 leading-relaxed">
                                    <span class="font-semibold text-gray-700">Centro:</span> ${escHtml(g.centros)}
                                    <span class="mx-2 text-gray-300">•</span>
                                    <span class="font-semibold text-gray-700">Duración:</span> ${escHtml(g.duracion)}
                                </p>
                                <div class="mt-3 flex flex-wrap gap-2">${badges}</div>
                            </div>

                            <div class="flex flex-wrap gap-2 md:justify-end shrink-0">
                                <button class="grado-open px-4 py-3 rounded-xl border border-gray-200 text-gray-700 bg-white hover:border-us-red hover:text-us-red transition-all text-sm font-semibold"
                                    data-idx="${idx}">
                                    Detalles
                                </button>
                                ${
                                  g.url
                                    ? `
                                    <a href="${escHtml(g.url)}" target="_blank" rel="noopener noreferrer"
                                        class="px-4 py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-us-red transition-colors text-sm inline-flex items-center gap-2">
                                        Ver ficha <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
                                    </a>
                                `
                                    : ""
                                }
                            </div>
                        </div>
                    </div>
                `;
          }

          function renderGroup(title, items, baseIndexMap) {
            const safeId =
              "rama-" + title.toLowerCase().replace(/[^a-z0-9]+/gi, "-");
            return `
                    <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                        <button class="w-full text-left p-6 md:p-7 flex items-center justify-between gap-4 hover:bg-gray-50/50 transition-colors" data-acc="${escHtml(safeId)}">
                            <div class="min-w-0">
                                <p class="text-xs font-bold uppercase tracking-widest text-gray-400">Rama</p>
                                <h4 class="text-lg font-extrabold text-gray-900 mt-1">${escHtml(title)}</h4>
                                <p class="text-gray-500 text-sm mt-1">${items.length} programa(s)</p>
                            </div>
                            <div class="w-10 h-10 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-600">
                                <i data-lucide="chevron-down" class="w-5 h-5"></i>
                            </div>
                        </button>
                        <div id="${escHtml(safeId)}" class="hidden p-6 md:p-7 pt-0 space-y-4">
                            ${items.map((g) => renderDegreeRow(g, baseIndexMap.get(g))).join("")}
                        </div>
                    </div>
                `;
          }

          function applyFilters() {
            const rawQ = (els.q.value || "").trim();
            const parsed = parseBooleanQuery(rawQ);

            const rama = els.rama.value;
            const centro = els.centro.value;
            const mod = els.mod.value;

            // Texto base en minúsculas para matching.
            let filtered = grados.filter((g) => {
              const nameL = g.nombre.toLowerCase();
              const centroL = g.centros.toLowerCase();

              // Booleanos: por defecto OR si no hay operador explícito.
              // Match global: (titulación OR centro) satisface la expresión.
              const okQ =
                !rawQ || boolMatch(nameL, parsed) || boolMatch(centroL, parsed);

              const okRama = !rama || g.rama === rama;
              const okCentro = !centro || g.centros === centro;
              const okMod = !mod || g.tipoEns === mod;
              return okQ && okRama && okCentro && okMod;
            });

            // Orden solicitado al buscar:
            // 1) match en titulación, 2) match/orden por centro (facultad), 3) alfabético.
            if (rawQ) {
              filtered.sort((a, b) => {
                const aName = a.nombre.toLowerCase();
                const bName = b.nombre.toLowerCase();
                const aCentro = a.centros.toLowerCase();
                const bCentro = b.centros.toLowerCase();

                const aInName = boolMatch(aName, parsed);
                const bInName = boolMatch(bName, parsed);
                if (aInName !== bInName) return aInName ? -1 : 1;

                // Score de posición (menor = mejor).
                const aNamePos = boolBestPos(aName, parsed);
                const bNamePos = boolBestPos(bName, parsed);

                if (aInName && bInName && aNamePos !== bNamePos)
                  return aNamePos - bNamePos;

                const aCentroPos = boolBestPos(aCentro, parsed);
                const bCentroPos = boolBestPos(bCentro, parsed);
                if (aCentroPos !== bCentroPos) return aCentroPos - bCentroPos;

                const c = aCentro.localeCompare(bCentro, "es");
                if (c !== 0) return c;

                return aName.localeCompare(bName, "es");
              });
            } else {
              // Orden por defecto: dobles primero, luego alfabético.
              filtered.sort(
                (a, b) =>
                  Number(b.isDoble) - Number(a.isDoble) ||
                  a.nombre.localeCompare(b.nombre, "es"),
              );
            }

            renderResults(filtered, els.group.checked);
            if (window.lucide?.createIcons) window.lucide.createIcons();
          }

          function renderResults(items) {
            if (!items.length) {
              els.results.innerHTML = `
                        <div class="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                            <p class="text-gray-500">No hay resultados con los filtros actuales.</p>
                        </div>
                    `;
              return;
            }

            // Mapa para recuperar el índice real del array "grados" (para abrir modal).
            const baseIndexMap = new Map();
            grados.forEach((g, i) => baseIndexMap.set(g, i));

            if (!els.group.checked) {
              els.results.innerHTML = items
                .map((g) => renderDegreeRow(g, baseIndexMap.get(g)))
                .join("");
            } else {
              const map = new Map();
              items.forEach((g) => {
                if (!map.has(g.rama)) map.set(g.rama, []);
                map.get(g.rama).push(g);
              });

              els.results.innerHTML = Array.from(map.keys())
                .sort((a, b) => a.localeCompare(b, "es"))
                .map((r) => renderGroup(r, map.get(r), baseIndexMap))
                .join("");

              // Accordion toggle (evita salto de scroll al desplegar)
              els.results.querySelectorAll("[data-acc]").forEach((btn) => {
                btn.addEventListener("click", () => {
                  const y = window.scrollY;
                  const target = document.getElementById(
                    btn.getAttribute("data-acc"),
                  );
                  if (target) target.classList.toggle("hidden");

                  // Algunos navegadores ajustan el scroll al cambiar la altura del contenido.
                  // Restauramos la posición para que el usuario vaya viendo los títulos de forma natural.
                  requestAnimationFrame(() => window.scrollTo({ top: y }));
                });
              });
            }

            // Botones de detalle
            els.results.querySelectorAll(".grado-open").forEach((btn) => {
              btn.addEventListener("click", () => {
                const idx = Number(btn.getAttribute("data-idx"));
                const g = grados[idx];
                if (g) openGradoModal(g);
              });
            });
          }

          // Listeners
          ["input", "change"].forEach((evt) => {
            els.q.addEventListener(evt, applyFilters);
            els.rama.addEventListener(evt, applyFilters);
            els.centro.addEventListener(evt, applyFilters);
            els.mod.addEventListener(evt, applyFilters);
            els.group.addEventListener(evt, applyFilters);
          });

          els.reset.addEventListener("click", () => {
            els.q.value = "";
            els.rama.value = "";
            els.centro.value = "";
            els.mod.value = "";
            els.group.checked = true;
            applyFilters();
          });

          applyFilters();
          refreshIcons();
        }

        function renderOfertaMasteresDoctorados() {
          // Colores tenues rotativos (Nota 6).
          const offerColors = [
            "bg-blue-50 hover:bg-blue-100 border-blue-100",
            "bg-emerald-50 hover:bg-emerald-100 border-emerald-100",
            "bg-violet-50 hover:bg-violet-100 border-violet-100",
            "bg-amber-50 hover:bg-amber-100 border-amber-100",
            "bg-rose-50 hover:bg-rose-100 border-rose-100",
          ];

          // Render GRADOS (UI curada).
          renderGradosUI(GRADOS_DATA);

          // Render Másteres (robusto: no rompe si el bloque no existe o está vacío).
          const containerMaster = document.getElementById("masteres-container");
          if (containerMaster) {
            if (MASTERES_DATA && MASTERES_DATA.length > 0) {
              containerMaster.innerHTML = MASTERES_DATA.map((m, index) => {
                const colorClass =
                  offerColors[(index + 2) % offerColors.length]; // Offset para variar
                return `
                    <a href="${normalizeDirectUrl(m.url)}" target="_blank" rel="noopener noreferrer" class="block group ${colorClass} p-4 rounded-xl border hover:shadow-md transition-all">
                        <div class="flex items-center justify-between">
                            <span class="text-gray-700 font-medium group-hover:text-gray-900 transition-colors">${escHtml(m.master || m.nombre)}</span>
                            <i data-lucide="arrow-up-right" class="w-4 h-4 text-gray-400 group-hover:text-gray-600"></i>
                        </div>
                    </a>
                `;
              }).join("");
            } else {
              // Si no hay másteres, limpia el contenedor (si existiera por compatibilidad).
              containerMaster.innerHTML = "";
            }
          }
          // Render Doctorados (Sección Oferta).
          const containerDoc = document.getElementById("doctorados-list");
          if (DOCTORADOS_DATA && DOCTORADOS_DATA.length > 0) {
            containerDoc.innerHTML = DOCTORADOS_DATA.map(
              (d) => `
                    <a href="${normalizeDirectUrl(d.url)}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 text-gray-300 hover:text-white transition-colors py-1">
                        <i data-lucide="chevron-right" class="w-4 h-4"></i>
                        ${escHtml(d.doctorado || d.nombre)}
                    </a>
                `,
            ).join("");
          }

          // Render Doctorados (Sección Investigación).
          const containerDocInv = document.getElementById(
            "doctorados-investigacion-list",
          );
          if (containerDocInv) {
            if (DOCTORADOS_DATA && DOCTORADOS_DATA.length > 0) {
              containerDocInv.innerHTML = DOCTORADOS_DATA.map(
                (d) => `
                        <a href="${normalizeDirectUrl(d.url)}" target="_blank" rel="noopener noreferrer" class="block text-gray-600 hover:text-us-red transition-colors py-1 flex items-center gap-2">
                            <i data-lucide="chevron-right" class="w-4 h-4"></i>
                            ${escHtml(d.doctorado || d.nombre)}
                        </a>
                    `,
              ).join("");
            } else {
              containerDocInv.innerHTML =
                '<p class="text-sm text-gray-400">No hay datos disponibles.</p>';
            }
          }
        }

        // Actualización: CARRUSEL/SLIDER con COLORES TENUES ROTATIVOS.
        function renderInvestigacionGrupos() {
          const slider = document.getElementById("grupos-slider");
          if (!CSV_INVESTIGADORES || CSV_INVESTIGADORES.length === 0) return;

          // Paleta de colores tenues para rotar.
          const cardColors = [
            "bg-blue-50 hover:bg-blue-100",
            "bg-emerald-50 hover:bg-emerald-100",
            "bg-violet-50 hover:bg-violet-100",
            "bg-amber-50 hover:bg-amber-100",
            "bg-rose-50 hover:bg-rose-100",
            "bg-cyan-50 hover:bg-cyan-100",
          ];

          const gruposUnicos = {};

          CSV_INVESTIGADORES.forEach((inv) => {
            if (
              inv.grupo &&
              inv.grupo.includes("SEJ-") &&
              !gruposUnicos[inv.grupo]
            ) {
              let nombreRaw = inv.grupo
                .replace(/UNIVERSIDAD DE SEVILLA/gi, "")
                .trim();
              if (nombreRaw.endsWith("-")) nombreRaw = nombreRaw.slice(0, -1);

              const codeMatch = nombreRaw.match(/(SEJ-\d+)/i);
              const code = codeMatch ? codeMatch[0].toUpperCase() : "";

              let titulo = nombreRaw
                .replace(code, "")
                .replace(/\(\)/g, "")
                .replace(/\( \)/g, "")
                .replace(/^-/, "")
                .trim()
                .toUpperCase();
              titulo = titulo.replace(/^-+|-+$/g, "").trim();

              gruposUnicos[inv.grupo] = {
                code: code,
                titulo: titulo,
                url: inv.url_grupo || "#",
              };
            }
          });

          const gruposArray = Object.values(gruposUnicos);

          if (gruposArray.length === 0) {
            slider.innerHTML =
              '<p class="text-gray-500 col-span-full">No hay grupos de investigación registrados con código SEJ.</p>';
            return;
          }

          slider.innerHTML = gruposArray
            .map((g, index) => {
              const colorClass = cardColors[index % cardColors.length];
              return `
                <div class="snap-center shrink-0 w-[300px] md:w-[350px]">
                    <a href="${normalizeDirectUrl(g.url)}" target="_blank" rel="noopener noreferrer" class="block ${colorClass} p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-lg transition-all group relative overflow-hidden flex flex-col items-start h-full h-[180px]">
                        <div class="flex justify-between items-start w-full mb-3">
                            <span class="inline-block bg-white text-gray-700 font-bold px-3 py-1 rounded-full text-xs tracking-wide shadow-sm">${escHtml(g.code)}</span>
                            <i data-lucide="search" class="w-4 h-4 text-gray-400 group-hover:text-us-red transition-colors"></i>
                        </div>
                        <h4 class="font-bold text-gray-900 leading-tight group-hover:text-us-red transition-colors uppercase tracking-tight text-sm">${escHtml(g.titulo)}</h4>
                    </a>
                </div>
             `;
            })
            .join("");
        }

        // UTILS NUEVAS: Truncar texto y Modal News.
        function truncateText(text, wordLimit = 12) {
          if (!text) return "";
          // Eliminamos tags HTML para el conteo de palabras, pero devolvemos texto plano para el resumen corto.
          // Ojo: Si el resumen tiene HTML, 'text' lo tendrá. Para "cortar", mejor usar solo texto.
          // Para simplificar y evitar cortar etiquetas a la mitad:
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = text;
          const plainText = tempDiv.textContent || tempDiv.innerText || "";

          const words = plainText.split(/\s+/);
          if (words.length > wordLimit) {
            return words.slice(0, wordLimit).join(" ") + "...";
          }
          return plainText;
        }

        // --- INDEXADO/ORDENACIÓN DE NOTICIAS (Sección:) ---.
        // Requisito: separar por tipos (evento, noticia, investig, etc.) revisando el archivo completo.
        // y ordenar por fecha de más recientes a más antiguas.

        function normalizeNewsTipo(tipoRaw) {
          const t = String(tipoRaw || "")
            .toLowerCase()
            .trim();
          if (!t) return "other";
          if (t === "evento" || t.includes("evento")) return "evento";
          if (t === "noticia" || t.includes("noticia")) return "noticia";
          if (t.includes("investig")) return "investig";
          if (t.includes("estudiant")) return "estudiantes";
          return "other";
        }

        function parseNewsDate(fechaRaw) {
          // Soporta: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY.
          const s = String(fechaRaw || "").trim();
          if (!s) return new Date(0);

          // ISO-like
          const iso = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
          if (iso) {
            const y = Number(iso[1]);
            const m = Number(iso[2]) - 1;
            const d = Number(iso[3]);
            const dt = new Date(y, m, d);
            return isNaN(dt.getTime()) ? new Date(0) : dt;
          }

          // DD/MM/YYYY or DD-MM-YYYY
          const dmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
          if (dmy) {
            const d = Number(dmy[1]);
            const m = Number(dmy[2]) - 1;
            const y = Number(dmy[3]);
            const dt = new Date(y, m, d);
            return isNaN(dt.getTime()) ? new Date(0) : dt;
          }

          // Fallback: Date.parse
          const dt = new Date(s);
          return isNaN(dt.getTime()) ? new Date(0) : dt;
        }

        // Muestra fechas de noticias en castellano (DD-MM-AAAA), sin alterar el dato original.
        function formatNewsFecha(fechaRaw) {
          const dt = parseNewsDate(fechaRaw);
          if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) {
            return String(fechaRaw ?? "").trim();
          }
          const s = new Intl.DateTimeFormat("es-ES", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(dt);
          return s.replaceAll("/", "-");
        }


        function dedupeNewsByKey(items) {
          const seen = new Set();
          return (items || []).filter((it) => {
            const key = `${it.titulo || ""}|${it.fecha || ""}|${normalizeNewsTipo(it.tipo)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }

        function buildNewsIndex() {
          const idx = {
            evento: [],
            noticia: [],
            investig: [],
            estudiantes: [],
            other: [],
          };
          if (!Array.isArray(NEWS_DATA)) return idx;

          // Recorremos TODO el CSV (NEWS_DATA completo) y clasificamos por tipo.
          NEWS_DATA.forEach((item) => {
            const key = normalizeNewsTipo(item.tipo);
            (idx[key] || idx.other).push(item);
          });

          // Orden descendente por fecha (más recientes primero).
          Object.keys(idx).forEach((k) => {
            idx[k].sort(
              (a, b) => parseNewsDate(b.fecha) - parseNewsDate(a.fecha),
            );
          });

          // Deduplicación (manteniendo orden ya ordenado).
          Object.keys(idx).forEach((k) => {
            idx[k] = dedupeNewsByKey(idx[k]);
          });

          return idx;
        }
        function openNewsModal(newsId) {
          // Buscamos la noticia por el índice _id que asignamos al cargar.
          const newsItem = NEWS_DATA.find((n) => n._id === newsId);
          if (!newsItem) return;

          const modal = document.getElementById("news-modal");
          const contentBody = document.getElementById("news-modal-body");
          const modalBox = document.getElementById("news-modal-content");

          contentBody.innerHTML = `
                <div class="mb-6">
                    <span class="inline-block bg-red-50 text-us-red text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3 border border-red-100">
                        ${formatNewsFecha(newsItem.fecha)}
                    </span>
                    <h2 class="text-3xl font-bold text-gray-900 leading-tight mb-2">${escHtml(newsItem.titulo)}</h2>
                    ${newsItem.autor ? `<p class="text-gray-400 text-sm font-medium">Por: <span class="text-gray-600">${escHtml(newsItem.autor)}</span></p>` : ""}
                </div>
                
                <div class="prose prose-red max-w-none text-gray-600 leading-relaxed">
                    <!-- Contenido completo (resumen) con HTML. -->
                    ${sanitizeRichHtml(newsItem.resumen)}
                </div>
            `;

          modal.classList.remove("hidden");
          setTimeout(() => {
            modal.classList.remove("opacity-0");
            modalBox.classList.remove("scale-95");
            modalBox.classList.add("scale-100");
          }, 10);
        }

        function closeNewsModal(event) {
          closeNewsModalDirect();
        }

        function closeNewsModalDirect() {
          const modal = document.getElementById("news-modal");
          const modalBox = document.getElementById("news-modal-content");

          modal.classList.add("opacity-0");
          modalBox.classList.remove("scale-100");
          modalBox.classList.add("scale-95");

          setTimeout(() => {
            modal.classList.add("hidden");
          }, 300);
        }

        function shuffleArray(array) {
          const arr = [...array];
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          return arr;
        }

        // Actualización: Estilo idéntico a "Próximos Eventos" (border-l-4).
        function renderInvestigacionNews() {
          const container = document.getElementById("investigacion-news-grid");
          if (!NEWS_DATA || NEWS_DATA.length === 0) return;

          const investigNews =
            NEWS_INDEX && NEWS_INDEX.investig ? NEWS_INDEX.investig : [];
          const eventNews =
            NEWS_INDEX && NEWS_INDEX.evento ? NEWS_INDEX.evento : [];

          let displayList = [...investigNews];

          // Si hay pocas de investigación, se rellenan con eventos.
          if (displayList.length < 6) {
            const needed = 6 - displayList.length;
            displayList = displayList.concat(eventNews.slice(0, needed));
          }

          // 🔑 CLAVE: selección aleatoria.
          displayList = shuffleArray(displayList).slice(0, 6);

          if (displayList.length > 0) {
            container.innerHTML = displayList
              .map(
                (n) => `
                    <div class="bg-white p-6 rounded-2xl border border-gray-100 hover-card transition-all h-full cursor-pointer"
                         onclick="openNewsModal(${n._id})">
                        <div class="border-l-4 ${n.tipo && n.tipo.includes("investig") ? "border-us-red" : "border-blue-400"} pl-4">
                            <span class="text-xs font-bold uppercase text-gray-500 block mb-1">${formatNewsFecha(n.fecha)}</span>
                            <h4 class="font-bold text-gray-900 leading-tight mb-2 text-sm">${escHtml(n.titulo)}</h4>
                            <p class="text-xs text-gray-500 line-clamp-3">${truncateText(n.resumen)}</p>
                        </div>
                    </div>
                `,
              )
              .join("");
          }
        }

        // NUEVA FUNCIÓN: Renderizar Noticias y Eventos en Home.
        function renderHomeNewsAndEvents() {
          if (!NEWS_DATA || NEWS_DATA.length === 0) return;

          // --- Próximos Eventos (independiente) ---.
          // Requisito: ignorar completamente filas intercaladas de otros tipos y recolectar primero todos los eventos.
          const eventosContainer = document.getElementById(
            "eventos-home-container",
          );
          if (!eventosContainer) {
            // Bloque de eventos sustituido por vídeo en Inicio. No hacemos nada aquí.
          } else {
            const eventosAll =
              NEWS_INDEX && NEWS_INDEX.evento ? NEWS_INDEX.evento : [];
            const lastEventos = eventosAll.slice(0, 4); // ya vienen ordenados por fecha desc

            if (lastEventos.length > 0) {
              eventosContainer.innerHTML = lastEventos
                .map(
                  (ev) => `
                    <div class="border-l-4 border-us-red pl-4 py-1 cursor-pointer hover:bg-gray-50 transition-colors rounded-r" onclick="openNewsModal(${ev._id})">
                        <span class="text-xs font-bold uppercase text-us-red block mb-1">${formatNewsFecha(ev.fecha)}</span>
                        <h4 class="font-bold text-gray-900 leading-tight mb-1 text-sm">${escHtml(ev.titulo)}</h4>
                        <p class="text-xs text-gray-500 line-clamp-2">${truncateText(ev.resumen)}</p>
                    </div>
                `,
                )
                .join("");
            } else {
              eventosContainer.innerHTML =
                '<p class="text-sm text-gray-400">No hay eventos próximos.</p>';
            }
          }

          // --- Últimas Noticias (ordenadas: más recientes -> más antiguas) ---.
          const noticiasContainer = document.getElementById(
            "noticias-home-container",
          );
          const noticiasAll =
            NEWS_INDEX && NEWS_INDEX.noticia ? NEWS_INDEX.noticia : [];
          const lastNoticias = noticiasAll.slice(0, 6); // par, para no descuadrar el grid de 2 columnas (ya vienen ordenadas por fecha desc)

          if (lastNoticias.length > 0) {
            noticiasContainer.innerHTML = lastNoticias
              .map(
                (news) => `
                    <div class="bg-white p-4 rounded-xl border border-gray-100 hover-card transition-all flex flex-col md:flex-row gap-4 items-start cursor-pointer" onclick="openNewsModal(${news._id})">
                        <div class="flex-shrink-0">
                            <span class="inline-block bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded">${formatNewsFecha(news.fecha)}</span>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-1 hover:text-us-red transition-colors cursor-pointer">${escHtml(news.titulo)}</h4>
                            <p class="text-sm text-gray-500 line-clamp-2">${truncateText(news.resumen)}</p>
                            ${news.autor ? `<p class="text-xs text-gray-400 mt-2">Por: ${escHtml(news.autor)}</p>` : ""}
                        </div>
                    </div>
                `,
              )
              .join("");
          } else {
            noticiasContainer.innerHTML =
              '<p class="text-gray-400 text-sm">No hay noticias recientes.</p>';
          }
        }

        // Renderizado de noticias Estudiantes (Actualización: CARRUSEL SIN LÍMITE).
        function renderNoticias() {
          const container = document.getElementById("noticias-container");
          if (!NEWS_DATA || NEWS_DATA.length === 0) {
            container.innerHTML =
              '<p class="text-gray-400 text-sm">No hay noticias recientes.</p>';
            return;
          }

          const studentNews =
            NEWS_INDEX && NEWS_INDEX.estudiantes ? NEWS_INDEX.estudiantes : [];

          if (studentNews.length === 0) {
            container.innerHTML =
              '<p class="text-gray-400 text-sm">No hay avisos para estudiantes.</p>';
            return;
          }

          // SIN LIMITES (reverse para mostrar más recientes primero) + ONCLICK + TRUNCATE.
          container.innerHTML = studentNews
            .map(
              (news) => `
                <div class="snap-center shrink-0 w-[300px] md:w-[350px]">
                    <div class="bg-white p-5 rounded-xl border border-gray-100 hover:border-red-100 hover:shadow-md transition-all group cursor-pointer flex flex-col h-full h-[180px] justify-between" onclick="openNewsModal(${news._id})">
                        <div>
                            <div class="flex justify-between items-center mb-2">
                                 <span class="text-[10px] font-bold tracking-widest uppercase text-us-red bg-red-50 px-2 py-1 rounded">${formatNewsFecha(news.fecha)}</span>
                            </div>
                            <h4 class="font-bold text-gray-800 text-lg mb-1 group-hover:text-us-red transition-colors line-clamp-2">${escHtml(news.titulo)}</h4>
                            <p class="text-sm text-gray-500 line-clamp-3">${truncateText(news.resumen)}</p>
                        </div>
                    </div>
                </div>
            `,
            )
            .join("");
        }

        // --- FUNCIONES NUEVAS: NORMATIVA CON MODAL Y ENLACES CORREGIDOS ---.

        function renderNormativas() {
          const container = document.getElementById("normativa-preview");
          if (!NORMATIVAS_DATA || NORMATIVAS_DATA.length === 0) {
            container.innerHTML =
              '<p class="text-gray-400 text-xs italic">No hay normativas.</p>';
            return;
          }

          const baseUrl = "https://edwww.us.es/";

          // Render first 3
          // Nota SOLICITADO: ELIMINAR TRUNCATE, USAR FLEX-ITEMS-START PARA QUE EL TEXTO FLUYA.
          const firstThree = NORMATIVAS_DATA.slice(0, 8)
            .map((norm) => {
              // Handle potential double slash if norm.URL starts with /.
              let cleanPath = norm.URL || "#";
              if (cleanPath.startsWith("/")) cleanPath = cleanPath.substring(1);
              const fullUrl = baseUrl + cleanPath;

              return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-500 hover:text-us-red transition-colors text-sm py-1 flex items-start gap-2"><div class="w-1.5 h-1.5 rounded-full bg-us-red flex-shrink-0 mt-1.5"></div> <span class="break-words">${escHtml(norm.Normativa || norm.nombre)}</span></a>`;
            })
            .join("");

          // Add + button
          const plusBtn = `
                <button onclick="openNormativasModal(event)" class="mt-3 w-full flex items-center justify-center gap-1 text-xs font-bold text-us-red bg-red-50 hover:bg-red-100 py-2 rounded-lg transition-colors border border-red-100">
                    <i data-lucide="plus" class="w-3 h-3"></i> Ver todas las normativas
                </button>
            `;

          container.innerHTML = firstThree + plusBtn;
          refreshIcons();
        }

        function openNormativasModal(event) {
          // Prevenir bubbling si fuera necesario.
          if (event) event.stopPropagation();

          const modal = document.getElementById("normativas-modal");
          const listContainer = document.getElementById(
            "normativas-modal-list",
          );
          const modalBox = document.getElementById("normativas-modal-content");

          const baseUrl = "https://edwww.us.es/";

          if (!NORMATIVAS_DATA || NORMATIVAS_DATA.length === 0) {
            listContainer.innerHTML =
              '<p class="text-gray-500 italic">No hay normativas disponibles.</p>';
          } else {
            listContainer.innerHTML = NORMATIVAS_DATA.map((norm) => {
              let cleanPath = norm.URL || "#";
              if (cleanPath.startsWith("/")) cleanPath = cleanPath.substring(1);
              const fullUrl = baseUrl + cleanPath;

              return `
                        <a href="${fullUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-4 rounded-xl border border-gray-100 hover:border-us-red hover:bg-red-50 transition-all group bg-gray-50/50">
                            <div class="bg-white p-2 rounded-lg border border-gray-100 text-us-red group-hover:scale-110 transition-transform">
                                <i data-lucide="file-text" class="w-5 h-5"></i>
                            </div>
                            <span class="text-gray-700 font-medium group-hover:text-us-red transition-colors">${escHtml(norm.Normativa || norm.nombre)}</span>
                            <i data-lucide="external-link" class="w-4 h-4 text-gray-400 ml-auto group-hover:text-us-red"></i>
                        </a>
                    `;
            }).join("");
          }

          modal.classList.remove("hidden");
          setTimeout(() => {
            modal.classList.remove("opacity-0");
            modalBox.classList.remove("scale-95");
            modalBox.classList.add("scale-100");
          }, 10);

          refreshIcons();
        }

        function closeNormativasModal(event) {
          closeNormativasModalDirect();
        }

        function closeNormativasModalDirect() {
          const modal = document.getElementById("normativas-modal");
          const modalBox = document.getElementById("normativas-modal-content");

          modal.classList.add("opacity-0");
          modalBox.classList.remove("scale-100");
          modalBox.classList.add("scale-95");

          setTimeout(() => {
            modal.classList.add("hidden");
          }, 300);
        }

        // ---------------------------------------------------------------------------------
        // API pública mínima (REQUERIDA por onclick="..." en HTML y HTML generado dinámicamente).
        // ---------------------------------------------------------------------------------
        // Nota: mantener estas asignaciones evita romper el sitio si el script se encapsula.
        window.switchSection = switchSection;
        window.toggleMobileMenu = toggleMobileMenu;
        window.clearSearch = clearSearch;
        window.showProfesoradoArea = showProfesoradoArea;
        window.scrollContainer = scrollContainer;
        window.closeModal = closeModal;
        window.closeModalDirect = closeModalDirect;
        window.openNewsModal = openNewsModal;
        window.closeNewsModal = closeNewsModal;
        window.closeNewsModalDirect = closeNewsModalDirect;
        window.openNormativasModal = openNormativasModal;
        window.closeNormativasModal = closeNormativasModal;
        window.closeNormativasModalDirect = closeNormativasModalDirect;
        window.closeGradoModal = closeGradoModal;
        window.closeGradoModalDirect = closeGradoModalDirect;
      })();
