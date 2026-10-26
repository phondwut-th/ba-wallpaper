# ทำสารบัญ CAB → bundle เสียง (ใช้หาไฟล์เสียงประกอบที่ Timeline ของ memorial lobby อ้างถึง)
# ใช้: .venv/bin/python -I tools/sfx_index.py   → .cache/audio/*.bundle + .cache/cab_index.json
import json, re, sys, pathlib
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import UnityPy
from get_character import catalog, fetch, ROOT

base, res = catalog()
cache = ROOT / '.cache' / 'audio'
idx_path = ROOT / '.cache' / 'cab_index.json'
idx = json.loads(idx_path.read_text()) if idx_path.exists() else {}
cands = [r for r in res if r['resource_path'].endswith('.bundle')
         and re.search(r'(?i)(sfx|sound|audio|_se[-_]|-se-)', r['resource_path'])]

def get(r):
    f = cache / r['resource_path'].split('/')[-1]
    if not f.exists():
        f.write_bytes(fetch(base, r))
    env = UnityPy.load(str(f))
    cabs = [name for name in env.files.get(next(iter(env.files)), None).files] if env.files else []
    return f.name, cabs

with ThreadPoolExecutor(8) as ex:
    for name, cabs in ex.map(get, cands):
        for c in cabs:
            idx[c.split('.')[0]] = name
idx_path.write_text(json.dumps(idx, indent=1))
print(len(cands), 'bundles,', len(idx), 'CABs')
