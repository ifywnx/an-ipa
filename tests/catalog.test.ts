import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPublicApps, parsePublicApps, validSlug } from "../src/modules/catalog/service";
import type { PublicApp } from "../src/modules/catalog/types";
const app: PublicApp = { slug: "demo-app", title: "Ứng dụng mẫu", summary: "Mô tả kiểm thử", category: "Công cụ", developer_name: "Nhà phát triển A" };
const dbRow = { slug: app.slug, name: app.title, description: app.summary, category: app.category, developer: app.developer_name };
test("slugs are bounded to canonical database format", () => {
  for (const s of ["", "../secret", "hello world", "UPPER", "x%2fy", "a/../b", "-leading", "x".repeat(81)]) assert.equal(validSlug(s), false);
  assert.equal(validSlug("valid-app-2"), true);
});
test("public projection maps live columns and drops malformed rows", () => {
  assert.deepEqual(parsePublicApps([dbRow, {...dbRow, slug:"../../../etc/passwd"}, {slug:"ok"}]), [app]);
  assert.deepEqual(parsePublicApps([{...dbRow,name:""}]), []);
});
test("public catalog filters locally after server-side published-only query", () => {
  assert.deepEqual(filterPublicApps([app], "ỨNG DỤNG", "Công cụ"), [app]);
  assert.deepEqual(filterPublicApps([app], "không tồn tại", ""), []);
  assert.deepEqual(filterPublicApps([app], "", "Trò chơi"), []);
});
