# Derived art

Much of Alkema's art is other artists' work, changed by us: The Battle for Wesnoth's terrain and
orcs recoloured and reassembled, Liberated Pixel Cup (LPC) tiles built into towns and castles,
LPC animals and birds laid out for the game. Their licences ask us to share what we made from
them under the same terms. This folder says what each of those pictures is, who drew what it's
made from, what we changed, and the licence you may use it under.

## What's here

- **`CREDITS.csv`**: one row for each derived picture (or group of like pictures): the file in
  the game (`client/assets/...` in this repository), its licence, the script that made it, what
  it's made from, the original artists, and what we changed.
- **`licenses/`**: the full text of each licence named in `CREDITS.csv`.
- **`source/tools/`**: the source of the derived pictures, published with them. That's the scripts
  that make them (`worldgen.py`, `worldart.py`, `battlegen.py`, `dungeongen.py`, `towngen.py`,
  `castlegen.py`, `spellgen.py`, `wildlife.py`, `shipart.py` and others) and the original art they
  start from (the `*-sources/` folders, each with the original credits and links). Most of these
  pictures are made by a script, so the script and its originals are the form you'd change them
  in. `battlegen.py` also reads the LPC character generator's palettes, from
  https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator.
  (`source/` is put together when this repository is published.)

## The licences

- **The Battle for Wesnoth's art** (https://www.wesnoth.org) is GPL 2.0 or later. Every picture
  with any Wesnoth art in it is offered under the **GPL 3.0**: the overworld's ground, mountains
  and trees, the orcs, the spells' effects, Gloomwater Grotto's levels, Castle Grimhold's grounds
  with its mountains. The LPC art blended into these is offered by its artists under the GPL 3.0
  as well, as most LPC art is.
- **The ships** (`client/assets/world/ships.png`, `ship.png`, `boats.png`) are drawn in code in the
  manner of Wesnoth's ships, with no Wesnoth picture copied. They're loosely derived, so we
  offer them under the GPL 3.0 with the rest.
- **Pictures made only from LPC art** (towns, Castle Dunmere, rooms, the water, the wildlife,
  the jesters' caps) are offered under the licences their pieces allow: CC-BY-SA (3.0 or 4.0)
  and, where every piece allows it, the GPL 3.0. Each picture's options are in `CREDITS.csv`.
- **Open Duelyst's art** (the Vanar foes) and **Dungeon Crawl Stone Soup's tiles** (the weapon
  icons) are CC0. Nothing is owed, but they're credited all the same.

Using any of these, credit the original artists named in `CREDITS.csv` (and in the credits file
of the source folder it names), say that you changed them if you do, and share what you make
under the same licence.

The game's full credits, every piece of art, sound and font, are in `client/CREDITS.txt`.

## Still being sorted out

- Gloomwater Grotto's first level (`client/assets/towns/gloomwater-1.png`) has a dock drawn from
  Reid's "Dock tileset", which is CC-BY-SA 3.0 only, beside Wesnoth's GPL cave art. The two
  licences can't be combined, so the dock is to be replaced with one under the GPL.
- Castle Grimhold's grounds (`grimhold-things.png`, GPL 3.0) have bare trees from "[LPC Revised]
  4-Season Terrain", which is OGA-BY 3.0 only. Whether OGA-BY 3.0 can go into a GPL work isn't
  settled, so they may be replaced with bare trees under the GPL too.
