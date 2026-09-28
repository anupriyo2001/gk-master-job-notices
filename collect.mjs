#!/usr/bin/env node
// GK Master — official job-notice collector (runs free on GitHub Actions).
//
// Every two hours:
//   1. Keeps a registry of every official government website, built from the
//      Government of India's own directory (igod.gov.in) — refreshed weekly.
//   2. Finds each site's recruitment page (the standard "Recruitment" notices
//      page on government-template sites, or a Careers/Recruitment link).
//   3. Checks the recruitment pages — commissions, selection boards, police,
//      districts (panchayat and local posts), India Post, railways, banks,
//      PSUs and more — for new notices, and saves their plain text to
//      notices/, together with the official-website list (notices/domains.json).
//
// The GK Master server reads these texts, extracts jobs with AI and publishes
// a job only if every key fact is proven by the official text.
// This repository holds NO secrets — only public text from official websites.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Agent } from "undici";
import { extractLinks, extractText, getDocumentProxy } from "unpdf";
import { WATCH_PAGES } from "./jobSources.js";
import { buildRegistry, makeOfficialCheck, RECRUITER } from "./registry.mjs";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const NOTICES = path.join(ROOT, "notices");
const STATE = path.join(ROOT, "state");
const file = (dir, name) => path.join(dir, name);
const MAX_NOTICES_PER_RUN = Number(process.env.MAX_NOTICES ?? 40);
const MAX_PER_PAGE = 4;
const PROBES_PER_RUN = Number(process.env.MAX_PROBES ?? 500);
const MAX_INDEX = 1500;
const MAX_TEXT = 40_000;
const CONCURRENCY = 8;
const WEEK = 7 * 86_400_000;
const MONTH = 30 * 86_400_000;
const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MS ?? 20 * 60_000);
const started = Date.now();
const timeLeft = () => RUN_BUDGET_MS - (Date.now() - started);

// A standard browser identity — some government sites refuse unknown readers.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// Many government sites run expired or incomplete certificates. For sites on
// the official list only, a second attempt accepts them — the notice text is
// still verified fact-by-fact by the server afterwards.
const lenient = new Agent({ connect: { rejectUnauthorized: false } });

const LOOKS_LIKE_RECRUITMENT =
  /recruit|advt|advertisement|notification|notice|vacanc|apply|application|examination|exam\b|bharti|bharati|भर्ती|भरती|विज्ञापन|नियुक्ति|নিয়োগ|corrigendum|extension|extended|addendum|engagement|walk.?in|gds|gramin dak|भरती|जाहिरात|पदभरती/i;
const NOT_RECRUITMENT =
  /result|answer.?key|admit|interview (schedule|date|letter)|cut.?off|\bmarks?\b|mark.?list|appointment.?letter|allotment|document.?verification|\bdv\b|syllabus|question.?paper|time.?table|press|tender|\brti\b|photo|gallery|caveat|merit.?list|selection.?list|rejected|minutes|holiday|citizen|faq|login|sitemap|annual.?report|budget|audit|quotation|auction|e-?bid|expression of interest|\beoi\b|hoarding|advertiser|disaster|\bplan\b|question.?bank|nyas|current page|marksheet|to be furnished|calend[ae]r|exam schedule|instructions|guidelines|\brules\b|notification of result|list of candidates|shortlisted|provisional(ly)? selected|scrutiny|objection/i;
// Topics official sites post that are never job openings (seen on real runs).
const NOT_JOB_TOPIC =
  /prospectus|\bnirf\b|handbook|\bhistory\b|enrol+ment form|bus pass|lok adalat|internship|committee|transfer(s)? and posting|posting of|attendance|\bstudents?\b|semester|caution notice|model answer|stall form|brochure|\(closed\)|\bclosed\b|draft .*regulations|comments? (&|and) suggestions|^page \d+$|reject|admission|scholarship|\bfaq|induction training|newly recruited|benefits of working/i;
const MENU_LABEL =
  /^(home|about.*|contact.*|calendar|active examinations?|forthcoming examinations?|read more|more|view all.*|click here|english|hindi|हिन्दी|vacancies|recruitment|careers?|current openings|how do you apply\??|faqs?|notices?|notifications?|what'?s new|archives?|vacancies notices|important links)$/i;
const STRONG_RECRUITMENT =
  /recruitment (of|for|to)|notification for|advertisement no|advt\.? no|vacanc(y|ies) (for|of|in)|invit(es|ing) (online )?applications|posts? of |engagement of|examination,? 20\d\d|exam(ination)? notification|walk.?in|gramin dak sevak/i;
const GENERIC_LINK = /^(view|download|click here|english|hindi|pdf|details?|more|read more|open|link|here)\b/i;
const CAREER_LINK = /recruit|career|vacanc|job|advertis|bharti|भर्ती|notification/i;

fs.mkdirSync(NOTICES, { recursive: true });
fs.mkdirSync(STATE, { recursive: true });
const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback);
// Links already read. A link skipped because of the per-run limits is NOT
// added, so it is read on a later run — jobs that were already open when a
// source was added are caught up over the next runs, newest first.
const seen = new Set(readJson(file(STATE, "read.json"), []));
const index = readJson(file(NOTICES, "index.json"), { notices: [] });
const probes = readJson(file(STATE, "probes.json"), {});
const runState = readJson(file(STATE, "run.json"), { run: 0 });
runState.run += 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = (url) => crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8211;/g, "–");
const clean = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

let official = makeOfficialCheck([]);

async function get(url, { asBuffer = false, timeout = 30_000 } = {}) {
  const attempt = async (dispatcher) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: controller.signal, dispatcher });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      const body = asBuffer || /pdf/i.test(type) ? new Uint8Array(await res.arrayBuffer()) : await res.text();
      return { body, type, finalUrl: res.url };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt(undefined);
  } catch (error) {
    const tls = /certificate|self.signed|unable to verify|CERT_|UNABLE_TO|fetch failed/i.test(`${error.message} ${error.cause?.message ?? ""}`);
    if (tls && official(url)) return attempt(lenient);
    throw error;
  }
}

/** Links with a meaningful title: generic "View (123 KB)" links take their table row's text. */
function links(html, base) {
  const out = [];
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: clean(m[0]) }));
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(decode(m[1].trim()), base).href;
    } catch {
      continue;
    }
    let label = clean(m[2]);
    const row = rows.find((r) => m.index >= r.start && m.index < r.end);
    if (row && (GENERIC_LINK.test(label) || label.length < 12)) label = row.text.slice(0, 240);
    out.push({ url: url.replace(/^http:\/\/(?=[^/]*\.(gov|nic)\.in)/, "https://"), label, row: row?.text ?? "" });
  }
  return out;
}

const htmlText = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|p|div|li|tr|h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

/** All dates written in a string (dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd). */
function datesIn(s) {
  const out = [];
  for (const m of s.matchAll(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/g)) out.push(new Date(+m[3], +m[2] - 1, +m[1]).getTime());
  for (const m of s.matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)) out.push(new Date(+m[1], +m[2] - 1, +m[3]).getTime());
  return out.filter((t) => !Number.isNaN(t));
}
/** A table row whose latest date has passed is a closed notice — skip it. */
const expiredRow = (row, now) => {
  const dates = datesIn(row);
  return dates.length > 0 && Math.max(...dates) < now - 86_400_000;
};

/** Titles that only mention years two or more years old are archives. */
const THIS_YEAR = new Date().getFullYear();
const onlyOldYears = (label) => {
  const years = [...label.matchAll(/20\d{2}/g)].map((m) => Number(m[0]));
  return years.length > 0 && Math.max(...years) < THIS_YEAR - 1;
};

function isNotice(a) {
  const both = `${a.label} ${a.url}`;
  const label = a.label.trim();
  if (!official(a.url) || label.length < 12 || NOT_RECRUITMENT.test(label) || NOT_JOB_TOPIC.test(label)) return false;
  if (MENU_LABEL.test(label) || onlyOldYears(label)) return false;
  // On standard district/department recruitment pages, only the notice table counts.
  if (a.templatePage && !a.row) return false;
  const isPdf = /\.pdf($|\?)/i.test(a.url);
  return (
    (isPdf && (LOOKS_LIKE_RECRUITMENT.test(both) || a.templatePage)) ||
    (/\d/.test(a.label) && LOOKS_LIKE_RECRUITMENT.test(both)) ||
    STRONG_RECRUITMENT.test(a.label)
  );
}

function withKeyLines(text) {
  const key = text
    .split(/\n+/)
    .filter((l) => /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|last date|closing|vacanc|age limit|qualification|fee|apply|advt|advertisement no/i.test(l))
    .slice(0, 80)
    .join("\n")
    .slice(0, 5000);
  return `KEY LINES:\n${key}\n\nFULL TEXT:\n${text}`.slice(0, MAX_TEXT);
}

async function readPdf(bytes) {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  let found = [];
  try {
    found = (await extractLinks(pdf)).links ?? [];
  } catch {
    found = [];
  }
  return { text: text.slice(0, 25).join("\n"), links: found };
}

/** Reads a notice: a PDF, or a page — following the page's own notice PDF if it has one. */
async function readNotice(link) {
  let { body, type, finalUrl } = await get(link.url);
  if (body instanceof Uint8Array || /pdf/i.test(type)) {
    const pdf = await readPdf(body instanceof Uint8Array ? body : new TextEncoder().encode(body));
    return { url: finalUrl, text: pdf.text, links: pdf.links };
  }
  if (new URL(finalUrl).pathname === "/" && new URL(link.url).pathname !== "/") {
    const www = new URL(link.url);
    if (!www.hostname.startsWith("www.")) {
      www.hostname = `www.${www.hostname}`;
      ({ body, type, finalUrl } = await get(www.href));
    }
  }
  const pageLinks = links(body, finalUrl);
  const pdfLink = pageLinks.find((a) => /\.pdf($|\?)/i.test(a.url) && official(a.url) && !NOT_RECRUITMENT.test(a.label));
  if (pdfLink) {
    const pdfBody = await get(pdfLink.url, { asBuffer: true });
    const pdf = await readPdf(pdfBody.body);
    return { url: pdfBody.finalUrl, text: pdf.text, links: [...pdf.links, ...pageLinks.map((a) => a.url)] };
  }
  return { url: finalUrl, text: htmlText(body), links: pageLinks.map((a) => a.url) };
}

/** Run `fn` over items, `CONCURRENCY` at a time, until the time budget runs low. */
async function pool(items, fn) {
  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length && timeLeft() > 60_000) {
      const item = items[i++];
      try {
        await fn(item);
      } catch {
        /* one site failing never stops the run */
      }
    }
  });
  await Promise.all(workers);
}

// ── 1. Registry (weekly) ─────────────────────────────────────
let registry = readJson(file(STATE, "registry.json"), null);
if (!registry || Date.now() - Date.parse(registry.updatedAt) > WEEK) {
  try {
    const fresh = await buildRegistry({ get: (u) => get(u), anchors: links, log: console.log });
    if (fresh.orgs.length > 1000) registry = fresh; // never replace a good list with a broken fetch
  } catch (error) {
    console.log(`⚠ Registry refresh failed: ${error.message}`);
  }
}
registry ??= { updatedAt: new Date(0).toISOString(), orgs: [] };
fs.writeFileSync(file(STATE, "registry.json"), JSON.stringify(registry));
official = makeOfficialCheck(registry.orgs.map((o) => o.host));

// ── 2. Find recruitment pages (probe new/stale sites) ────────
const toProbe = registry.orgs
  .filter((o) => !probes[o.host] || Date.now() - Date.parse(probes[o.host].at) > MONTH)
  .sort((a, b) => Number(RECRUITER.test(b.name)) - Number(RECRUITER.test(a.name)))
  .slice(0, PROBES_PER_RUN);
await pool(toProbe, async (org) => {
  const pages = [];
  // Government-template (S3WaaS) sites share a standard recruitment page.
  if (/\.(gov|nic)\.in$/.test(org.host)) {
    try {
      const r = await get(`${org.url}notice_category/recruitment/`, { timeout: 20_000 });
      if (typeof r.body === "string" && /notice_category|s3waas/i.test(r.body)) pages.push(r.finalUrl);
    } catch {
      /* not a template site */
    }
  }
  // Recruiting bodies: look for a Careers/Recruitment link on the home page.
  if (!pages.length && RECRUITER.test(org.name)) {
    try {
      const r = await get(org.url, { timeout: 20_000 });
      if (typeof r.body === "string") {
        const found = links(r.body, r.finalUrl)
          .filter((a) => official(a.url) && CAREER_LINK.test(a.label) && !NOT_RECRUITMENT.test(a.label) && a.label.length < 60)
          .map((a) => a.url);
        pages.push(...[...new Set(found)].slice(0, 2));
        if (!pages.length) pages.push(r.finalUrl); // the home page itself lists notices on many sites
      }
    } catch {
      /* site down — try again next month */
    }
  }
  probes[org.host] = { at: new Date().toISOString(), pages, name: org.name, state: org.state, recruiter: RECRUITER.test(org.name) };
});

// ── 3. Watch list: core sources every run; the rest in rotation ─
const core = WATCH_PAGES.map((w) => ({ url: w.url, id: w.id, name: w.name, state: "ALL" }));
const discovered = Object.entries(probes).flatMap(([host, p]) =>
  p.pages.map((url) => ({ url, id: host, name: p.name, state: p.state, recruiter: p.recruiter, template: /notice_category/.test(url) })),
);
const everyRun = discovered.filter((d) => d.recruiter || d.template);
const rotating = discovered.filter((d) => !d.recruiter && !d.template);
const slice = rotating.filter((_, i) => i % 3 === runState.run % 3);
const watch = [...core, ...everyRun, ...slice];

// ── 4. Read new notices ──────────────────────────────────────
const now = Date.now();
let saved = 0;
const report = [];
await pool(watch, async (source) => {
  if (saved >= MAX_NOTICES_PER_RUN) return;
  const page = await get(source.url, { timeout: 25_000 });
  if (typeof page.body !== "string") return;
  const recruitmentPage = /recruit|career|vacanc|notice_category/i.test(source.url);
  const templatePage = /notice_category/i.test(source.url);
  const candidates = links(page.body, page.finalUrl)
    .map((a) => ({ ...a, recruitmentPage, templatePage }))
    .filter((a) => isNotice(a) && !(a.row && expiredRow(a.row, now)));
  let perPage = 0;
  for (const link of candidates) {
    if (seen.has(link.url)) continue;
    if (perPage >= MAX_PER_PAGE || saved >= MAX_NOTICES_PER_RUN || timeLeft() < 90_000) break;
    seen.add(link.url);
    perPage++;
    try {
      const notice = await readNotice(link);
      if (!official(notice.url) || notice.text.replace(/\s+/g, "").length < 300) continue;
      const id = idOf(notice.url);
      if (index.notices.some((n) => n.id === id)) continue;
      const record = {
        id,
        url: notice.url,
        title: link.label.slice(0, 240),
        source: { id: source.id, name: source.name, pageUrl: page.finalUrl, state: source.state },
        text: withKeyLines(notice.text),
        links: [...new Set(notice.links.filter((u) => typeof u === "string" && official(u)))].slice(0, 60),
        fetchedAt: new Date().toISOString(),
      };
      fs.writeFileSync(file(NOTICES, `${id}.json`), JSON.stringify(record));
      index.notices = [{ id, url: record.url, title: record.title, source: source.id, fetchedAt: record.fetchedAt }, ...index.notices];
      saved++;
      report.push(`+ ${source.name}: ${record.title.slice(0, 120)}`);
      await sleep(400); // be gentle with government servers
    } catch (error) {
      report.push(`⚠ ${source.name}: couldn't read ${link.url} (${error.message})`);
    }
  }
});

// ── 5. Save ──────────────────────────────────────────────────
for (const old of index.notices.slice(MAX_INDEX)) fs.rmSync(file(NOTICES, `${old.id}.json`), { force: true });
index.notices = index.notices.slice(0, MAX_INDEX);
index.updatedAt = new Date().toISOString();
fs.writeFileSync(file(NOTICES, "index.json"), JSON.stringify(index));
// The server checks links against the same official list.
fs.writeFileSync(file(NOTICES, "domains.json"), JSON.stringify({ updatedAt: registry.updatedAt, hosts: registry.orgs.map((o) => o.host) }));
fs.writeFileSync(file(STATE, "read.json"), JSON.stringify([...seen].slice(-60_000)));
fs.writeFileSync(file(STATE, "probes.json"), JSON.stringify(probes));
fs.writeFileSync(file(STATE, "run.json"), JSON.stringify(runState));
// A commit every run keeps GitHub's scheduled workflow active.
fs.writeFileSync(file(STATE, "last-run.json"), JSON.stringify({ at: index.updatedAt, saved, watched: watch.length }));
console.log(report.join("\n"));
console.log(
  `\nRegistry ${registry.orgs.length} sites · probed ${toProbe.length} · watching ${watch.length} pages · ${saved} new notice(s) · ${Math.round((Date.now() - started) / 1000)}s`,
);
