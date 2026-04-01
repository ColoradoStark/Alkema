# Oversized Animation Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-pipeline support for oversized/custom animations (128px and 192px frames) — from DB ingestion through backend rendering to test page display.

**Architecture:** Parse `custom-animations.js` definitions into two new Postgres tables (`custom_animations`, `custom_animation_frames`). Extend `sprite_generator.py` to append oversized animation sections below the standard 3392px canvas. Extend API responses with layout metadata and animation coverage info. Update the test page to extract and play oversized frames.

**Tech Stack:** Python/SQLAlchemy (models + ingestion), Pillow (rendering), FastAPI (endpoints), vanilla JS/Canvas (test page)

---

### Task 1: Add Database Models for Custom Animations

**Files:**
- Modify: `API-Character-Sprite-Generator/models.py`

- [ ] **Step 1: Add CustomAnimation and CustomAnimationFrame models to models.py**

Add after the `Animation` class (line 149):

```python
class CustomAnimation(Base):
    __tablename__ = 'custom_animations'

    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    frame_size = Column(Integer, nullable=False)  # 64, 128, or 192
    num_directions = Column(Integer, nullable=False)  # typically 4
    num_frames = Column(Integer, nullable=False)  # frames per direction

    frames = relationship("CustomAnimationFrame", back_populates="custom_animation", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_custom_animations_name', 'name'),
    )


class CustomAnimationFrame(Base):
    __tablename__ = 'custom_animation_frames'

    id = Column(Integer, primary_key=True)
    custom_animation_id = Column(Integer, ForeignKey('custom_animations.id', ondelete='CASCADE'), nullable=False)
    direction_index = Column(Integer, nullable=False)  # 0=N, 1=W, 2=S, 3=E
    frame_index = Column(Integer, nullable=False)  # position in sequence
    source_animation = Column(String(50), nullable=False)  # e.g. 'slash'
    source_direction = Column(String(10), nullable=False)  # 'n', 'w', 's', 'e'
    source_frame = Column(Integer, nullable=False)  # column index in standard row

    custom_animation = relationship("CustomAnimation", back_populates="frames")

    __table_args__ = (
        UniqueConstraint('custom_animation_id', 'direction_index', 'frame_index', name='uq_custom_anim_frame'),
        Index('idx_custom_anim_frames_anim', 'custom_animation_id'),
    )
```

- [ ] **Step 2: Add the new models to the import in models.py and verify init_database still works**

The `init_database()` function calls `Base.metadata.create_all(engine)` which will auto-create the new tables. No changes needed to that function, but verify the models are importable:

```bash
cd API-Character-Sprite-Generator && python -c "from models import CustomAnimation, CustomAnimationFrame; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add API-Character-Sprite-Generator/models.py
git commit -m "feat: add CustomAnimation and CustomAnimationFrame DB models"
```

---

### Task 2: Ingest Custom Animation Definitions from JS

**Files:**
- Modify: `API-Character-Sprite-Generator/ingest_lpc_data.py`

- [ ] **Step 1: Add the JS parser function to ingest_lpc_data.py**

Add this import at the top of the file (after `import re` — add `import re` if not present):

```python
import re
```

Add this function before the `LPCDataIngester` class:

```python
CUSTOM_ANIMATIONS_PATH = "/generator/sources/custom-animations.js"
if not os.path.exists(CUSTOM_ANIMATIONS_PATH):
    CUSTOM_ANIMATIONS_PATH = "../Universal-LPC-Spritesheet-Character-Generator/sources/custom-animations.js"


def parse_custom_animations_js(file_path: str) -> Dict[str, Dict]:
    """
    Parse custom-animations.js and extract custom animation definitions.

    Returns dict like:
    {
        'slash_oversize': {
            'frame_size': 192,
            'frames': [
                [('slash', 'n', 0), ('slash', 'n', 1), ...],  # direction 0 (N)
                [('slash', 'w', 0), ('slash', 'w', 1), ...],  # direction 1 (W)
                ...
            ]
        },
        ...
    }
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract the customAnimations object block
    match = re.search(r'const\s+customAnimations\s*=\s*\{', content)
    if not match:
        raise ValueError("Could not find customAnimations in JS file")

    # Find the matching closing brace by counting braces
    start = match.start()
    brace_count = 0
    obj_start = None
    for i in range(match.end() - 1, len(content)):
        if content[i] == '{':
            brace_count += 1
            if obj_start is None:
                obj_start = i
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                obj_end = i + 1
                break

    obj_text = content[obj_start:obj_end]

    # Parse individual animation entries using regex
    # Pattern: name: { frameSize: N, frames: [[...], ...] }
    results = {}
    # Match each animation key and its block
    anim_pattern = re.compile(
        r'(\w+)\s*:\s*\{[^}]*?frameSize\s*:\s*(\d+)\s*,'
        r'[^}]*?frames\s*:\s*\[(.*?)\]\s*\}',
        re.DOTALL
    )

    for m in anim_pattern.finditer(obj_text):
        name = m.group(1)
        frame_size = int(m.group(2))
        frames_text = m.group(3)

        # Parse each direction row: [...], [...], ...
        directions = []
        row_pattern = re.compile(r'\[(.*?)\]', re.DOTALL)
        for row_match in row_pattern.finditer(frames_text):
            row_text = row_match.group(1)
            # Parse frame references: "slash-n,2"
            frame_refs = re.findall(r'"([^"]+)"', row_text)
            parsed_frames = []
            for ref in frame_refs:
                # Format: "animation-direction,frameIndex"
                anim_dir, frame_idx = ref.rsplit(',', 1)
                anim_name, direction = anim_dir.rsplit('-', 1)
                parsed_frames.append((anim_name, direction, int(frame_idx)))
            if parsed_frames:
                directions.append(parsed_frames)

        if directions:
            results[name] = {
                'frame_size': frame_size,
                'frames': directions,
            }

    return results
```

- [ ] **Step 2: Add custom animation ingestion to LPCDataIngester**

Add this method to the `LPCDataIngester` class, after `_init_static_data`:

```python
def _ingest_custom_animations(self):
    """Ingest custom animation definitions from custom-animations.js."""
    from models import CustomAnimation, CustomAnimationFrame

    # Check if already ingested
    existing = self.session.query(CustomAnimation).count()
    if existing > 0:
        print(f"  Custom animations already ingested ({existing} definitions). Skipping.")
        return

    if not os.path.exists(CUSTOM_ANIMATIONS_PATH):
        print(f"  WARNING: custom-animations.js not found at {CUSTOM_ANIMATIONS_PATH}")
        return

    print("  Ingesting custom animation definitions...")
    definitions = parse_custom_animations_js(CUSTOM_ANIMATIONS_PATH)

    for name, defn in definitions.items():
        custom_anim = CustomAnimation(
            name=name,
            frame_size=defn['frame_size'],
            num_directions=len(defn['frames']),
            num_frames=len(defn['frames'][0]) if defn['frames'] else 0,
        )
        self.session.add(custom_anim)
        self.session.flush()  # get the id

        for dir_idx, direction_frames in enumerate(defn['frames']):
            for frame_idx, (src_anim, src_dir, src_frame) in enumerate(direction_frames):
                frame = CustomAnimationFrame(
                    custom_animation_id=custom_anim.id,
                    direction_index=dir_idx,
                    frame_index=frame_idx,
                    source_animation=src_anim,
                    source_direction=src_dir,
                    source_frame=src_frame,
                )
                self.session.add(frame)

    self.session.commit()
    print(f"  Ingested {len(definitions)} custom animation definitions.")
```

- [ ] **Step 3: Call _ingest_custom_animations from ingest_all**

In the `ingest_all` method, add the call after `_init_static_data()` and before `_process_json_files()`:

```python
def ingest_all(self):
    """Main ingestion process."""
    print("Starting LPC data ingestion...")

    try:
        self._init_static_data()
        self._ingest_custom_animations()  # <-- add this line
        self._process_json_files()
        self._scan_and_update_animations()
```

- [ ] **Step 4: Update the models import in ingest_lpc_data.py**

Update the import at line 14-18 to include the new models:

```python
from models import (
    init_database, create_session,
    Item, ItemLayer, ItemLayerBodyType, ItemVariant, ItemCredit,
    Tag, Animation, BodyType, item_animations,
    CustomAnimation, CustomAnimationFrame,
)
```

- [ ] **Step 5: Commit**

```bash
git add API-Character-Sprite-Generator/ingest_lpc_data.py
git commit -m "feat: ingest custom animation definitions from custom-animations.js"
```

---

### Task 3: Update Animation Scanner for Custom Animations

**Files:**
- Modify: `API-Character-Sprite-Generator/animation_scanner.py`

- [ ] **Step 1: Replace empty CUSTOM_TO_STANDARD with DB-driven lookup**

The scanner currently has `CUSTOM_TO_STANDARD = {}`. We need to:
1. Accept a mapping dict as a constructor parameter (loaded from DB by the ingester)
2. Use it to determine which standard animations a custom layer provides

Replace the `CUSTOM_TO_STANDARD` constant and update the `__init__` method:

```python
# Remove the CUSTOM_TO_STANDARD = {} line (line 34)

class AnimationScanner:
    """Scans the spritesheets filesystem to determine which animations
    actually have sprite files for each item definition."""

    def __init__(self, sprite_base_path: str = None, sheet_definitions_path: str = None,
                 custom_to_standard: Dict[str, str] = None):
        self.sprite_base_path = sprite_base_path or SPRITE_BASE_PATH
        self.sheet_definitions_path = sheet_definitions_path
        self.custom_to_standard = custom_to_standard or {}
        self._path_cache: Dict[str, bool] = {}
```

- [ ] **Step 2: Update scan_item to use self.custom_to_standard**

In `scan_item`, replace the reference to `CUSTOM_TO_STANDARD` (line 92) with `self.custom_to_standard`:

Change:
```python
mapped = CUSTOM_TO_STANDARD.get(custom_name)
```
To:
```python
mapped = self.custom_to_standard.get(custom_name)
```

- [ ] **Step 3: Build the mapping in ingest_lpc_data.py and pass it to the scanner**

In `ingest_lpc_data.py`, update `_scan_and_update_animations` to build the custom-to-standard mapping from the DB and pass it to the scanner:

```python
def _scan_and_update_animations(self):
    """Run filesystem scanner and update item_animations with verified data."""
    print("\nRunning filesystem animation scanner...")

    # Build custom_to_standard mapping from DB
    # Each custom animation maps to the standard animation its frames reference
    custom_to_standard = {}
    custom_anims = self.session.query(CustomAnimation).options(
        joinedload(CustomAnimation.frames)
    ).all()
    for ca in custom_anims:
        if ca.frames:
            # The source animation of the first frame tells us what standard
            # animation this custom animation is based on
            custom_to_standard[ca.name] = ca.frames[0].source_animation
    if custom_to_standard:
        print(f"  Custom-to-standard mappings: {custom_to_standard}")

    scanner = AnimationScanner(
        sheet_definitions_path=SHEET_DEFINITIONS_PATH,
        custom_to_standard=custom_to_standard,
    )
    scan_results = scanner.scan_all_definitions()
    # ... rest unchanged
```

Add `joinedload` to the imports if not present:

```python
from sqlalchemy.orm import Session, joinedload
```

And add `CustomAnimation` to the models import (already done in Task 2 Step 4).

- [ ] **Step 4: Commit**

```bash
git add API-Character-Sprite-Generator/animation_scanner.py API-Character-Sprite-Generator/ingest_lpc_data.py
git commit -m "feat: wire custom-to-standard animation mapping into scanner from DB"
```

---

### Task 4: Extend Sprite Generator for Oversized Rendering

**Files:**
- Modify: `API-Character-Sprite-Generator/sprite_generator.py`

- [ ] **Step 1: Add CustomAnimation imports and standard animation row lookup**

Add to imports at the top:

```python
from models import Item, ItemLayer, ItemLayerBodyType, ItemVariant, Animation, item_animations, CustomAnimation, CustomAnimationFrame
```

Add a row lookup dict after the ANIMATIONS list (after line 47):

```python
# Standard animation row lookup: animation_name -> {direction: row}
# Direction order in LPC: n=0, w=1, s=2, e=3
DIRECTION_OFFSETS = {'n': 0, 'w': 1, 's': 2, 'e': 3}

ANIMATION_ROWS = {}
for _anim_name, _start_row, _num_rows in ANIMATIONS:
    ANIMATION_ROWS[_anim_name] = _start_row
```

- [ ] **Step 2: Add method to determine needed custom animations**

Add this method to the `SpriteGenerator` class:

```python
def _get_custom_animations_needed(
    self,
    selected_items: List[Dict[str, str]],
) -> Dict[str, 'CustomAnimation']:
    """
    Determine which custom animations are needed based on selected items.

    Returns dict mapping custom animation name to its DB definition.
    """
    # Get all item file_names
    item_names = [s['item'] for s in selected_items]
    if not item_names:
        return {}

    # Find layers with custom_animation set
    layers = (
        self.session.query(ItemLayer)
        .join(Item)
        .filter(Item.file_name.in_(item_names))
        .filter(ItemLayer.custom_animation.isnot(None))
        .all()
    )

    custom_anim_names = {layer.custom_animation for layer in layers}
    if not custom_anim_names:
        return {}

    # Load custom animation definitions
    custom_anims = (
        self.session.query(CustomAnimation)
        .options(joinedload(CustomAnimation.frames))
        .filter(CustomAnimation.name.in_(custom_anim_names))
        .all()
    )

    return {ca.name: ca for ca in custom_anims}
```

- [ ] **Step 3: Add method to render oversized animation section**

Add this method to the `SpriteGenerator` class:

```python
def _render_custom_animations(
    self,
    spritesheet: Image.Image,
    body_type: str,
    selected_items: List[Dict[str, str]],
    custom_anims: Dict[str, 'CustomAnimation'],
) -> Tuple[Image.Image, Dict[str, Dict]]:
    """
    Render oversized/custom animations below the standard grid.

    Returns:
        - Extended spritesheet image
        - Layout metadata: {anim_name: {y_offset, frame_size, num_frames, num_directions}}
    """
    if not custom_anims:
        return spritesheet, {}

    layers_to_draw = self._get_layers_to_draw(body_type, selected_items)
    layout_meta = {}
    current_y = FULL_HEIGHT  # Start below standard grid

    for anim_name, ca in sorted(custom_anims.items()):
        fs = ca.frame_size
        section_width = fs * ca.num_frames
        section_height = fs * ca.num_directions

        # Expand canvas if needed
        new_width = max(spritesheet.size[0], section_width)
        new_height = current_y + section_height

        if new_width > spritesheet.size[0] or new_height > spritesheet.size[1]:
            expanded = Image.new('RGBA', (new_width, new_height), (0, 0, 0, 0))
            expanded.paste(spritesheet, (0, 0))
            spritesheet = expanded

        # Get layers that reference this custom animation
        custom_layers = [
            l for l in layers_to_draw
            if l['layer'].custom_animation == anim_name
        ]
        custom_layers.sort(key=lambda x: x['z_pos'] if x['z_pos'] is not None else 0)

        # Build frame mapping from DB
        frame_map = {}  # (dir_idx, frame_idx) -> (source_anim, source_dir, source_frame)
        for frame in ca.frames:
            key = (frame.direction_index, frame.frame_index)
            frame_map[key] = (frame.source_animation, frame.source_direction, frame.source_frame)

        # Render each frame
        for dir_idx in range(ca.num_directions):
            for frame_idx in range(ca.num_frames):
                mapping = frame_map.get((dir_idx, frame_idx))
                if not mapping:
                    continue

                src_anim, src_dir, src_frame_col = mapping
                dest_x = frame_idx * fs
                dest_y = current_y + dir_idx * fs

                # Composite all custom layers for this frame
                frame_canvas = Image.new('RGBA', (fs, fs), (0, 0, 0, 0))
                offset = (fs - SPRITE_WIDTH) // 2

                for layer_info in custom_layers:
                    sprite_path = self._resolve_animation_path(
                        layer_info, body_type, src_anim
                    )
                    if not os.path.exists(sprite_path):
                        continue

                    try:
                        src_image = self._load_image(sprite_path)
                        # Determine source row from direction
                        src_row = ANIMATION_ROWS.get(src_anim, 0) + DIRECTION_OFFSETS.get(src_dir, 0)
                        # We need the row relative to the animation image
                        # The animation image file contains rows for one animation
                        # Row within the animation sprite file
                        anim_start = ANIMATION_ROWS.get(src_anim, 0)
                        local_row = DIRECTION_OFFSETS.get(src_dir, 0)

                        sx = src_frame_col * SPRITE_WIDTH
                        sy = local_row * SPRITE_HEIGHT

                        if sx + SPRITE_WIDTH <= src_image.size[0] and sy + SPRITE_HEIGHT <= src_image.size[1]:
                            src_frame = src_image.crop((sx, sy, sx + SPRITE_WIDTH, sy + SPRITE_HEIGHT))
                            # Center the 64x64 frame within the larger frame
                            temp = Image.new('RGBA', (fs, fs), (0, 0, 0, 0))
                            temp.paste(src_frame, (offset, offset), src_frame)
                            frame_canvas = Image.alpha_composite(frame_canvas, temp)
                    except Exception:
                        pass

                # Paste completed frame onto spritesheet
                spritesheet.paste(frame_canvas, (dest_x, dest_y), frame_canvas)

        layout_meta[anim_name] = {
            'y_offset': current_y,
            'frame_size': fs,
            'num_frames': ca.num_frames,
            'num_directions': ca.num_directions,
        }
        current_y += section_height

    return spritesheet, layout_meta
```

- [ ] **Step 4: Update generate_spritesheet to include oversized animations**

Change the return type and signature of `generate_spritesheet` to also return metadata:

```python
def generate_spritesheet(
    self,
    body_type: str,
    selected_items: List[Dict[str, str]],
) -> Tuple[bytes, Dict]:
    """
    Generate a complete spritesheet for a character.

    Args:
        body_type: The body type (male, female, child, etc.)
        selected_items: List of dicts with 'type', 'item', and optional 'variant'

    Returns:
        Tuple of (PNG image bytes, custom_animations layout metadata)
    """
    layers_to_draw = self._get_layers_to_draw(body_type, selected_items)
    layers_to_draw.sort(key=lambda x: x['z_pos'] if x['z_pos'] is not None else 0)

    # Standard canvas – composite standard layers (skip custom_animation layers)
    spritesheet = Image.new('RGBA', (FULL_WIDTH, FULL_HEIGHT), (0, 0, 0, 0))

    for layer_info in layers_to_draw:
        if layer_info['layer'].custom_animation:
            continue  # handled separately
        self._composite_layer(spritesheet, layer_info, body_type, selected_items)

    # Render custom/oversized animations below standard grid
    custom_anims = self._get_custom_animations_needed(selected_items)
    spritesheet, custom_layout = self._render_custom_animations(
        spritesheet, body_type, selected_items, custom_anims,
    )

    output = io.BytesIO()
    spritesheet.save(output, format='PNG', optimize=False)
    return output.getvalue(), custom_layout
```

- [ ] **Step 5: Add animation_coverage method**

Add this method to `SpriteGenerator`:

```python
def get_animation_coverage(
    self,
    selected_items: List[Dict[str, str]],
) -> Dict[str, Dict]:
    """
    Get per-animation coverage info: whether standard sprites exist
    and which oversized variant (if any) is available.

    Returns:
        {
            "slash": {"standard": true, "oversized": "slash_oversize"},
            "thrust": {"standard": false, "oversized": "thrust_oversize"},
            "walk": {"standard": true, "oversized": null},
            ...
        }
    """
    item_names = [s['item'] for s in selected_items]
    if not item_names:
        return {}

    # Get standard animation support
    items = (
        self.session.query(Item)
        .options(joinedload(Item.animations))
        .filter(Item.file_name.in_(item_names))
        .all()
    )
    standard_anims = set()
    for item in items:
        for anim in item.animations:
            standard_anims.add(anim.name)

    # Get custom animations referenced by selected items' layers
    custom_anim_names = set()
    layers = (
        self.session.query(ItemLayer)
        .join(Item)
        .filter(Item.file_name.in_(item_names))
        .filter(ItemLayer.custom_animation.isnot(None))
        .all()
    )
    for layer in layers:
        custom_anim_names.add(layer.custom_animation)

    # Load custom animation definitions to find source animations
    custom_anims = (
        self.session.query(CustomAnimation)
        .options(joinedload(CustomAnimation.frames))
        .filter(CustomAnimation.name.in_(custom_anim_names))
        .all()
    ) if custom_anim_names else []

    # Map standard animation name -> oversized variant name
    oversized_map = {}
    for ca in custom_anims:
        if ca.frames:
            base_anim = ca.frames[0].source_animation
            oversized_map[base_anim] = ca.name

    # Build coverage for all standard animations
    coverage = {}
    for anim_name, _, _ in ANIMATIONS:
        coverage[anim_name] = {
            'standard': anim_name in standard_anims,
            'oversized': oversized_map.get(anim_name),
        }

    return coverage
```

- [ ] **Step 6: Commit**

```bash
git add API-Character-Sprite-Generator/sprite_generator.py
git commit -m "feat: render oversized animations below standard grid in spritesheet"
```

---

### Task 5: Update API Endpoints for New Return Types

**Files:**
- Modify: `API-Character-Sprite-Generator/main_v2.py`

- [ ] **Step 1: Update generate_sprite endpoint**

The `generate_spritesheet` now returns a tuple `(bytes, metadata)`. Update the endpoint at line 1542:

```python
@app.post("/generate-sprite", ...)
async def generate_sprite(request: SpriteRequest, db: Session = Depends(get_db)):
    try:
        generator = SpriteGenerator(db)
        image_bytes, custom_layout = generator.generate_spritesheet(
            request.body_type,
            [s.model_dump() for s in request.selections],
        )
        coverage = generator.get_animation_coverage(
            [s.model_dump() for s in request.selections],
        )
        import json as _json
        metadata = {
            'custom_animations': custom_layout,
            'animation_coverage': coverage,
        }
        return Response(
            content=image_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": "inline; filename=character.png",
                "X-Sprite-Meta": _json.dumps(metadata),
            },
        )
    except Exception as e:
        raise HTTPException(500, f"Error generating sprite: {e}")
```

- [ ] **Step 2: Update supported-animations endpoint**

At line 1596, extend the response to include animation coverage:

```python
@app.post("/supported-animations", tags=["Sprite Generation"])
async def get_supported_animations(request: SpriteRequest, db: Session = Depends(get_db)):
    try:
        generator = SpriteGenerator(db)
        sels = [s.model_dump() for s in request.selections]
        result = generator.get_supported_animations(sels)
        result['animation_coverage'] = generator.get_animation_coverage(sels)
        return result
    except Exception as e:
        raise HTTPException(500, f"Error checking animations: {e}")
```

- [ ] **Step 3: Update random-character/sprite endpoint**

At line 1725, update to pass through metadata:

```python
async def random_character_sprite(...):
    import json as _json

    char_data = generate_random_character(db, ...)
    try:
        generator = SpriteGenerator(db)
        image_bytes, custom_layout = generator.generate_spritesheet(
            char_data["body_type"],
            char_data["selections"],
        )
        coverage = generator.get_animation_coverage(char_data["selections"])
        char_data['custom_animations'] = custom_layout
        char_data['animation_coverage'] = coverage
        return Response(
            content=image_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": "inline; filename=random_character.png",
                "X-Character-Data": _json.dumps(char_data),
            },
        )
    except Exception as e:
        raise HTTPException(500, f"Error generating random sprite: {e}")
```

- [ ] **Step 4: Update random-character JSON endpoint**

At line 1688, add coverage data to the JSON response too:

```python
async def random_character(...):
    result = generate_random_character(db, ...)
    # Add animation coverage metadata
    generator = SpriteGenerator(db)
    result['animation_coverage'] = generator.get_animation_coverage(result['selections'])
    return result
```

- [ ] **Step 5: Add imports for new models to main_v2.py**

Update the models import at the top (line 9-14) to include:

```python
from models import (
    create_session, init_database,
    Item, ItemLayer, ItemLayerBodyType, ItemVariant, ItemCredit,
    Tag, Animation, BodyType,
    item_tags, item_required_tags, item_excluded_tags, item_animations,
    CustomAnimation, CustomAnimationFrame,
)
```

- [ ] **Step 6: Commit**

```bash
git add API-Character-Sprite-Generator/main_v2.py
git commit -m "feat: extend API endpoints with custom animation metadata and coverage"
```

---

### Task 6: Update Test Page for Oversized Animation Display

**Files:**
- Modify: `API-Character-Sprite-Generator/main_v2.py` (the `_TEST_PAGE_HTML` string at line 1794)

- [ ] **Step 1: Update the ANIMATIONS array and add custom animation tracking**

In the test page `<script>` section, after the `ANIMATIONS` array, add:

```javascript
// Custom/oversized animation data per card — populated from API response
// cardAnims[id].customAnims = { name: {y_offset, frame_size, num_frames, num_directions} }
// cardAnims[id].coverage = { anim_name: {standard: bool, oversized: string|null} }
```

- [ ] **Step 2: Update the generateOne function**

Update `generateOne()` to pass custom animation metadata through to `addCard`:

```javascript
async function generateOne() {
  setLoading(true);
  try {
    const race = document.getElementById('raceSelect').value;
    const bt = document.getElementById('bodySelect').value;
    const age = document.getElementById('ageSelect').value;
    const cls = document.getElementById('classSelect').value;
    const params = new URLSearchParams();
    if (race) params.set('race', race);
    if (bt) params.set('body_type', bt);
    if (age) params.set('age', age);
    if (cls) params.set('class', cls);
    const qs = params.toString();
    const url = API + '/random-character' + (qs ? '?' + qs : '');
    const charResp = await fetch(url);
    const charData = await charResp.json();

    const spriteResp = await fetch(API + '/generate-sprite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charData),
    });
    const blob = await spriteResp.blob();
    const imgUrl = URL.createObjectURL(blob);

    // Parse sprite metadata from header
    let spriteMeta = {};
    const metaHeader = spriteResp.headers.get('X-Sprite-Meta');
    if (metaHeader) {
      try { spriteMeta = JSON.parse(metaHeader); } catch(e) {}
    }

    const animResp = await fetch(API + '/supported-animations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charData),
    });
    const animData = await animResp.json();

    addCard(charData, imgUrl, animData, spriteMeta);
  } catch (e) {
    console.error(e);
    alert('Error generating character: ' + e.message);
  } finally {
    setLoading(false);
  }
}
```

- [ ] **Step 3: Update addCard to store custom animation data**

Update `addCard` signature and cardAnims initialization:

```javascript
function addCard(charData, imgUrl, animData, spriteMeta) {
  charCount++;
  const id = charCount;
  document.getElementById('counter').textContent = id + ' characters generated';

  const supportedSet = new Set((animData && animData.supported) || []);
  const naSet = new Set((animData && animData.na) || []);
  const weaponMissing = (animData && animData.weapon_missing) || {};
  const coverage = (animData && animData.animation_coverage) || {};
  const customAnims = (spriteMeta && spriteMeta.custom_animations) || {};
  const supportedCount = supportedSet.size;

  // Build list of oversized animations for the animation switcher
  const oversizedAnims = [];
  for (const [stdName, cov] of Object.entries(coverage)) {
    if (cov.oversized && customAnims[cov.oversized]) {
      oversizedAnims.push({
        name: cov.oversized,
        displayName: cov.oversized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        standardName: stdName,
        ...customAnims[cov.oversized],
      });
    }
  }

  cardAnims[id] = {
    animIdx: DEFAULT_ANIM,
    intervalId: null,
    sheet: null,
    supported: supportedSet,
    na: naSet,
    weaponMissing: weaponMissing,
    coverage: coverage,
    customAnims: customAnims,
    oversizedAnims: oversizedAnims,
    oversizedIdx: -1,  // -1 = showing standard anim, >=0 = showing oversized
    showingOversized: false,
  };
  // ... rest of card HTML and setup
```

- [ ] **Step 4: Update the canvas size and CSS for 192px preview**

Update the CSS for `.sprite-preview` and canvas to accommodate 192px:

```css
.sprite-preview { width: 192px; height: 192px; background: #111; border-radius: 6px; overflow: hidden;
    image-rendering: pixelated; position: relative; }
.sprite-preview canvas { position: absolute; top: 0; left: 0; width: 192px; height: 192px; image-rendering: pixelated; }
```

Update the canvas element in the card HTML to use 192x192:

```html
<canvas id="anim-${id}" width="192" height="192"></canvas>
```

- [ ] **Step 5: Update animation controls HTML to include oversized toggle**

In the card HTML template, after the standard animation controls `anim-controls` div, add an oversized section:

```javascript
const oversizedBtns = oversizedAnims.length > 0
  ? `<div class="anim-controls" style="margin-top:4px">
       <div class="anim-btn oversized-btn" onclick="toggleOversized(${id})" title="Toggle oversized animations" style="width:auto;padding:0 8px;border-radius:4px;font-size:0.7em">OS</div>
       <span class="anim-label" id="os-label-${id}" style="font-size:0.65em;color:#888">${oversizedAnims.length} oversized</span>
     </div>`
  : '';
```

Add this after the existing anim-controls div in the card HTML.

- [ ] **Step 6: Update startAnim to handle both standard and oversized playback**

Replace the `startAnim` function:

```javascript
function startAnim(id) {
  const state = cardAnims[id];
  if (!state || !state.sheet) return;

  if (state.intervalId) clearInterval(state.intervalId);

  const canvas = document.getElementById('anim-' + id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (state.showingOversized && state.oversizedIdx >= 0) {
    // Oversized animation playback
    const os = state.oversizedAnims[state.oversizedIdx];
    const fs = os.frame_size;
    const yOff = os.y_offset;
    const numFrames = os.num_frames;
    const numDirs = os.num_directions;

    // Scale factor to fit within 192px canvas
    const scale = Math.min(192 / (fs * 2), 192 / (fs * 2));
    const scaledFs = Math.floor(fs * Math.min(1, 192 / (fs * 2)));

    // 2x2 grid for 4 directions, centered for 1
    const dirGrid = numDirs >= 4
      ? [{dir: 0, x: 0,           y: 0},            // N → top-left
         {dir: 3, x: 192 - scaledFs, y: 0},          // E → top-right
         {dir: 1, x: 0,           y: 192 - scaledFs}, // W → bottom-left
         {dir: 2, x: 192 - scaledFs, y: 192 - scaledFs}] // S → bottom-right
      : [{dir: 0, x: (192 - scaledFs) / 2, y: (192 - scaledFs) / 2}];

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, 192, 192);
      for (const d of dirGrid) {
        const sx = frame * fs;
        const sy = yOff + d.dir * fs;
        ctx.drawImage(state.sheet, sx, sy, fs, fs, d.x, d.y, scaledFs, scaledFs);
      }
      frame = (frame + 1) % numFrames;
    }
    draw();
    state.intervalId = setInterval(draw, 150);
  } else {
    // Standard animation playback
    const [name, startRow, numDirs, numFrames] = ANIMATIONS[state.animIdx];

    const dirGrid = numDirs >= 4
      ? [{r: startRow,     x: 0,  y: 0},
         {r: startRow + 3, x: 64, y: 0},
         {r: startRow + 1, x: 0,  y: 64},
         {r: startRow + 2, x: 64, y: 64}]
      : [{r: startRow, x: 32, y: 32}];

    // Center the 128px standard view within 192px canvas
    const offsetX = 32;
    const offsetY = 32;

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, 192, 192);
      for (const d of dirGrid) {
        ctx.drawImage(state.sheet, frame * 64, d.r * 64, 64, 64,
                      d.x + offsetX, d.y + offsetY, 64, 64);
      }
      frame = (frame + 1) % numFrames;
    }
    draw();
    state.intervalId = setInterval(draw, 150);
  }
}
```

- [ ] **Step 7: Add toggleOversized and oversized navigation functions**

Add these functions to the script:

```javascript
function toggleOversized(id) {
  const state = cardAnims[id];
  if (!state || state.oversizedAnims.length === 0) return;

  state.showingOversized = !state.showingOversized;
  if (state.showingOversized) {
    state.oversizedIdx = 0;
  } else {
    state.oversizedIdx = -1;
  }

  updateAnimLabel(id);
  startAnim(id);
}

function updateAnimLabel(id) {
  const state = cardAnims[id];
  const label = document.getElementById('anim-label-' + id);
  const osLabel = document.getElementById('os-label-' + id);
  if (!state || !label) return;

  if (state.showingOversized && state.oversizedIdx >= 0) {
    const os = state.oversizedAnims[state.oversizedIdx];
    label.textContent = os.displayName;
    label.className = 'anim-label';
    label.style.color = '#e9a045';  // orange for oversized
    if (osLabel) osLabel.textContent = `${state.oversizedIdx + 1}/${state.oversizedAnims.length} oversized`;
  } else {
    const status = getAnimStatus(id, state.animIdx);
    const suffix = status === 'na' ? ' (N/A)' : status === 'weapon-miss' ? ' (no weapon)' : '';
    label.textContent = ANIMATIONS[state.animIdx][0] + suffix;
    label.className = 'anim-label' + (status === 'na' ? ' na' : status === 'weapon-miss' ? ' weapon-miss' : '');
    label.style.color = '';
    if (osLabel) osLabel.textContent = `${state.oversizedAnims.length} oversized`;
  }
}
```

- [ ] **Step 8: Update changeAnim to handle oversized cycling**

Replace the `changeAnim` function:

```javascript
function changeAnim(id, delta) {
  const state = cardAnims[id];
  if (!state) return;

  if (state.showingOversized) {
    // Cycle through oversized animations
    state.oversizedIdx = (state.oversizedIdx + delta + state.oversizedAnims.length) % state.oversizedAnims.length;
  } else {
    // Cycle through standard animations
    state.animIdx = (state.animIdx + delta + ANIMATIONS.length) % ANIMATIONS.length;
  }

  updateAnimLabel(id);
  startAnim(id);
}
```

- [ ] **Step 9: Add CSS for oversized button**

Add to the `<style>` section:

```css
.oversized-btn { background: #e9a045 !important; color: #1a1a2e !important; font-weight: 700; }
.oversized-btn:hover { background: #d4903a !important; }
```

- [ ] **Step 10: Expose X-Sprite-Meta header via CORS**

In the CORS middleware setup (near the top of main_v2.py), add `expose_headers`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sprite-Meta", "X-Character-Data"],
)
```

- [ ] **Step 11: Commit**

```bash
git add API-Character-Sprite-Generator/main_v2.py
git commit -m "feat: update test page with oversized animation display and toggle"
```

---

### Task 7: Verify End-to-End

**Files:** None (testing only)

- [ ] **Step 1: Rebuild and start Docker services**

```bash
docker compose down && docker compose build && docker compose up -d
```

- [ ] **Step 2: Verify custom animations were ingested**

```bash
curl -s http://localhost:8000/stats | python -m json.tool
```

Check that the stats include custom animation counts.

- [ ] **Step 3: Generate a random character with a weapon and check metadata**

```bash
curl -s "http://localhost:8000/random-character?class=warrior" | python -m json.tool
```

Verify `animation_coverage` field is present with `standard` and `oversized` values.

- [ ] **Step 4: Open test page and visually verify**

Open `http://localhost:8000/test-characters` in a browser. Generate warrior characters (which use weapons with oversized animations). Verify:
- Standard animations play in the centered 128px area within the 192px preview
- The "OS" toggle button appears when oversized animations are available
- Clicking "OS" switches to oversized animation playback
- Arrow buttons cycle through oversized animations
- Animation label turns orange for oversized

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: address issues found during end-to-end testing"
```
