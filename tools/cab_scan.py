# สแกนสารบัญ CAB → bundle ของทั้งเกม โดยโหลดแค่หัวไฟล์ (~2KB) ของแต่ละ bundle ด้วย HTTP Range
# ใช้: .venv/bin/python -I tools/cab_scan.py   → .cache/cab_all.json  {CAB-xxxx: resource_path}
#
# รูปแบบหัว UnityFS: signature, version, unityVersion, revision, size(i64),
# compressedBlocksInfoSize, uncompressedBlocksInfoSize, flags → blocksInfo (บีบอัด LZ4)
# ซึ่งมีรายชื่อ node (เช่น "CAB-94b9…") อยู่ข้างใน
import io, json, pathlib, struct, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import lz4.block
from get_character import catalog, ROOT

base, res = catalog()
out = ROOT / '.cache' / 'cab_all.json'
done = json.loads(out.read_text()) if out.exists() else {}
seen = set(done.values())
bundles = [r for r in res if r['resource_path'].endswith('.bundle') and r['resource_path'] not in seen]

def cstr(f):
    b = bytearray()
    while (c := f.read(1)) not in (b'\0', b''):
        b += c
    return b.decode('utf-8', 'replace')

def cabs_of(head):
    f = io.BytesIO(head)
    if cstr(f) != 'UnityFS':
        return []
    ver = struct.unpack('>I', f.read(4))[0]
    cstr(f); cstr(f)
    struct.unpack('>q', f.read(8))
    csize, usize, flags = struct.unpack('>III', f.read(12))
    if flags & 0x80:          # blocksInfo อยู่ท้ายไฟล์ — ข้ามไป
        return None
    if ver >= 7 or flags & 0x200:
        f.seek((f.tell() + 15) // 16 * 16)
    raw = f.read(csize)
    if len(raw) < csize:
        return None
    comp = flags & 0x3F
    info = raw if comp == 0 else lz4.block.decompress(raw, uncompressed_size=usize)
    g = io.BytesIO(info)
    g.read(16)
    nblocks = struct.unpack('>i', g.read(4))[0]
    g.read(nblocks * 10)
    nnodes = struct.unpack('>i', g.read(4))[0]
    names = []
    for _ in range(nnodes):
        g.read(20)
        names.append(cstr(g))
    return names

def scan(r):
    for size in (2048, 16384):
        head = subprocess.run(['curl', '-sf', '-r', f'0-{size - 1}', base + r['resource_path']],
                              capture_output=True).stdout
        try:
            names = cabs_of(head)
        except Exception:
            names = None
        if names is not None:
            return r['resource_path'], names
    return r['resource_path'], []

with ThreadPoolExecutor(24) as ex:
    for i, (path, names) in enumerate(ex.map(scan, bundles), 1):
        for n in names:
            done[n.split('.')[0]] = path
        if i % 2000 == 0:
            out.write_text(json.dumps(done))
            print(i, '/', len(bundles), flush=True)
out.write_text(json.dumps(done))
print('CABs:', len(done))
