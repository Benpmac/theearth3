// =====================================================================
// ExploreView — l'écran d'accueil : le globe
// ---------------------------------------------------------------------
// Survoler un pays affiche son nom ; cliquer (ou toucher) ouvre
// directement sa page. En revenant d'une page pays, le globe se tourne
// vers le pays que l'on vient de visiter.
// =====================================================================

import { h } from "../utils/dom.js";
import { formatCompact, formatPeople } from "../utils/format.js";
import { Globe } from "./Globe.js";
import { View } from "./View.js";

// Les continents et leur couleur sur le globe (jetons de tokens.css)
const REGIONS = {
  Afrique: "--land-africa", Amériques: "--land-americas", Asie: "--land-asia",
  Europe: "--land-europe", Océanie: "--land-oceania", Antarctique: "--land-antarctic",
};

export class ExploreView extends View {
  #globe;

  constructor(root, app) {
    super(root, app);
    const planet = app.planet;

    this.#globe = new Globe(root.querySelector(".globe"), planet, {
      onSelect: (country) => app.router.go(`pays/${country.code}`),
      describe: (country) => [country.capitalNames[0], country.population ? `${formatCompact(country.population)} hab.` : null].filter(Boolean).join(" · "),
    });

    // Ce que l'on sait de la planète (attributs de l'instance earth)
    root.querySelector("[data-planet-facts]").textContent =
      `${planet.size} pays et territoires à visiter · ${formatPeople(planet.population)} d'habitants`;

    root.querySelector('[data-zoom="in"]').addEventListener("click", () => this.#globe.zoomBy(1.5));
    root.querySelector('[data-zoom="out"]').addEventListener("click", () => this.#globe.zoomBy(1 / 1.5));
    root.querySelector('[data-zoom="reset"]').addEventListener("click", () => this.#globe.reset());

    // Légende des continents
    const css = getComputedStyle(document.documentElement);
    const color = (region) => css.getPropertyValue(REGIONS[region] || "--land-other").trim();
    this.#globe.setFill((c) => color(c.region));
    root.querySelector(".legend").replaceChildren(
      h("ul", { class: "legend__swatches", role: "list" },
        Object.keys(REGIONS).filter((r) => r !== "Antarctique").map((r) =>
          h("li", {}, h("a", { href: `#/destinations/${encodeURIComponent(r)}` }, h("i", { style: { background: color(r) } }), r)))));
  }

  get documentTitle() {
    return "TheEarth · Visitez un pays depuis votre canapé";
  }

  enter() {
    this.#globe.resume();
    // En revenant d'une page pays, le globe se tourne vers ce pays et le surligne
    const last = this.app.lastCountry;
    if (last) this.#globe.focus(last.code);
  }

  leave() {
    this.#globe.pause();
  }
}
