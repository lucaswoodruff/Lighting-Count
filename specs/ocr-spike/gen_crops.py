"""Generate synthetic test crops mimicking scanned electrical-drawing text.

Two classes of fixture:
  tags/     - tiny sparse fixture tags (A2, F-3, EM1...) at drawing-realistic
              pixel sizes, some rotated 90/180/270, light scan noise.
  schedule/ - a fixture-schedule table region (larger, grid-aligned text).

Ground truth is encoded in the filename: <truth>__rot<deg>.png (dashes kept).
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

random.seed(42)
OUT = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(os.path.join(OUT, "tags"), exist_ok=True)
os.makedirs(os.path.join(OUT, "schedule"), exist_ok=True)

def load_font(px):
    for name in ("DejaVuSansMono.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            pass
    return ImageFont.load_default()

def scanify(img):
    """Light scan artifacts: slight blur, gray noise, threshold-ish look."""
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            v = px[x, y]
            v = min(255, max(0, v + random.randint(-18, 18)))
            px[x, y] = v
    return img

# --- fixture tags: tiny text on sparse background -------------------------
TAGS = ["A2", "F-3", "EM1", "B12", "X-1", "L4A", "W2", "S-10"]
ROTS = {0: 5, 90: 2, 180: 1, 270: 1}  # counts per rotation bucket
rot_plan = [r for r, n in ROTS.items() for _ in range(n)][: len(TAGS) + 1]

for i, tag in enumerate(TAGS):
    rot = rot_plan[i % len(rot_plan)]
    font_px = random.choice([9, 10, 11, 12])  # realistic tag size at 1x render
    font = load_font(font_px)
    img = Image.new("L", (72, 48), 255)
    d = ImageDraw.Draw(img)
    # a bit of drawing clutter: a leader line and part of a fixture circle
    d.line((4, 40, 30, 30), fill=90, width=1)
    d.arc((44, 28, 68, 52), 180, 300, fill=110)
    d.text((18, 16), tag, font=font, fill=20)
    img = scanify(img)
    if rot:
        img = img.rotate(rot, expand=True, fillcolor=255)
    img.save(os.path.join(OUT, "tags", f"{tag}__rot{rot}.png"))

# --- schedule table region ------------------------------------------------
rows = [
    ("TYPE", "DESCRIPTION", "WATTS"),
    ("A2", "2X4 LED TROFFER", "38"),
    ("F-3", "STRIP LIGHT 4FT", "30"),
    ("EM1", "EXIT/EM COMBO", "5"),
    ("B12", "DOWNLIGHT 6IN", "12"),
]
cellw, cellh = (150, 260, 90), 34
W, H = sum(cellw) + 2, cellh * len(rows) + 2
img = Image.new("L", (W, H), 255)
d = ImageDraw.Draw(img)
font = load_font(16)
for r, row in enumerate(rows):
    x = 1
    for c, text in enumerate(row):
        d.rectangle((x, 1 + r * cellh, x + cellw[c], 1 + (r + 1) * cellh), outline=60)
        d.text((x + 8, 8 + r * cellh), text, font=font, fill=15)
        x += cellw[c]
img = scanify(img)
img.save(os.path.join(OUT, "schedule", "schedule.png"))

# ground-truth text file for the schedule
with open(os.path.join(OUT, "schedule", "schedule.truth.txt"), "w") as f:
    for row in rows:
        f.write(" ".join(row) + "\n")

print("done:", sum(len(fs) for _, _, fs in os.walk(OUT)), "files in", OUT)
