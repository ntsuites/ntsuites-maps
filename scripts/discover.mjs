// Connection test for the NTsuites maps project.
// Logs in to OfficeRnD with the repo secrets and prints ONLY the shape of the data:
// counts, location/floor/type names, and field NAMES. It never prints tenant data,
// prices, codes or any other values, because this repo's run logs are public.

const ORG = process.env.OFFICERND_ORG;
const CLIENT_ID = process.env.OFFICERND_CLIENT_ID;
const CLIENT_SECRET = process.env.OFFICERND_CLIENT_SECRET;
const SCOPES = [
  "flex.space.locations.read",
  "flex.space.floors.read",
  "flex.space.resources.read",
  "flex.space.resourceTypes.read",
  "flex.community.memberships.read",
  "flex.space.assignments.read",
].join(" ");
const API = `https://app.officernd.com/api/v2/organizations/${ORG}`;

if (!ORG || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing one of the secrets: OFFICERND_ORG, OFFICERND_CLIENT_ID, OFFICERND_CLIENT_SECRET");
  process.exit(1);
}

async function getToken() {
  const res = await fetch("https://identity.officernd.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: SCOPES,
    }),
  });
  if (!res.ok) {
    console.error(`Login to OfficeRnD failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  console.log(`Login OK. Token valid for ${body.expires_in} seconds.`);
  return body.access_token;
}

async function getAll(token, path) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${API}/${path}`);
    url.searchParams.set("$limit", "50");
    if (cursor) url.searchParams.set("$cursorNext", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.log(`  ${path}: HTTP ${res.status} (permission missing or wrong path)`);
      return null;
    }
    const body = await res.json();
    const batch = Array.isArray(body) ? body : body.results ?? body.data ?? [];
    items.push(...batch);
    cursor = Array.isArray(body) ? null : body.cursorNext ?? null;
    if (!cursor || batch.length === 0) break;
  }
  return items;
}

function keysOf(items, field) {
  const keys = new Set();
  for (const it of items) {
    const obj = field ? it?.[field] : it;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) Object.keys(obj).forEach((k) => keys.add(k));
  }
  return [...keys].sort();
}

function countBy(items, fn) {
  const counts = {};
  for (const it of items) {
    const k = String(fn(it) ?? "(none)");
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

const token = await getToken();

const locations = (await getAll(token, "locations")) ?? [];
console.log(`\nLOCATIONS (${locations.length}):`);
for (const l of locations) console.log(`  - ${l.name}`);

const floors = (await getAll(token, "floors")) ?? [];
console.log(`\nFLOORS (${floors.length}):`);
for (const f of floors) console.log(`  - ${f.name}`);

const types = (await getAll(token, "resource-types")) ?? [];
console.log(`\nRESOURCE TYPES (${types.length}):`);
for (const t of types) console.log(`  - ${t.title ?? t.name ?? t.type}`);

const resources = (await getAll(token, "resources")) ?? [];
console.log(`\nRESOURCES (${resources.length})`);
console.log(`  Field names: ${keysOf(resources).join(", ")}`);
for (const nested of ["properties", "customProperties", "price", "size", "availability"]) {
  const k = keysOf(resources, nested);
  if (k.length) console.log(`  Field names inside "${nested}": ${k.join(", ")}`);
}
console.log("  Count by type:", JSON.stringify(countBy(resources, (r) => r.type)));
console.log("  Count by status:", JSON.stringify(countBy(resources, (r) => r.status)));

const memberships = (await getAll(token, "memberships")) ?? [];
console.log(`\nMEMBERSHIPS (${memberships.length})`);
console.log(`  Field names: ${keysOf(memberships).join(", ")}`);
console.log("  Count by status:", JSON.stringify(countBy(memberships, (m) => m.status)));

// ---- Occupancy from assignments (suite <-> membership links) ----
// Only suite numbers, prices, sizes and dates are printed below: the same
// information the public website already shows. No tenant data.
async function getAssignments(token, resourceIds) {
  const out = [];
  for (let i = 0; i < resourceIds.length; i += 40) {
    const ids = resourceIds.slice(i, i + 40);
    let cursor = null;
    for (let page = 0; page < 50; page++) {
      const url = new URL(`${API}/assignments`);
      url.searchParams.set("resource[$in]", ids.join(","));
      url.searchParams.set("$limit", "50");
      if (cursor) url.searchParams.set("$cursorNext", cursor);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        console.log(`  assignments: HTTP ${res.status}`);
        return null;
      }
      const body = await res.json();
      const batch = body.results ?? [];
      out.push(...batch);
      cursor = body.cursorNext ?? null;
      if (!cursor || batch.length === 0) break;
    }
  }
  return out;
}

const day = (d) => (d ? String(d).slice(0, 10) : null);
const today = new Date().toISOString().slice(0, 10);
const suites = resources.filter((r) => r.type === "salonspace" || r.type === "team_room");
const assignments = await getAssignments(token, suites.map((r) => r._id));

if (assignments) {
  console.log(`\nASSIGNMENTS (${assignments.length})`);
  console.log(`  Field names: ${keysOf(assignments).join(", ")}`);

  const byResource = {};
  for (const a of assignments) (byResource[a.resource] ??= []).push(a);

  function statusOf(r) {
    const list = byResource[r._id] ?? [];
    const current = list.filter((a) => day(a.startDate) <= today && (!a.endDate || day(a.endDate) >= today));
    const future = list.filter((a) => day(a.startDate) > today);
    if (current.length) {
      const openEnded = current.some((a) => !a.endDate);
      const ends = openEnded ? null : current.map((a) => day(a.endDate)).sort().at(-1);
      return { status: future.length ? "occupied, then reserved" : ends ? "occupied until " + ends : "occupied (no end date)", ends };
    }
    if (future.length) return { status: "available, reserved from " + future.map((a) => day(a.startDate)).sort()[0] };
    return { status: "available now" };
  }

  const summary = {};
  for (const r of suites) {
    const s = statusOf(r).status.replace(/ until .*| from .*/, "");
    const key = `${r.type} / ${s}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  console.log("\nSTATUS SUMMARY (suites only, as of " + today + "):");
  for (const [k, v] of Object.entries(summary).sort()) console.log(`  ${k}: ${v}`);

  const floor751 = floors.find((f) => /751/.test(f.name));
  if (floor751) {
    console.log(`\nSOUTHLAKE 751 SUITES (for comparison with the current website map):`);
    const rows = suites
      .filter((r) => r.floor === floor751._id)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const r of rows) {
      const p = r.properties ?? {};
      const dims = p.Length && p.Width ? `${p.Width}x${p.Length}` : "no dims";
      const price = typeof r.price === "object" ? JSON.stringify(r.price) : r.price;
      console.log(`  ${r.name.padEnd(7)} | area ${r.area ?? "?"} | size ${r.size ?? "?"} | ${dims} | price ${price} | ${statusOf(r).status}`);
    }
  }
}

console.log("\nDone. No tenant names, codes or contact details were printed.");
