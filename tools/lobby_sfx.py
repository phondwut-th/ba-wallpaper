# ดึงเสียงประกอบ (SFX/ambient) ของ memorial lobby จาก Unity Timeline ในไฟล์เกม
# ใช้: .venv/bin/python -I tools/lobby_sfx.py <lobby id เช่น ch0205 หรือ zunko> <โฟลเดอร์ตัวละคร>
#   → characters/<โฟลเดอร์>/sfx/*.m4a + sfx.json  [{t, file, volume, pitch, loop}]
# ต้องรัน tools/sfx_index.py ก่อนหนึ่งครั้ง (ทำสารบัญ CAB → bundle เสียง)
#
# โครงในเกม: bundle ของ lobby มี TimelineAsset (เช่น CH0205_Timeline) ที่มีแทร็ก "SFX n"
# แต่ละคลิปชี้ไปที่ TimeLineAudioController → AudioData { AudioClips[], Volume, Pitch, Loop }
# ส่วน AudioClip อยู่ใน bundle อื่น อ้างถึงด้วย externals (CAB-xxxx) + PathID
import io, json, pathlib, subprocess, sys, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import soundfile as sf
import UnityPy
from get_character import catalog, fetch, ROOT

lobby, folder = sys.argv[1].lower(), ROOT / 'characters' / sys.argv[2]
base, res = catalog()
idx = json.loads((ROOT / '.cache' / 'cab_index.json').read_text())
# สารบัญของทั้งเกม (tools/cab_scan.py) — ใช้เมื่อเสียงอยู่ใน bundle ที่ชื่อไม่บอกว่าเป็นเสียง
all_path = ROOT / '.cache' / 'cab_all.json'
cab_all = json.loads(all_path.read_text()) if all_path.exists() else {}
by_path = {r['resource_path']: r for r in res}
audio_cache = ROOT / '.cache' / 'audio'

def locate(cab):
    if cab in idx:
        return idx[cab]
    path = cab_all.get(cab)
    if not path:
        return None
    name = path.split('/')[-1]
    if not (audio_cache / name).exists():
        (audio_cache / name).write_bytes(fetch(base, by_path[path]))
    return name

events, missing = [], set()
clip_files = {}  # (bundle, pathid) → ชื่อไฟล์ที่เขียนแล้ว
envs = {}

def audio_env(name):
    if name not in envs:
        envs[name] = UnityPy.load(str(audio_cache / name))
    return envs[name]

def export_clip(bundle, path_id):
    key = (bundle, path_id)
    if key in clip_files:
        return clip_files[key]
    obj = next((o for o in audio_env(bundle).objects if o.path_id == path_id), None)
    if obj is None:
        return None
    clip = obj.read()
    (out := folder / 'sfx').mkdir(parents=True, exist_ok=True)
    for name, wav in clip.samples.items():
        data, rate = sf.read(io.BytesIO(wav))
        with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
            sf.write(tmp.name, data, rate)
            dst = out / (clip.m_Name + '.m4a')
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', tmp.name, str(dst)], check=True)  # ไม่กำหนด bitrate — ไฟล์โมโน 22kHz ตั้ง 96k ไม่ได้
        clip_files[key] = 'sfx/' + dst.name
        return clip_files[key]

for r in [r for r in res if f'spinelobbies-{lobby}_home-' in r['resource_path']]:
    env = UnityPy.load(fetch(base, r))
    sfile = next(iter(next(iter(env.files.values())).files.values()))
    externals = [e.path.split('/')[-1] for e in getattr(sfile, 'externals', [])]
    objs = {o.path_id: o for o in env.objects}
    for o in env.objects:
        if o.type.name != 'MonoBehaviour':
            continue
        t = o.read_typetree()
        if 'm_Tracks' not in t:
            continue
        for tr in t['m_Tracks']:
            track = objs.get(tr['m_PathID'])
            if not track:
                continue
            for c in track.read_typetree().get('m_Clips', []):
                ctl = objs.get(c['m_Asset']['m_PathID'])
                ad = ctl and ctl.read_typetree().get('AudioData')
                if not ad:
                    continue
                for ref in ad['AudioClips']:
                    cab = externals[ref['m_FileID'] - 1] if ref['m_FileID'] else None
                    bundle = locate(cab) if cab else None
                    f = bundle and export_clip(bundle, ref['m_PathID'])
                    if not f:
                        missing.add(cab)
                        continue
                    events.append({'t': round(c['m_Start'], 3), 'file': f, 'volume': round(ad['Volume'], 3),
                                   'pitch': round(ad['Pitch'], 3), 'loop': bool(ad['Loop']), 'timeline': t['m_Name']})

events.sort(key=lambda e: e['t'])
if events:
    (folder / 'sfx.json').write_text(json.dumps(events, ensure_ascii=False, indent=1))
for e in events:
    print(f"  {e['t']:6.2f}s  {e['file']:<45} vol {e['volume']:.2f} pitch {e['pitch']:.2f}{' loop' if e['loop'] else ''}")
print(f'{lobby}: {len(events)} เสียง', f'(หาไฟล์ไม่เจอ {len(missing)} bundle)' if missing else '')
