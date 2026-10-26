# BA Wallpaper

วอลเปเปอร์ Memorial Lobby ของ Blue Archive บน macOS แบบโต้ตอบได้ ไฟล์ตัวละครเป็นของ Spine (ไม่ใช่ Live2D)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `main.swift` | แอปบนแถบเมนู: หน้าต่างพื้นหลัง (ใต้ไอคอนเดสก์ท็อป), WKWebView + `ba://` scheme ใช้อ่านไฟล์ในเครื่อง, เมนู/แถบเสียง, ส่งต่อคลิกบนเดสก์ท็อป, หยุดวาดเมื่อจอถูกบัง |
| `build.sh` | คอมไพล์ `main.swift` เป็น `BAWallpaper.app` (ใช้แค่ Command Line Tools) |
| `web/index.html` | เลือกตัวเล่น Spine ตามเวอร์ชันของไฟล์ (3.8–4.1 → pixi-spine, 4.2 → spine-pixi-v7) ก่อนสร้าง renderer |
| `web/app.js` | เล่นตัวละคร, จัดกล้องแบบ memorial lobby, Look/Pat/Talk ผ่าน bone `Touch_Eye`/`Touch_Point`, เสียงพูดตาม Spine event `Talk`, กล่องคำพูด, เพลง, เสียงประกอบ |
| `web/lib/` | pixi.js 7.3.2, pixi-spine 4.0.4, @esotericsoftware/spine-pixi-v7 4.2.119 |
| `tools/get_character.py` | ดึง memorial lobby จาก CDN ของ Nexon (Global) → `characters/<ชื่อ>/` และใช้ `--bgm Theme_NN` ใส่เพลง |
| `tools/lobby_sfx.py` | ดึงเสียงประกอบจาก Unity Timeline ของ lobby → `sfx/` + `sfx.json` |
| `tools/sfx_index.py` | ทำสารบัญ CAB → bundle เสียง (รันครั้งเดียวก่อนใช้ `lobby_sfx.py`) |
| `tools/cab_scan.py` | สแกนหัว bundle ทั้งเกม (HTTP Range) ได้สารบัญ CAB ครบ ใช้หาเสียงที่อยู่นอกคลังเสียงกลาง |
| `tools/atlas_sheet.py` | ตัดชิ้นส่วนจาก atlas ออกมาเป็นภาพสำหรับดู |
| `tools/ogg2m4a.py` | แปลงเสียง .ogg → .m4a (WebKit บน Mac เล่น Vorbis ไม่ได้) |

## เริ่มใช้

```bash
python3 -m venv .venv && .venv/bin/pip install UnityPy soundfile xxhash
.venv/bin/python -I tools/get_character.py --list
.venv/bin/python -I tools/get_character.py zunko Junko
.venv/bin/python -I tools/get_character.py --bgm Theme_36 Junko
.venv/bin/python -I tools/sfx_index.py
.venv/bin/python -I tools/cab_scan.py
.venv/bin/python -I tools/lobby_sfx.py zunko Junko
./build.sh && open BAWallpaper.app
```

บทพูดภาษาไทยอยู่ใน `characters/<ชื่อ>/config.json` → `dialog.lines` (key = เลขท่อนของเสียง เช่น `"4_2"`)

## ดีบัก

- `BA_SNAPSHOT=out.png BA_SNAPSHOT_DELAY=20` บันทึกภาพจาก canvas
- `BA_EVAL="js"` รันสคริปต์ในหน้าหลังเปิดแอป 10 วินาที
- `BA_QUERY="res=1&aa=0"` ลองค่าคุณภาพ

ไฟล์ตัวละคร เสียง และเพลงเป็นลิขสิทธิ์ของ NEXON Games / Yostar ใช้บนเครื่องตัวเองเท่านั้น ห้ามแจกต่อ
