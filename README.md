# Thoughts

Source for [thoughts.vimal.works](https://thoughts.vimal.works/), a small public archive of short philosophical thoughts.

## About

The site presents thoughts as a simple visual archive. New entries appear over time, and the homepage always reflects the current published collection.

## Project files

- `index.html` - main page shell
- `admin.html` - private sign-in and moderation page
- `assets/css/` - stylesheet files for the public site and admin
- `assets/js/` - browser-side scripts and configuration
- `data/thoughts.json` - published thought archive
- `assets/` - local fonts and browser-side dependencies
- `infra/` - workflow and infrastructure reference files
- `CNAME` - custom domain mapping for GitHub Pages
- `robots.txt` - crawler directives
- `sitemap.xml` - sitemap for search engines
- `llms.txt` - plain-language guidance for language models and automated readers

## Local preview

Serve the folder with any static server. One simple option:

```bash
python3 -m http.server 4173
```

Then open [http://127.0.0.1:4173/](http://127.0.0.1:4173/).
