# Thoughts

Static GitHub Pages site for `thoughts.vimal.works`.

## Structure

- `index.html` - app shell
- `style.css` - visual system and responsive grid
- `script.js` - fetches and renders `data/thoughts.json`
- `data/thoughts.json` - content source updated by automation
- `assets/fonts/` - local Plus Jakarta Sans font files
- `assets/vendor/` - local browser dependencies
- `CNAME` - GitHub Pages custom domain

## Local preview

Serve the folder with any static server, for example:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.
