// =====================================================================
// Planet — une planète et ses pays
// ---------------------------------------------------------------------
//   const earth = await Planet.load({ name: "Terre", services });
//   earth.country("CI")          → l'objet Country de la Côte d'Ivoire
//   earth.search("cote")         → [Country, …]
//   earth.byRegion()             → les pays rangés par continent, de A à Z
//   earth.random()               → un pays au hasard
//
// Planet.load() est une "méthode de fabrique" statique : elle charge les
// fichiers, crée chaque Country puis renvoie la planète prête à l'emploi.
// =====================================================================

import { DATA } from "../config.js";
import { normalize } from "../utils/format.js";
import { Country } from "./Country.js";

const { topojson } = window;

async function getJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Fichier introuvable : ${path}`);
  return response.json();
}

export class Planet {
  #countries = new Map();   // code à 2 lettres → Country
  #byCode3 = new Map();     // code à 3 lettres → Country
  #searchIndex = [];

  constructor({ name, radiusKm, surfaceKm2, ageYears, geometry }) {
    this.name = name;
    this.radiusKm = radiusKm;
    this.surfaceKm2 = surfaceKm2;
    this.ageYears = ageYears;
    this.geometry = geometry;   // contours et frontières, pour le globe
  }

  static async load({ name = "Terre", services }) {
    const [rawCountries, cities, world50, world110] = await Promise.all([
      getJSON(DATA.countries),
      getJSON(DATA.cities),
      getJSON(DATA.world50),
      getJSON(DATA.world110),
    ]);

    const features50 = topojson.feature(world50, world50.objects.countries).features;
    const features110 = topojson.feature(world110, world110.objects.countries).features;
    const geometry = {
      features50,
      features110,
      borders50: topojson.mesh(world50, world50.objects.countries, (a, b) => a !== b),
      borders110: topojson.mesh(world110, world110.objects.countries, (a, b) => a !== b),
    };

    const planet = new Planet({ name, radiusKm: 6371, surfaceKm2: 510_072_000, ageYears: 4.54e9, geometry });
    const shapes = new Map(features50.filter((f) => f.properties.a2).map((f) => [f.properties.a2, f]));
    for (const raw of rawCountries) {
      planet.#add(new Country(raw, { planet, services, shape: shapes.get(raw.a2) || null, cities: cities[raw.a2] || [] }));
    }
    return planet;
  }

  #add(country) {
    this.#countries.set(country.code, country);
    this.#byCode3.set(country.code3, country);
    this.#searchIndex.push({
      country,
      name: normalize(country.name),
      words: normalize(`${country.name} ${country.englishName} ${country.officialName}`).split(/[\s'-]+/),
      all: normalize(`${country.name} ${country.englishName} ${country.officialName} ${country.capitalNames.join(" ")}`),
    });
  }

  // --- Accès aux pays ------------------------------------------------
  get countries() {
    return [...this.#countries.values()];
  }

  get size() {
    return this.#countries.size;
  }

  country(code) {
    return this.#countries.get((code || "").toUpperCase()) || null;
  }

  countryByCode3(code3) {
    return this.#byCode3.get(code3) || null;
  }

  has(code) {
    return this.#countries.has((code || "").toUpperCase());
  }

  get regions() {
    return [...new Set(this.countries.map((c) => c.region))].sort((a, b) => a.localeCompare(b, "fr"));
  }

  // Population totale des pays connus
  get population() {
    return this.countries.reduce((sum, c) => sum + (c.population || 0), 0);
  }

  // --- Recherche : début du nom > début d'un mot > ailleurs ----------
  search(query, limit = 8) {
    const q = normalize(query.trim());
    if (!q) return [];
    const results = [];
    for (const entry of this.#searchIndex) {
      const c = entry.country;
      let score = 0;
      if (q.length <= 3 && (q === c.code.toLowerCase() || q === c.code3.toLowerCase())) score = 5;
      else if (entry.name.startsWith(q)) score = 4;
      else if (entry.words.some((w) => w.startsWith(q))) score = 3;
      else if (entry.all.includes(q)) score = 1;
      if (score) results.push({ c, score });
    }
    results.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name, "fr"));
    return results.slice(0, limit).map((r) => r.c);
  }

  // --- Un pays au hasard (filtré si besoin) --------------------------
  random(filter = (c) => c.hasShape && c.independent) {
    const pool = this.countries.filter(filter);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // --- Les pays par continent, de A à Z (écran "Destinations") ------
  byRegion() {
    const groups = new Map();
    for (const country of [...this.countries].sort((a, b) => a.name.localeCompare(b.name, "fr"))) {
      if (!groups.has(country.region)) groups.set(country.region, []);
      groups.get(country.region).push(country);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  }
}
