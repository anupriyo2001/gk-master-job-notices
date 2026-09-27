/**
 * The official-source registry for Government Jobs.
 *
 * A job is published only if its notification, website and apply links are
 * HTTPS links on these domains (or their sub-domains). Used by
 * scripts/jobs-publish.mjs (to reject anything else before upload) and by
 * scripts/jobs-watch.mjs (the pages it checks for new notifications).
 *
 * Add a recruiting body here only after confirming its domain from an
 * official government source (for example india.gov.in, or a ministry page).
 */

/** Any Indian government domain. */
export const GOVERNMENT_SUFFIXES = [".gov.in", ".nic.in"];

/**
 * Official bodies whose recruitment sites are not on .gov.in / .nic.in —
 * public-sector banks, PSUs, academic testing bodies — and the exam agencies
 * that host official application forms for them.
 */
export const OFFICIAL_DOMAINS = [
  // Banking & finance regulators and public-sector banks
  "ibps.in", "sbi.co.in", "sbi.bank.in", "rbi.org.in", "nabard.org", "sidbi.in",
  "bankofbaroda.in", "bank.in", "pnbindia.in", "canarabank.com", "unionbankofindia.co.in",
  "indianbank.in", "bankofindia.co.in", "centralbankofindia.co.in", "ucobank.com",
  "iob.in", "psbindia.com", "bankofmaharashtra.in", "idbibank.in", "licindia.in",
  "newindia.co.in", "nationalinsurance.nic.co.in", "orientalinsurance.org.in",
  "uiic.co.in", "gicre.in", "eximbankindia.in",
  // PSUs
  "ongcindia.com", "iocl.com", "bhel.com", "ntpc.co.in", "sail.co.in", "aai.aero",
  "bel-india.in", "hal-india.co.in", "coalindia.in", "powergrid.in", "gailonline.com",
  "bharatpetroleum.in", "hindustanpetroleum.com", "nhpcindia.com", "npcil.co.in",
  "concorindia.co.in", "rvnl.org", "ircon.org", "irctc.com", "becil.com",
  "nhai.org", "fci.gov.in", "hindustancopper.com", "nmdc.co.in", "mazagondock.in",
  "cochinshipyard.in", "grse.in", "bdl-india.in", "beml.co.in", "mecl.co.in",
  // Education & testing bodies, defence recruitment portals
  "nta.ac.in", "cdac.in", "joinindianarmy.nic.in", "joinindiannavy.gov.in",
  "joinindiancoastguard.cdac.in", "agnipathvayu.cdac.in", "kvsangathan.nic.in",
  "navodaya.gov.in", "aiims.edu", "aiimsexams.ac.in", "iitd.ac.in",
  // Exam agencies that host official application forms (TCS iON etc.)
  "digialm.com", "cbexams.com", "onlineregistrationforms.com",
];

/** Recruitment pages scripts/jobs-watch.mjs checks for new notifications. */
export const WATCH_PAGES = [
  { id: "ssc", name: "Staff Selection Commission", url: "https://ssc.gov.in/" },
  { id: "upsc", name: "Union Public Service Commission", url: "https://upsc.gov.in/examinations/active-exams" },
  { id: "ibps", name: "IBPS", url: "https://www.ibps.in/" },
  { id: "sbi", name: "State Bank of India careers", url: "https://sbi.co.in/web/careers/current-openings" },
  { id: "rbi", name: "Reserve Bank of India", url: "https://opportunities.rbi.org.in/Scripts/Vacancies.aspx" },
  { id: "rrb", name: "Railway Recruitment Boards", url: "https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,7,1281" },
  { id: "nta", name: "National Testing Agency", url: "https://nta.ac.in/" },
  { id: "army", name: "Indian Army", url: "https://joinindianarmy.nic.in/" },
  { id: "navy", name: "Indian Navy", url: "https://www.joinindiannavy.gov.in/" },
  { id: "wbpsc", name: "West Bengal PSC", url: "https://psc.wb.gov.in/" },
  { id: "bpsc", name: "Bihar PSC", url: "https://bpsc.bihar.gov.in/" },
  { id: "uppsc", name: "Uttar Pradesh PSC", url: "https://uppsc.up.nic.in/" },
  { id: "mppsc", name: "Madhya Pradesh PSC", url: "https://mppsc.mp.gov.in/" },
  { id: "rpsc", name: "Rajasthan PSC", url: "https://rpsc.rajasthan.gov.in/" },
  { id: "ncs", name: "National Career Service", url: "https://www.ncs.gov.in/" },
  { id: "indiapost-gds", name: "India Post — Gramin Dak Sevak", url: "https://indiapostgdsonline.gov.in/" },
  { id: "indiapost", name: "India Post", url: "https://www.indiapost.gov.in/VAS/Pages/Content/Recruitments.aspx" },
  { id: "dsssb", name: "Delhi Subordinate Services Selection Board", url: "https://dsssb.delhi.gov.in/" },
  { id: "rrb-kolkata", name: "Railway Recruitment Board Kolkata", url: "https://www.rrbkolkata.gov.in/" },
  { id: "army-agniveer", name: "Indian Army — Agnipath", url: "https://joinindianarmy.nic.in/" },
  { id: "airforce-agniveer", name: "Indian Air Force — Agniveervayu", url: "https://agnipathvayu.cdac.in/" },
];

/** True for an HTTPS URL on an official domain (or one of its sub-domains). */
export function isOfficialUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (GOVERNMENT_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return OFFICIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// ── Shared vocabularies (must match src/services/jobs.ts) ───────

export const SECTORS = [
  "central", "state", "ssc", "psc", "railway", "banking", "defence", "police",
  "teaching", "psu", "health", "apprentice", "other",
];

export const QUALIFICATIONS = [
  "8th", "10th", "12th", "iti", "diploma", "graduate", "postgraduate",
  "engineering", "medical", "nursing", "bed", "law", "ca", "phd",
];

/** "ALL" (all India) plus ISO 3166-2:IN state / UT codes. */
export const STATES = [
  "ALL", "AN", "AP", "AR", "AS", "BR", "CH", "CT", "DH", "DL", "GA", "GJ", "HP",
  "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL",
  "OR", "PB", "PY", "RJ", "SK", "TG", "TN", "TR", "UP", "UT", "WB",
];

export const JOB_STATUSES = ["upcoming", "open", "extended", "closed", "cancelled"];
