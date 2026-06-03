---
name: apm-viewer-design
description: Use this skill to generate well-branded interfaces and assets for APM Viewer (api-ui), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping a precise, calm, information-dense developer tool (Linear/GitHub/Vercel register) with a central status color system, light + dark themes, and first-class copy/clipboard affordances.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

Key resources:
- `README.md` — product context, content fundamentals, visual foundations, iconography, manifest.
- `colors_and_type.css` — all design tokens (light + dark, status system, type scale, spacing). Start here.
- `preview/*.html` — visual reference cards for every foundation and component.
- `ui_kits/apm-viewer/` — the full React click-through UI kit; lift components/screens from here.
- `assets/` — brand mark (`logo.svg`) and a sample figure.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create
static HTML files for the user to view. Link `colors_and_type.css` and the relevant UI-kit CSS; reuse
the class vocabulary (`status-badge`, `gnode`, `id-chip`, `wi-row`, `md-*`, etc). If working on
production code, copy assets and read the rules here to become an expert in designing with this brand.

Non-negotiables for this brand: status legibility is paramount (use the status tokens, never invent
status colors); monospace for IDs/code, Geist sans for prose; everything must work in light **and**
dark; copy/clipboard affordances are first-class and always confirm ("Copied ✓"); read-only write
actions appear as disabled "soon" previews; no emoji in UI chrome, no gradients except the live-pulse.

If the user invokes this skill without any other guidance, ask them what they want to build or design,
ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code,
depending on the need.
