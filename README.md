# Interactive 3D Event Badge

An interactive 3D event badge for the web. Grab the card, throw it, swing it or spin it: the lanyard
is simulated with real physics, twists when the card spins, turns the card back as it unwinds, and
loops through the ring on the card's clip. The card design and the lanyard print are plain image
files, so you can make the badge your own without opening any 3D software.

If you find it useful, give this repository a star ⭐

## Features

- Physics-based lanyard: drag, throw and swing the card
- 3D band with real thickness that twists with the card, and a torsion force that turns the card back
- Band loops through the ring on the card's clip
- Looks the same on phone, tablet and desktop
- Custom card design from a single PNG, with a plain white card as fallback
- Optional name printed on the card

## Inspiration

[Building an interactive 3D event badge with React Three Fiber](https://vercel.com/blog/building-an-interactive-3d-event-badge-with-react-three-fiber)

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router), React 19, TypeScript
- [three.js](https://threejs.org), [React Three Fiber](https://r3f.docs.pmnd.rs), [Drei](https://drei.docs.pmnd.rs)
- [react-three-rapier](https://github.com/pmndrs/react-three-rapier) (Rapier physics)
- Tailwind CSS 4
- Blender (card model)

## Getting started

Requires Node.js 20.9 or later.

```bash
git clone https://github.com/daffahaidar/interactive-3d-event-badge.git
cd interactive-3d-event-badge
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

| Command         | What it does                     |
| --------------- | -------------------------------- |
| `npm run dev`   | Start the development server     |
| `npm run build` | Build for production             |
| `npm run start` | Serve the production build       |
| `npm run lint`  | Run ESLint                       |

## Customization

All assets live in `public/assets/`:

| File                        | What it is                     |
| --------------------------- | ------------------------------ |
| `images/card_texture.png`   | Card design, front and back    |
| `images/tag_texture.png`    | Print on the lanyard band      |
| `3d/card.glb`               | Card, ring and hook model      |

The included artwork (photo and Digital Infinit branding) is only an example. Replace it with your own.

### Card design: `card_texture.png`

One image holds both sides of the card.

- **Size:** 1080 × 1080 px, ratio **1:1**. Other square sizes work too (for example 2048 × 2048 for a
  sharper card), as long as the layout below keeps the same proportions.
- **Format:** opaque PNG. Transparent areas are not see-through on the card.

```text
x: 0            540           1080
   ┌─────────────┬─────────────┐  y: 0
   │             │             │
   │    FRONT    │    BACK     │
   │  540 × 815  │  540 × 815  │
   │             │             │
   ├─────────────┴─────────────┤  y: 815
   │          (unused)         │
   └───────────────────────────┘  y: 1080
```

| Area   | Pixels in a 1080 × 1080 file | Share of the image      |
| ------ | ---------------------------- | ----------------------- |
| Front  | x 0–540, y 0–815             | left 50 %, top 75.5 %   |
| Back   | x 540–1080, y 0–815          | right 50 %, top 75.5 %  |
| Unused | y 815–1080                   | bottom 24.5 %           |

Each side is **540 × 815 px (about 2:3)**. Draw both sides upright and unmirrored. The back appears the
way you see it when you turn the card around. The included `card_texture.png` is a ready-made template.

Tips:

- **Stretch:** the card is slightly wider than its panel (about 5:7 instead of 2:3), so artwork is
  stretched about 8 % horizontally. If a logo or face must keep exact proportions, squeeze it to about
  93 % of its width in the texture.
- **Margins:** keep important content at least 40 px from the panel edges. The card corners are
  rounded, and the card's thin edges take their color from the border pixels of each panel.
- **Hole:** keep the top center clear. The hole for the hook sits around x 255–290, y 55–90 on the front
  (x 790–825 on the back).
- **Name:** the optional name is drawn near the bottom left of the front (around x 45–310, y 705–755).
  Keep that area calm if you use it.
- **Plain card:** delete `card_texture.png` to get a plain white card.

### Name on the card

The name comes from the `name` prop in `app/page.tsx`:

```tsx
<Band name="Daffa Haidar" />
```

Remove the prop if your card design already includes the name. The text is white Inter, so it is not
visible on the plain white card. Change its font, color or position in the `<Text>` element in
`components/band.tsx`.

### Lanyard band: `tag_texture.png`

- **Size:** the included file is 1024 × 248 px. Use a ratio of about **4:1**, for example 1024 × 256 or
  2048 × 512.
- **Orientation:** the image runs along the band. Its width follows the length of the band and its
  height spans the band's width. The left edge points up toward the neck.
- **Repeat:** the image repeats 3 times along the band and is stretched to fit, so the exact ratio is
  not critical. To change the count, edit the `-3` in `updateRibbon` in `components/band.tsx`.
- **Rivet:** leave a blank gap in the design. `PRINT_GAP` in `components/band.tsx` is where that gap
  sits across the image's width (0 = left edge, 1 = right edge); that spot is kept under the rivet.
- **Edges:** the top and bottom rows of pixels color the thin edges of the band. Keep them plain.
- **Both sides:** the print reads correctly on both sides of the band.

### Card model: `card.glb`

- The code expects meshes named `card`, `clip` (the ring) and `clamp` (the hook), and a material named
  `metal`. The card's own material is defined in code, so the model needs no textures.
- The card mesh's UVs define the texture layout described above.
- The band's loop around the ring uses coordinates measured from this model (`LOOP` in
  `components/band.tsx`). If you replace the model, measure them again, or the band won't sit on the ring.

### Tuning

These constants are at the top of `components/band.tsx`:

| Constant         | Default | Effect                                              |
| ---------------- | ------- | --------------------------------------------------- |
| `HALF_WIDTH`     | `0.11`  | Half the width of the band                          |
| `HALF_THICKNESS` | `0.006` | Half the thickness of the band                      |
| `TORSION`        | `7.5`   | How strongly a twisted band turns the card back     |
| `GRIP`           | `25`    | How tightly a dragged card follows the pointer      |
| `RIVET_RUN`      | `0.05`  | Length of the riveted overlap above the ring        |

Camera, lights and gravity are set in `app/page.tsx`.

## Project structure

```text
app/page.tsx          Canvas, camera, lights and physics world
components/band.tsx   Lanyard band, card, physics joints and torsion
public/assets/        Card model and textures
```

## License

MIT © Daffa Haidar Nabil Zufar
