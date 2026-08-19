/**
 * ADEMARK — v2
 * Lógica de la aplicación (un único archivo, sin dependencias cruzadas implícitas).
 * Los datos (json/*.json, out/*.csv) se sirven desde la raíz del proyecto,
 * un nivel por encima de /v2.
 */
(function () {
  "use strict";

  const DATA_ROOT = "../";

  // -----------------------------------------------------------------------
  // Utilidades
  // -----------------------------------------------------------------------
  function $id(id) {
    return document.getElementById(id);
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function esc(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  // -----------------------------------------------------------------------
  // Estado
  // -----------------------------------------------------------------------
  let CSV_PROFESORES = [];
  let CSV_PROFESORES_PERFIL = [];
  let CSV_PROFESORES_CENTROS = [];
  let CSV_PROFESORES_ASIGNATURAS = [];
  let CSV_INVESTIGADORES = [];
  let PROFESORES_EXTRA = { ocultos: [], manuales: [] };
  let NEWS_DATA = [];
  let NEWS_INDEX = { evento: [], noticia: [], investig: [], estudiantes: [], other: [] };
  let MASTERES_DATA = [];
  let GRADOS_DATA = [];
  let DOCTORADOS_DATA = [];
  let NORMATIVAS_DATA = [];

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

  // -----------------------------------------------------------------------
  // Carga de datos
  // -----------------------------------------------------------------------
  function parseCsvRowString(str) {
    const fields = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inQuotes) {
        if (ch === '"') {
          if (str[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(field);
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields;
  }

  // Algunos CSV (profesores_perfil.csv) tienen cada fila envuelta en comillas
  // externas; PapaParse trata entonces la fila entera como un solo campo.
  // Se detecta y re-parsea aquí.
  function fixMalformedCsvRow(row) {
    const content = row.url_abs || "";
    if (!content.includes(",")) return row;
    const COLS = [
      "url_abs", "nombre", "categoria", "telefono", "email",
      "departamento", "area_conocimiento", "perfil_prisma_url",
      "content_hash", "scraped_at",
    ];
    const fields = parseCsvRowString(content);
    const fixed = {};
    COLS.forEach((col, i) => { fixed[col] = fields[i] !== undefined ? fields[i] : ""; });
    return fixed;
  }

  async function fetchCsv(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo cargar ${url}`);
    const text = await response.text();
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
    return Array.isArray(data) ? data : [];
  }

  async function loadAllData() {
    try {
      const results = await Promise.all([
        fetchCsv(DATA_ROOT + "out/profesores.csv"),
        fetchCsv(DATA_ROOT + "out/profesores_perfil.csv"),
        fetchCsv(DATA_ROOT + "out/profesores_centros.csv"),
        fetchCsv(DATA_ROOT + "out/profesores_asignaturas.csv"),
        fetchCsv(DATA_ROOT + "out/investigadores.csv"),
        fetchJson(DATA_ROOT + "json/noticias.json"),
        fetchCsv(DATA_ROOT + "out/masteres.csv"),
        fetchCsv(DATA_ROOT + "out/doctorados.csv"),
        fetchCsv(DATA_ROOT + "out/normativas_simplificado.csv"),
        fetchJson(DATA_ROOT + "json/grados.json").catch(() => []),
        fetch(DATA_ROOT + "json/profesores_extra.json")
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({})),
      ]);

      CSV_PROFESORES = results[0];
      CSV_PROFESORES_PERFIL = results[1];
      CSV_PROFESORES_CENTROS = results[2];
      CSV_PROFESORES_ASIGNATURAS = results[3];
      CSV_INVESTIGADORES = results[4];
      NEWS_DATA = results[5].map((item, index) => ({ ...item, _id: index }));
      MASTERES_DATA = results[6];
      DOCTORADOS_DATA = results[7];
      NORMATIVAS_DATA = results[8];
      GRADOS_DATA = results[9];

      const extra = results[10] || {};
      PROFESORES_EXTRA = {
        ocultos: Array.isArray(extra.ocultos) ? extra.ocultos : [],
        manuales: Array.isArray(extra.manuales) ? extra.manuales : [],
      };

      $id("loading-screen").style.display = "none";
      $id("main-content").classList.remove("hidden");

      initApp();
    } catch (error) {
      console.error("Error cargando los datos:", error);
      $id("loading-screen").innerHTML = `
        <div style="text-align:center; padding: 2rem; max-width: 420px;">
          <p style="color:#b30a1b; font-weight:700; font-size:1.1rem; margin-bottom:.5rem;">Error cargando datos</p>
          <p style="color:#706a61; margin-bottom:1rem;">Asegúrate de servir este sitio desde un servidor local (no abrir el archivo directamente).</p>
          <p style="font-size:.75rem; color:#a39c91; font-family:monospace;">${esc(error.message)}</p>
        </div>`;
    }
  }

  // Grids de tarjetas (Instalaciones / Comunidad) desde JSON.
  async function loadCardGridFromJson(opts) {
    const gridEl = $id(opts.gridId);
    const statusEl = $id(opts.statusId);
    if (!gridEl) return;

    function cardHtml(item) {
      const titulo = esc(item.titulo);
      const imagen = esc(item.imagen);
      const alt = esc(item.alt || item.titulo || "");
      const ubicacion = esc(item.ubicacion);
      const descripcion = esc(item.descripcion);
      return `
        <div class="card media-card">
          <figure>
            <img src="${DATA_ROOT}${imagen}" alt="${alt}" loading="lazy"
                 onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23f4f2ee%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2216%22 fill=%22%23a39c91%22 text-anchor=%22middle%22%3EImagen no disponible%3C/text%3E%3C/svg%3E'" />
          </figure>
          <div class="media-card-body">
            <h3>${titulo}</h3>
            <div class="media-meta"><i data-lucide="map-pin"></i><span>${ubicacion}</span></div>
            <div class="media-meta"><i data-lucide="info"></i><span>${descripcion}</span></div>
          </div>
        </div>`;
    }

    try {
      if (statusEl) statusEl.textContent = opts.loadingText || "Cargando…";
      const res = await fetch(DATA_ROOT + opts.jsonUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

      if (!items.length) {
        gridEl.innerHTML = `<p class="text-faint" style="grid-column:1/-1">${esc(opts.emptyText || "No hay elementos para mostrar.")}</p>`;
      } else {
        gridEl.innerHTML = items.map(cardHtml).join("");
      }
      if (statusEl) statusEl.textContent = "";
    } catch (err) {
      console.error("Error cargando grid JSON:", opts.jsonUrl, err);
      if (statusEl) {
        statusEl.innerHTML = `<span class="status-error"><i data-lucide="alert-triangle"></i> No se pudo cargar ${esc(opts.jsonUrl)}.</span>`;
      }
      gridEl.innerHTML = "";
    }
    refreshIcons();
  }

  // -----------------------------------------------------------------------
  // Inicialización
  // -----------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const yearEl = $id("year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
    refreshIcons();
    loadAllData();
  });

  function initApp() {
    NEWS_INDEX = buildNewsIndex();

    renderMenu();
    wireStaticInteractions();

    loadCardGridFromJson({
      gridId: "instalaciones-grid",
      statusId: "instalaciones-status",
      jsonUrl: "json/instalaciones.json",
      loadingText: "Cargando instalaciones…",
      emptyText: "No hay instalaciones para mostrar.",
    });
    loadCardGridFromJson({
      gridId: "comunidad-grid",
      statusId: "comunidad-status",
      jsonUrl: "json/comunidad.json",
      loadingText: "Cargando comunidad…",
      emptyText: "No hay elementos de comunidad para mostrar.",
    });

    renderOfertaMasteresDoctorados();
    renderInvestigacionGrupos();
    renderInvestigacionNews();
    renderNoticias();
    renderHomeNewsAndEvents();
    renderNormativas();
    loadComisiones();

    const profesoresCompletos = joinProfessorData();
    renderProfessorsGrid(profesoresCompletos);
    patchProfessorStats(profesoresCompletos);
    initStatBands();

    const searchInput = $id("profesor-search");
    const clearBtn = $id("clear-search");

    searchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase();
      clearBtn.classList.toggle("hidden", term.length === 0);

      const filtered = profesoresCompletos.filter((p) => {
        const nombre = (p.nombre_listado || "").toLowerCase();
        let area = (p.area_conocimiento || "").toLowerCase();
        const categoria = (p.categoria || "").toLowerCase();
        if (area.includes("comercialización") || area.includes("comercializacion")) {
          area += " marketing";
        }
        return nombre.includes(term) || area.includes(term) || categoria.includes(term);
      });
      renderProfessorsGrid(filtered);
    });

    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      searchInput.focus();
    });

    refreshIcons();
    switchSection(getSectionFromHash(), { skipHistory: true });
  }

  function showProfesoradoArea(areaTerm) {
    switchSection("profesorado");
    const input = $id("profesor-search");
    if (!input) return;
    input.value = areaTerm;
    input.dispatchEvent(new Event("input"));
  }

  // -----------------------------------------------------------------------
  // Navegación / interacciones estáticas
  // -----------------------------------------------------------------------
  function switchSection(sectionId, options) {
    options = options || {};

    document.querySelectorAll(".section-layer").forEach((el) => {
      el.classList.add("hidden");
      el.classList.remove("is-active");
    });

    const target = $id(sectionId);
    if (target) {
      target.classList.remove("hidden");
      target.classList.add("is-active");
      target.classList.remove("fade-in");
      void target.offsetWidth;
      target.classList.add("fade-in");
    }

    if (sectionId === "profesorado") {
      const searchInput = $id("profesor-search");
      if (searchInput) {
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input"));
      }
    }

    updateActiveMenu(sectionId);
    closeMobileMenu();
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (!options.skipHistory) {
      const newHash = "#" + sectionId;
      if (window.location.hash !== newHash) {
        history.pushState({ section: sectionId }, "", newHash);
      }
    }
  }

  function getSectionFromHash() {
    const hash = (window.location.hash || "").replace(/^#/, "");
    return MENU_ITEMS.some((item) => item.id === hash) ? hash : "inicio";
  }

  window.addEventListener("popstate", () => {
    switchSection(getSectionFromHash(), { skipHistory: true });
  });

  function updateActiveMenu(activeId) {
    document.querySelectorAll("#desktop-nav button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.target === activeId);
    });
    document.querySelectorAll("#mobile-nav-items button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.target === activeId);
    });
  }

  function renderMenu() {
    const desktopContainer = $id("desktop-nav");
    const mobileContainer = $id("mobile-nav-items");
    desktopContainer.innerHTML = "";
    mobileContainer.innerHTML = "";

    MENU_ITEMS.forEach((item) => {
      const btn = document.createElement("button");
      btn.textContent = item.label;
      btn.dataset.target = item.id;
      btn.onclick = () => switchSection(item.id);
      desktopContainer.appendChild(btn);

      const mBtn = document.createElement("button");
      mBtn.textContent = item.label;
      mBtn.dataset.target = item.id;
      mBtn.onclick = () => switchSection(item.id);
      mobileContainer.appendChild(mBtn);
    });

    updateActiveMenu("inicio");
  }

  function openMobileMenu() {
    const menu = $id("mobile-menu");
    menu.classList.remove("hidden");
    menu.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeMobileMenu() {
    const menu = $id("mobile-menu");
    menu.classList.add("hidden");
    menu.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function scrollContainer(containerId, direction) {
    const container = $id(containerId);
    if (!container) return;
    container.scrollBy({ left: direction * 350, behavior: "smooth" });
  }

  function openModal(modalId) {
    const modal = $id(modalId);
    if (!modal) return;
    modal.classList.remove("hidden");
    // setTimeout (en lugar de requestAnimationFrame) para que la transición
    // dispare de forma fiable incluso si la pestaña no está compositando
    // frames activamente (p. ej. en segundo plano).
    setTimeout(() => modal.classList.add("is-open"), 10);
  }
  function closeModalById(modalId) {
    const modal = $id(modalId);
    if (!modal) return;
    modal.classList.remove("is-open");
    setTimeout(() => modal.classList.add("hidden"), 250);
  }

  function wireStaticInteractions() {
    // Navegación por marca / botones data-nav estáticos.
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => switchSection(el.dataset.nav));
    });

    // Tarjetas de área en Inicio.
    document.querySelectorAll("[data-area]").forEach((el) => {
      el.addEventListener("click", () => showProfesoradoArea(el.dataset.area));
    });

    // Menú móvil.
    $id("menu-toggle-btn").addEventListener("click", openMobileMenu);
    $id("mobile-nav-close").addEventListener("click", closeMobileMenu);

    window.addEventListener("resize", () => {
      if (window.matchMedia("(min-width: 1120px)").matches) closeMobileMenu();
    });

    // Sliders horizontales.
    document.querySelectorAll("[data-slide]").forEach((btn) => {
      btn.addEventListener("click", () =>
        scrollContainer(btn.dataset.slide, Number(btn.dataset.dir)),
      );
    });

    // Acordeón (Administración; los de Grados se delegan aparte).
    document.querySelectorAll(".accordion-btn[data-accordion-target]").forEach((btn) => {
      btn.addEventListener("click", () => toggleAccordion(btn));
    });

    // Cierre de modales (click en overlay + botón X).
    document.querySelectorAll("[data-modal-close]").forEach((overlay) => {
      overlay.addEventListener("click", () => closeModalById(overlay.dataset.modalClose));
    });
    document.querySelectorAll("[data-modal-close-btn]").forEach((btn) => {
      btn.addEventListener("click", () => closeModalById(btn.dataset.modalCloseBtn));
    });

    // Cierre de modales con tecla Escape.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".modal.is-open").forEach((m) => closeModalById(m.id));
    });

    // Chat NotebookLM.
    const notebookLink = $id("notebooklm-link");
    if (notebookLink) {
      notebookLink.addEventListener("click", (e) => {
        e.preventDefault();
        window.open(
          "https://notebooklm.google.com/notebook/ebba05c2-879a-49db-a0a6-13c423cb08cc",
          "ChatNotebookLM",
          "width=500,height=700,resizable=yes,scrollbars=yes,status=no",
        );
      });
    }
  }

  function toggleAccordion(btn) {
    const targetId = btn.getAttribute("data-accordion-target");
    const panel = $id(targetId);
    if (!panel) return;
    const y = window.scrollY;
    panel.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", panel.classList.contains("hidden") ? "false" : "true");
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }

  // -----------------------------------------------------------------------
  // Bandas de estadísticas (contador animado al entrar en viewport)
  // -----------------------------------------------------------------------
  function patchProfessorStats(profesores) {
    const norm = (s) => String(s || "").toLowerCase();
    let org = 0;
    let mkt = 0;
    profesores.forEach((p) => {
      const area = norm(p.area_conocimiento);
      if (area.includes("organi")) org++;
      else if (area.includes("comercia") || area.includes("marketing")) mkt++;
    });
    const orgEl = document.querySelector('[data-stat="profesores-organizacion"]');
    const mktEl = document.querySelector('[data-stat="profesores-marketing"]');
    if (orgEl && org > 0) orgEl.setAttribute("data-target", String(org));
    if (mktEl && mkt > 0) mktEl.setAttribute("data-target", String(mkt));
  }

  function animateValue(el, start, end, duration) {
    let startTs = null;
    function step(ts) {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      el.textContent = Math.floor(progress * (end - start) + start);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = String(end);
    }
    requestAnimationFrame(step);
  }

  function initStatBands() {
    const bands = document.querySelectorAll(".countdown-band");
    if (!bands.length) return;
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const card = entry.target;
          card.classList.add("visible");
          const numberEl = card.querySelector(".stat-number");
          const target = Number(numberEl?.getAttribute("data-target"));
          if (numberEl && Number.isFinite(target)) animateValue(numberEl, 0, target, 1400);
          obs.unobserve(card);
        });
      },
      { threshold: 0.2 },
    );
    bands.forEach((band) => band.querySelectorAll(".stat-card").forEach((c) => observer.observe(c)));
  }

  // -----------------------------------------------------------------------
  // Profesorado
  // -----------------------------------------------------------------------
  function joinProfessorData() {
    if (!CSV_PROFESORES || CSV_PROFESORES.length === 0) return [];
    const ocultos = new Set(PROFESORES_EXTRA.ocultos || []);

    const fromCsv = CSV_PROFESORES.filter(
      (base) => !ocultos.has(base.url_abs) && CSV_PROFESORES_PERFIL.some((p) => p.url_abs === base.url_abs),
    ).map((base) => {
      const perfil = CSV_PROFESORES_PERFIL.find((p) => p.url_abs === base.url_abs) || {};
      const prismaUrl = (perfil.perfil_prisma_url || "").trim();
      const inv = prismaUrl
        ? CSV_INVESTIGADORES.find((i) => i.url === prismaUrl) ||
          CSV_INVESTIGADORES.find(
            (i) => i.url && prismaUrl && (i.url.includes(prismaUrl) || prismaUrl.includes(i.url)),
          ) ||
          {}
        : {};
      return {
        ...base,
        ...perfil,
        area_conocimiento:
          perfil.area_conocimiento && perfil.area_conocimiento !== "No disponible"
            ? perfil.area_conocimiento
            : inv.area_conocimiento && inv.area_conocimiento !== "No disponible"
              ? inv.area_conocimiento
              : "",
        categoria:
          perfil.categoria && perfil.categoria !== "No disponible"
            ? perfil.categoria
            : inv.categoria && inv.categoria !== "No disponible"
              ? inv.categoria
              : "",
        grupo: inv.grupo && inv.grupo !== "No disponible" ? inv.grupo : "",
        url_grupo: inv.url_grupo && inv.url_grupo !== "No disponible" ? inv.url_grupo : "",
      };
    });

    const manuales = (PROFESORES_EXTRA.manuales || [])
      .filter((m) => m.url_abs && !ocultos.has(m.url_abs))
      .map((m) => ({
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

  function getAreaClass(areaName) {
    const area = (areaName || "").toLowerCase();
    if (area.includes("organi")) return "area-org";
    if (area.includes("comercia") || area.includes("marketing")) return "area-mkt";
    return "";
  }

  function toTitleCase(str) {
    if (!str) return "";
    const titled = str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    return restoreAccents(titled);
  }

  function restoreAccents(str) {
    const ACCENTS = {
      Jose: "José", Gonzalez: "González", Rodriguez: "Rodríguez",
      Gaitan: "Gaitán", Sanchez: "Sánchez", Maria: "María",
      Benitez: "Benítez", Cristobal: "Cristóbal", Carrion: "Carrión",
      Cortes: "Cortés", Perez: "Pérez", Garcia: "García",
      Rosalia: "Rosalía", Diaz: "Díaz", Fernandez: "Fernández",
      Dominguez: "Domínguez", Espasandin: "Espasandín", Florez: "Flórez",
      Galan: "Galán", Angeles: "Ángeles", Candon: "Candón",
      Gomez: "Gómez", Chacon: "Chacón", Hernandez: "Hernández",
      Rendon: "Rendón", Concepcion: "Concepción", Rocio: "Rocío",
      Millan: "Millán", Lopez: "López", Belen: "Belén",
      Marquez: "Márquez", Martin: "Martín", Nicolas: "Nicolás",
      Martinez: "Martínez", Menendez: "Menéndez", Gutierrez: "Gutiérrez",
      Picon: "Picón", Encarnacion: "Encarnación", Roman: "Román",
      Rondan: "Rondán", Roldan: "Roldán", Rio: "Río",
      Jesus: "Jesús", Mejias: "Mejías", Suarez: "Suárez",
      Joaquin: "Joaquín", Vazquez: "Vázquez", Rios: "Ríos",
      Angel: "Ángel", Perinan: "Periñán",
    };
    const pattern = new RegExp("\\b(" + Object.keys(ACCENTS).join("|") + ")\\b", "g");
    return str.replace(pattern, (match) => ACCENTS[match] || match);
  }

  function trimProfesor(cat) {
    if (!cat) return cat;
    return cat.replace(/^Profesora?\s+/i, "").trim();
  }

  function renderProfessorsGrid(data) {
    const container = $id("profesores-grid");
    container.innerHTML = "";

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="search-x"></i>
          <p>No se encontraron profesores.</p>
        </div>`;
      refreshIcons();
      return;
    }

    data.forEach((prof) => {
      const card = document.createElement("div");
      card.className = "card card-link people-card";
      card.onclick = () => openProfessorModal(prof);

      let areaClean = "Docente";
      if (prof.area_conocimiento) {
        areaClean = prof.area_conocimiento
          .replace("Comercialización e Investigación de Mercados", "Marketing")
          .replace("Organización de Empresas", "Organización");
      }
      const areaTag = prof.area_conocimiento ? `<span class="tag">${esc(areaClean)}</span>` : "<span></span>";
      const areaClass = getAreaClass(prof.area_conocimiento);

      card.innerHTML = `
        <div class="people-card-top">
          <span class="people-avatar ${areaClass}"><i data-lucide="user"></i></span>
          <div>
            <h4>${toTitleCase(prof.nombre_listado)}</h4>
            <p class="role">${esc(trimProfesor(prof.categoria) || "PDI")}</p>
          </div>
        </div>
        <div class="people-card-foot">
          ${areaTag}
          <i data-lucide="plus-circle" style="width:18px;height:18px;color:var(--color-faint)"></i>
        </div>`;
      container.appendChild(card);
    });
    refreshIcons();
  }

  // -----------------------------------------------------------------------
  // Identificadores académicos
  // -----------------------------------------------------------------------
  function getFirstField(obj, candidates) {
    if (!obj) return "";
    const keys = Object.keys(obj);
    const map = {};
    for (const k of keys) map[k.toLowerCase().trim()] = k;
    for (const c of candidates) {
      const kk = map[String(c).toLowerCase().trim()];
      if (kk && obj[kk] != null && String(obj[kk]).trim() !== "") return String(obj[kk]).trim();
    }
    return "";
  }

  function getFirstFieldByContains(obj, patterns) {
    if (!obj) return "";
    const keys = Object.keys(obj);
    const lowerKeys = keys.map((k) => ({ k, lk: String(k).toLowerCase() }));
    for (const p of patterns || []) {
      const lp = String(p).toLowerCase();
      const hit = lowerKeys.find((x) => x.lk.includes(lp));
      if (hit) {
        const val = obj[hit.k];
        if (val != null && String(val).trim() !== "") return String(val).trim();
      }
    }
    return "";
  }

  function normalizeProfileUrl(u) {
    const s = String(u || "").trim();
    if (!s) return "";
    return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "").trim().toLowerCase();
  }

  function extractPdiIdFromUrl(url) {
    const m = String(url || "").match(/pdi=(\d+)/i);
    return m && m[1] ? m[1] : "";
  }

  function normalizeEmail(e) {
    return String(e || "").trim().toLowerCase();
  }

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

  function looseNameMatch(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ta = na.split(" ").filter(Boolean);
    const tb = nb.split(" ").filter(Boolean);
    if (!ta.length || !tb.length) return false;
    const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const setLong = new Set(longer);
    return shorter.every((t) => setLong.has(t));
  }

  function findInvestigadorForProfesor(prof) {
    if (!prof) return null;

    const profEmail = normalizeEmail(
      getFirstField(prof, ["email", "correo", "mail", "e-mail", "correo_us", "email_us", "emailcontacto", "correo_contacto"]),
    );
    if (profEmail) {
      const byEmail = toArray(CSV_INVESTIGADORES).find((r) => {
        const invEmail = normalizeEmail(
          getFirstField(r, ["email", "correo", "mail", "e-mail", "correo_us", "email_us", "emailcontacto", "correo_contacto"]),
        );
        return invEmail && invEmail === profEmail;
      });
      if (byEmail) return byEmail;
    }

    const profUrlRaw = getFirstField(prof, ["url_abs", "url", "enlace", "perfil", "ficha"]);
    const profUrl = normalizeProfileUrl(profUrlRaw);
    if (profUrl) {
      const byUrl = toArray(CSV_INVESTIGADORES).find((r) => {
        const invUrlRaw = getFirstField(r, ["url_abs", "url", "enlace", "perfil", "ficha"]);
        return normalizeProfileUrl(invUrlRaw) === profUrl;
      });
      if (byUrl) return byUrl;
    }

    const profPdi = extractPdiIdFromUrl(profUrlRaw);
    if (profPdi) {
      const byPdi = toArray(CSV_INVESTIGADORES).find((r) => {
        const invUrlRaw = getFirstField(r, ["url_abs", "url", "enlace", "perfil", "ficha"]);
        return extractPdiIdFromUrl(invUrlRaw) === profPdi;
      });
      if (byPdi) return byPdi;
    }

    const profNameRaw = getFirstField(prof, ["nombre", "nombre_listado", "nombre_completo"]);
    if (profNameRaw) {
      const byName = toArray(CSV_INVESTIGADORES).find((r) => {
        const invNameRaw = getFirstField(r, ["nombre", "nombre_listado", "nombre_completo"]);
        return looseNameMatch(invNameRaw, profNameRaw);
      });
      if (byName) return byName;
    }
    return null;
  }

  function normalizeIdUrl(kind, value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    switch (kind) {
      case "orcid": return `https://orcid.org/${encodeURIComponent(v)}`;
      case "scopus": return `https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(v)}`;
      case "researchid": return `https://www.webofscience.com/wos/author/record/${encodeURIComponent(v)}`;
      case "scholar": return `https://scholar.google.com/citations?user=${encodeURIComponent(v)}`;
      default: return "";
    }
  }

  function normalizeDirectUrl(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    return `https://${v}`;
  }

  function isValidIdentifierValue(value) {
    if (value === null || value === undefined) return false;
    const s = String(value).trim();
    if (!s) return false;
    const low = s.toLowerCase();
    if (low === "-" || low === "n/a" || low === "na") return false;
    if (low.includes("no disponible") || low.includes("no-disponible") || low.includes("no aplica")) return false;
    return true;
  }

  function buildIdentificadoresHtml(prof) {
    const inv = findInvestigadorForProfesor(prof);
    if (!inv) return "";

    const orcid = getFirstField(inv, ["orcid", "orcid_id", "id_orcid", "orcid iD", "orcid-id"]) || getFirstFieldByContains(inv, ["orcid"]);
    const scopus = getFirstField(inv, ["scopus", "scopus_id", "scopusid", "id_scopus", "authorid", "author_id", "scopus_author_id", "scopus author id"]) || getFirstFieldByContains(inv, ["scopus", "authorid"]);
    const researchid = getFirstField(inv, ["researchid", "research_id", "researcherid", "researcher_id", "researcher id", "rid", "wos", "wos_id"]) || getFirstFieldByContains(inv, ["research", "researcherid", "rid"]);
    const scholar = getFirstField(inv, ["googlescholar", "google_scholar", "google scholar", "scholar", "scholar_id", "google_scholar_id", "google_scholar_user", "scholar_user"]) || getFirstFieldByContains(inv, ["scholar", "google"]);
    const idus_url = getFirstField(inv, ["idus_url", "idUS_url", "id_us_url", "idus link", "enlace_idus", "url_idus", "link_idus"]) || getFirstFieldByContains(inv, ["idus_url", "idus url", "url idus"]);

    const items = [];
    if (isValidIdentifierValue(orcid)) items.push({ label: "ORCID", url: normalizeIdUrl("orcid", orcid), iconHtml: '<i class="ai ai-orcid" aria-hidden="true"></i>' });
    if (isValidIdentifierValue(scopus)) items.push({ label: "Scopus", url: normalizeIdUrl("scopus", scopus), iconHtml: '<i class="ai ai-scopus" aria-hidden="true"></i>' });
    if (isValidIdentifierValue(researchid)) items.push({ label: "ResearchID", url: normalizeIdUrl("researchid", researchid), iconHtml: '<i class="ai ai-researcherid" aria-hidden="true"></i>' });
    if (isValidIdentifierValue(scholar)) items.push({ label: "Google Scholar", url: normalizeIdUrl("scholar", scholar), iconHtml: '<i class="ai ai-google-scholar" aria-hidden="true"></i>' });
    if (isValidIdentifierValue(idus_url)) items.push({ label: "idUS", url: normalizeDirectUrl(idus_url), iconHtml: '<i class="ai ai-open-access" aria-hidden="true"></i>' });

    if (!items.length) return "";

    const pills = items
      .map((it) => `<a href="${it.url}" target="_blank" rel="noopener noreferrer" class="id-pill" title="${it.label}">${it.iconHtml}<span>${it.label}</span></a>`)
      .join("");

    return `<div style="margin-top: var(--space-6)"><h3 class="modal-label">Identificadores</h3><div style="display:flex;flex-wrap:wrap;gap:.5rem">${pills}</div></div>`;
  }

  // -----------------------------------------------------------------------
  // Modal profesor
  // -----------------------------------------------------------------------
  function openProfessorModal(prof) {
    const content = $id("modal-body-content");

    const centros = CSV_PROFESORES_CENTROS.filter((c) => c.url_abs === prof.url_abs);
    const asignaturas = CSV_PROFESORES_ASIGNATURAS.filter((a) => a.url_abs === prof.url_abs);

    let centrosHtml = '<p class="text-faint" style="font-size:.9rem">Información no disponible</p>';
    if (centros.length > 0) {
      centrosHtml = `<ul style="font-size:.9rem;color:var(--color-ink-soft);display:flex;flex-direction:column;gap:.5rem">${centros
        .map((c) => `<li style="display:flex;gap:.5rem;align-items:flex-start"><span style="width:6px;height:6px;border-radius:50%;background:var(--color-red);margin-top:.5rem;flex-shrink:0"></span>${toTitleCase(c.centro)}</li>`)
        .join("")}</ul>`;
    }

    let asignaturasHtml = '<p class="text-faint" style="font-size:.9rem">No hay asignaturas registradas.</p>';
    if (asignaturas.length > 0) {
      asignaturasHtml = `<div style="display:flex;flex-wrap:wrap;gap:.5rem">${asignaturas
        .map((a) => {
          const label = esc(a.asignatura);
          const url = (a.asignatura_url || "").trim();
          return url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="subj-pill">${label}<i data-lucide="external-link"></i></a>`
            : `<span class="subj-pill">${label}</span>`;
        })
        .join("")}</div>`;
    }

    const displayName = toTitleCase(prof.nombre || prof.nombre_listado);
    const areaClass = getAreaClass(prof.area_conocimiento);

    content.innerHTML = `
      <div style="display:flex;gap:var(--space-5);align-items:center;margin-bottom:var(--space-6)">
        <span class="people-avatar ${areaClass}" style="width:64px;height:64px"><i data-lucide="user" style="width:26px;height:26px"></i></span>
        <div>
          <h2 class="display" style="font-size:var(--step2)">${esc(displayName)}</h2>
          <p style="color:var(--color-red);font-weight:600;margin-top:2px">${esc(trimProfesor(prof.categoria) || "Docente")}</p>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="stack" style="gap:var(--space-5)">
          <div>
            <h3 class="modal-label">Contacto</h3>
            <div class="stack" style="gap:.5rem">
              ${prof.email ? `<a href="mailto:${esc(prof.email)}" class="contact-chip"><i data-lucide="mail"></i><span>${esc(prof.email)}</span></a>` : '<p class="text-faint" style="font-size:.85rem">Email no disponible</p>'}
              ${prof.telefono ? `<div class="contact-chip"><i data-lucide="phone"></i><span>${esc(prof.telefono)}</span></div>` : '<p class="text-faint" style="font-size:.85rem">Teléfono no disponible</p>'}
            </div>
          </div>
          ${
            prof.perfil_prisma_url && prof.perfil_prisma_url !== "#"
              ? `<a href="${esc(prof.perfil_prisma_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="width:100%;justify-content:space-between">Ver perfil investigador (PRISMA) <i data-lucide="external-link"></i></a>`
              : ""
          }
        </div>
        <div class="stack" style="gap:var(--space-5)">
          <div>
            <h3 class="modal-label">Centros</h3>
            ${centrosHtml}
          </div>
          ${
            prof.grupo && prof.grupo !== "No disponible"
              ? `<div><h3 class="modal-label">Grupo de investigación</h3>${
                  prof.url_grupo && prof.url_grupo !== "No disponible"
                    ? `<a href="${esc(prof.url_grupo)}" target="_blank" rel="noopener noreferrer" class="contact-chip"><i data-lucide="flask-conical"></i><span>${esc(prof.grupo)}</span></a>`
                    : `<p style="font-size:.9rem">${esc(prof.grupo)}</p>`
                }</div>`
              : ""
          }
        </div>
      </div>

      <div style="margin-top:var(--space-7);padding-top:var(--space-6);border-top:1px solid var(--color-border)">
        <h3 class="modal-label">Asignaturas impartidas</h3>
        ${asignaturasHtml}
      </div>
      ${buildIdentificadoresHtml(prof)}
    `;

    openModal("profesor-modal");
    refreshIcons();
  }

  // -----------------------------------------------------------------------
  // Grados
  // -----------------------------------------------------------------------
  function sanitizeRichHtml(input) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = String(input ?? "");
    wrapper.querySelectorAll("script, style, iframe, object, embed").forEach((n) => n.remove());
    wrapper.querySelectorAll("*").forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || "").trim();
        if (name.startsWith("on")) { el.removeAttribute(attr.name); return; }
        if ((name === "href" || name === "src") && /^javascript:/i.test(value)) el.removeAttribute(attr.name);
      });
    });
    return wrapper.innerHTML;
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr)).filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
  }

  function smartTitleEs(input) {
    const s = String(input || "").trim();
    if (!s) return "";
    const stop = new Set(["y", "e", "o", "u", "en", "de", "del", "la", "las", "el", "los", "a", "al", "por", "para", "con", "sin", "sobre", "entre"]);
    return s
      .split(/\s+/)
      .map((tok, i) => {
        if (!tok) return tok;
        const lettersOnly = tok.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
        const isAllCaps = lettersOnly && lettersOnly === lettersOnly.toUpperCase() && lettersOnly !== lettersOnly.toLowerCase();
        const hasDot = tok.includes(".");
        const hasDash = tok.includes("-");
        if (isAllCaps || hasDot || (hasDash && tok.toUpperCase() === tok)) return tok.toUpperCase();
        const low = tok.toLowerCase();
        if (stop.has(low) && i !== 0) return low;
        return low.charAt(0).toUpperCase() + low.slice(1);
      })
      .join(" ")
      .replace(/\bIi\b/g, "II")
      .replace(/\bIii\b/g, "III");
  }

  function formatCentros(centrosRaw) {
    const raw = String(centrosRaw || "").trim();
    if (!raw) return "";
    return raw.split(";").map((p) => p.trim()).filter(Boolean).map((p) => smartTitleEs(p)).join("; ");
  }

  function normalizeGradoItem(item) {
    const nombre = String(item.grado ?? item.nombre ?? "").trim() || "Grado (sin nombre)";
    const rama = String(item["Rama de conocimiento"] ?? item.rama ?? "").trim() || "Sin rama";
    const tipoEns = String(item["Tipo de enseñanza"] ?? item.modalidad ?? "").trim() || "Sin modalidad";
    const centrosRaw = String(item["Centro(s) responsable(s) del título"] ?? item.centro ?? "").trim() || "Centro no especificado";
    const centros = formatCentros(centrosRaw) || "Centro no especificado";
    const duracion = String(item["Duración del programa"] ?? item.duracion ?? "").trim() || "Duración no especificada";
    const url = String(item.url ?? "").trim();
    const isDoble = /^Doble\s+Grado/i.test(nombre) || /\(Doble/i.test(nombre);
    const ectsMatch = duracion.match(/(\d+(\.\d+)?)\s*ECTS/i);
    const ects = ectsMatch ? Number(ectsMatch[1]) : null;
    const yearMatch = nombre.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : null;
    return { nombre, rama, tipoEns, centros, duracion, url, isDoble, ects, year, raw: item };
  }

  function buildBadge(text, tone) {
    const cls = tone === "red" ? "tag tag-red" : "tag";
    return `<span class="${cls}">${esc(text)}</span>`;
  }

  function openGradoModal(grado) {
    const body = $id("grado-modal-body");
    if (!body) return;
    body.innerHTML = `
      <div style="margin-bottom:var(--space-6)">
        <span class="tag tag-red" style="margin-bottom:var(--space-3)">Detalle del grado</span>
        <h2 class="display" style="font-size:var(--step3);margin-top:var(--space-3)">${esc(grado.nombre)}</h2>
      </div>
      <div class="grid grid-2">
        <div class="card" style="padding:var(--space-5);background:var(--color-surface-alt)">
          <p class="modal-label" style="margin-bottom:.35rem">Rama</p>
          <p style="font-weight:600;color:var(--color-ink)">${esc(grado.rama)}</p>
        </div>
        <div class="card" style="padding:var(--space-5);background:var(--color-surface-alt)">
          <p class="modal-label" style="margin-bottom:.35rem">Modalidad</p>
          <p style="font-weight:600;color:var(--color-ink)">${esc(grado.tipoEns)}</p>
        </div>
        <div class="card" style="padding:var(--space-5);background:var(--color-surface-alt);grid-column:1/-1">
          <p class="modal-label" style="margin-bottom:.35rem">Centro(s) responsable(s)</p>
          <p style="font-weight:600;color:var(--color-ink)">${esc(grado.centros)}</p>
        </div>
        <div class="card" style="padding:var(--space-5);background:var(--color-surface-alt);grid-column:1/-1">
          <p class="modal-label" style="margin-bottom:.35rem">Duración</p>
          <p style="font-weight:600;color:var(--color-ink)">${esc(grado.duracion)}</p>
        </div>
      </div>
      ${
        grado.url
          ? `<div style="margin-top:var(--space-6);padding-top:var(--space-6);border-top:1px solid var(--color-border)">
              <a href="${esc(grado.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Ver ficha oficial <i data-lucide="external-link"></i></a>
            </div>`
          : ""
      }`;
    openModal("grado-modal");
    refreshIcons();
  }

  function renderGradosUI(gradosRaw) {
    const wrapper = $id("grados-wrapper");
    const container = $id("grados-container");
    if (!wrapper || !container) return;

    const grados = (Array.isArray(gradosRaw) ? gradosRaw : []).map(normalizeGradoItem);
    wrapper.classList.remove("hidden");

    if (grados.length === 0) {
      container.innerHTML = `
        <div class="card" style="padding:var(--space-6)">
          <h4 style="font-weight:700;color:var(--color-ink);margin-bottom:var(--space-2)">Grados universitarios</h4>
          <p class="text-muted">No se han podido cargar los grados. Revisa que exista <span style="font-family:var(--font-mono)">json/grados.json</span>.</p>
        </div>`;
      return;
    }

    const ramas = uniqueSorted(grados.map((g) => g.rama));
    const centrosUnique = uniqueSorted(grados.map((g) => g.centros));
    const modalidades = uniqueSorted(grados.map((g) => g.tipoEns));

    container.innerHTML = `
      <div class="card filter-panel">
        <div class="filter-row">
          <div class="field" style="max-width:none;flex:1">
            <label class="field-label">Buscar</label>
            <div style="position:relative">
              <span class="field-icon"><i data-lucide="search"></i></span>
              <input id="grados-q" type="text" placeholder="Busca por titulación o centro…" />
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:.5rem">
            <button id="grados-reset" class="btn btn-outline btn-sm">Limpiar</button>
            <label class="checkbox-field">
              <input id="grados-group" type="checkbox" checked /> Agrupar por rama
            </label>
          </div>
        </div>
        <div class="filter-grid">
          <div>
            <label class="field-label">Rama</label>
            <select id="grados-rama"><option value="">Todas</option>${ramas.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}</select>
          </div>
          <div>
            <label class="field-label">Centro</label>
            <select id="grados-centro"><option value="">Todos</option>${centrosUnique.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
          </div>
          <div>
            <label class="field-label">Modalidad</label>
            <select id="grados-mod"><option value="">Todas</option>${modalidades.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</select>
          </div>
        </div>
      </div>
      <div id="grados-results"></div>
    `;

    const els = {
      q: $id("grados-q"), rama: $id("grados-rama"), centro: $id("grados-centro"),
      mod: $id("grados-mod"), group: $id("grados-group"), reset: $id("grados-reset"),
      results: $id("grados-results"),
    };

    function parseBooleanQuery(raw) {
      const s = (raw || "").trim();
      if (!s) return { groups: [], hasOps: false, raw: "" };
      const tokens = s.split(/\s+/).filter(Boolean);
      const hasOps = tokens.some((t) => /^(and|or)$/i.test(t));
      if (!hasOps) return { groups: tokens.map((t) => [t]), hasOps: false, raw: s };
      const groups = [];
      let current = [];
      for (const tok of tokens) {
        if (/^or$/i.test(tok)) { if (current.length) groups.push(current); current = []; continue; }
        if (/^and$/i.test(tok)) continue;
        current.push(tok);
      }
      if (current.length) groups.push(current);
      if (!groups.length) {
        const terms = tokens.filter((t) => !/^(and|or)$/i.test(t));
        return { groups: terms.map((t) => [t]), hasOps: false, raw: s };
      }
      return { groups, hasOps: true, raw: s };
    }

    function boolMatch(textLower, parsed) {
      if (!parsed?.groups?.length) return true;
      return parsed.groups.some((group) => group.every((term) => textLower.includes(term.toLowerCase())));
    }

    function boolBestPos(textLower, parsed) {
      if (!parsed?.groups?.length) return Number.POSITIVE_INFINITY;
      let best = Number.POSITIVE_INFINITY;
      for (const group of parsed.groups) {
        const positions = group.map((t) => textLower.indexOf(t.toLowerCase()));
        if (positions.some((p) => p < 0)) continue;
        const score = Math.max(...positions);
        if (score < best) best = score;
      }
      return best;
    }

    function renderDegreeRow(g, idx) {
      const badges = [
        g.isDoble ? buildBadge("Doble grado", "red") : buildBadge("Grado"),
        g.tipoEns ? buildBadge(g.tipoEns) : "",
        g.ects ? buildBadge(`${g.ects} ECTS`) : "",
        g.year ? buildBadge(`Plan ${g.year}`) : "",
      ].filter(Boolean).join(" ");

      return `
        <div class="card degree-row">
          <div class="degree-row-top">
            <div style="min-width:0">
              <h4>${esc(g.nombre)}</h4>
              <p class="meta"><strong style="color:var(--color-ink)">Centro:</strong> ${esc(g.centros)} &nbsp;·&nbsp; <strong style="color:var(--color-ink)">Duración:</strong> ${esc(g.duracion)}</p>
              <div class="badges">${badges}</div>
            </div>
            <div class="degree-actions">
              <button class="btn btn-outline btn-sm grado-open" data-idx="${idx}">Detalles</button>
              ${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Ver ficha <i data-lucide="arrow-up-right"></i></a>` : ""}
            </div>
          </div>
        </div>`;
    }

    function renderGroup(title, items, baseIndexMap) {
      const safeId = "rama-" + title.toLowerCase().replace(/[^a-z0-9]+/gi, "-");
      return `
        <div class="group-panel">
          <button class="group-panel-btn" data-acc="${esc(safeId)}" aria-expanded="false">
            <div>
              <p class="role-label" style="color:var(--color-faint)">Rama</p>
              <h4>${esc(title)}</h4>
              <p class="text-muted" style="font-size:.85rem;margin-top:2px">${items.length} programa(s)</p>
            </div>
            <span class="chev"><i data-lucide="chevron-down"></i></span>
          </button>
          <div id="${esc(safeId)}" class="hidden group-panel-body">
            ${items.map((g) => renderDegreeRow(g, baseIndexMap.get(g))).join("")}
          </div>
        </div>`;
    }

    function applyFilters() {
      const rawQ = (els.q.value || "").trim();
      const parsed = parseBooleanQuery(rawQ);
      const rama = els.rama.value;
      const centro = els.centro.value;
      const mod = els.mod.value;

      let filtered = grados.filter((g) => {
        const nameL = g.nombre.toLowerCase();
        const centroL = g.centros.toLowerCase();
        const okQ = !rawQ || boolMatch(nameL, parsed) || boolMatch(centroL, parsed);
        const okRama = !rama || g.rama === rama;
        const okCentro = !centro || g.centros === centro;
        const okMod = !mod || g.tipoEns === mod;
        return okQ && okRama && okCentro && okMod;
      });

      if (rawQ) {
        filtered.sort((a, b) => {
          const aName = a.nombre.toLowerCase(), bName = b.nombre.toLowerCase();
          const aCentro = a.centros.toLowerCase(), bCentro = b.centros.toLowerCase();
          const aInName = boolMatch(aName, parsed), bInName = boolMatch(bName, parsed);
          if (aInName !== bInName) return aInName ? -1 : 1;
          const aNamePos = boolBestPos(aName, parsed), bNamePos = boolBestPos(bName, parsed);
          if (aInName && bInName && aNamePos !== bNamePos) return aNamePos - bNamePos;
          const aCentroPos = boolBestPos(aCentro, parsed), bCentroPos = boolBestPos(bCentro, parsed);
          if (aCentroPos !== bCentroPos) return aCentroPos - bCentroPos;
          const c = aCentro.localeCompare(bCentro, "es");
          if (c !== 0) return c;
          return aName.localeCompare(bName, "es");
        });
      } else {
        filtered.sort((a, b) => Number(b.isDoble) - Number(a.isDoble) || a.nombre.localeCompare(b.nombre, "es"));
      }

      renderResults(filtered);
      refreshIcons();
    }

    function renderResults(items) {
      if (!items.length) {
        els.results.innerHTML = `<div class="card" style="padding:var(--space-6);text-align:center"><p class="text-muted">No hay resultados con los filtros actuales.</p></div>`;
        return;
      }
      const baseIndexMap = new Map();
      grados.forEach((g, i) => baseIndexMap.set(g, i));

      if (!els.group.checked) {
        els.results.innerHTML = items.map((g) => renderDegreeRow(g, baseIndexMap.get(g))).join("");
      } else {
        const map = new Map();
        items.forEach((g) => { if (!map.has(g.rama)) map.set(g.rama, []); map.get(g.rama).push(g); });
        els.results.innerHTML = Array.from(map.keys())
          .sort((a, b) => a.localeCompare(b, "es"))
          .map((r) => renderGroup(r, map.get(r), baseIndexMap))
          .join("");

        els.results.querySelectorAll("[data-acc]").forEach((btn) => btn.addEventListener("click", () => toggleAccordionAcc(btn)));
      }

      els.results.querySelectorAll(".grado-open").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-idx"));
          const g = grados[idx];
          if (g) openGradoModal(g);
        });
      });
    }

    function toggleAccordionAcc(btn) {
      const y = window.scrollY;
      const target = $id(btn.getAttribute("data-acc"));
      if (target) target.classList.toggle("hidden");
      btn.setAttribute("aria-expanded", target && !target.classList.contains("hidden") ? "true" : "false");
      requestAnimationFrame(() => window.scrollTo({ top: y }));
    }

    ["input", "change"].forEach((evt) => {
      els.q.addEventListener(evt, applyFilters);
      els.rama.addEventListener(evt, applyFilters);
      els.centro.addEventListener(evt, applyFilters);
      els.mod.addEventListener(evt, applyFilters);
      els.group.addEventListener(evt, applyFilters);
    });

    els.reset.addEventListener("click", () => {
      els.q.value = ""; els.rama.value = ""; els.centro.value = ""; els.mod.value = ""; els.group.checked = true;
      applyFilters();
    });

    applyFilters();
    refreshIcons();
  }

  // -----------------------------------------------------------------------
  // Oferta: másteres y doctorados
  // -----------------------------------------------------------------------
  function renderOfertaMasteresDoctorados() {
    renderGradosUI(GRADOS_DATA);

    const containerMaster = $id("masteres-container");
    if (containerMaster) {
      if (MASTERES_DATA && MASTERES_DATA.length > 0) {
        containerMaster.innerHTML = MASTERES_DATA.map(
          (m) => `
            <a href="${normalizeDirectUrl(m.url)}" target="_blank" rel="noopener noreferrer" class="card card-link" style="padding:var(--space-5);display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)">
              <span style="font-weight:600;color:var(--color-ink)">${esc(m.master || m.nombre)}</span>
              <i data-lucide="arrow-up-right" style="width:16px;height:16px;color:var(--color-faint);flex-shrink:0"></i>
            </a>`,
        ).join("");
      } else {
        containerMaster.innerHTML = `<p class="text-faint">No hay másteres para mostrar.</p>`;
      }
    }

    const containerDoc = $id("doctorados-list");
    if (containerDoc) {
      containerDoc.innerHTML = (DOCTORADOS_DATA || [])
        .map((d) => `<a href="${normalizeDirectUrl(d.url)}" target="_blank" rel="noopener noreferrer"><i data-lucide="chevron-right"></i> ${esc(d.doctorado || d.nombre)}</a>`)
        .join("");
    }

    const containerDocInv = $id("doctorados-investigacion-list");
    if (containerDocInv) {
      containerDocInv.innerHTML = (DOCTORADOS_DATA || []).length
        ? DOCTORADOS_DATA.map((d) => `<a href="${normalizeDirectUrl(d.url)}" target="_blank" rel="noopener noreferrer"><i data-lucide="chevron-right"></i> ${esc(d.doctorado || d.nombre)}</a>`).join("")
        : '<p class="text-faint">No hay datos disponibles.</p>';
    }
    refreshIcons();
  }

  // -----------------------------------------------------------------------
  // Grupos de investigación
  // -----------------------------------------------------------------------
  function renderInvestigacionGrupos() {
    const slider = $id("grupos-slider");
    if (!slider || !CSV_INVESTIGADORES || CSV_INVESTIGADORES.length === 0) return;

    const gruposUnicos = {};
    CSV_INVESTIGADORES.forEach((inv) => {
      if (inv.grupo && inv.grupo.includes("SEJ-") && !gruposUnicos[inv.grupo]) {
        let nombreRaw = inv.grupo.replace(/UNIVERSIDAD DE SEVILLA/gi, "").trim();
        if (nombreRaw.endsWith("-")) nombreRaw = nombreRaw.slice(0, -1);
        const codeMatch = nombreRaw.match(/(SEJ-\d+)/i);
        const code = codeMatch ? codeMatch[0].toUpperCase() : "";
        let titulo = nombreRaw.replace(code, "").replace(/\(\)/g, "").replace(/\( \)/g, "").replace(/^-/, "").trim().toUpperCase();
        titulo = titulo.replace(/^-+|-+$/g, "").trim();
        gruposUnicos[inv.grupo] = { code, titulo, url: inv.url_grupo || "#" };
      }
    });

    const gruposArray = Object.values(gruposUnicos);
    if (gruposArray.length === 0) {
      slider.innerHTML = `<p class="text-faint">No hay grupos de investigación registrados con código SEJ.</p>`;
      return;
    }

    slider.innerHTML = gruposArray
      .map(
        (g) => `
        <div class="hslider-item">
          <a href="${normalizeDirectUrl(g.url)}" target="_blank" rel="noopener noreferrer" class="group-chip">
            <span class="code">${esc(g.code)}</span>
            <h4>${esc(g.titulo)}</h4>
          </a>
        </div>`,
      )
      .join("");
  }

  // -----------------------------------------------------------------------
  // Noticias
  // -----------------------------------------------------------------------
  function truncateText(text, wordLimit = 20) {
    if (!text) return "";
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = text;
    const plainText = tempDiv.textContent || tempDiv.innerText || "";
    const words = plainText.split(/\s+/);
    return words.length > wordLimit ? words.slice(0, wordLimit).join(" ") + "…" : plainText;
  }

  function normalizeNewsTipo(tipoRaw) {
    const t = String(tipoRaw || "").toLowerCase().trim();
    if (!t) return "other";
    if (t === "evento" || t.includes("evento")) return "evento";
    if (t === "noticia" || t.includes("noticia")) return "noticia";
    if (t.includes("investig")) return "investig";
    if (t.includes("estudiant")) return "estudiantes";
    return "other";
  }

  function parseNewsDate(fechaRaw) {
    const s = String(fechaRaw || "").trim();
    if (!s) return new Date(0);
    const iso = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (iso) {
      const dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return isNaN(dt.getTime()) ? new Date(0) : dt;
    }
    const dmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (dmy) {
      const dt = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
      return isNaN(dt.getTime()) ? new Date(0) : dt;
    }
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? new Date(0) : dt;
  }

  function formatNewsFecha(fechaRaw) {
    const dt = parseNewsDate(fechaRaw);
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return String(fechaRaw ?? "").trim();
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(dt).replaceAll("/", "-");
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
    const idx = { evento: [], noticia: [], investig: [], estudiantes: [], other: [] };
    if (!Array.isArray(NEWS_DATA)) return idx;
    NEWS_DATA.forEach((item) => {
      const key = normalizeNewsTipo(item.tipo);
      (idx[key] || idx.other).push(item);
    });
    Object.keys(idx).forEach((k) => idx[k].sort((a, b) => parseNewsDate(b.fecha) - parseNewsDate(a.fecha)));
    Object.keys(idx).forEach((k) => (idx[k] = dedupeNewsByKey(idx[k])));
    return idx;
  }

  function openNewsModal(newsId) {
    const newsItem = NEWS_DATA.find((n) => n._id === newsId);
    if (!newsItem) return;
    const contentBody = $id("news-modal-body");
    contentBody.innerHTML = `
      <div style="margin-bottom:var(--space-6)">
        <span class="tag tag-red" style="margin-bottom:var(--space-3)">${formatNewsFecha(newsItem.fecha)}</span>
        <h2 class="display" style="font-size:var(--step3);margin-top:var(--space-3)">${esc(newsItem.titulo)}</h2>
        ${newsItem.autor ? `<p class="text-faint" style="font-size:.85rem;margin-top:var(--space-2)">Por: ${esc(newsItem.autor)}</p>` : ""}
      </div>
      <div class="prose">${sanitizeRichHtml(newsItem.resumen)}</div>`;
    openModal("news-modal");
  }

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function renderInvestigacionNews() {
    const container = $id("investigacion-news-grid");
    if (!container || !NEWS_DATA || NEWS_DATA.length === 0) return;

    const investigNews = NEWS_INDEX.investig || [];
    const eventNews = NEWS_INDEX.evento || [];
    let displayList = [...investigNews];
    if (displayList.length < 6) displayList = displayList.concat(eventNews.slice(0, 6 - displayList.length));
    displayList = shuffleArray(displayList).slice(0, 6);

    container.innerHTML = displayList
      .map(
        (n) => `
        <div class="card news-card" onclick="window.__ademark.openNewsModal(${n._id})">
          <div class="news-kicker"><span class="tag ${n.tipo && n.tipo.includes("investig") ? "tag-red" : ""}">${formatNewsFecha(n.fecha)}</span></div>
          <h4>${esc(n.titulo)}</h4>
          <p>${truncateText(n.resumen, 16)}</p>
        </div>`,
      )
      .join("");
  }

  function renderHomeNewsAndEvents() {
    if (!NEWS_DATA || NEWS_DATA.length === 0) return;
    const noticiasContainer = $id("noticias-home-container");
    const noticiasAll = NEWS_INDEX.noticia || [];
    const lastNoticias = noticiasAll.slice(0, 6);

    if (!noticiasContainer) return;

    if (lastNoticias.length > 0) {
      noticiasContainer.innerHTML = lastNoticias
        .map(
          (news) => `
          <div class="news-row" onclick="window.__ademark.openNewsModal(${news._id})">
            <span class="news-date">${formatNewsFecha(news.fecha)}</span>
            <div>
              <h4>${esc(news.titulo)}</h4>
              <p>${truncateText(news.resumen, 22)}</p>
              ${news.autor ? `<p class="text-faint" style="font-size:.78rem;margin-top:4px">Por: ${esc(news.autor)}</p>` : ""}
            </div>
          </div>`,
        )
        .join("");
    } else {
      noticiasContainer.innerHTML = `<p class="text-faint">No hay noticias recientes.</p>`;
    }
  }

  function renderNoticias() {
    const container = $id("noticias-container");
    if (!container) return;
    if (!NEWS_DATA || NEWS_DATA.length === 0) {
      container.innerHTML = `<p class="text-faint">No hay noticias recientes.</p>`;
      return;
    }
    const studentNews = NEWS_INDEX.estudiantes || [];
    if (studentNews.length === 0) {
      container.innerHTML = `<p class="text-faint">No hay avisos para estudiantes.</p>`;
      return;
    }
    container.innerHTML = studentNews
      .map(
        (news) => `
        <div class="hslider-item">
          <div class="card card-link avviso-card" onclick="window.__ademark.openNewsModal(${news._id})">
            <span class="tag tag-red">${formatNewsFecha(news.fecha)}</span>
            <h4>${esc(news.titulo)}</h4>
            <p>${truncateText(news.resumen, 18)}</p>
          </div>
        </div>`,
      )
      .join("");
  }

  // -----------------------------------------------------------------------
  // Normativas
  // -----------------------------------------------------------------------
  function renderNormativas() {
    const container = $id("normativa-preview");
    if (!container) return;
    if (!NORMATIVAS_DATA || NORMATIVAS_DATA.length === 0) {
      container.innerHTML = `<p class="text-faint" style="font-size:.85rem">No hay normativas.</p>`;
      return;
    }
    const baseUrl = "https://edwww.us.es/";
    const firstFour = NORMATIVAS_DATA.slice(0, 4)
      .map((norm) => {
        let cleanPath = norm.URL || "#";
        if (cleanPath.startsWith("/")) cleanPath = cleanPath.substring(1);
        return `<a href="${baseUrl + cleanPath}" target="_blank" rel="noopener noreferrer" class="link-list" style="display:flex"><i data-lucide="chevron-right"></i><span>${esc(norm.Normativa || norm.nombre)}</span></a>`;
      })
      .join("");
    container.innerHTML = `<div class="link-list" style="margin-bottom:var(--space-4)">${firstFour}</div>
      <button id="open-normativas" class="btn btn-outline btn-sm" style="width:100%;justify-content:center">Ver todas las normativas</button>`;
    $id("open-normativas").addEventListener("click", openNormativasModal);
    refreshIcons();
  }

  function openNormativasModal() {
    const listContainer = $id("normativas-modal-list");
    const baseUrl = "https://edwww.us.es/";
    if (!NORMATIVAS_DATA || NORMATIVAS_DATA.length === 0) {
      listContainer.innerHTML = `<p class="text-faint">No hay normativas disponibles.</p>`;
    } else {
      listContainer.innerHTML = NORMATIVAS_DATA.map((norm) => {
        let cleanPath = norm.URL || "#";
        if (cleanPath.startsWith("/")) cleanPath = cleanPath.substring(1);
        return `
          <a href="${baseUrl + cleanPath}" target="_blank" rel="noopener noreferrer" class="card card-link" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4)">
            <span class="icon-tile"><i data-lucide="file-text"></i></span>
            <span style="flex:1;font-weight:500;color:var(--color-ink-soft)">${esc(norm.Normativa || norm.nombre)}</span>
            <i data-lucide="external-link" style="width:16px;height:16px;color:var(--color-faint);flex-shrink:0"></i>
          </a>`;
      }).join("");
    }
    openModal("normativas-modal");
    refreshIcons();
  }

  // -----------------------------------------------------------------------
  // Comisiones
  // -----------------------------------------------------------------------
  async function loadComisiones() {
    const statusEl = $id("comisiones-status");
    const containerEl = $id("comisiones-container");
    if (!statusEl || !containerEl) return;

    function renderMiembros(miembros) {
      if (!Array.isArray(miembros) || miembros.length === 0) return `<p class="text-faint" style="font-size:.9rem">Sin miembros definidos.</p>`;
      return `<ul class="stack" style="gap:.5rem">${miembros
        .map((m) => `<li style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:.25rem"><span class="m-name">${esc(m.nombre)}</span><span class="m-role">${esc(m.rol)}${m.funcion ? ` · ${esc(m.funcion)}` : ""}</span></li>`)
        .join("")}</ul>`;
    }

    function renderBloque(titulo, items) {
      if (!Array.isArray(items) || items.length === 0) return "";
      return `
        <div class="commission-block">
          <div class="commission-block-head"><span class="dot"></span><h4>${esc(titulo)}</h4></div>
          <div class="grid grid-2">
            ${items.map((c) => `<div class="commission-card"><h5>${esc(c.nombre)}</h5>${renderMiembros(c.miembros)}</div>`).join("")}
          </div>
        </div>`;
    }

    try {
      const res = await fetch(DATA_ROOT + "json/comisiones.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const html = [
        renderBloque("Comisiones estatutarias", data.estatutarias),
        renderBloque("Comisiones delegadas", data.delegadas),
        renderBloque("Representantes", data.representantes),
      ].filter(Boolean).join("");
      containerEl.innerHTML = html || `<p class="text-faint">No hay comisiones para mostrar.</p>`;
      statusEl.textContent = "";
    } catch (err) {
      console.error("Error cargando comisiones:", err);
      statusEl.innerHTML = `<span class="status-error"><i data-lucide="alert-triangle"></i> No se pudo cargar json/comisiones.json.</span>`;
      containerEl.innerHTML = "";
    }
    refreshIcons();
  }

  // -----------------------------------------------------------------------
  // API pública mínima (usada por HTML generado dinámicamente vía onclick="").
  // -----------------------------------------------------------------------
  window.__ademark = { openNewsModal };
})();
