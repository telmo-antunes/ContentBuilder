# inspo/

Reference Instagram posts captured from the owner's swipe-file accounts, used as the bar when judging decks the app produces. Start at [INDEX.md](INDEX.md).

## Layout

```
inspo/<account>/<post-code>/01.jpg … NN.jpg   every slide, in order, 1080 px wide
inspo/<account>/<post-code>/sheet.jpg        all slides tiled in one strip — open this to judge a carousel in one look
inspo/<account>/<post-code>/meta.json        url, slide count, has-video flag, caption excerpt
inspo/tools/annotations.json                  title · forms · "what to copy" per post (feeds INDEX.md)
inspo/tools/capture.cjs                       captures a post
inspo/tools/listing.cjs                       lists an account's 12 latest posts as a labelled thumbnail sheet
```

The JPEGs and `meta.json` are gitignored (58 MB). INDEX.md, the annotations and the tools are tracked, so the folder can be rebuilt on any machine with the two commands below.

## How to judge a deck against it

1. Name the form each slide of the new deck is attempting (one-liner, number, exhibit, numbered teaching poster, product proof, picture owns the frame, close as an arrival).
2. Find two or three posts in INDEX.md with the same form and open their `sheet.jpg`.
3. Compare at phone size, one second per slide: does the hook read alone, is there one idea per slide, does the exhibit carry information, does the close arrive somewhere.
4. Score on `docs/audit/rubric.md`; cite the reference post code in the notes.

## Rebuilding or extending

No login needed: Instagram serves the public embed page (`/p/<code>/embed/captioned/`) with every carousel slide at 1200 px. Run from the repo root (uses the repo's puppeteer and sharp).

```bash
node inspo/tools/listing.cjs notionhq            # → inspo/.scratch/thumbs/notionhq.jpg + listing.json (codes, carousel/reel badges)
node inspo/tools/capture.cjs post notionhq DcjRsxVFJvp   # → inspo/notionhq/DcjRsxVFJvp/
```

Then add the post to `tools/annotations.json` and run `python3 inspo/tools/index.py` to regenerate INDEX.md. Reels are skipped on purpose; posts that mix video slides keep only the poster frames and are flagged `video` in the index.

Why not Claude in Chrome: its screenshot-to-disk never returns a path and image URLs are redacted from page scripts, so nothing could be saved. The embed route is faster anyway (79 posts in about six minutes).
