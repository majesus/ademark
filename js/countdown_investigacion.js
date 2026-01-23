// js/countdown_investigacion.js
(() => {
  "use strict";

  // =========================
  // 1) CSS INYECTADO (banda más bajita + separación natural abajo)
  // =========================
  const CSS = `
/* =========================
   COUNTDOWN INVESTIGACIÓN
   (aislado dentro de #countdown-investigacion)
========================= */

#countdown-investigacion {
  background-color: #B30A1B;
  color: #ffffff;
  padding: 40px 20px;   /* más bajita */
  margin-bottom: 28px;  /* separación natural con el bloque de abajo */
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
}

#countdown-investigacion .stats-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 28px;            /* más compacto */
  max-width: 1200px;
  width: 100%;
}

#countdown-investigacion .stat-card {
  padding: 14px 12px;   /* menos alto */
  opacity: 0;
  transform: translateY(30px);
  transition: all 0.8s ease-out;
}

#countdown-investigacion .stat-card.visible {
  opacity: 1;
  transform: translateY(0);
}

#countdown-investigacion .stat-number {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 3rem;      /* reduce altura visual */
  font-weight: 800;
  display: block;
  margin-bottom: 8px;
  color: #ffffff;
}

#countdown-investigacion .stat-symbol {
  font-size: 1.6rem;
  color: #c5a059;
  vertical-align: super;
}

#countdown-investigacion .stat-label {
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
  border-top: 2px solid #c5a059;
  display: inline-block;
  padding-top: 8px;
}
`;

  const injectCSS = () => {
    if (document.getElementById("css-countdown-investigacion")) return;
    const style = document.createElement("style");
    style.id = "css-countdown-investigacion";
    style.textContent = CSS;
    document.head.appendChild(style);
  };

  // =========================
  // 2) JS (ANIMACIÓN)
  // =========================
  const ROOT_SELECTOR = "#countdown-investigacion";

  const animateValue = (obj, start, end, duration) => {
    let startTimestamp = null;

    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      obj.textContent = Math.floor(progress * (end - start) + start);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        obj.textContent = end;
      }
    };

    window.requestAnimationFrame(step);
  };

  const initCountdown = () => {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    const cards = root.querySelectorAll(".stat-card");
    if (!cards.length) return;

    const observerOptions = { threshold: 0.2 };

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const card = entry.target;
        card.classList.add("visible");

        const numberElement = card.querySelector(".stat-number");
        if (!numberElement) return;

        const targetNumber = +numberElement.getAttribute("data-target");
        if (!Number.isFinite(targetNumber)) return;

        animateValue(numberElement, 0, targetNumber, 2000);

        obs.unobserve(card);
      });
    }, observerOptions);

    cards.forEach((card) => observer.observe(card));
  };

  // =========================
  // 3) INIT
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    injectCSS();
    initCountdown();
  });
})();
