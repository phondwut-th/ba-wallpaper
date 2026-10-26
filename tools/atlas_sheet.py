# ตัดชิ้นส่วนทุกชิ้นออกจาก Spine atlas แล้ววางเรียงเป็นแผ่นพร้อมชื่อ — ไว้ดูว่าฉากประกอบจากอะไรบ้าง
# ใช้: .venv/bin/python -I tools/atlas_sheet.py characters/<ชื่อ> [mesh.json]   → previews/<ชื่อ>/
#   mesh.json (ไม่ใส่ก็ได้) = สามเหลี่ยม UV ของแต่ละชิ้นที่ดึงจากแอป ใช้เป็นแม่พิมพ์ตัดตามรูปทรงจริง
#   เพราะ atlas อัดแบบ polygon packing กรอบสี่เหลี่ยมของแต่ละชิ้นจึงซ้อนทับกัน ตัดเป็นสี่เหลี่ยมจะได้ชิ้นข้าง ๆ ติดมาด้วย
import json, pathlib, sys
from PIL import Image, ImageDraw, ImageFont

src = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent.parent / 'previews' / src.name
out.mkdir(parents=True, exist_ok=True)

def parse(atlas):
    pages, page, reg = [], None, None
    for raw in atlas.read_text().splitlines():
        line = raw.strip()
        if not line:
            page = reg = None; continue
        if ':' in line:
            k, v = [s.strip() for s in line.split(':', 1)]
            target = reg if reg is not None else page
            if target is not None: target[k] = v
            continue
        if page is None:
            page = {'file': line, 'regions': []}; pages.append(page)
        else:
            reg = {'name': line}; page['regions'].append(reg)
    return pages

def nums(s): return [int(float(x)) for x in s.split(',')]

meshes = json.loads(pathlib.Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else {}
pages_img = {}
pieces = []
for name, m in meshes.items():
    if m['page'] not in pages_img:
        pages_img[m['page']] = Image.open(src / m['page']).convert('RGBA')
    img = pages_img[m['page']]
    if 'tris' in m:
        mask = Image.new('L', img.size, 0)
        md = ImageDraw.Draw(mask)
        for t in m['tris']:
            md.polygon([tuple(p) for p in t], fill=255)
        md_box = mask.getbbox()
        if not md_box: continue
        piece = Image.new('RGBA', img.size, (0, 0, 0, 0))
        piece.paste(img, (0, 0), mask)
        piece = piece.crop(md_box)
    else:
        x, y, w, h = m['rect']
        piece = img.crop((x, y, x + w, y + h))
    if m.get('rot'):
        piece = piece.rotate(m['rot'], expand=True)
    pieces.append((name, piece))
for atlas in ([] if meshes else src.glob('*.atlas')):
    for page in parse(atlas):
        img = Image.open(src / page['file']).convert('RGBA')
        img.save(out / ('atlas_' + page['file']))
        for r in page['regions']:
            if 'bounds' in r: x, y, w, h = nums(r['bounds'])
            else: (x, y), (w, h) = nums(r['xy']), nums(r['size'])
            rot = r.get('rotate', 'false')
            rotated = rot in ('true', '90')
            tw, th = (h, w) if rotated else (w, h)
            piece = img.crop((x, y, x + tw, y + th))
            if rotated: piece = piece.rotate(90, expand=True)
            pieces.append((r['name'], piece))

font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 15)
CELL, LABEL, COLS = 220, 40, 8
for f in {m['page'] for m in meshes.values()}:
    Image.open(src / f).save(out / ('atlas_' + f))
pieces.sort(key=lambda p: -p[1].width * p[1].height)
per_sheet = COLS * 6
for n in range(0, len(pieces), per_sheet):
    chunk = pieces[n:n + per_sheet]
    rows = (len(chunk) + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * CELL, rows * (CELL + LABEL)), (32, 36, 48, 255))
    d = ImageDraw.Draw(sheet)
    for i, (name, p) in enumerate(chunk):
        cx, cy = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL)
        # พื้นลายตารางหมากรุก จะได้เห็นส่วนที่โปร่งใส
        for gx in range(0, CELL - 10, 12):
            for gy in range(0, CELL - 10, 12):
                if (gx // 12 + gy // 12) % 2: d.rectangle([cx + 5 + gx, cy + 5 + gy, cx + 16 + gx, cy + 16 + gy], fill=(48, 54, 70, 255))
        t = p.copy(); t.thumbnail((CELL - 14, CELL - 14))
        sheet.alpha_composite(t, (cx + (CELL - t.width) // 2, cy + (CELL - t.height) // 2))
        label = name if len(name) <= 24 else name[:22] + '…'
        d.text((cx + 8, cy + CELL + 4), label, font=font, fill=(230, 235, 245, 255))
        d.text((cx + 8, cy + CELL + 21), f'{p.width}×{p.height}', font=font, fill=(130, 140, 160, 255))
    path = out / f'pieces_{n // per_sheet + 1}.png'
    sheet.convert('RGB').save(path)
    print(path)
print(len(pieces), 'pieces')
