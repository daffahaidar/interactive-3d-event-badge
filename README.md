# Interactive 3D Event Badge

If you find it useful, give this repository a star⭐ as a sign of thanks

## Inspiration

[Building an interactive 3D event badge with React Three Fiber](https://vercel.com/blog/building-an-interactive-3d-event-badge-with-react-three-fiber)

## The Stack

- Next Js
- Typescript
- Blender
- Three Js
- React Three Fiber
- Drei
- React-three-rapier

## Customize the card

Replace `public/assets/images/card_texture.png` with your own design. Keep the layout of the
included file: card front on the left half, card back on the right half (1080×1080). Delete the
file to get a plain white card.

The name on the card front comes from `<Band name="..." />` in `app/page.tsx`. Remove the `name`
prop if your texture already includes the name.

## Installation

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Build the project

```bash
npm run build
```

### Run the project in production mode

```bash
npm run start
```
