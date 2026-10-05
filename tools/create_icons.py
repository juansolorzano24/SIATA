"""Genera los iconos de la app con geometría propia; requiere Pillow solo al regenerarlos."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "icons"
root.mkdir(exist_ok=True)
for filename, size in [("icon-192.png", 192), ("icon-512.png", 512),
                       ("maskable-512.png", 512), ("apple-touch-icon.png", 180)]:
    image = Image.new("RGB", (1536, 1536), "#09283e")
    draw = ImageDraw.Draw(image)
    draw.ellipse((288, 288, 1248, 1248), outline="#2a617b", width=36)
    draw.ellipse((432, 432, 1104, 1104), outline="#2a617b", width=30)
    draw.polygon([(768, 411), (536, 786), (1000, 786)], fill="#52cde5")
    draw.ellipse((516, 609, 1020, 1113), fill="#52cde5")
    draw.arc((650, 755, 870, 990), 90, 180, fill="#e5faff", width=36)
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / filename)
print("Iconos 192, 512 y Apple listos.")
