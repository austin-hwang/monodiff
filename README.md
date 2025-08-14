# MonoDiff

A modern, minimal text/JSON diff viewer. Features:

- Line numbers in unified and split views
- Floating Prev/Next and Scroll-to-Top controls
- Automatic JSON beautification on paste
- Optional manual beautify removed for a cleaner UI
- Day/Night theme toggle with improved light theme contrast
- Swap Inputs button
- Collapsible unchanged blocks (Only changes toggle)
- Inline word/char diff for single-line inputs

## Getting Started

Open `index.html` in your browser. No build step required.

## Usage Tips

- Paste JSON into either input and it will be pretty-printed automatically.
- Use the "Only changes" toggle to collapse unchanged sections.
- Switch between unified/split view and word/char tokenization for single line diffs.
- Theme preference is persisted. Toggle the theme via the header button.
- Swap A↔B with the Swap button.

## Deploy to GitHub Pages

This is a static site and works great on GitHub Pages.

1. Create a repo and push this folder to the root of the repo.
2. Add a `.nojekyll` file (already included).
3. In GitHub: Settings → Pages → Source: Deploy from a branch → Branch: `main` → Folder: `/`.
4. The site will be available at `https://<username>.github.io/<repo>/`.

## Tech

- Tailwind CSS (via CDN)
- jsdiff (via CDN)
- Vanilla JS

## License

MIT
