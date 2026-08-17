# Goodfolk Hub Price — Ý tưởng & luồng

Trung tâm giá catalog cho store Shopify. App giữ `option.json` (danh mục
garment × color × size + giá) và phục vụ giá đó tới picker sản phẩm + Shopify
Function trên store.

## Ý tưởng cốt lõi

**Sản phẩm không tạo variant.** Người mua chọn Style → Color → Size trên
picker đọc catalog từ app. Khi add-to-cart, giá catalog được gửi kèm như line
properties (`_price`, `_sku`). Discount function đọc `_price` và bù discount
để khách trả **đúng giá catalog**, dù variant gốc có giá cao hơn. Vì giá nằm
trên chính cart line, function không cần network access — chạy được trên mọi
gói Shopify.

## Luồng

```
option.json ──► app /api/catalog-import ──► catalog.json (Blob/data/)
                                                 │
                                   /api/catalog ▼
        store / PDP picker: Style → Color → Size
            │ add-to-cart kèm properties:
            │   _sku, _price, Style, Color, Size
            ▼
   hub-price-discount function
        │ discount = giá line − giá catalog
        ▼
   Khách trả đúng giá catalog ✓
```

Chi tiết các bước:

1. **Publish** — upload `option.json` qua Admin UI hoặc API (Bearer `HUB_API_TOKEN`).
   App flatten thành từng SKU: `skuPattern` = `{garment}-{color}-{size}`
   (vd `G5000-ANTIQUECHERRYRED-S`).
2. **Chọn sản phẩm** — picker đọc `GET /api/catalog`, add-to-cart POST form tới
   `https://{shop}/cart/add` với `_sku`, `_price`, `Style`, `Color`, `Size`.
3. **Checkout** — discount function bù discount trên từng line có `_price`;
   discount cap 50% giá line (chống sửa `_price` tay). Kèm free shipping cho
   option ship thường.
4. **Validate** — `POST /api/price` lookup giá theo SKU (fail-closed → 404 nếu
   không tồn tại). Chưa được function gọi vì chờ Shopify xác nhận network access.

## Thành phần

| Thành phần        | Vị trí                                                         | Vai trò                                          |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Catalog service   | `app/services/catalog.server.js`                               | Normalize + lưu/đọc catalog, auth                |
| API               | `api.catalog-import.jsx` / `api.catalog.jsx` / `api.price.jsx` | Import, phục vụ catalog, lookup giá              |
| PDP page          | `app/routes/pdp.jsx`                                           | Trang chọn sản phẩm public (form POST /cart/add) |
| Admin UI          | `app/routes/app._index.jsx`                                    | Upload catalog, tạo discount                     |
| Discount function | `extensions/hub-price-discount/`                               | Bù giá catalog + free shipping                   |
| Product picker    | `extensions/product-options/`                                  | Liquid block picker trên trang product           |

## Ghi chú

- Catalog lưu `data/catalog.json` (local) / Vercel Blob (production).
- Đang dở: comment trong `option-picker.js` nhắc "hub-price-transform" (đổi giá
  thật) nhưng đường đi đang dùng là discount function — đừng chạy cả hai (double pricing).
- Local: `npm install && cp .env.example .env && npm run setup && npm run dev`.
  Env chính: `HUB_API_TOKEN`, `SHOPIFY_API_SECRET`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`.
