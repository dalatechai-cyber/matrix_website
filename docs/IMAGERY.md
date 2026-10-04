# Feature photos: where each one goes

Every feature photo on the site is chosen in
[data/imagery.json](../data/imagery.json), one entry per place. Pages only say
*where* a photo goes (`<!-- @image:intro-services -->`); `lib/pages.js` draws it
in the brand's arch frame, with responsive sizes. A place set to `null` shows no
photo, and the section keeps its limewash texture and soft light.

Only the salon's own photos are used: the vetted set in `data/gallery.json`
(see [PHOTOS.md](PHOTOS.md); nothing showing the old «MATRIX» name). No stock
or AI-generated pictures of salons or people.

## Swapping in the owner's new interior photos

1. Crop each photo to 4:5 and save it as WebP at 480 / 800 / 1200 px wide
   (never wider than the original) in `img/photos/`, named `<slug>-<width>.webp`.
2. Add it to `data/gallery.json` with a Mongolian description (`alt`) and the
   `salon` category, like the other photos.
3. Put its slug in the place below in `data/imagery.json`. Nothing else
   changes.

## The places

| Place (`slot`) | Page and position | Now | Best with the owner's photo of… |
| --- | --- | --- | --- |
| `home-services` | Home, beside the service list (tall arch; wide arch on phones) | `rose-waves` | the styling stations: mirrors, chairs, steel and plaster |
| `home-about` | Home, «Бидний тухай» | `cutting` | a stylist at work in the new interior |
| `intro-services` | «Үйлчилгээ ба үнэ», top right (wide window on phones) | `bronde-waves` | the colour bar or wash area |
| `intro-contact` | «Салбарууд», top right | none (texture) | the entrance or reception of each branch |
| `intro-products` | «Бүтээгдэхүүн» (Amos), top right | `tools` | the product shelf |
| `intro-keune` | «Keune», top right | none (texture) | the Keune shelf |

The home hero (`hero-mauve`) is set in `index.html` itself and stays a work
photo; it is the page's first impression.
