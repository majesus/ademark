// js/countdown_investigacion.js
(() => {
  "use strict";

  // =========================
  // 1) CSS INYECTADO (para TODAS las bandas)
  // =========================
  const CSS = `
/* =========================
   COUNTDOWN BANDS
   (repetible con .countdown-band)
========================= */

.countdown-band{
  background-color: #B30A1B;
  color: #ffffff;
  padding: 16px 16px;      /* fino */
  margin: 18px 0;          /* misma distancia arriba/abajo */
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.countdown-band .stats-container{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  max-width: 1200px;
  width: 100%;
}

.countdown-band .stat-card{
  padding: 6px 8px;
  opacity: 0;
  transform: translateY(12px);
  transition: all 0.55s ease-out;
}

.countdown-band .stat-card.visible{
  opacity: 1;
  transform: translateY(0);
}

.countdown-band .stat-number{
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 2.05rem;
  font-weight: 800;
  line-height: 1;
  display: block;
  margin-bottom: 4px;
  color: #ffffff;
}

.countdown-band .stat-symbol{
  font-size: 1.05rem;
  color: #c5a059;
  vertical-align: super;
}

.countdown-band .stat-label{
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 700;
  border-top: 2px solid #c5a059;
  display: inline-block;
  padding-top: 5px;
  line-height: 1.15;
}
`;

  const injectCSS = () => {
    if (document.getElementById("css-countdown-bands")) return;
    const style = document.createElement("style");
    style.id = "css-countdown-bands";
    style.textContent = CSS;
    document.head.appendChild(style);
  };

  // =========================
  // 2) JS (ANIMACIÓN) para N bandas
  // =========================
  const animateValue = (obj, start, end, duration) => {
    let startTimestamp = null;

    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      obj.textContent = Math.floor(progress * (end - start) + start);

      if (progress < 1) window.requestAnimationFrame(step);
      else obj.textContent = String(end);
    };

    window.requestAnimationFrame(step);
  };

  const initCountdownBands = () => {
    const bands = document.querySelectorAll(".countdown-band");
    if (!bands.length) return;

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const card = entry.target;
        card.classList.add("visible");

        const numberEl = card.querySelector(".stat-number");
        if (!numberEl) return;

        const raw = numberEl.getAttribute("data-target");
        const target = Number(raw);

        // Si data-target no es número, no animamos (pero no rompemos nada).
        if (!Number.isFinite(target)) return;

        animateValue(numberEl, 0, target, 1600);
        obs.unobserve(card);
      });
    }, { threshold: 0.2 });

    bands.forEach((band) => {
      band.querySelectorAll(".stat-card").forEach((card) => observer.observe(card));
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    injectCSS();
    initCountdownBands();
  });
})();
