# Pending Arabic work (snapshot)

Made on 2026-10-21 at Sevag's request, so he can see how much is waiting before the Sunday run.
Upstream henmedia/layerling main: **1.99.0** (`78a0fd7`). Last Arabic batch merged: ar-batch-2026-10-18 (1.90.0).
The Sunday run starts from this list, then re-checks upstream for anything newer.

## Summary
| Part | Waiting |
| --- | --- |
| Interface sentences with no Arabic | 29 |
| Interface Arabic written by others since 1.90.0 (to check) | about 172 lines in messages.ar.ts |
| Release notes without Arabic (newest 20 versions) | 90 notes, about 4,359 English words |
| Guide chapters changed in English since 1.90.0 | 15 chapters, 172 lines added / 49 removed |
| Guide gaps found by validate_guide.py | 29 |
| Guide Arabic written by others since 1.90.0 (to check) | about 45 lines in 13 chapters |
| Guide pictures retaken in English (2026-10-20) | all 35; the Arabic ones are from 2026-10-18 |

## Interface sentences with no Arabic (29)
- `contextMenu.carry`
- `prop.sketchFill.shrink`
- `prop.sketchFill.shrinkHint`
- `nameTag.side.free`
- `nameTag.side.freeHint`
- `nameTag.keyringTab`
- `nameTag.keyringTabFix`
- `nameTag.keyringTabFixHint`
- `status.keyringTabMade`
- `status.keyringTabFixed`
- `status.keyringTabNoTag`
- `prop.textSpacing`
- `prop.textSpacingHint`
- `prop.screwHoleBothSides`
- `sketch.strokeAlign.shrink`
- `workspace.simpleMode`
- `workspace.simpleModeHint`
- `workspace.simpleModeOff`
- `sketch.fromMiddle`
- `sketch.fromMiddleHint`
- `status.sketchFromMiddleOn`
- `status.sketchFromMiddleOff`
- `edge.variableRadius`
- `edge.variableRadiusHint`
- `edge.radiusStart`
- `edge.radiusEnd`
- `edge.swapEnds`
- `edge.swapEndsHint`
- `edge.variableOneEdge`

## Release notes without Arabic
| Version | Notes |
| --- | --- |
| 1.99.0 | 8 of 8 |
| 1.98.0 | 11 of 11 |
| 1.96.0 | 5 of 5 |
| 1.95.0 | 6 of 6 |
| 1.94.0 | 15 of 15 |
| 1.93.1 | 2 of 2 |
| 1.93.0 | 10 of 10 |
| 1.92.2 | 6 of 6 |
| 1.92.1 | 8 of 8 |
| 1.92.0 | 15 of 16 |
| 1.91.0 | 4 of 5 |

## Guide chapters changed in English (since 5f5accf8)
| Chapter | Lines |
| --- | --- |
| 02-view-and-workplane.md | +92 / -11 |
| 03-shapes.md | +20 / -4 |
| 04-select-and-arrange.md | +3 / -3 |
| 05-solids-and-holes.md | +5 / -4 |
| 06-edges-and-hollowing.md | +2 / -1 |
| 07-sketches.md | +13 / -5 |
| 08-text.md | +3 / -2 |
| 09-threads-and-mechanics.md | +13 / -7 |
| 10-measuring-and-notes.md | +5 / -5 |
| 11-printing.md | +3 / -1 |
| 12-files-and-saving.md | +2 / -2 |
| 13-shortcuts.md | +1 / -1 |
| 14-ai-with-mcp.md | +3 / -2 |
| 15-offline-and-install.md | +3 / -1 |
| 17-tablet-and-touch.md | +4 / -0 |

## Pictures
Stefan retook all 35 English guide pictures on 2026-10-20 (interface changes since 1.90.0). The Arabic pictures still show the 1.88 interface. Remake them with pictures/shots-ar.mjs; any that fail stay as they are and are listed.
