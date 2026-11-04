/**
 * Every policy page is a DRAFT until the store owner approves the legal
 * wording. This banner is part of that contract: do not remove it from a
 * page whose content has not been owner-approved.
 */
export function PolicyDraftNotice() {
  return <div className="panel notice" role="note">
    <h2>Bản nháp — chưa có hiệu lực</h2>
    <p>Trang này là <strong>bản nháp</strong> do hệ thống soạn sẵn để chủ cửa hàng rà soát. Nội dung chỉ chính thức áp dụng sau khi chủ sở hữu duyệt nội dung pháp lý và gỡ bỏ thông báo này. Trong thời gian chờ duyệt, các thỏa thuận cụ thể khi bạn liên hệ mua hàng trực tiếp với cửa hàng vẫn là căn cứ chính.</p>
  </div>;
}
