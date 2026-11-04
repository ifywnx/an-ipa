import Link from "next/link";

/**
 * Pre-install checklist + FAQ for app detail pages. Original copy written
 * for this store's Ad Hoc model: the owner signs with LCSign on their own
 * iPhone, every customer's UDID must be inside the provisioning profile,
 * and "downloadable" is not the same as "installable".
 */
export function InstallChecklist() {
  return <div className="panel">
    <h2>Trước khi cài — kiểm tra nhanh</h2>
    <ol>
      <li><strong>Mở trang này bằng Safari</strong> trên đúng chiếc iPhone/iPad sẽ cài app. Liên kết cài đặt (itms-services) chỉ hoạt động trong Safari; Chrome và trình duyệt trong ứng dụng khác sẽ không cài được.</li>
      <li><strong>Bật Developer Mode nếu máy chạy iOS 16 trở lên:</strong> Cài đặt → Quyền riêng tư &amp; Bảo mật → Developer Mode → bật và khởi động lại máy. Thiếu bước này app sẽ báo không mở được sau khi cài.</li>
      <li><strong>UDID đã gửi phải là của chính máy này.</strong> App chỉ cài được khi UDID của máy nằm trong provisioning profile của bản IPA đã ký. Gửi UDID của máy khác, hoặc đổi máy sau khi gửi, thì bản cài sẽ bị iOS từ chối.</li>
      <li><strong>Đọc trước chính sách thu hồi và hết hạn</strong> (<Link href="/policies/refund-warranty">đổi trả / bảo hành</Link>): chứng chỉ và profile có thể hết hạn hoặc bị Apple thu hồi; khi đó app đã cài có thể ngừng mở cho tới khi có bản ký mới.</li>
    </ol>
  </div>;
}

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Vì sao cửa hàng cần UDID của máy tôi?",
    a: "Các bản IPA ở đây được phân phối theo hình thức Ad Hoc. Apple chỉ cho phép cài lên những thiết bị có UDID nằm trong provisioning profile đi kèm bản ký. Không có UDID của máy bạn trong profile, iOS sẽ từ chối cài đặt — đây là giới hạn của Apple, không phải của cửa hàng. UDID chỉ dùng để đăng ký thiết bị và tạo profile; cửa hàng không cần (và không bao giờ hỏi) mật khẩu Apple ID của bạn.",
  },
  {
    q: "Tải được file IPA có nghĩa là cài được, đúng không?",
    a: "Không. Tải xuống chỉ là lấy file về máy. Cài đặt thành công còn cần: UDID của máy có trong profile, chữ ký còn hiệu lực, profile chưa hết hạn và chưa bị thu hồi. Vì vậy cửa hàng chỉ mở liên kết cài đặt sau khi máy chủ đã kiểm tra đủ các điều kiện này cho đúng thiết bị của bạn.",
  },
  {
    q: "Khi profile hết hạn thì app đã cài có sao không?",
    a: "Khi profile hết hạn (hoặc bị Apple thu hồi), app có thể ngừng mở. Cách xử lý là chờ bản IPA được ký lại với profile mới rồi cài đè lên bản cũ — dữ liệu trong app thường vẫn giữ nguyên nếu bạn không xóa app. Thời hạn còn lại của profile luôn được kiểm tra trước mỗi lần cấp liên kết cài đặt mới.",
  },
  {
    q: "Tôi đổi iPhone/iPad mới thì có dùng tiếp được không?",
    a: "Máy mới có UDID khác, nên cần gửi UDID của máy mới và chờ UDID đó được đăng ký với Apple và đưa vào profile, sau đó IPA phải được ký lại. Apple giới hạn số thiết bị đăng ký mỗi năm cho mỗi loại thiết bị, nên việc đổi máy có thể cần thời gian xử lý — hãy gửi UDID máy mới sớm thay vì đợi tới lúc cần cài gấp.",
  },
];

export function InstallFaq() {
  return <div className="panel">
    <h2>Câu hỏi thường gặp</h2>
    {FAQ.map((item) => <div key={item.q}>
      <h3>{item.q}</h3>
      <p>{item.a}</p>
    </div>)}
  </div>;
}
