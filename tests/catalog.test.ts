import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPublicApps, parsePublicApps, validSlug } from "../src/modules/catalog/service";
import type { PublicApp } from "../src/modules/catalog/types";

const app: PublicApp = { slug: "demo-app", title: "Ứng dụng mẫu", summary: "Mô tả kiểm thử", category: "Công cụ", developer_name: "Nhà phát triển A" };
test("catalog refuses invalid slugs", () => {
  for (const s of ["", "../secret", "hello world", "UPPER", "x%2fy", "a/../b", "-leading"]) assert.equal(validSlug(s), false);
  assert.equal(validSlug("valid-app-2"), true);
});
test("public projection discards malformed rows", () => {
  assert.deepEqual(parsePublicApps([{...app}, {slug:"../../../etc/passwd", title:"x",summary:"x",category:"x",developer_name:"x"}, {slug:"ok"}]), [app]);
});
test("catalog search and categories are case insensitive and bounded", () => {
  assert.deepEqual(filterPublicApps([app], "ỨNG DỤNG", "Công cụ"), [app]);
  assert.deepEqual(filterPublicApps([app], "không tồn tại", ""), []);
  assert.deepEqual(filterPublicApps([app], "", "Trò chơi"), []);
});
