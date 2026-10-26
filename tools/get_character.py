# ดึง Memorial Lobby ของนักเรียน 1 คนจากเซิร์ฟเวอร์ Global มาเป็นตัวละครของ BA Wallpaper
#
# ใช้:  .venv/bin/python -I tools/get_character.py <ชื่อในเกม> [ชื่อโฟลเดอร์]
#   เช่น  tools/get_character.py zunko Junko
#         tools/get_character.py hoshino_swimsuit
#         tools/get_character.py --list        (ดูชื่อทั้งหมดที่มี)
#         tools/get_character.py --bgm Theme_36 Junko   (ใส่เพลงประจำ lobby → characters/Junko/bgm.m4a)
#
# ขั้นตอน: ถาม API แพตช์ของ Nexon → โหลดรายการไฟล์ → โหลด bundle ของ spinelobbies-<ชื่อ>_home
# → แยก .skel/.atlas/.png ด้วย UnityPy → ดึงเสียง memoriallobby จาก VOC_JP แล้วแปลงเป็น .m4a
import hashlib, io, json, pathlib, re, subprocess, sys, tempfile, zipfile

import UnityPy
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache'
API = 'https://api-pub.nexon.com/patch/v1.1/version-check'
# เวอร์ชันแอปที่ใช้ถาม API — ถ้าเกมอัปเดตจนเซิร์ฟเวอร์ไม่ตอบ ให้เปลี่ยนเป็นเวอร์ชันใหม่
BUILD = '1.93.454564'


def curl(url, data=None):
    # ใช้ curl เพราะ Python ของเครื่องนี้ไม่มีใบรับรอง SSL
    cmd = ['curl', '-sfL', url]
    if data is not None:
        cmd += ['-X', 'POST', '-H', 'Content-Type: application/json', '-d', json.dumps(data)]
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def catalog():
    v = json.loads(curl(API, {
        'market_game_id': 'com.nexon.bluearchive', 'market_code': 'playstore',
        'curr_build_version': BUILD, 'curr_build_number': BUILD.split('.')[-1],
    }))
    url = v['patch']['resource_path']
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / (url.split('/')[-2] + '.json')
    if not cached.exists():
        cached.write_bytes(curl(url))
    return url.rsplit('/', 1)[0] + '/', json.loads(cached.read_text())['resources']


def fetch(base, res):
    data = curl(base + res['resource_path'])
    if hashlib.md5(data).hexdigest() != res['resource_hash'].lower():
        sys.exit('ไฟล์เสีย (md5 ไม่ตรง): ' + res['resource_path'])
    return data


def to_m4a(ogg_bytes, dst, bitrate=96000):
    data, rate = sf.read(io.BytesIO(ogg_bytes))
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        sf.write(wav.name, data, rate)
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(bitrate), wav.name, str(dst)], check=True)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__ or 'ใช้: get_character.py <ชื่อในเกม> [ชื่อโฟลเดอร์]')
    base, res = catalog()
    if sys.argv[1] == '--bgm':
        name, folder = sys.argv[2], ROOT / 'characters' / sys.argv[3]
        r = next((r for r in res if r['resource_path'].endswith(f'/BGM/{name}.ogg')), None)
        if not r: sys.exit(f'ไม่เจอเพลง {name}')
        to_m4a(fetch(base, r), folder / 'bgm.m4a')
        print('เพลง →', folder / 'bgm.m4a')
        return
    if sys.argv[1] == '--list':
        ids = sorted({m.group(1) for r in res for m in [re.search(r'spinelobbies-(.+?)_home', r['resource_path'])] if m})
        print(' '.join(ids))
        return

    key = sys.argv[1].lower()
    out = ROOT / 'characters' / (sys.argv[2] if len(sys.argv) > 2 else key.capitalize())
    bundles = [r for r in res if f'spinelobbies-{key}_home-' in r['resource_path']]
    if not bundles:
        sys.exit(f'ไม่เจอ memorial lobby ของ "{key}" — ลอง --list ดูชื่อที่มี')
    out.mkdir(parents=True, exist_ok=True)

    voice_prefixes = set()
    for r in bundles:
        env = UnityPy.load(fetch(base, r))
        for obj in env.objects:
            if obj.type.name not in ('TextAsset', 'Texture2D'):
                continue
            d = obj.read()
            name = d.m_Name
            if obj.type.name == 'TextAsset':
                b = d.m_Script
                b = b.encode('utf-8', 'surrogateescape') if isinstance(b, str) else bytes(b)
                (out / name).write_bytes(b)
                # ชื่อชุดเสียงอยู่ใน event ของ skel เช่น "Zunko_MemorialLobby_1_1", "CH0192_MemorialLobby_3"
                voice_prefixes |= {m.decode() for m in re.findall(rb'([A-Za-z0-9]+)_MemorialLobby', b, re.I)}
            else:
                d.image.save(out / (name + '.png'))
            print('  ', name)

    # เสียง: ใช้ชื่อจาก event ใน skel (เช่น Zunko, CH0192) → VOC_JP/JP_<ชื่อ>.zip
    zips = [r for r in res for v in voice_prefixes if re.search(rf'VOC_JP/JP_{v}\.zip$', r['resource_path'], re.I)]
    print('   voice packs:', ', '.join(sorted(voice_prefixes)) or '-')
    for r in zips:
        z = zipfile.ZipFile(io.BytesIO(fetch(base, r)))
        for n in z.namelist():
            if 'memoriallobby' not in n.lower():
                continue
            dst = out / (pathlib.Path(n).stem + '.m4a')
            to_m4a(z.read(n), dst)
            print('  ', dst.name)
    if not zips:
        print('   (ไม่เจอไฟล์เสียง)')
    print('เสร็จแล้ว →', out)


if __name__ == '__main__':
    main()
