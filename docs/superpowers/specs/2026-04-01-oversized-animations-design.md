# Oversized Animation Support

## Overview

Add full-pipeline support for oversized/custom animations (128x128 and 192x192 frames) to the character sprite generator. This includes database ingestion of custom animation definitions, backend rendering into expanded spritesheets, API metadata for animation coverage, and test page display.

Currently, the frontend (`custom-animations.js`) defines 13 custom animations with frame sizes of 64, 128, or 192 pixels. Items (primarily weapons) reference these via `custom_animation` on their layers. The backend stores this reference but skips rendering entirely. This design closes that gap.

## Database Schema

### New Table: `custom_animations`

| Column | Type | Description |
|--------|------|-------------|
| id | Integer PK | Auto-increment |
| name | String(100), unique | e.g. `slash_oversize`, `thrust_128` |
| frame_size | Integer | 64, 128, or 192 |
| num_directions | Integer | Typically 4 (N/W/S/E) |
| num_frames | Integer | Frames per direction |

### New Table: `custom_animation_frames`

| Column | Type | Description |
|--------|------|-------------|
| id | Integer PK | Auto-increment |
| custom_animation_id | FK -> custom_animations | Parent definition |
| direction_index | Integer | 0=N, 1=W, 2=S, 3=E |
| frame_index | Integer | Position in frame sequence |
| source_animation | String(50) | Standard animation name (e.g. `slash`) |
| source_direction | String(10) | `n`, `w`, `s`, `e` |
| source_frame | Integer | Column index in the standard animation row |

The frame mapping defines: "for frame N of direction D in custom animation X, pull from standard animation row Y, column Z, and center it within the larger frame."

The existing `item_layers.custom_animation` column (already in the schema) links items to these definitions.

## Ingestion (`ingest_lpc_data.py`)

1. **Parse `custom-animations.js`** from the mounted generator volume. The file contains a clean JS object literal — extract using regex or simple parser.
2. **Create `custom_animations` records** for each definition (name, frame_size, derived num_directions and num_frames).
3. **Create `custom_animation_frames` records** by parsing frame reference strings. Format is `"animation-direction,frameIndex"` (e.g. `"slash-n,2"` -> source_animation=`slash`, source_direction=`n`, source_frame=`2`).
4. **Run before the animation scanner** so `animation_scanner.py` can use custom animation definitions to detect oversized animation support per item.
5. **Follows existing skip pattern** — data persists to Postgres, ingestion skips if data already exists. Only re-ingest when LPC asset definitions change.

### Animation Scanner Updates

Replace the empty `CUSTOM_TO_STANDARD = {}` with a DB-driven lookup. The scanner queries `custom_animations` + `custom_animation_frames` to know which custom animations exist and what source animations they reference, then verifies sprite files exist for those item layers.

## Sprite Rendering (`sprite_generator.py`)

1. **Render standard grid first** — 832x3392 canvas with 64x64 frames (unchanged).
2. **Determine needed custom animations** — query `item_layers.custom_animation` for all selected items to find which custom animations are referenced.
3. **Expand canvas** — append each custom animation below the standard grid. Canvas height grows by `frame_size * num_directions` per custom animation. Canvas width expands if `frame_size * num_frames > 832`.
4. **Composite oversized frames** — for each frame in the custom animation:
   - The frame mapping says which standard animation row/column to reference (e.g. `slash-n, frame 2`)
   - For each item layer that declares this custom_animation, load the sprite image from that layer's own sprite path (e.g. `weapon/blunt/flail/attack_slash/`)
   - Extract the 64x64 region corresponding to the source row/column
   - Composite all layers in z_pos order onto a frame_size x frame_size canvas, centered (offset = `(frame_size - 64) / 2`)
5. **Track layout** — record the y_offset, frame_size, num_frames, and num_directions for each rendered custom animation. This becomes API metadata.

Output: single PNG with standard spritesheet on top, oversized animations appended below.

## API Metadata

### `/generate-sprite` Response

Returns PNG with `X-Character-Data` JSON header extended to include:

```json
{
  "selections": {},
  "custom_animations": {
    "slash_oversize": {
      "y_offset": 3392,
      "frame_size": 192,
      "num_frames": 6,
      "num_directions": 4
    }
  },
  "animation_coverage": {
    "slash": {"standard": true, "oversized": "slash_oversize"},
    "thrust": {"standard": false, "oversized": "thrust_oversize"},
    "walk": {"standard": true, "oversized": null}
  }
}
```

- `custom_animations`: layout info for reading the expanded spritesheet
- `animation_coverage`: per-animation breakdown — whether standard sprites exist, and which oversized variant (if any) is available. This is the weapon visibility metadata: consumers can see which items are blank in the standard grid and need the oversized version.

### `/supported-animations` Response

Extended to include per-item breakdown: which items have standard sprites, which only have oversized, which have both.

### `/random-character` Response

Includes the same `custom_animations` and `animation_coverage` metadata so the test page can read the spritesheet correctly.

## Test Page (`/test-characters`)

1. **Preview area** — fixed size accommodating 192x192 frames. Standard 64x64 animations render centered with padding.
2. **Animation controls** — badges gain a new state for "oversized available" (distinct color from green/red/orange). When an animation has an oversized variant, provide a way to toggle between standard and oversized views.
3. **Frame extraction** — extended to extract frames at the correct frame_size from the appended section of the spritesheet, using `custom_animations` metadata (y_offset, frame_size) from the API response.
4. **Playback** — oversized frames play at native size within the fixed preview area.
5. **Animation coverage display** — shows which animations have standard sprites, oversized only, or both, for verifying weapon visibility metadata.
