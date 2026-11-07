# Pending: Arabic batch split over two days (Sevag, 5 + 7 Nov 2026)

Upstream at review time: henmedia/layerling b8141d93 (1.150.0). Last merged Arabic batch: PR #1104 (1 Nov).

- Part 1 (5 Nov): interface 553 sentences by others since 1 Nov, 80 corrected — CONFIRMED by Sevag on 7 Nov.
  reviews/2026-11-05-part1-interface.tsv
- Part 2 (7 Nov): 186 release notes 1.130.0–1.150.0; interface 495 sentences by others (1.142–1.150), 48 corrected;
  guide chapter 7 drawing section re-translated (English rewritten as cards) + fixes in chapters 02/03/04/06/09/10/11/12/14/15;
  Arabic pictures: trace-house, trace-house-body, group-keep-parts, paint, print-check (ai-quickstart-powershell stays English).
  reviews/2026-11-07-part2-*.tsv — waiting for Sevag's confirmation.
- After confirmation: push branch ar-batch-2026-11-07 (from upstream main, Part 1 + Part 2), prefilled PR link,
  move guide_synced_at to the upstream commit used, delete this file.
