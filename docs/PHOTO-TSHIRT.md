# Custom T-shirt

Prodigi [Bella+Canvas 3001](https://www.prodigi.com/products/mens-clothing/t-shirts/classic/bella-canvas-3001/), SKU `GLOBAL-TEE-BC-3001`. Front only, one per order, $29 including US shipping plus tax. Supported colors: white, black, navy blue, orange, natural. Sizes: S, M, L, XL.

Quote evidence (2026-10-12): all five M variants returned $12 production plus $10.75 Budget shipping, US lab us20, excluding possible supplier sales tax. Variant metadata supports all offered combinations; each actual order verifies its exact variant and current quote. No shared fulfillment or carrier promise is made. Do not expand options without new US quote checks.

Proposal item example:
```json
{"product":"tshirt","photoId":"PHOTO_ID","quantity":1,"color":"orange","size":"m","fit":"contain"}
```

Both options are required; do not guess a size or color. Show `operation.summary` and its returned `previews` before confirmation. Preview is a schematic illustration of the selected color and artwork, with approximate placement. Fulfillment uses a separate 4680x5790 transparent PNG on the `front` print area. The illustration is never printed. Source photo white pixels remain white; automatic background removal is not offered.

Test with the reference client's `--tshirt --approve-demo` against sandbox, optionally `--sandbox-account`. This simulates payment and fulfillment; physical quality and garment fit require a real sample. Existing mugs are retained only for historical order rendering; new mug proposals are rejected.
