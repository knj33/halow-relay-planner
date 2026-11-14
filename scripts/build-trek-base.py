"""Builds a bundled equirectangular base map by stitching one zoom level of a NASA Trek
EPSG:4326 WMTS layer (2^(z+1) x 2^z tiles of 256 px, lon -180..180, lat +90..-90).

The result is what scripts/build-base-textures.mjs expects as input, already at its output size,
so ImageMagick is not needed. Requires Pillow.

Usage:
  python scripts/build-trek-base.py <layer-url-template> <output.jpg> [zoom=2]

Mars example (Viking MDIM 2.1 colour mosaic, NASA Mars Trek):
  python scripts/build-trek-base.py \
    "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg" \
    public/base/mars.jpg 2
"""
import io
import sys
import urllib.request

from PIL import Image


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    template, output = sys.argv[1], sys.argv[2]
    z = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    cols, rows = 2 ** (z + 1), 2 ** z
    canvas = Image.new("RGB", (cols * 256, rows * 256))
    for y in range(rows):
        for x in range(cols):
            url = template.replace("{z}", str(z)).replace("{y}", str(y)).replace("{x}", str(x))
            with urllib.request.urlopen(url, timeout=60) as res:
                tile = Image.open(io.BytesIO(res.read())).convert("RGB")
            canvas.paste(tile.resize((256, 256)), (x * 256, y * 256))
    canvas.save(output, "JPEG", quality=82, progressive=True, optimize=True)
    print(f"wrote {output} ({canvas.width}x{canvas.height})")


if __name__ == "__main__":
    main()
