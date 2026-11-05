/**
 * Device-registration packages shown on the storefront pricing section.
 *
 * OWNER ACTION REQUIRED before production: `priceVnd` values are
 * PLACEHOLDERS for design review — replace them with the real prices.
 * Durations describe how long the store supports re-signing for the
 * registered device, following the store's Ad Hoc model: the owner signs
 * with LCSign, and each package covers exactly ONE device UDID.
 */
export interface RegistrationPackage {
  id: string;
  name: string;
  durationLabel: string;
  priceVnd: number;
  tagline: string;
  featured?: boolean;
  badge?: string;
  features: string[];
}

export const REGISTRATION_PACKAGES: RegistrationPackage[] = [
  {
    id: "goi-3-thang",
    name: "Khởi đầu",
    durationLabel: "3 tháng hỗ trợ",
    priceVnd: 99000,
    tagline: "Cho 1 thiết bị iPhone / iPad",
    features: [
      "Đăng ký UDID của 1 thiết bị vào hồ sơ ký",
      "Cài mọi ứng dụng trong kho qua liên kết cài đặt",
      "Hỗ trợ ký lại trong 3 tháng khi có bản ký mới",
      "Hướng dẫn cài đặt từng bước trên trang thiết bị",
      "Hỗ trợ trực tiếp từ cửa hàng",
    ],
  },
  {
    id: "goi-6-thang",
    name: "Tiêu chuẩn",
    durationLabel: "6 tháng hỗ trợ",
    priceVnd: 149000,
    tagline: "Cho 1 thiết bị iPhone / iPad",
    featured: true,
    badge: "Được chọn nhiều nhất",
    features: [
      "Đăng ký UDID của 1 thiết bị vào hồ sơ ký",
      "Cài mọi ứng dụng trong kho qua liên kết cài đặt",
      "Hỗ trợ ký lại trong 6 tháng khi có bản ký mới",
      "Ưu tiên xử lý khi có bản phát hành mới",
      "Hướng dẫn cài đặt từng bước trên trang thiết bị",
      "Hỗ trợ trực tiếp từ cửa hàng",
    ],
  },
  {
    id: "goi-12-thang",
    name: "Trọn năm",
    durationLabel: "12 tháng hỗ trợ",
    priceVnd: 199000,
    tagline: "Cho 1 thiết bị iPhone / iPad",
    features: [
      "Đăng ký UDID của 1 thiết bị vào hồ sơ ký",
      "Cài mọi ứng dụng trong kho qua liên kết cài đặt",
      "Hỗ trợ ký lại trọn 12 tháng khi có bản ký mới",
      "Ưu tiên cao nhất khi có bản phát hành mới",
      "Được nhắc trước khi hồ sơ ký sắp hết hạn",
      "Hỗ trợ trực tiếp từ cửa hàng",
    ],
  },
];

/**
 * Certificate packages (P12 + provisioning profile) for customers who
 * sign IPAs themselves with their own signing app (LCSign, ESign...).
 * Tiers differ by WARRANTY length: if Apple revokes the certificate
 * inside the warranty window, the store reissues it for free.
 *
 * OWNER ACTION REQUIRED before production: `priceVnd` values are
 * PLACEHOLDERS for design review, and the supply route (wholesale
 * reseller vs the store's own Apple Developer account) is not decided
 * yet — the storefront copy deliberately promises nothing about supply
 * timing beyond "issued after the UDID is registered".
 */
export interface CertificatePackage {
  id: string;
  name: string;
  warrantyLabel: string;
  priceVnd: number;
  tagline: string;
  featured?: boolean;
  badge?: string;
  features: string[];
}

export const CERTIFICATE_PACKAGES: CertificatePackage[] = [
  {
    id: "cert-30-ngay",
    name: "Linh hoạt",
    warrantyLabel: "Bảo hành 30 ngày",
    priceVnd: 79000,
    tagline: "Cho 1 thiết bị iPhone / iPad",
    features: [
      "File P12 + hồ sơ ký theo đúng UDID của bạn",
      "Tự ký mọi file IPA bằng LCSign, ESign, Scarlet...",
      "Bị Apple thu hồi trong 30 ngày: cấp lại miễn phí",
      "Hướng dẫn nạp chứng chỉ vào ứng dụng ký",
      "Hỗ trợ trực tiếp từ cửa hàng",
    ],
  },
  {
    id: "cert-90-ngay",
    name: "Ổn định",
    warrantyLabel: "Bảo hành 90 ngày",
    priceVnd: 129000,
    tagline: "Cho 1 thiết bị iPhone / iPad",
    featured: true,
    badge: "Được chọn nhiều nhất",
    features: [
      "File P12 + hồ sơ ký theo đúng UDID của bạn",
      "Tự ký mọi file IPA bằng LCSign, ESign, Scarlet...",
      "Bị Apple thu hồi trong 90 ngày: cấp lại miễn phí",
      "Ưu tiên cấp lại khi xảy ra thu hồi hàng loạt",
      "Hướng dẫn nạp chứng chỉ vào ứng dụng ký",
      "Hỗ trợ trực tiếp từ cửa hàng",
    ],
  },
  {
    id: "cert-365-ngay",
    name: "Lâu dài",
    warrantyLabel: "Bảo hành 365 ngày",
    priceVnd: 249000,
    tagline: "Cho 1 thiết bị iPhone / iPad",
    features: [
      "File P12 + hồ sơ ký theo đúng UDID của bạn",
      "Tự ký mọi file IPA bằng LCSign, ESign, Scarlet...",
      "Bị Apple thu hồi trong 365 ngày: cấp lại miễn phí",
      "Ưu tiên cao nhất khi xảy ra thu hồi hàng loạt",
      "Được nhắc trước khi chứng chỉ sắp hết hạn",
      "Hỗ trợ trực tiếp từ cửa hàng",
    ],
  },
];

export function formatVnd(value: number): string {
  return `${value.toLocaleString("vi-VN")}đ`;
}
