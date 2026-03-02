#!/usr/bin/env python3
"""
Generate .forge file type icon assets for macOS (.icns), Windows (.ico), and Linux (.png).

Produces a document-shaped icon with a folded corner and a lightning bolt,
matching the ForgeFileIcon SVG in the UI but rendered at high resolution.

Colors: deep indigo document (#4338CA) with white lightning bolt on a subtle gradient.
"""

from PIL import Image, ImageDraw
import struct
import os

SIZES = [16, 32, 64, 128, 256, 512, 1024]
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'resources')


def draw_forge_icon(size: int) -> Image.Image:
    """Draw the .forge file icon at the given size."""
    # Work at 4x for antialiasing, then downscale
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Margins
    mx = int(s * 0.12)  # horizontal margin
    my = int(s * 0.06)  # top margin
    mb = int(s * 0.06)  # bottom margin
    fold = int(s * 0.22)  # corner fold size

    # Document body coordinates
    left = mx
    top = my
    right = s - mx
    bottom = s - mb

    # --- Shadow ---
    shadow_off = int(s * 0.02)
    shadow_pts = [
        (left + shadow_off, top + shadow_off),
        (right - fold + shadow_off, top + shadow_off),
        (right + shadow_off, top + fold + shadow_off),
        (right + shadow_off, bottom + shadow_off),
        (left + shadow_off, bottom + shadow_off),
    ]
    draw.polygon(shadow_pts, fill=(0, 0, 0, 40))

    # --- Document body (indigo gradient approximation) ---
    # Base color: indigo-700
    base_r, base_g, base_b = 67, 56, 202  # #4338CA
    dark_r, dark_g, dark_b = 49, 46, 129  # #312E81 (darker bottom)

    # Draw gradient by horizontal bands
    doc_pts = [
        (left, top),
        (right - fold, top),
        (right, top + fold),
        (right, bottom),
        (left, bottom),
    ]
    # Fill solid first
    draw.polygon(doc_pts, fill=(base_r, base_g, base_b, 255))

    # Overlay a subtle gradient (darken toward bottom)
    for y_pos in range(top, bottom):
        t = (y_pos - top) / max(bottom - top, 1)
        r = int(base_r + (dark_r - base_r) * t * 0.5)
        g = int(base_g + (dark_g - base_g) * t * 0.5)
        b = int(base_b + (dark_b - base_b) * t * 0.5)
        draw.line([(left, y_pos), (right, y_pos)], fill=(r, g, b, 255))

    # Re-clip to document shape (clear outside)
    mask = Image.new('L', (s, s), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon(doc_pts, fill=255)
    # Apply mask
    r_ch, g_ch, b_ch, a_ch = img.split()
    from PIL import ImageChops
    a_ch = ImageChops.multiply(a_ch, mask)
    img = Image.merge('RGBA', (r_ch, g_ch, b_ch, a_ch))
    draw = ImageDraw.Draw(img)

    # --- Folded corner ---
    fold_pts = [
        (right - fold, top),
        (right, top + fold),
        (right - fold, top + fold),
    ]
    # Lighter shade for the fold
    draw.polygon(fold_pts, fill=(99, 102, 241, 255))  # indigo-500

    # Fold crease line
    draw.line([(right - fold, top), (right, top + fold)],
              fill=(55, 48, 163, 255), width=max(1, int(s * 0.005)))

    # --- Document border (subtle) ---
    draw.line([(left, top), (right - fold, top)],
              fill=(55, 48, 163, 200), width=max(1, int(s * 0.005)))
    draw.line([(right, top + fold), (right, bottom)],
              fill=(55, 48, 163, 200), width=max(1, int(s * 0.005)))
    draw.line([(right, bottom), (left, bottom)],
              fill=(55, 48, 163, 200), width=max(1, int(s * 0.005)))
    draw.line([(left, bottom), (left, top)],
              fill=(55, 48, 163, 200), width=max(1, int(s * 0.005)))

    # --- Lightning bolt (white, centered in document) ---
    cx = (left + right) / 2
    cy = (top + fold + bottom) / 2 + s * 0.02  # slightly below center to account for fold

    bw = s * 0.22  # bolt width
    bh = s * 0.42  # bolt height

    # Lightning bolt points (relative to center)
    bolt = [
        (cx + bw * 0.1,  cy - bh * 0.5),    # top right
        (cx - bw * 0.25, cy - bh * 0.02),    # middle left notch
        (cx + bw * 0.05, cy - bh * 0.02),    # middle right notch
        (cx - bw * 0.1,  cy + bh * 0.5),     # bottom left
        (cx + bw * 0.25, cy + bh * 0.02),    # middle right notch 2
        (cx - bw * 0.05, cy + bh * 0.02),    # middle left notch 2
    ]
    bolt_int = [(int(x), int(y)) for x, y in bolt]
    draw.polygon(bolt_int, fill=(255, 255, 255, 240))

    # Subtle glow around bolt
    for offset in range(1, max(2, int(s * 0.01))):
        glow_bolt = [(int(x), int(y + offset)) for x, y in bolt]
        draw.polygon(glow_bolt, fill=(255, 255, 255, 20))

    # --- ".forge" text label at bottom ---
    if size >= 64:
        # Only render text on larger icons
        from PIL import ImageFont
        font_size = int(s * 0.085)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/SFCompact.ttf", font_size)
        except (OSError, IOError):
            try:
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
            except (OSError, IOError):
                font = ImageFont.load_default()

        text = ".forge"
        # Text background pill
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = int(cx - tw / 2)
        ty = int(bottom - th - s * 0.08)

        pill_pad_x = int(s * 0.03)
        pill_pad_y = int(s * 0.015)
        pill_rect = [
            tx - pill_pad_x, ty - pill_pad_y,
            tx + tw + pill_pad_x, ty + th + pill_pad_y
        ]
        draw.rounded_rectangle(pill_rect, radius=int(s * 0.02),
                               fill=(255, 255, 255, 200))
        draw.text((tx, ty), text, fill=(49, 46, 129, 255), font=font)

    # Downscale with high-quality resampling
    img = img.resize((size, size), Image.LANCZOS)
    return img


def generate_iconset(base_dir: str):
    """Generate macOS .iconset directory."""
    iconset_dir = os.path.join(base_dir, 'forge-file.iconset')
    os.makedirs(iconset_dir, exist_ok=True)

    # macOS expects specific sizes: 16, 32, 128, 256, 512 (and @2x variants)
    mac_sizes = [
        ('icon_16x16.png', 16),
        ('icon_16x16@2x.png', 32),
        ('icon_32x32.png', 32),
        ('icon_32x32@2x.png', 64),
        ('icon_128x128.png', 128),
        ('icon_128x128@2x.png', 256),
        ('icon_256x256.png', 256),
        ('icon_256x256@2x.png', 512),
        ('icon_512x512.png', 512),
        ('icon_512x512@2x.png', 1024),
    ]

    for filename, size in mac_sizes:
        icon = draw_forge_icon(size)
        icon.save(os.path.join(iconset_dir, filename), 'PNG')
        print(f'  {filename} ({size}x{size})')

    return iconset_dir


def generate_ico(base_dir: str):
    """Generate Windows .ico file."""
    ico_sizes = [16, 32, 48, 64, 128, 256]
    images = []
    for size in ico_sizes:
        images.append(draw_forge_icon(size))

    ico_path = os.path.join(base_dir, 'forge-file.ico')
    # Save using Pillow's ICO support
    images[0].save(
        ico_path, format='ICO',
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:]
    )
    print(f'  forge-file.ico ({len(ico_sizes)} sizes)')
    return ico_path


def generate_png(base_dir: str):
    """Generate high-res PNG for Linux and general use."""
    for size in [128, 256, 512]:
        icon = draw_forge_icon(size)
        path = os.path.join(base_dir, f'forge-file-{size}.png')
        icon.save(path, 'PNG')
        print(f'  forge-file-{size}.png')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print('Generating macOS iconset...')
    iconset_dir = generate_iconset(OUT_DIR)

    print('Generating Windows .ico...')
    generate_ico(OUT_DIR)

    print('Generating Linux PNGs...')
    generate_png(OUT_DIR)

    # Also generate the app icon (same design but without the .forge label,
    # just the lightning bolt document)
    print('\nDone! Icon assets saved to:', OUT_DIR)
    print(f'\nTo create .icns (macOS), run:')
    print(f'  iconutil -c icns {iconset_dir}')


if __name__ == '__main__':
    main()
