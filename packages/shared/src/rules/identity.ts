import { MIN_AGE_YEARS } from "../constants";

/** `dob` is YYYY-MM-DD. Compares calendar dates so birthdays count from the day itself. */
export function isAdult(dob: string, now: Date = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return false;
  const cutoff = Date.UTC(now.getUTCFullYear() - MIN_AGE_YEARS, now.getUTCMonth(), now.getUTCDate());
  return parsed.getTime() <= cutoff;
}

const INSTITUTION_SUFFIXES = [".edu", ".ac.uk", ".ac.nz", ".ac.jp", ".ac.kr", ".ac.za", ".ac.in", ".ac.il", ".edu.au", ".edu.cn", ".edu.sg", ".edu.hk"];
const INSTITUTION_DOMAINS = [
  // Canada
  "uottawa.ca", "carleton.ca", "utoronto.ca", "yorku.ca", "torontomu.ca", "ryerson.ca", "ocadu.ca", "ontariotechu.ca",
  "uwaterloo.ca", "wlu.ca", "mcmaster.ca", "queensu.ca", "uwo.ca", "uoguelph.ca", "brocku.ca", "trentu.ca", "uwindsor.ca",
  "laurentian.ca", "lakeheadu.ca", "nipissingu.ca", "algomau.ca", "mcgill.ca", "umontreal.ca", "concordia.ca", "uqam.ca",
  "ulaval.ca", "usherbrooke.ca", "ubishops.ca", "polymtl.ca", "etsmtl.ca", "hec.ca", "uqo.ca", "uqtr.ca", "uqac.ca", "ubc.ca", "sfu.ca", "uvic.ca",
  "unbc.ca", "tru.ca", "viu.ca", "ucalgary.ca", "ualberta.ca", "mtroyal.ca", "macewan.ca", "uleth.ca", "athabascau.ca",
  "umanitoba.ca", "uwinnipeg.ca", "brandonu.ca", "usask.ca", "uregina.ca", "dal.ca", "smu.ca", "acadiau.ca", "stfx.ca",
  "unb.ca", "mta.ca", "umoncton.ca", "upei.ca", "mun.ca",
  // Elsewhere
  "ethz.ch", "epfl.ch", "tum.de", "lmu.de", "sciencespo.fr", "uva.nl", "ku.dk",
];

/** Returns the institution domain for an academic email, or null. A verified login proves control of the address. */
export function institutionDomain(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  if (INSTITUTION_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return domain;
  const known = INSTITUTION_DOMAINS.find((item) => domain === item || domain.endsWith(`.${item}`));
  return known ?? null;
}
