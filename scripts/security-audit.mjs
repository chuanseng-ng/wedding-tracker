#!/usr/bin/env node
// CI dependency-audit gate.
//
// Replaces a bare `npm audit --audit-level=high` so we can keep failing the
// build on real high/critical advisories while carrying a small, DOCUMENTED
// allowlist for advisories that provably do not apply to this app. Zero
// dependencies on purpose — a security gate should not add its own supply-chain
// surface just to suppress one finding.
//
// To allowlist an advisory: add its GHSA id below with a concrete reason and a
// revisit condition. Anything else at `high`/`critical` fails the build. If an
// allowlisted advisory stops appearing (upstream shipped a fix), the script
// warns so the entry can be removed.

import { execSync } from "node:child_process";

// GHSA id → why it is safe to ignore here. Keep this list short and honest.
const ALLOWLIST = {
  // react-router / react-router-dom "RSC Mode CSRF Bypass" (GHSA-qwww-vcr4-c8h2).
  // The flaw only affects apps using react-router's unstable React Server
  // Components APIs. This is a client-side SPA rendered with <BrowserRouter>
  // (src/main.jsx) and uses none of the RSC/data-router APIs, so it is not
  // exploitable here. There is no patched 7.x; the only fix is a major upgrade
  // to react-router v8.3.0. Revisit when migrating to react-router v8.
  "GHSA-qwww-vcr4-c8h2":
    "react-router RSC-mode CSRF; not exploitable in a <BrowserRouter> SPA (no RSC APIs). No 7.x fix — revisit on the v8 upgrade.",
};

const BLOCKING = new Set(["high", "critical"]);

function runAudit() {
  try {
    // Exits 0 when there are no vulnerabilities.
    return execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities exist, but still prints the
    // JSON report to stdout — that is the normal path here.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

const report = JSON.parse(runAudit());

// Collect unique advisories from every vulnerability's `via` entries. Object
// `via` entries are concrete advisories (with a GHSA url); string entries are
// just "vulnerable because it depends on <pkg>" links and carry no id of their
// own, so the advisory is always caught on the package that actually bears it.
const advisories = new Map(); // ghsaId -> { title, severity, module, url }
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !via.url) continue;
    const id = via.url.split("/").pop();
    advisories.set(id, { title: via.title, severity: via.severity, module: via.name, url: via.url });
  }
}

const blocking = [...advisories.entries()].filter(([, a]) => BLOCKING.has(a.severity));
const unallowed = blocking.filter(([id]) => !(id in ALLOWLIST));
const allowedSeen = blocking.filter(([id]) => id in ALLOWLIST).map(([id]) => id);

// Warn about allowlist entries that no longer match anything (likely fixed).
for (const id of Object.keys(ALLOWLIST)) {
  if (!advisories.has(id)) {
    console.warn(`⚠️  Allowlisted advisory ${id} is no longer reported — remove it from scripts/security-audit.mjs.`);
  }
}

if (allowedSeen.length) {
  console.log("Allowlisted advisories (not exploitable in this app):");
  for (const id of allowedSeen) console.log(`  • ${id} — ${ALLOWLIST[id]}`);
}

if (unallowed.length) {
  console.error(`\n✖ ${unallowed.length} un-allowlisted high/critical advisory(ies):`);
  for (const [id, a] of unallowed) {
    console.error(`  • [${a.severity}] ${a.module}: ${a.title} (${id})\n    ${a.url}`);
  }
  console.error("\nFix the dependency, or (only if it genuinely does not apply) add it to the allowlist with a reason.");
  process.exit(1);
}

console.log("\n✔ Dependency audit passed (no un-allowlisted high/critical advisories).");
