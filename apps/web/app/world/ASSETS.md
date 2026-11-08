# 3D runtime asset manifest additions

The scene GLBs and their sources are recorded in the Phase 06 package manifest. This file covers runtime assets added afterwards.

## People: `public/world/player.glb`, `dana.glb`, `teammate.glb`

Each is one avatar from Microsoft Rocketbox, with the Quaternius clips retargeted onto its skeleton (`assets-cp5/build_people.py`).

| Use | Model | Source | Licence | Triangles |
|---|---|---|---|---|
| Player | Male_Adult_08 | https://github.com/microsoft/Microsoft-Rocketbox (Assets/Avatars/Adults) | MIT | 7,364 |
| Dana | Business_Female_02 | Same (Assets/Avatars/Professions) | MIT | 8,640 |
| Teammate | Business_Male_07 | Same | MIT | 6,722 |
| Compared, not used | Business_Male_06 | Same | MIT | 6,950 |

**Clips:** Universal Animation Library by Quaternius, CC0 1.0, https://quaternius.itch.io/universal-animation-library, 9 of 46 clips. **Changes:** textures reduced to 1024 colour and 512 normal, specular dropped, 52 bones retargeted including every finger.

**Catalogs asked for in the brief:** Free3D, Sketchfab and CGTrader need a signed-in account to download. No model from them is used.

## Handset

Geometry adapted from the model Tung supplied (`91-21-iphonex.zip`). The front glass was replaced and the rest reduced from 234,806 to 9,217 triangles. Its author and licence are unknown, so treat it as local only until confirmed.

## Sound

`world-audio.ts` loads `/world/audio/ring.mp3` and `buzz.mp3` when present. The two Freesound clips in the brief are CC0 (https://freesound.org/people/Artiom_Constantinov/sounds/845527/, https://freesound.org/people/mobaudio/sounds/384485/), but their host refused an automated download, so this build uses cues generated in code.

## Prop rebuild inside `public/world/bedroom.glb` and `office.glb`

All Poly Haven models are CC0 1.0 (https://polyhaven.com/license). Attribution is not required and is recorded here anyway. Each was downloaded from the Poly Haven API at 1k. Changes: decimated where listed, recentred on the floor, base colour and normal maps reduced, metal and roughness maps replaced by constants.

| Model | Source | Author | Used for | Triangles (source to shipped) |
|---|---|---|---|---|
| Potted Plant 01 | https://polyhaven.com/a/potted_plant_01 | Rico Cilliers | Lobby and entrance floor plants | 176,226 to 8,811 |
| Potted Plant 02 | https://polyhaven.com/a/potted_plant_02 | Rico Cilliers | Bedroom window plant | 69,806 to 7,677 |
| Potted Plant 04 | https://polyhaven.com/a/potted_plant_04 | James Ray Cock | Nightstand, shelf, desk, reception and meeting table plants | 8,929 to 2,678 |
| Fern 02 (one of four) | https://polyhaven.com/a/fern_02 | Rob Tuytel, Rico Cilliers | Entrance planters and workstation planter | Reduced to 70% |
| Modern Coffee Table 01 | https://polyhaven.com/a/modern_coffee_table_01 | Amin | Lobby coffee table | 4,504 unchanged |
| Wooden Display Shelves 01 | https://polyhaven.com/a/wooden_display_shelves_01 | James Ray Cock | Workstation bay shelving, narrowed and heightened to fit its collider | 3,174 unchanged |

**Built for this project in Blender** (`assets-cp4/props_lib.py`, `rebuild_bedroom.py`, `rebuild_office.py`), because Poly Haven has no modern office chair, sofa or matching desk parts: swivel chair (two upholstery variants, 1,988 triangles, seat top at 0.455 m), lobby sofa, bed frame and mattress, nightstand, bedroom bookcase, bedside and desk lamps, keyboards, mice, monitor rears and stands, laptop body, meeting table base, drawer fronts and mugs.

**Removed:** Kenney chairDesk, loungeDesignSofa, tableCoffeeGlass, tableCross, bookcaseOpen, laptop, plantSmall1, pottedPlant, bedSingle, cabinetBedDrawerTable and lampRoundTable. The Kenney entrance awning remains. The object named `lampRoundTable(Clone)` is now the new lamp shade, because the runtime dims it by that name.

**Contract:** every anchor, pivot, collider, screen plane and door node has the same transform as before (`assets-cp4/glbcheck.py`).

| Scene | File size before | After | Triangles before | After |
|---|---|---|---|---|
| Bedroom | 3,680,632 | 5,588,284 | 18,151 | about 52,000 |
| Office | 1,968,324 | 4,349,072 | 11,018 | 90,870 |
