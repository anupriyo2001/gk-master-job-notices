// Builds the official-website registry from the Government of India's own
// directory, igod.gov.in (Integrated Government Online Directory): every
// ministry, department, commission, board, police unit, district, PSU and
// panchayat body listed there, with its official website.
//
// A notice is treated as genuine only if it comes from a website in this
// registry (or a .gov.in / .nic.in domain). Refreshed weekly by collect.mjs.
import { GOVERNMENT_SUFFIXES, OFFICIAL_DOMAINS } from "./jobSources.js";

const START = [
  "https://igod.gov.in/ug/categories",
  "https://igod.gov.in/apx/categories",
  "https://igod.gov.in/leg/categories",
  "https://igod.gov.in/jud/categories",
  "https://igod.gov.in/sg/district/states",
  "https://igod.gov.in/districts",
  "https://igod.gov.in/sectors",
  "https://igod.gov.in/leg/L007/states",
];
// Directory listing pages worth walking (not per-organisation detail pages).
const LISTING = /^https:\/\/igod\.gov\.in\/(ug|apx|leg|jud|sg|sector|districts)(\/|$)[^?#]*$/;
const SKIP = /\/organization\/|\/site_map|\/search|\/about|\/feedback|\/help|\/contact/;
const IGNORE_HOSTS = new Set([
  "igod.gov.in", "twitter.com", "x.com", "facebook.com", "youtube.com", "instagram.com", "linkedin.com",
  "india.gov.in", "mygov.in", "data.gov.in", "pmindia.gov.in", "pgportal.gov.in", "s3waas.gov.in", "nic.in",
  "passportindia.gov.in", "guidelines.india.gov.in", "services.india.gov.in", "digitalindia.gov.in",
]);

// The directory's state codes → the app's (ISO 3166-2:IN) codes.
const STATE_ALIASES = { CG: "CT", TS: "TG", UK: "UT", ND: "DH", OD: "OR", DD: "DH", DN: "DH" };
const STATE_OF = (url) => {
  const code = url.match(/igod\.gov\.in\/sg\/([A-Z]{2})\//)?.[1];
  return code ? (STATE_ALIASES[code] ?? code) : "ALL";
};

export async function buildRegistry({ get, anchors, log = () => {}, maxPages = 1500 }) {
  const queue = [...START];
  const visited = new Set();
  const orgs = new Map(); // host -> { name, url, state }
  const fetchPage = async (page) => {
    try {
      const res = await get(page);
      return typeof res.body === "string" ? res.body : "";
    } catch {
      return "";
    }
  };
  while (queue.length && visited.size < maxPages) {
    // Six directory pages at a time — quick, but gentle on the server.
    const batch = [];
    while (queue.length && batch.length < 6) {
      const page = queue.shift();
      if (!visited.has(page)) {
        visited.add(page);
        batch.push(page);
      }
    }
    const pages = await Promise.all(batch.map(async (page) => [page, await fetchPage(page)]));
    for (const [page, html] of pages) {
    for (const { url, label } of anchors(html, page)) {
      let u;
      try {
        u = new URL(url);
      } catch {
        continue;
      }
      if (u.hostname === "igod.gov.in") {
        const clean = `${u.origin}${u.pathname}`.replace(/\/+$/, "");
        if (LISTING.test(clean) && !SKIP.test(clean) && !visited.has(clean)) queue.push(clean);
        continue;
      }
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (!/^https?:$/.test(u.protocol) || IGNORE_HOSTS.has(host)) continue;
      if (!label || label.length < 3 || orgs.has(host)) continue;
      orgs.set(host, { name: label.slice(0, 160), url: `${u.protocol}//${u.hostname}/`, state: STATE_OF(page) });
    }
    }
  }
  log(`Registry: ${orgs.size} official websites from ${visited.size} directory pages.`);
  return {
    updatedAt: new Date().toISOString(),
    orgs: [...orgs.entries()].map(([host, o]) => ({ host, ...o })),
  };
}

/** Official = government domain, a known public-sector domain, or listed in the registry. */
export function makeOfficialCheck(registryHosts) {
  const hosts = new Set(registryHosts);
  return (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (GOVERNMENT_SUFFIXES.some((s) => host.endsWith(s))) return true;
    if (OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
    if (hosts.has(host)) return true;
    // A sub-domain of a registered site (e.g. recruitment.example.org).
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i++) if (hosts.has(parts.slice(i).join("."))) return true;
    return false;
  };
}

/** Organisations that recruit often — watched every run, not just in rotation. */
export const RECRUITER =
  /public service commission|service commission|staff selection|subordinate services? selection|selection board|recruitment board|recruitment cell|police|high court|district court|judicial|railway recruitment|postal|india post|school service|teachers? recruitment|health (mission|society)|national health mission|nhm|panchayat|zilla parishad|zila parishad|municipal corporation|bank|power (corporation|company)|electricity board|transport corporation|university|aiims|institute of medical/i;
