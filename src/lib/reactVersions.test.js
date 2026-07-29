import { describe, it, expect } from "vitest";
import reactPkg from "react/package.json";
import reactDomPkg from "react-dom/package.json";

// react-dom hard-codes the exact react version it was compiled against and throws
// at module-evaluation time when they differ — before createRoot() ever runs, so
// #root stays empty and every route renders a white blank page:
//
//   Uncaught Error: Minified React error #527 (args: 19.2.8, 19.2.7)
//
// This slipped through once already: Dependabot bumps react and react-dom in
// separate PRs, react-dom's peer range is the loose "^19.2.7" so npm accepts the
// pair, and nothing in CI catches it (the check is at runtime — lint, the pure
// src/lib tests, and vite build all stay green). .github/dependabot.yml now groups
// the two packages; this test is the backstop if that grouping is ever dropped.
describe("react / react-dom", () => {
  it("resolve to the exact same version", () => {
    expect(reactDomPkg.version).toBe(reactPkg.version);
  });
});
