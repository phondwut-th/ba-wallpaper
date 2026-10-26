#!/bin/zsh
# สร้าง BAWallpaper.app จาก main.swift
set -e
cd "$(dirname "$0")"
APP=BAWallpaper.app
rm -rf $APP
mkdir -p $APP/Contents/MacOS
swiftc -O main.swift -o $APP/Contents/MacOS/BAWallpaper -framework AppKit -framework WebKit
cat > $APP/Contents/Info.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>BA Wallpaper</string>
  <key>CFBundleIdentifier</key><string>local.ba-wallpaper</string>
  <key>CFBundleExecutable</key><string>BAWallpaper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict></plist>
EOF
codesign --force -s - $APP
echo "built $PWD/$APP"
