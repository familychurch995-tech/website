"""
Family Church — Image Processing Tool

Processes logo, event, and stock images for web use.

Usage:
    python tools/process_images.py --logo      # Extract logo with transparent bg
    python tools/process_images.py --events    # Optimize event images
    python tools/process_images.py --stock     # Process church stock photos
    python tools/process_images.py --all       # Everything

Requires: pip install Pillow
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Pillow is required. Install it with: pip install Pillow")
    sys.exit(1)

# Project root (one level up from tools/)
ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = ROOT / "images"
LOGO_SOURCE = ROOT / "Faily Church Logo.jpeg"

# ── Logo Processing ──────────────────────────────────────────────


def process_logo():
    """Extract logo from JPEG, remove white bg, crop, and save variants."""

    if not LOGO_SOURCE.exists():
        print(f"Logo source not found: {LOGO_SOURCE}")
        return False

    print(f"Reading logo from: {LOGO_SOURCE}")
    img = Image.open(LOGO_SOURCE).convert("RGBA")
    pixels = img.load()
    w, h = img.size
    print(f"  Original size: {w}x{h}")

    # Step 1: Remove white background (threshold-based)
    # Any pixel where R, G, B are all > 230 becomes transparent
    WHITE_THRESHOLD = 230
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if r > WHITE_THRESHOLD and g > WHITE_THRESHOLD and b > WHITE_THRESHOLD:
                pixels[x, y] = (r, g, b, 0)  # fully transparent

    # Step 2: Auto-crop to content bounds
    bbox = img.getbbox()
    if not bbox:
        print("  ERROR: Image is entirely transparent after white removal!")
        return False

    cropped = img.crop(bbox)
    cw, ch = cropped.size
    print(f"  Cropped to content: {cw}x{ch}")

    # Step 3: Add small padding (4% of the larger dimension)
    pad = max(int(max(cw, ch) * 0.04), 4)
    padded = Image.new("RGBA", (cw + pad * 2, ch + pad * 2), (0, 0, 0, 0))
    padded.paste(cropped, (pad, pad))
    pw, ph = padded.size
    print(f"  With padding: {pw}x{ph}")

    # Step 4: Save black-on-transparent (for navbar)
    out_logo = IMAGES_DIR / "logo.png"
    padded.save(out_logo, "PNG", optimize=True)
    size_kb = out_logo.stat().st_size / 1024
    print(f"  Saved: {out_logo} ({size_kb:.1f} KB)")

    # Step 5: Create white variant (for footer on dark bg)
    # Invert only the non-transparent pixels: black ->white
    white_img = padded.copy()
    wpx = white_img.load()
    ww, wh = white_img.size
    for y in range(wh):
        for x in range(ww):
            r, g, b, a = wpx[x, y]
            if a > 0:  # only invert visible pixels
                wpx[x, y] = (255 - r, 255 - g, 255 - b, a)

    out_white = IMAGES_DIR / "logo-white.png"
    white_img.save(out_white, "PNG", optimize=True)
    size_kb = out_white.stat().st_size / 1024
    print(f"  Saved: {out_white} ({size_kb:.1f} KB)")

    # Step 6: Extract icon-only (the circle with family figures at the top)
    # The icon is roughly the top 45% of the cropped content
    icon_h = int(ch * 0.45)
    icon_region = cropped.crop((0, 0, cw, icon_h))

    # Re-crop to actual content within that region
    icon_bbox = icon_region.getbbox()
    if icon_bbox:
        icon_cropped = icon_region.crop(icon_bbox)
        iw, ih = icon_cropped.size
        ipad = max(int(max(iw, ih) * 0.06), 4)
        icon_padded = Image.new("RGBA", (iw + ipad * 2, ih + ipad * 2), (0, 0, 0, 0))
        icon_padded.paste(icon_cropped, (ipad, ipad))

        out_icon = IMAGES_DIR / "logo-icon.png"
        icon_padded.save(out_icon, "PNG", optimize=True)
        size_kb = out_icon.stat().st_size / 1024
        print(f"  Saved: {out_icon} ({size_kb:.1f} KB)")

    print("  Logo processing complete!")
    return True


# ── Event Image Optimization ─────────────────────────────────────


MAX_WIDTH = 1200
JPEG_QUALITY = 82


def optimize_event_images():
    """Scan images/events/ and optimize all images for web."""
    events_dir = IMAGES_DIR / "events"
    if not events_dir.exists():
        print("No images/events/ directory found. Skipping.")
        return True

    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}
    optimized = 0

    for event_folder in events_dir.iterdir():
        if not event_folder.is_dir():
            continue

        for img_path in event_folder.iterdir():
            if img_path.suffix.lower() not in image_exts:
                continue
            if img_path.stem.endswith(".original"):
                continue  # skip backups

            original_size = img_path.stat().st_size
            print(f"\n  Processing: {img_path.relative_to(ROOT)}")
            print(f"    Original: {original_size / 1024:.0f} KB")

            img = Image.open(img_path)
            w, h = img.size
            print(f"    Dimensions: {w}x{h}")

            # Resize if wider than MAX_WIDTH
            if w > MAX_WIDTH:
                ratio = MAX_WIDTH / w
                new_h = int(h * ratio)
                img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)
                print(f"    Resized to: {MAX_WIDTH}x{new_h}")

            # Convert to RGB (drop alpha if present — event images don't need transparency)
            if img.mode in ("RGBA", "P"):
                bg = Image.new("RGB", img.size, (0, 0, 0))
                if img.mode == "P":
                    img = img.convert("RGBA")
                bg.paste(img, mask=img.split()[3])
                img = bg

            # Save as optimized JPEG
            # Back up the original first
            backup = img_path.with_suffix(img_path.suffix + ".original")
            if not backup.exists():
                img_path.rename(backup)
            else:
                # backup already exists from a previous run, just overwrite the output
                pass

            # Always save as .jpg for web
            out_path = img_path.with_suffix(".jpg")
            img.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
            new_size = out_path.stat().st_size
            savings = (1 - new_size / original_size) * 100
            print(f"    Optimized: {new_size / 1024:.0f} KB (saved {savings:.0f}%)")
            print(f"    Output: {out_path.relative_to(ROOT)}")

            # If we saved as .jpg but original was .png, remove the original .png
            # (backup is kept as .png.original)
            if img_path.suffix.lower() != ".jpg" and img_path.exists():
                img_path.unlink()

            optimized += 1

    print(f"\n  Optimized {optimized} event image(s).")
    return True


# ── Stock Photo Processing ───────────────────────────────────────

STOCK_SOURCE = ROOT / "Church Stock photos"
STOCK_OUTPUT = IMAGES_DIR / "stock"
STOCK_MAX_WIDTH = 1600
STOCK_QUALITY = 82

# Mapping: source filename ->output name
STOCK_MAP = {
    "DSC07416.JPG": "pastors-worship.jpg",
    "DSC07427.JPG": "pastor-preaching.jpg",
    "DSC07437.JPG": "congregation-worship.jpg",
    "DSC07412.JPG": "worship-wide.jpg",
    "DSC07407.JPG": "worship-band-logo.jpg",
    "DSC07408.JPG": "worship-hand-raised.jpg",
    "DSC06279.JPG": "worship-singers.jpg",
    "DSC06278.JPG": "kid-singing.jpg",
    "DSC06582.JPG": "prayer.jpg",
    "DSC06584.JPG": "worship-candles.jpg",
    "DSC06123.JPG": "welcome-greeting.jpg",
    "DSC06127.JPG": "fellowship-table.jpg",
    "DSC06147.JPG": "kids-marshmallows.jpg",
    "914144AB-B070-4906-9933-BAB1EA10CEE9.jpeg": "youth-party.jpg",
}


def process_stock_photos():
    """Process church stock photos: fix rotation, resize, optimize."""
    if not STOCK_SOURCE.exists():
        print(f"  Stock photos directory not found: {STOCK_SOURCE}")
        return False

    STOCK_OUTPUT.mkdir(parents=True, exist_ok=True)
    processed = 0

    for src_name, out_name in STOCK_MAP.items():
        src_path = STOCK_SOURCE / src_name
        if not src_path.exists():
            print(f"  SKIP (not found): {src_name}")
            continue

        print(f"\n  Processing: {src_name} ->{out_name}")
        img = Image.open(src_path)

        # Fix EXIF rotation (handles sideways photos)
        img = ImageOps.exif_transpose(img)

        w, h = img.size
        print(f"    Original: {w}x{h}")

        # Resize if wider than max
        if w > STOCK_MAX_WIDTH:
            ratio = STOCK_MAX_WIDTH / w
            new_h = int(h * ratio)
            img = img.resize((STOCK_MAX_WIDTH, new_h), Image.LANCZOS)
            print(f"    Resized:  {STOCK_MAX_WIDTH}x{new_h}")

        # Convert to RGB
        if img.mode != "RGB":
            img = img.convert("RGB")

        # Save optimized JPEG
        out_path = STOCK_OUTPUT / out_name
        img.save(out_path, "JPEG", quality=STOCK_QUALITY, optimize=True)
        size_kb = out_path.stat().st_size / 1024
        original_kb = src_path.stat().st_size / 1024
        savings = (1 - size_kb / original_kb) * 100
        print(f"    Saved:    {out_path.relative_to(ROOT)} ({size_kb:.0f} KB, saved {savings:.0f}%)")
        processed += 1

    print(f"\n  Processed {processed} stock photo(s).")
    return True


# ── Main ─────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Family Church image processing tool")
    parser.add_argument("--logo", action="store_true", help="Process logo (extract, crop, transparent bg)")
    parser.add_argument("--events", action="store_true", help="Optimize event images for web")
    parser.add_argument("--stock", action="store_true", help="Process church stock photos for web")
    parser.add_argument("--all", action="store_true", help="Process everything")
    args = parser.parse_args()

    if not (args.logo or args.events or args.stock or args.all):
        parser.print_help()
        return

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    if args.logo or args.all:
        print("\n=== Processing Logo ===")
        process_logo()

    if args.events or args.all:
        print("\n=== Optimizing Event Images ===")
        optimize_event_images()

    if args.stock or args.all:
        print("\n=== Processing Stock Photos ===")
        process_stock_photos()

    print("\nDone!")


if __name__ == "__main__":
    main()
