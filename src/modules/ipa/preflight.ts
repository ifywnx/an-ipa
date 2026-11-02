/** UI-only preflight, NOT archive parsing, signature verification or an upload. */
export const MAX_IPA_BYTES = 500 * 1024 * 1024;
export type IpaPreflight = { ok: boolean; detail: string };
export function preflightIpa(name: string, size: number, magic: Uint8Array): IpaPreflight {
  if (!/^[^/\\]+\.ipa$/i.test(name) || name.length > 255)
    return { ok: false, detail: "Chỉ chấp nhận tệp có đuôi .ipa." };
  if (!Number.isSafeInteger(size) || size < 4 || size > MAX_IPA_BYTES)
    return { ok: false, detail: "Dung lượng IPA phải từ 4 byte tới tối đa 500 MiB." };
  if (magic.length < 4 || magic[0] !== 0x50 || magic[1] !== 0x4b ||
      magic[2] !== 0x03 || magic[3] !== 0x04)
    return { ok: false, detail: "Tệp không có header ZIP/IPA hợp lệ để kiểm tra sơ bộ." };
  return { ok: true, detail: "Header và dung lượng đạt kiểm tra sơ bộ trên thiết bị. Chưa upload hoặc xác minh chữ ký." };
}
