# Draws every Babillard icon from one definition: a flyer with a tear line and five
# tear-off tabs, one already taken. Run from apps/mobile: python3 scripts/make-icons.py
from pathlib import Path

from PIL import Image, ImageDraw

INK = (21, 23, 61, 255)
PINK = (255, 95, 174, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)
SUPERSAMPLE = 4
TABS = 5
TAKEN = {3}

root = Path(__file__).resolve().parent.parent
assets = root / "assets"
site = root.parent / "site" / "public" / "site"


def flyer(size: int, colour, background, scale: float = 1.0) -> Image.Image:
    """The mark centred on a square canvas. scale shrinks it, for masks that crop the edges."""
    s = size * SUPERSAMPLE
    image = Image.new("RGBA", (s, s), background)
    draw = ImageDraw.Draw(image)
    half_w, half_h = 0.23 * scale, 0.30 * scale
    x0, x1 = int(s * (0.5 - half_w)), int(s * (0.5 + half_w))
    y0, y1 = int(s * (0.5 - half_h)), int(s * (0.5 + half_h))
    radius = int(s * 0.035 * scale)
    tear = y0 + int((y1 - y0) * 0.62)
    gap = int(s * 0.028 * scale)
    draw.rounded_rectangle((x0, y0, x1, tear), radius=radius, fill=colour)
    tab_width = ((x1 - x0) - gap * (TABS - 1)) / TABS
    for i in range(TABS):
        if i in TAKEN:
            continue
        left = x0 + i * (tab_width + gap)
        draw.rounded_rectangle((left, tear + gap, left + tab_width, y1), radius=int(radius * 0.7), fill=colour)
    return image.resize((size, size), Image.LANCZOS)


# iOS and the store listing: full bleed, the system rounds the corners.
flyer(1024, INK, PINK).convert("RGB").save(assets / "icon.png")
# Android adaptive icon: launchers crop to a circle or squircle inside the middle 66 of 108 dp.
flyer(1024, INK, CLEAR, scale=0.75).save(assets / "adaptive-icon.png")
# Android 13+ themed icons recolour this silhouette to match the wallpaper.
flyer(1024, WHITE, CLEAR, scale=0.75).save(assets / "monochrome-icon.png")
# Splash: the mark alone, on the pink set in app.config.ts.
flyer(800, INK, CLEAR).save(assets / "splash.png")
# Status bar: Android paints every opaque pixel white, so it must be a silhouette.
flyer(96, WHITE, CLEAR, scale=1.25).save(assets / "notification-icon.png")
# Website favicon and header.
flyer(512, INK, PINK).save(site / "icon.png")
print("wrote icons to", assets, "and", site)
