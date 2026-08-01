# Ingot — what's inside AI training data?

Source: https://ingot-six.vercel.app

To create a video from this capture, use the `product-launch-video` skill.

## What's in This Capture

| File | Contents |
|------|----------|
| `screenshots/contact-sheet-1.jpg` | **View this first.** All scroll screenshots in labeled grid — see the entire page at a glance — page 1 of 2 |
| `screenshots/contact-sheet-2.jpg` | **View this first.** All scroll screenshots in labeled grid — see the entire page at a glance — page 2 of 2 |
| `screenshots/scroll-*.png` | Individual viewport screenshots if you need detail on a specific section. |
| `extracted/tokens.json` | Design tokens: 9 colors, 3 fonts, 9 headings, 2 CTAs |
| `extracted/design-styles.json` | Computed styles from live DOM: typography hierarchy, button/card/nav styles, spacing scale, border-radius, box shadows. Primary data source for DESIGN.md. |
| `extracted/asset-descriptions.md` | One-line description of every downloaded asset. Read this for asset selection — only open individual files for safe-zone checking. |
| `extracted/visible-text.txt` | Page text in DOM order, prefixed with HTML tag (`[h1]`, `[p]`, `[a]`). Use as context — rephrase freely. |
| `assets/contact-sheet.jpg` | Downloaded images in labeled grid — view before opening individual files |
| `assets/` | Individual downloaded images, SVGs, and font files. |

## Brand Summary

- **Colors**: #16181A (surface-dark), #F4F5F4 (bg-light), #5D6165 (neutral), #43474B (neutral), #FFFFFF (bg-light), #D9DBDA (surface-light), #B45309 (accent), #15803D (accent), #B91C1C (accent)
- **Fonts**: Archivo (400,600), Public Sans (400,500,700), JetBrains Mono (400,700)
