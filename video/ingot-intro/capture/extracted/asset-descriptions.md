# Asset Descriptions

One line per file. Read this instead of opening every image individually.

To find a specific brand or icon, **grep this file for the brand name in the description text** (e.g. `grep -i 'autodesk' asset-descriptions.md`). The Gemini Vision captions identify what's actually in each file — that's the agent's selector.

The `logo-<hash>.svg` filename prefix is a cheap structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). It is NOT a content claim — many `logo-*` files are nav icons or decorative shapes. Trust the captions, not the filename prefix.

- ingot-guide.webm — [video] 57 seconds, voiced and captioned. Nothing plays or downloads until you press play., ~1014×570
- guide-poster.jpg — 100KB, A light-themed informational slide features black text and highlighted tan segments, emphasizing the display of specific evidence.
- og-image.png — 48KB, This dark-themed website image features white and green text centered on a black background, posing a question about AI training data.
