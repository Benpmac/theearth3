// =====================================================================
// Globe — le globe 3D, dessiné dans un <canvas> avec d3
// ---------------------------------------------------------------------
// Même principe que la version 1 (voir le document "Le globe 3D") :
// une projection orthographique transforme (longitude, latitude) en
// (x, y), et tout est redessiné à chaque image. Le code est rangé dans
// une classe : l'état est dans des champs privés (#), les actions sont
// des méthodes, et deux "rappels" (callbacks) parlent au reste du site :
//   onSelect(country)  quand on clique un pays
//   describe(country)  texte affiché sous le nom dans l'info-bulle
// =====================================================================

import { SETTINGS } from "../config.js";
import { h } from "../utils/dom.js";

const { d3 } = window;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const HOME = { lon: 10, lat: 15 };

export class Globe {
  // --- Champs privés : l'état interne du globe
  #container; #canvas; #ctx; #tooltip;
  #planet; #geometry; #boxes;
  #projection; #path;
  #sphere = { type: "Sphere" };
  #graticule = d3.geoGraticule10();
  #view = { width: 0, height: 0, radius: 1, zoom: 1, rotation: [-HOME.lon, -HOME.lat, 0] };
  #selected = null;
  #hovered = null;
  #moving = false;
  #spin = null;
  #flight = null;
  #frame = 0;
  #zoom; #last = d3.zoomIdentity; #syncing = false;
  #pointer = null; #hoverFrame = 0;
  #colors; #fill;
  #reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(container, planet, { onSelect = () => {}, describe = () => "" } = {}) {
    this.#container = container;
    this.#canvas = container.querySelector(".globe__canvas");
    this.#ctx = this.#canvas.getContext("2d");
    this.#tooltip = container.querySelector(".globe__tooltip");
    this.#planet = planet;
    this.#geometry = planet.geometry;
    this.onSelect = onSelect;
    this.describe = describe;

    // Couleurs relues dans tokens.css
    const css = getComputedStyle(document.documentElement);
    const token = (name) => css.getPropertyValue(name).trim();
    this.#colors = {
      oceanLight: token("--ocean-light"), oceanDark: token("--ocean-dark"), atmosphere: token("--atmosphere"),
      graticule: token("--graticule"), border: token("--land-border"), hover: token("--land-hover"),
      selected: token("--land-selected"), other: token("--land-other"), font: token("--font-body"),
      light: token("--globe-light"), shadow: token("--globe-shadow"), halo: token("--globe-halo"), outline: token("--globe-outline"),
      regions: {
        Afrique: token("--land-africa"), Amériques: token("--land-americas"), Asie: token("--land-asia"),
        Europe: token("--land-europe"), Océanie: token("--land-oceania"), Antarctique: token("--land-antarctic"),
      },
    };
    this.setFill((country) => this.#colors.regions[country?.region] || this.#colors.other);

    this.#boxes = new Map(this.#geometry.features50.map((f) => [f, d3.geoBounds(f)]));
    this.#projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
    this.#path = d3.geoPath(this.#projection, this.#ctx);

    this.#bindGestures();
    this.#bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  // =================================================================
  // Méthodes publiques
  // =================================================================

  // Choisir comment colorer les pays : une fonction country → couleur
  setFill(fillFn) {
    const map = new Map();
    for (const country of this.#planet.countries) map.set(country.code, fillFn(country));
    this.#fill = map;
    this.#requestDraw();
  }

  // Surligner un pays et voler jusqu'à lui (null = aucun)
  focus(code) {
    this.#selected = code;
    if (!code) return this.#requestDraw();
    const country = this.#planet.country(code);
    if (!country) return;
    const zoom = clamp(2.1 * Math.pow(300000 / Math.max(country.area || 300000, 1), 0.22), 1, 6);
    this.#flyTo(country.center.lon, country.center.lat, zoom);
  }

  zoomBy(factor) {
    this.#stopSpin();
    this.#stopFlight();
    this.#view.zoom = clamp(this.#view.zoom * factor, SETTINGS.minZoom, SETTINGS.maxZoom);
    this.#syncZoom();
    this.#draw();
  }

  reset() {
    const country = this.#selected && this.#planet.country(this.#selected);
    const target = country ? country.center : HOME;
    this.#flyTo(target.lon, target.lat, 1);
  }

  // Pause quand l'écran du globe n'est pas affiché (économise la batterie)
  pause() {
    this.#stopSpin();
    this.#stopFlight();
  }

  resume() {
    this.resize();
    if (!this.#selected) this.#startSpin();
  }

  resize() {
    const { width, height } = this.#container.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    Object.assign(this.#view, { width, height, radius: Math.min(width, height) * (width < 600 ? 0.46 : 0.42) });
    this.#canvas.width = Math.round(width * ratio);
    this.#canvas.height = Math.round(height * ratio);
    this.#ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.#draw();
  }

  // =================================================================
  // Dessin
  // =================================================================
  #draw() {
    const { width, height, radius, zoom, rotation } = this.#view;
    if (!width) return;
    const ctx = this.#ctx;
    const path = this.#path;
    const c = this.#colors;
    const r = radius * zoom;
    const cx = width / 2;
    const cy = height / 2;
    this.#projection.scale(r).translate([cx, cy]).rotate(rotation);

    const fine = !this.#moving || zoom > 3;
    const features = fine ? this.#geometry.features50 : this.#geometry.features110;
    const borders = fine ? this.#geometry.borders50 : this.#geometry.borders110;

    ctx.clearRect(0, 0, width, height);

    // 1. halo de l'atmosphère
    const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.18);
    halo.addColorStop(0, c.atmosphere);
    halo.addColorStop(1, "transparent");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.18, 0, 2 * Math.PI);
    ctx.fill();

    // 2. océan
    const ocean = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
    ocean.addColorStop(0, c.oceanLight);
    ocean.addColorStop(1, c.oceanDark);
    ctx.beginPath();
    path(this.#sphere);
    ctx.fillStyle = ocean;
    ctx.fill();

    // 3. méridiens et parallèles
    ctx.beginPath();
    path(this.#graticule);
    ctx.strokeStyle = c.graticule;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 4. pays
    for (const feature of features) {
      const code = feature.properties.a2;
      ctx.beginPath();
      path(feature);
      ctx.fillStyle =
        code && code === this.#selected ? c.selected :
        code && code === this.#hovered ? c.hover :
        this.#fill.get(code) || c.other;
      ctx.fill();
    }

    // 5. frontières
    ctx.beginPath();
    path(borders);
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 6. contour du pays choisi
    const selectedCountry = this.#selected && this.#planet.country(this.#selected);
    if (selectedCountry?.shape) {
      ctx.beginPath();
      path(selectedCountry.shape);
      ctx.strokeStyle = this.#colors.light;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // 7. ombre de volume
    const shade = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
    shade.addColorStop(0, this.#colors.halo);
    shade.addColorStop(0.7, "transparent");
    shade.addColorStop(1, this.#colors.shadow);
    ctx.beginPath();
    path(this.#sphere);
    ctx.fillStyle = shade;
    ctx.fill();

    // 8. capitale du pays choisi
    if (selectedCountry) this.#drawMarker(selectedCountry);
  }

  #drawMarker(country) {
    const place = country.referencePlace;
    if (!this.#isVisible(place.lon, place.lat)) return;
    const ctx = this.#ctx;
    const [x, y] = this.#projection(place.coordinates);
    if (!country.hasShape) {
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, 2 * Math.PI);
      ctx.strokeStyle = this.#colors.selected;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = this.#colors.light;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.#colors.outline;
    ctx.stroke();
    const label = country.capital?.name || country.capitalNames[0];
    if (label) {
      ctx.font = `600 13px ${this.#colors.font}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.#colors.outline;
      ctx.strokeText(label, x + 9, y + 4);
      ctx.fillStyle = this.#colors.light;
      ctx.fillText(label, x + 9, y + 4);
    }
  }

  #requestDraw() {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
    });
  }

  #isVisible(lon, lat) {
    const [r0, r1] = this.#view.rotation;
    return d3.geoDistance([lon, lat], [-r0, -r1]) < Math.PI / 2 - 0.01;
  }

  // Quel pays se trouve sous le point (x, y) ?
  #countryAt(x, y) {
    const point = this.#projection.invert([x, y]);
    if (!point || !Number.isFinite(point[0]) || !this.#isVisible(point[0], point[1])) return null;
    const [lon, lat] = point;
    for (const feature of this.#geometry.features50) {
      if (!feature.properties.a2) continue;
      const [[west, south], [east, north]] = this.#boxes.get(feature);
      if (lat < south || lat > north) continue;
      const outside = west <= east ? lon < west || lon > east : lon < west && lon > east;
      if (outside) continue;
      if (d3.geoContains(feature, point)) return feature.properties.a2;
    }
    return null;
  }

  // =================================================================
  // Gestes : glisser pour tourner, molette ou pincement pour zoomer
  // =================================================================
  #bindGestures() {
    this.#zoom = d3.zoom()
      .scaleExtent([SETTINGS.minZoom, SETTINGS.maxZoom])
      .clickDistance(4)
      .on("start", (event) => {
        if (!event.sourceEvent) return;
        this.#stopSpin();
        this.#stopFlight();
        this.#moving = true;
        this.#tooltip.hidden = true;
      })
      .on("zoom", (event) => {
        const t = event.transform;
        if (!this.#syncing) {
          const view = this.#view;
          if (t.k === this.#last.k) {
            const degreesPerPixel = 180 / (Math.PI * view.radius * view.zoom);
            view.rotation[0] += (t.x - this.#last.x) * degreesPerPixel;
            view.rotation[1] = clamp(view.rotation[1] - (t.y - this.#last.y) * degreesPerPixel, -90, 90);
          } else {
            view.zoom = t.k;
          }
        }
        this.#last = t;
        this.#requestDraw();
      })
      .on("end", (event) => {
        if (!event.sourceEvent) return;
        this.#moving = false;
        this.#requestDraw();
      });
    d3.select(this.#canvas).call(this.#zoom).on("dblclick.zoom", null);
  }

  #syncZoom() {
    this.#syncing = true;
    d3.select(this.#canvas).call(this.#zoom.transform, d3.zoomIdentity.scale(this.#view.zoom));
    this.#last = d3.zoomIdentity.scale(this.#view.zoom);
    this.#syncing = false;
  }

  // =================================================================
  // Survol et clic
  // =================================================================
  #bindPointer() {
    const canvas = this.#canvas;
    // La souris arrive sur le globe : il arrête de tourner tout seul, pour qu'on puisse
    // survoler et viser un pays (pendant la rotation, le survol est désactivé)
    canvas.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") this.#stopSpin();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      if (this.#spin) this.#stopSpin();
      this.#pointer = [event.offsetX, event.offsetY];
      if (!this.#hoverFrame) this.#hoverFrame = requestAnimationFrame(() => this.#updateHover());
    });
    canvas.addEventListener("pointerleave", () => {
      this.#pointer = null;
      this.#hovered = null;
      this.#tooltip.hidden = true;
      canvas.classList.remove("is-over-country");
      this.#requestDraw();
    });
    canvas.addEventListener("click", (event) => {
      const code = this.#countryAt(event.offsetX, event.offsetY);
      if (code) this.onSelect(this.#planet.country(code));
    });
  }

  #updateHover() {
    this.#hoverFrame = 0;
    if (!this.#pointer || this.#moving) return;
    const [x, y] = this.#pointer;
    const code = this.#countryAt(x, y);
    if (code !== this.#hovered) {
      this.#hovered = code;
      this.#requestDraw();
      const country = code && this.#planet.country(code);
      if (country) {
        const detail = this.describe(country);
        this.#tooltip.replaceChildren(
          h("img", { src: country.flag, alt: "", width: 28, height: 21 }),
          h("span", {}, h("strong", {}, country.name), detail ? h("small", {}, detail) : null, h("small", { class: "globe__tooltip-cta" }, "Cliquer pour visiter →"))
        );
      }
    }
    this.#canvas.classList.toggle("is-over-country", Boolean(code));
    this.#tooltip.hidden = !code;
    if (code) {
      this.#tooltip.style.left = `${x}px`;
      this.#tooltip.style.top = `${y}px`;
    }
  }

  // =================================================================
  // Animations
  // =================================================================
  #startSpin() {
    if (this.#reduceMotion || this.#spin) return;
    this.#moving = true;
    let previous = 0;
    this.#spin = d3.timer((elapsed) => {
      this.#view.rotation[0] += (elapsed - previous) * SETTINGS.autoRotateSpeed;   // même vitesse sur tous les écrans
      previous = elapsed;
      this.#draw();
    });
  }

  #stopSpin() {
    if (!this.#spin) return;
    this.#spin.stop();
    this.#spin = null;
    this.#moving = false;
    this.#requestDraw();
  }

  #stopFlight() {
    if (!this.#flight) return;
    this.#flight.stop();
    this.#flight = null;
    this.#moving = false;
  }

  #flyTo(lon, lat, targetZoom) {
    this.#stopSpin();
    this.#stopFlight();
    const view = this.#view;
    const from = [...view.rotation];
    const zoomFrom = view.zoom;
    const deltaLon = ((((-lon - from[0]) % 360) + 540) % 360) - 180;
    const to = [from[0] + deltaLon, -lat, 0];
    const finish = () => {
      view.rotation = to;
      view.zoom = targetZoom;
      this.#moving = false;
      this.#flight = null;
      this.#syncZoom();
      this.#draw();
    };
    if (this.#reduceMotion) return finish();
    this.#moving = true;
    const duration = 1200;
    this.#flight = d3.timer((elapsed) => {
      const t = Math.min(1, elapsed / duration);
      const e = d3.easeCubicInOut(t);
      const lift = Math.sin(Math.PI * e) * 0.25 * Math.min(1, Math.abs(deltaLon) / 90);
      view.rotation = [from[0] + deltaLon * e, from[1] + (to[1] - from[1]) * e, 0];
      view.zoom = (zoomFrom + (targetZoom - zoomFrom) * e) * (1 - lift);
      this.#draw();
      if (t === 1) {
        this.#flight.stop();
        finish();
      }
    });
  }
}
