# portfolio-site

Riku Kanzaki's personal portfolio. Plain static HTML/CSS/JS with no build step and no dependencies.

| File | Purpose |
|------|---------|
| `index.html` | The site (single page) |
| `styles.css` | Styling |
| `main.js` | Interactivity, including the hero IK arm canvas |
| `404.html` | Not-found page |
| `favicon.svg` | Site icon |

## Preview locally

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Deploy

Asset paths are relative, so the site works at a domain root or under a project subpath.

### GitHub Pages

1. Create a repo on GitHub and push this folder to it (`main` branch).
2. In the repo, go to **Settings > Pages**.
3. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to `main`, folder `/ (root)`, then Save.
4. After a minute the site is live at `https://<user>.github.io/<repo>/`. `404.html` is served automatically for missing pages.

### Vercel

1. Go to Vercel and choose **Add New > Project**, then import the GitHub repo.
2. Set Framework Preset to **Other**.
3. Leave the build command empty and set Output Directory to `.`.
4. Click **Deploy**.
