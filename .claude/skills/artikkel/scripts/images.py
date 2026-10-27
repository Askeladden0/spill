"""Bildehjelper for /artikkel.

  images.py sheet <mappe> <ut.png>                 kontaktark av alle .jpg i mappa
  images.py prep <inn> <ut.webp> <16:9|3:2> [fy]   beskjær til 1200 px bredde og lagre som WebP
                                                   (fy = vertikalt fokus 0-1, standard 0.5)
"""
import os
import sys

from PIL import Image, ImageDraw, ImageOps


def sheet(folder, out):
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
    w, h, cols = 300, 200, 4
    rows = (len(files) + cols - 1) // cols
    canvas = Image.new("RGB", (w * cols, (h + 20) * max(rows, 1)), "white")
    draw = ImageDraw.Draw(canvas)
    for i, name in enumerate(files):
        im = Image.open(os.path.join(folder, name)).convert("RGB")
        im.thumbnail((w, h))
        x, y = (i % cols) * w, (i // cols) * (h + 20)
        canvas.paste(im, (x, y))
        draw.text((x + 3, y + h + 3), f"{i}: {name[:30]}", fill="black")
    canvas.save(out)
    print(out, f"{len(files)} bilder")


def prep(src, dst, ratio, focus_y=0.5):
    a, b = (float(n) for n in ratio.split(":"))
    width = 1200
    height = round(width * b / a)
    im = Image.open(src).convert("RGB")
    im = ImageOps.fit(im, (width, height), Image.LANCZOS, centering=(0.5, focus_y))
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    im.save(dst, "WEBP", quality=78, method=6)
    print(dst, im.size, f"{os.path.getsize(dst) // 1024} kB")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "sheet" and len(sys.argv) == 4:
        sheet(sys.argv[2], sys.argv[3])
    elif cmd == "prep" and len(sys.argv) in (5, 6):
        prep(sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]) if len(sys.argv) == 6 else 0.5)
    else:
        sys.exit(__doc__)
