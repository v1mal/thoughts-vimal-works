# Thoughts

Static GitHub Pages site for `thoughts.vimal.works`.

## Structure

- `index.html` - app shell
- `style.css` - visual system and responsive grid
- `script.js` - fetches and renders `data/thoughts.json`
- `admin.html` - private moderation UI entry point
- `admin.css` / `admin.js` - Supabase-backed moderation experience
- `admin-config.js` - project-specific Supabase/admin settings
- `data/thoughts.json` - content source updated by automation
- `supabase/001_thoughts_schema.sql` - schema, RLS, and export view
- `scripts/backfill_supabase.py` - backfill helper for archive + n8n history
- `n8n/` - Supabase generation and export workflow artifacts
- `assets/fonts/` - local Plus Jakarta Sans font files
- `assets/vendor/` - local browser dependencies
- `CNAME` - GitHub Pages custom domain
- `robots.txt` - crawler directives
- `sitemap.xml` - sitemap for search engines

## Supabase moderation setup

1. Create a Supabase project on the free plan.
2. In the SQL editor, run [`supabase/001_thoughts_schema.sql`](/Users/vimal/Desktop/Thoughts/supabase/001_thoughts_schema.sql).
3. In Supabase Auth, enable Google and add the callback URL:

```text
https://thoughts.vimal.works/admin.html
```

4. Update [`admin-config.js`](/Users/vimal/Desktop/Thoughts/admin-config.js) with:
   - your project URL
   - your anon key
   - optional export webhook URL after you import the export workflow into n8n
5. Import these workflows into n8n:
   - [`n8n/thoughts-supabase-generation-workflow.json`](/Users/vimal/Desktop/Thoughts/n8n/thoughts-supabase-generation-workflow.json)
   - [`n8n/thoughts-supabase-export-workflow.json`](/Users/vimal/Desktop/Thoughts/n8n/thoughts-supabase-export-workflow.json)
6. Replace the placeholders in each workflow `Config` node.

Important:

- Keep the `n8n/` workflow files in this repo as sanitized templates only.
- Do not commit workflow exports that contain real API keys, PATs, or service-role credentials.

## Backfill

Backfill the current public archive and, optionally, exported n8n history into Supabase:

```bash
python3 scripts/backfill_supabase.py \
  --supabase-url https://YOUR_PROJECT.supabase.co \
  --service-role-key YOUR_SERVICE_ROLE_KEY \
  --archive data/thoughts.json \
  --history /path/to/n8n-history-export.json
```

Notes:

- `--history` is optional.
- Archive thoughts are imported as `approved`.
- Historical n8n rows are mapped from `published` to `approved` and `rejected` to `rejected`.
- If the n8n export does not contain stable ids, the script generates deterministic history ids and merges rows by exact text where possible.

## Local preview

Serve the folder with any static server, for example:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.
