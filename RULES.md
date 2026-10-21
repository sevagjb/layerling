# Arabic for layerling: evening check (rules for the scheduled task)

Owner: Sevag Barsoumian (GitHub sevagjb), native Arabic speaker. He reviews every text himself.
Upstream: https://github.com/henmedia/layerling (maintainer Stefan). Fork: https://github.com/sevagjb/layerling.

## Hard rules
- Never commit to the fork's `main`. Work only on a new branch `ar-batch-YYYY-MM-DD` made from upstream `main`.
- Never open a pull request and never comment on GitHub. Sevag clicks the pull request himself.
- Pull-request text: keep the line "🤖 Generated with [Claude Code](https://claude.com/claude-code)", but never put a session link in it.
- Commits: author `Sevag Barsoumian <sevagjbarsoumian@gmail.com>`, with the Co-Authored-By / Claude-Session trailers from the session's attribution reminder.
- Do not change anything that is not Arabic (no English, no code), except `docs/guide/ar/**`, `apps/web/src/lib/messages.ar.ts` and the `ar` fields in `apps/web/src/lib/whatsNew.json`.
- Edit messages.ar.ts directly. Keep Stefan's own Arabic additions unless they break the glossary (then fix and list them).

## PENDING.md
If PENDING.md exists on this branch, read it first: it is a snapshot Sevag asked for of what was waiting. Cover everything in it plus anything newer, then delete PENDING.md from this branch at the end of the batch (it is replaced by the batch itself).

## What to look for (compare upstream main with the Arabic)
1. Interface: `npm ci` (if needed) then `npm run i18n:status -- ar` lists missing sentences. Add each key in the English key order. `{placeholder}` names must match the English exactly.
2. Release notes: in `whatsNew.json`, items among the newest 20 versions (WHATS_NEW_MAX_VERSIONS) without an `ar` title/body. Add `"ar"` after the existing keys. Write the file back with `json.dumps(d, ensure_ascii=False, indent=2) + "\n"` (this reproduces the original formatting exactly).
3. Guide: `python3 validate_guide.py <repo>` (structural gaps: missing {{ui:}}, [[Key]], headings, list items, anchors) and `git diff <guide_synced_at>..origin/main -- docs/guide/en` (changed sentences). Translate the changed/new parts into the same Arabic chapter. Then move `guide_synced_at` in state.json (on this ar-toolkit branch) to the upstream commit you compared with.

## Language rules
- Glossary: glossary.tsv in this branch. One Arabic word per English term; the "Not this" column is forbidden. Key ones: chamfer = شطف (never شطب), fillet = تنعيم, workplane = سطح العمل, plane = مستوى, object/body = جسم (never أوبجكت/كائن), view cube = مكعب العرض, thread = سن لولبي, section view = عرض المقطع, slider = شريط التمرير, tooltip = تلميح الأداة, Duplicate = تكرار, Gridfinity bin = علبة, baseplate = لوح شبكة, hinge pin = الدبوس, knuckles = المفاصل, inset = الهامش الداخلي.
- Any button/field name must be exactly its Arabic interface text from messages.ar.ts. In release notes write it in «».
- Counts: Arabic has six plural forms and one string per key, so write counts in the colon form, e.g. "أُعيدت أجسام: {count}".
- Guide markup stays exactly as in English: {{ui:key}}, [[Key]], {{value:X}}, {{shortcuts}}, (shot:...), (chapter:...), code in backticks.
- A guide heading that something links to (anchor) gets its English heading in parentheses, e.g. `## حذف وجه (Deleting faces)`, because slugify drops Arabic letters.
- Modern Standard Arabic, Western digits, "مم" for millimetre. Error messages that the program shows in English stay in English, quoted.
- Known open fix: the interface has «شطب مستدير» for Chamfillet (edge.chamfillet and related keys); it must be «شطف مستدير» / «شطف وتدوير». Fix it in the first batch.

## Arabic written by others (check every evening)
Stefan and other contributors sometimes add Arabic themselves (first drafts, often machine-made), e.g. a new field in messages.ar.ts or a paragraph in docs/guide/ar. These do not show up as "missing".
- Look at `git log <guide_synced_at>..origin/main` for commits that touch `apps/web/src/lib/messages.ar.ts`, `docs/guide/ar/` or `ar` fields in whatsNew.json, whose author is not Sevag Barsoumian.
- Review those Arabic texts against the glossary and the interface names; fix them in the batch, and list each one in the Word file with the old text, the new text and why (e.g. "شطب → شطف").
- If they are fine, list them as "checked, no change".

## Guide pictures (check every evening)
The guide uses one picture per `(shot:name)`. Arabic pictures live in `docs/guide/images/ar/<name>.webp`; English ones in `docs/guide/images/en/`. Without an Arabic picture the English one is shown.
Check:
- English pictures with no Arabic version (`ls docs/guide/images/en` vs `ar`).
- English pictures changed after the Arabic one (`git log -1 --format=%ct -- <file>` for en vs ar). That means the interface in that picture changed.
- New `(shot:...)` in the English guide.
If any: try to make the Arabic picture with the adapted screenshot tool in `pictures/` on this branch (copy `shots-ar.mjs` and `scenes-ar.mjs` into the repo's `scripts/` as `_shots-ar.mjs` and `_scenes-ar.mjs`, temporary, never commit them; start the dev server; run with `EDGE_PATH=/opt/pw-browsers/chromium` (or wherever Chromium is), `--lang ar`, `--only <name>`). New scenes come from upstream `scripts/guide-scenes.mjs`: copy the scene into scenes-ar.mjs with Arabic object names, and update scenes-ar.mjs on this branch. Only the `.webp` files under `docs/guide/images/ar/` go into the batch branch. Look at every picture you made (Read the image) before adding it.
If a picture cannot be made, do not block the batch: list the picture names in the message to Sevag as "still English".

## Checks before finishing
- `npm run i18n:status -- ar`, `npx vitest run --config tests/vitest.config.ts tests/unit/whatsNew.test.ts tests/unit/updatePreview.test.ts`, `npm run guide`, `python3 validate_guide.py <repo>`.

## What Sevag gets
- A Word review file: English next to Arabic, grouped as Interface / Release notes / Guide. Build it with `node review-docx.js data.json out.docx`
  (data.json: {"title","intro","sections":[{"title","rows":[{"key","en","ar"}]}]}; the first line of en/ar is shown bold).
- Push the branch to the fork, send the Word file, and a short message: what was new upstream (version numbers), how many items were translated, anything he must decide, and a prefilled compare link:
  https://github.com/henmedia/layerling/compare/main...sevagjb:layerling:<branch>?expand=1&title=...&body=...
- If nothing is new: no branch, just a one-line "nothing new for Arabic today (upstream at <version>)".
