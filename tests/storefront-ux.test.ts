import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");

test("app detail pages carry the pre-install checklist and FAQ", () => {
  const guide = read("src/components/install-guide.tsx");
  assert.match(guide, /Safari/);
  assert.match(guide, /Developer Mode/);
  assert.match(guide, /iOS 16/);
  assert.match(guide, /UDID.*chính máy này|chính máy này/);
  for (const question of [
    "Vì sao cửa hàng cần UDID",
    "Tải được file IPA",
    "profile hết hạn",
    "đổi iPhone",
  ]) assert.match(guide, new RegExp(question), question);
  const detail = read("src/app/apps/[slug]/page.tsx");
  assert.match(detail, /InstallChecklist/);
  assert.match(detail, /InstallFaq/);
});

test("customer devices page is honest about both storage scopes and reuses the intake APIs", () => {
  const page = read("src/app/devices/page.tsx");
  assert.match(page, /\/api\/devices\/manual/);
  assert.match(page, /\/api\/account\/devices/);
  assert.match(page, /trình duyệt này/);
  assert.match(page, /pending_unverified/);
  // Guests are told plainly that storage is browser-bound, with the account
  // option offered instead of the old (now false) "no customer accounts".
  assert.match(page, /Đăng ký tài khoản để không mất dấu thiết bị/);
  assert.doesNotMatch(page, /chưa có tài khoản khách hàng/);
  // An account must never be presented as device verification.
  assert.match(page, /tài khoản không tự làm thiết bị đủ điều kiện cài IPA/);
});

test("admin quota panel shows real-data wiring and an explicit unconnected state", () => {
  const page = read("src/app/admin/udids/page.tsx");
  assert.match(page, /loadAppleQuotaSummary/);
  assert.match(page, /UNCONNECTED_APPLE_QUOTA/);
  assert.match(page, /Chưa nối dữ liệu Apple/);
  assert.match(page, /100 \/ loại \/ năm|trần 100/);
});

test("all three policy pages are real drafts with an unmissable draft banner", () => {
  const notice = read("src/components/policy-draft-notice.tsx");
  assert.match(notice, /BẢN NHÁP|Bản nháp/);
  assert.match(notice, /chưa có hiệu lực/);
  for (const page of ["terms", "privacy", "refund-warranty"]) {
    const source = read("src/app/policies/" + page + "/page.tsx");
    assert.match(source, /PolicyDraftNotice/, page);
    assert.ok(source.length > 1500, page + " must be a real document, not a placeholder");
  }
  const privacy = read("src/app/policies/privacy/page.tsx");
  assert.match(privacy, /Xử lý UDID/);
  assert.match(privacy, /Xóa theo yêu cầu/);
  assert.match(privacy, /mật khẩu Apple ID/);
  const layout = read("src/app/layout.tsx");
  for (const href of ["/policies/terms", "/policies/privacy", "/policies/refund-warranty"]) {
    assert.match(layout, new RegExp('href="' + href + '"'), href);
  }
});
