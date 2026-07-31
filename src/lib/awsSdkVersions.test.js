import { describe, it, expect } from "vitest";
import clientPkg from "@aws-sdk/client-s3/package.json";
import presignerPkg from "@aws-sdk/s3-request-presigner/package.json";

// api/_lib/photoStorage/r2.js hands an S3Client + command from @aws-sdk/client-s3
// straight to getSignedUrl() from @aws-sdk/s3-request-presigner, so the two walk
// the same signing middleware. AWS cuts every @aws-sdk/* package from one release
// train, but each depends on the shared internals (@aws-sdk/core,
// signature-v4-multi-region) through loose "^" ranges — so npm happily installs a
// split pair and nothing complains until a guest upload gets a presigned URL S3
// rejects. Dependabot bumped them separately for a while and they drifted to
// 3.1096.0 / 3.1091.0 before anyone noticed; lint, the pure src/lib tests and vite
// build all stayed green, because the R2 path only runs server-side with real
// credentials. .github/dependabot.yml now groups "@aws-sdk/*"; this test is the
// backstop if that grouping is ever dropped.
describe("@aws-sdk/client-s3 / @aws-sdk/s3-request-presigner", () => {
  it("resolve to the exact same version", () => {
    expect(presignerPkg.version).toBe(clientPkg.version);
  });
});
