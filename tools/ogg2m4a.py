# แปลง .ogg (Vorbis) → .m4a เพราะ WebKit บน Mac เล่น Vorbis ไม่ได้
# ใช้: .venv/bin/python tools/ogg2m4a.py characters/<ชื่อ>
import pathlib, subprocess, sys, tempfile
import soundfile as sf

for ogg in sorted(pathlib.Path(sys.argv[1]).rglob('*.ogg')):
    data, rate = sf.read(ogg)
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        sf.write(wav.name, data, rate)
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '96000', wav.name, str(ogg.with_suffix('.m4a'))], check=True)
    ogg.unlink()
    print('converted', ogg.with_suffix('.m4a').name)
