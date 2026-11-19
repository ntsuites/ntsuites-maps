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

console.log("\nDone. No values were printed, only names and counts.");
