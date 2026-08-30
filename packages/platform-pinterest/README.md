# @bozonx/social-posting-pinterest

Pinterest API v5 Pin creation for `@bozonx/social-posting`.

Use `target.id` for the board and optional `target.sectionId` for a board section. Image Pins
accept a public image URL. Video Pins accept a previously uploaded Pinterest media id as a
`platformRef` and require a thumbnail/cover. Organic carousel Pins are intentionally not
declared.

The OAuth grant needs `pins:write` and `boards:read`; live use depends on Pinterest app access.

```ts
import { pinterest } from '@bozonx/social-posting-pinterest';
```
