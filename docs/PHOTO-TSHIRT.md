# Custom T-shirt

The UI is available only at the unlinked `/shirt` page. It is not promoted in the homepage or FAQ.

Prodigi [Bella+Canvas 3001](https://www.prodigi.com/products/mens-clothing/t-shirts/classic/bella-canvas-3001/), SKU `GLOBAL-TEE-BC-3001`. Front only, up to 20 per order. $29 for the first and $17 per additional shirt, including US shipping plus tax. Sizes and colors can be mixed. Supported colors: white, black, navy blue, orange, natural. Sizes: S, M, L, XL.

Quote evidence (2026-10-12): all five M variants returned $12 production plus $10.75 Budget shipping, US lab us20, excluding possible supplier sales tax. Variant metadata supports all offered combinations; each actual order verifies its exact variant and current quote. No shared fulfillment or carrier promise is made. Do not expand options without new US quote checks.

Use one item for each photo/color/size/fit combination; quantity is the number of that size. Gather all quantities together. Proposal items example:
```json
[{"product":"tshirt","photoId":"PHOTO_ID","quantity":2,"color":"orange","size":"m","fit":"contain"}, {"product":"tshirt","photoId":"PHOTO_ID","quantity":1,"color":"black","size":"xl","fit":"contain"}]
```

Both options are required; do not guess a size or color. Show `operation.summary` and its returned `previews` before confirmation. Preview is a schematic illustration of the selected color and artwork, with approximate placement. Fulfillment uses a separate 4680x5790 transparent PNG on the `front` print area. The illustration is never printed. Source photo white pixels remain white; automatic background removal is not offered.

Test with the reference client's `--tshirt --approve-demo` against sandbox, optionally `--sandbox-account`. This simulates payment and fulfillment; physical quality and garment fit require a real sample. Existing mugs are retained only for historical order rendering; new mug proposals are rejected.

## Required preview approval

Show every `operation.terms.previews` shirt mockup with its photo, color, size and quantity. Ask the user to explicitly approve print appearance/placement and the order terms together. After approval call `approveShirtPreviews` (`POST /api/operations/{id}/shirt-previews`):

```json
{"revision":1,"approved_by":"user","previewIds":["RETURNED_SHIRT_PREVIEW_ID_1","RETURNED_SHIRT_PREVIEW_ID_2"]}
```

Then call normal `confirmOperation`. The server rejects checkout with `shirt_preview_approval_required` until this attestation is stored for the exact revision and all shirt previews. Missing, duplicate, foreign or stale preview IDs are rejected. Any changed choices require a new proposal and fresh approval. This applies to native Poppy and compatibility sessions; it is a Print with Poppy API, not a new protocol field. The agent attests to explicit human approval; the server cannot independently prove that a person viewed an image.

## Multi-shirt quotes

Live Prodigi Budget US quotes, October 12, 2026, split across black/M and orange/XL, all routed to US lab us20. Supplier costs exclude possible supplier sales tax. Pricing retains the existing live contribution guard, supplier tax allowance and Stripe fees.

| Shirts | Supplier production + shipping | Customer price before tax | Average per shirt |
| --- | --- | --- | --- |
| 1 | $22.75 | $29 | $29 |
| 2 | $37 | $46 | $23 |
| 3 | $51.25 | $63 | $21 |
| 5 | $79.75 | $97 | $19.40 |
| 10 | $151 | $182 | $18.20 |
| 20 | $293.50 | $352 | $17.60 |

The sandbox reference `--tshirt` case orders two orange M shirts and one black XL, records preview approval and exercises payment, fulfillment, order status and captured emails. It never orders physical shirts.
