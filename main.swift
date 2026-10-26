// BA Wallpaper — วอลเปเปอร์ Spine แบบโต้ตอบได้บน macOS
// หน้าต่างไร้ขอบวางอยู่เหนือไอคอนเดสก์ท็อป แต่อยู่ใต้หน้าต่างแอปทั้งหมด

import AppKit
import WebKit

let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("ba-wallpaper")
let charsDir = root.appendingPathComponent("characters")

// MARK: - ไฟล์ตัวละคร

struct Character: Encodable {
    let name: String
    let skel: String
    let atlas: String
    let voices: [String]
    let bgm: String?
    let sfx: String?
    let config: [String: AnyCodable]?
}

struct AnyCodable: Encodable {
    let value: Any
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as Bool: try c.encode(v)
        case let v as Int: try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as String: try c.encode(v)
        case let v as [Any]: try c.encode(v.map(AnyCodable.init))
        case let v as [String: Any]: try c.encode(v.mapValues(AnyCodable.init))
        default: try c.encodeNil()
        }
    }
}

// ชื่อไฟล์จากเกมมักเป็น xxx.skel.bytes / xxx.atlas.txt — ตัด suffix ทิ้งตอนส่งให้ JS แล้วให้ handler หาเอง
let aliasSuffixes = [".bytes", ".txt", ".prefab"]
func stripAlias(_ s: String) -> String {
    for suf in aliasSuffixes where s.hasSuffix(suf) { return String(s.dropLast(suf.count)) }
    return s
}

func url(for file: URL) -> String {
    let rel = file.path.replacingOccurrences(of: root.path, with: "")
    return "ba://local" + stripAlias(rel).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!
}

func scanCharacters() -> [Character] {
    let fm = FileManager.default
    guard let dirs = try? fm.contentsOfDirectory(at: charsDir, includingPropertiesForKeys: [.isDirectoryKey]) else { return [] }
    let audioExt: Set = ["ogg", "wav", "mp3", "m4a", "aac"]
    var out: [Character] = []
    for dir in dirs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where dir.hasDirectoryPath {
        let files = (fm.enumerator(at: dir, includingPropertiesForKeys: nil)?.allObjects as? [URL] ?? [])
            .sorted { $0.path < $1.path }
        let names = files.map { stripAlias($0.lastPathComponent.lowercased()) }
        guard let si = names.firstIndex(where: { $0.hasSuffix(".skel") })
                ?? names.firstIndex(where: { $0.hasSuffix(".json") && $0 != "config.json" }),
              let ai = names.firstIndex(where: { $0.hasSuffix(".atlas") }) else { continue }
        // atlas ที่ชื่อตรงกับ skel ก่อน
        let base = (names[si] as NSString).deletingPathExtension
        let atlasIdx = names.firstIndex(of: base + ".atlas") ?? ai
        var config: [String: AnyCodable]? = nil
        if let d = try? Data(contentsOf: dir.appendingPathComponent("config.json")),
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            config = obj.mapValues(AnyCodable.init)
        }
        out.append(Character(
            name: dir.lastPathComponent,
            skel: url(for: files[si]),
            atlas: url(for: files[atlasIdx]),
            voices: files.filter { audioExt.contains($0.pathExtension.lowercased()) && !$0.lastPathComponent.lowercased().hasPrefix("bgm.")
                && $0.deletingLastPathComponent().lastPathComponent != "sfx" }.map { url(for: $0) },
            bgm: files.first { audioExt.contains($0.pathExtension.lowercased()) && $0.lastPathComponent.lowercased().hasPrefix("bgm.") }.map { url(for: $0) },
            sfx: files.first { $0.lastPathComponent == "sfx.json" }.map { url(for: $0) },
            config: config))
    }
    return out
}

// MARK: - ba:// scheme (ให้ WebView อ่านไฟล์ในเครื่องได้โดยไม่ติด CORS)

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let u = task.request.url else { return }
        var data: Data?
        var mime = "application/octet-stream"
        if u.path == "/api/chars" {
            data = try? JSONEncoder().encode(scanCharacters())
            mime = "application/json"
        } else {
            let p = root.appendingPathComponent(u.path).standardizedFileURL
            if p.path.hasPrefix(root.path) {
                for cand in [p] + aliasSuffixes.map({ URL(fileURLWithPath: p.path + $0) }) {
                    if let d = try? Data(contentsOf: cand) { data = d; break }
                }
            }
            mime = [
                "html": "text/html", "js": "text/javascript", "json": "application/json",
                "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "atlas": "text/plain",
                "ogg": "audio/ogg", "wav": "audio/wav", "mp3": "audio/mpeg", "m4a": "audio/mp4",
            ][p.pathExtension.lowercased()] ?? mime
        }
        guard let body = data else {
            task.didReceive(HTTPURLResponse(url: u, statusCode: 404, httpVersion: nil, headerFields: nil)!)
            task.didFinish(); return
        }
        task.didReceive(HTTPURLResponse(url: u, statusCode: 200, httpVersion: nil, headerFields: [
            "Content-Type": mime, "Content-Length": "\(body.count)", "Access-Control-Allow-Origin": "*",
        ])!)
        task.didReceive(body)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - หน้าต่างพื้นหลัง

final class ClickWebView: WKWebView {
    // คลิกครั้งแรกให้ถึงตัวละครเลย ไม่ต้องคลิกเพื่อโฟกัสก่อน
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class WallpaperPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    // macOS นับหน้าต่างระดับเดสก์ท็อปว่า "ถูกบัง" → WebKit หยุดวาดเฟรม จึงต้องบอกว่ามองเห็นเสมอ
    override var occlusionState: NSWindow.OcclusionState { .visible }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var panel: WallpaperPanel!
    var web: ClickWebView!
    var status: NSStatusItem!
    var lastMouse = NSPoint(x: -1, y: -1)
    let defaults = UserDefaults.standard

    var current: String? {
        get { defaults.string(forKey: "character") }
        set { defaults.set(newValue, forKey: "character") }
    }
    // ปิดโหมดโต้ตอบ = ตัวละครเล่นท่าอย่างเดียว ไม่มองตาม/ไม่รับคลิก และคลิกทะลุไปถึงเดสก์ท็อป
    var interact: Bool {
        get { defaults.object(forKey: "interact") as? Bool ?? !defaults.bool(forKey: "clickThrough") }
        set {
            defaults.set(newValue, forKey: "interact")
            panel.ignoresMouseEvents = !newValue
            js("BA.setInteract(\(newValue))")
            updateStatusIcon()
        }
    }
    // แสดงไอคอนเดสก์ท็อป: วางหน้าต่างไว้ใต้ไอคอน แล้วรับคลิกจาก global monitor แทน
    var showIcons: Bool {
        get { defaults.object(forKey: "showIcons") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "showIcons"); applyLevel() }
    }
    var volume: Double {
        get { defaults.object(forKey: "volume") as? Double ?? 0.8 }
        set { defaults.set(newValue, forKey: "volume"); js("BA.setVolume(\(newValue))") }
    }
    var sfxVolume: Double {
        get { defaults.object(forKey: "sfxVolume") as? Double ?? 0.8 }
        set { defaults.set(newValue, forKey: "sfxVolume"); js("BA.setSfxVolume(\(newValue))") }
    }
    var musicVolume: Double {
        get { defaults.object(forKey: "musicVolume") as? Double ?? 0.4 }
        set { defaults.set(newValue, forKey: "musicVolume"); js("BA.setMusicVolume(\(newValue))") }
    }
    func applyLevel() {
        let key: CGWindowLevelKey = showIcons ? .desktopWindow : .desktopIconWindow
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(key)) + 1)
    }
    var lookOn: Bool {
        get { defaults.object(forKey: "look") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "look"); js("BA.setLook(\(newValue))") }
    }
    var paused = false

    func applicationDidFinishLaunching(_ n: Notification) {
        try? FileManager.default.createDirectory(at: charsDir, withIntermediateDirectories: true)

        let screen = NSScreen.main!
        panel = WallpaperPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel],
                               backing: .buffered, defer: false)
        applyLevel()
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        panel.backgroundColor = .black
        panel.hasShadow = false
        panel.isMovable = false
        panel.ignoresMouseEvents = !interact
        panel.acceptsMouseMovedEvents = true

        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: "ba")
        cfg.userContentController.add(self, name: "log")
        cfg.mediaTypesRequiringUserActionForPlayback = []
        web = ClickWebView(frame: panel.contentView!.bounds, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        if #available(macOS 13.3, *) { web.isInspectable = true }
        panel.contentView!.addSubview(web)
        load()
        panel.orderFront(nil)

        // หยุดวาดเมื่อหน้าต่างอื่นบังพื้นหลังเกือบมิด (ประหยัดแบต/GPU)
        Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.checkCovered() }

        // ส่งตำแหน่งเมาส์ให้ JS ตลอดเวลา (ทำงานแม้แอปอื่นอยู่ข้างหน้า)
        Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.tickMouse() }

        // โหมดแสดงไอคอน: Finder เป็นคนรับคลิกบนเดสก์ท็อป เราแค่ "ฟัง" แล้วส่งต่อให้ตัวละคร
        NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { [weak self] e in
            self?.forwardDesktopClick(e)
        }

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            if let s = NSScreen.main { self?.panel.setFrame(s.frame, display: true) }
        }
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.js("BA.pause(true, true)") }
        ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, !self.paused else { return }
            self.js("BA.pause(\(self.covered), false)")
        }

        // ใช้ตอนดีบัก: BA_SNAPSHOT=/path/to.png → บันทึกภาพหน้าจอวอลเปเปอร์หลัง BA_SNAPSHOT_DELAY วินาที (ค่าเริ่มต้น 4)
        if let snap = ProcessInfo.processInfo.environment["BA_SNAPSHOT"] {
            let delay = Double(ProcessInfo.processInfo.environment["BA_SNAPSHOT_DELAY"] ?? "") ?? 4
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                // อ่านจาก canvas ตรง ๆ เพราะ takeSnapshot ไม่ติดภาพ WebGL
                self?.web.evaluateJavaScript("document.querySelector('canvas').toDataURL('image/png')") { r, err in
                    guard let s = r as? String, let d = Data(base64Encoded: String(s.split(separator: ",")[1])) else {
                        print("[snapshot] failed", err ?? ""); return
                    }
                    try? d.write(to: URL(fileURLWithPath: snap))
                    print("[snapshot]", snap); fflush(stdout)
                }
            }
        }

        // ใช้ตอนดีบัก: BA_EVAL="js" → รันสคริปต์ในหน้าหลังเปิด 10 วินาที
        if let code = ProcessInfo.processInfo.environment["BA_EVAL"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.js(code) }
        }

        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateStatusIcon()
        rebuildMenu()
    }

    func load() {
        var c = URLComponents(string: "ba://local/web/index.html")!
        var q: [URLQueryItem] = []
        if let cur = current { q.append(URLQueryItem(name: "char", value: cur)) }
        // ส่งค่าเสียง/การมองไปกับ URL เลย — หน้าโหลดใหม่ทุกครั้งที่เปลี่ยนตัวละคร ถ้าส่งตามทีหลังจะได้ยินค่าเริ่มต้นแวบหนึ่ง
        q += [URLQueryItem(name: "vol", value: "\(volume)"), URLQueryItem(name: "music", value: "\(musicVolume)"),
              URLQueryItem(name: "sfx", value: "\(sfxVolume)"), URLQueryItem(name: "look", value: lookOn ? "1" : "0"),
              URLQueryItem(name: "interact", value: interact ? "1" : "0")]
        // BA_QUERY="res=1&aa=0" ใช้ทดลองค่าคุณภาพ; debug=1 เมื่อจะถ่าย snapshot
        let env = ProcessInfo.processInfo.environment
        if env["BA_SNAPSHOT"] != nil { q.append(URLQueryItem(name: "debug", value: "1")) }
        for kv in (env["BA_QUERY"] ?? "").split(separator: "&") {
            let p = kv.split(separator: "=", maxSplits: 1).map(String.init)
            if p.count == 2 { q.append(URLQueryItem(name: p[0], value: p[1])) }
        }
        c.queryItems = q
        web.load(URLRequest(url: c.url!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self else { return }
            self.js("BA.setLook(\(self.lookOn)); BA.setVolume(\(self.volume)); BA.setMusicVolume(\(self.musicVolume))")
        }
    }

    var forwarding = false
    func forwardDesktopClick(_ e: NSEvent) {
        guard showIcons, interact, !paused, !covered else { return }
        let m = NSEvent.mouseLocation, f = panel.frame
        let type: String
        switch e.type {
        case .leftMouseDown:
            // ส่งต่อเฉพาะคลิกบนเดสก์ท็อปเปล่า ๆ — ไม่ใช่บนหน้าต่างของแอปอื่น
            guard windowAt(m) == nil else { return }
            forwarding = true; type = "down"
        case .leftMouseDragged: guard forwarding else { return }; type = "move"
        default: guard forwarding else { return }; forwarding = false; type = "up"
        }
        js("BA.pointer('\(type)', \(m.x - f.minX), \(f.maxY - m.y))")
    }
    // หน้าต่างปกติ (layer 0) ที่อยู่ใต้เมาส์ ถ้าไม่มีแปลว่าคลิกโดนเดสก์ท็อป
    func windowAt(_ p: NSPoint) -> Int? {
        let screenH = NSScreen.screens.first?.frame.height ?? 0
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        for w in list {
            guard (w[kCGWindowLayer as String] as? Int) == 0,
                  (w[kCGWindowOwnerPID as String] as? Int32) != getpid(),
                  let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = b["X"], let y = b["Y"], let ww = b["Width"], let hh = b["Height"] else { continue }
            if NSRect(x: x, y: screenH - y - hh, width: ww, height: hh).contains(p) { return w[kCGWindowNumber as String] as? Int }
        }
        return nil
    }

    var covered = false
    func checkCovered() {
        // ตอนถ่าย snapshot ดีบัก ต้องวาดต่อแม้จอจะถูกบัง
        if ProcessInfo.processInfo.environment["BA_SNAPSHOT"] != nil { return }
        let f = panel.frame
        let screenH = NSScreen.screens.first?.frame.height ?? f.height
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        // คิดพื้นที่ที่ถูกบังแบบตาราง 32x20 ช่อง — พอสำหรับตัดสินว่ามิดหรือไม่
        let cols = 32, rows = 20
        var hit = [Bool](repeating: false, count: cols * rows)
        for w in list {
            guard (w[kCGWindowLayer as String] as? Int) == 0,
                  (w[kCGWindowAlpha as String] as? Double ?? 1) > 0.9,
                  (w[kCGWindowOwnerPID as String] as? Int32) != getpid(),
                  let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = b["X"], let y = b["Y"], let ww = b["Width"], let hh = b["Height"] else { continue }
            // CGWindow ใช้จุดกำเนิดมุมซ้ายบน แปลงเป็นพิกัด AppKit
            let r = NSRect(x: x, y: screenH - y - hh, width: ww, height: hh)
            for i in 0..<cols { for j in 0..<rows {
                let p = NSPoint(x: f.minX + (CGFloat(i) + 0.5) * f.width / CGFloat(cols),
                                y: f.minY + (CGFloat(j) + 0.5) * f.height / CGFloat(rows))
                if r.contains(p) { hit[j * cols + i] = true }
            } }
        }
        let frac = Double(hit.filter { $0 }.count) / Double(cols * rows)
        let now = frac > 0.97
        if now != covered {
            covered = now
            if !paused { js("BA.pause(\(now))") }
            print("[covered]", now, String(format: "%.2f", frac)); fflush(stdout)
        }
    }

    func js(_ s: String) { web.evaluateJavaScript(s, completionHandler: nil) }

    func tickMouse() {
        let m = NSEvent.mouseLocation
        guard m != lastMouse, !paused else { return }
        lastMouse = m
        let f = panel.frame
        js("onCursor && onCursor(\(m.x - f.minX), \(f.maxY - m.y))")
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        print("[web]", m.body)
        fflush(stdout)
    }

    // MARK: menu

    func rebuildMenu() {
        let menu = NSMenu()
        let chars = scanCharacters()
        let header = NSMenuItem(title: chars.isEmpty ? "ยังไม่มีตัวละคร" : "ตัวละคร", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        let active = current ?? chars.first?.name
        for c in chars {
            let it = NSMenuItem(title: c.name, action: #selector(pick(_:)), keyEquivalent: "")
            it.target = self
            it.state = c.name == active ? .on : .off
            it.indentationLevel = 1
            menu.addItem(it)
        }
        menu.addItem(.separator())
        menu.addItem(volumeItem(1))
        menu.addItem(volumeItem(2))
        menu.addItem(volumeItem(3))
        menu.addItem(.separator())
        add(menu, "ตามองเมาส์", #selector(toggleLook), on: lookOn)
        add(menu, "แสดงไอคอนบนเดสก์ท็อป", #selector(toggleIcons), on: showIcons)
        add(menu, "โหมดโต้ตอบ (คลิก/ลูบหัว/มองตาม)", #selector(toggleInteract), on: interact, key: "i")
        add(menu, paused ? "เล่นต่อ" : "หยุดชั่วคราว", #selector(togglePause))
        add(menu, "รีเซ็ตขนาด/ตำแหน่ง", #selector(resetView))
        menu.addItem(.separator())
        add(menu, "เปิดโฟลเดอร์ตัวละคร…", #selector(openFolder))
        add(menu, "โหลดใหม่", #selector(reload), key: "r")
        menu.addItem(.separator())
        add(menu, "ออก", #selector(NSApplication.terminate(_:)), key: "q", target: NSApp)
        menu.delegate = self
        status.menu = menu
    }

    func add(_ m: NSMenu, _ t: String, _ a: Selector, on: Bool = false, key: String = "", target: AnyObject? = nil) {
        let it = NSMenuItem(title: t, action: a, keyEquivalent: key)
        it.target = target ?? self
        it.state = on ? .on : .off
        m.addItem(it)
    }

    @objc func pick(_ s: NSMenuItem) { current = s.title; load(); rebuildMenu() }
    @objc func toggleIcons() { showIcons.toggle(); rebuildMenu() }
    // แถบเลื่อนในเมนู: tag 1 = เสียงพูด, tag 2 = เพลง
    @objc func volumeChanged(_ s: NSSlider) {
        switch s.tag { case 2: musicVolume = s.doubleValue; case 3: sfxVolume = s.doubleValue; default: volume = s.doubleValue }
        (s.superview?.viewWithTag(s.tag + 10) as? NSTextField)?.stringValue = volumeLabel(s.tag)
    }
    func volumeLabel(_ tag: Int) -> String {
        let (v, name, icon) = tag == 2 ? (musicVolume, "เพลง", "🎵") : tag == 3 ? (sfxVolume, "เสียงประกอบ", "🌊") : (volume, "เสียงพูด", "🗣")
        return v <= 0.001 ? "🔇 ปิด\(name)" : "\(icon) \(name) \(Int((v * 100).rounded()))%"
    }
    func volumeItem(_ tag: Int) -> NSMenuItem {
        let v = NSView(frame: NSRect(x: 0, y: 0, width: 230, height: 46))
        let label = NSTextField(labelWithString: volumeLabel(tag))
        label.frame = NSRect(x: 20, y: 25, width: 200, height: 16)
        label.font = .menuFont(ofSize: 12); label.textColor = .secondaryLabelColor; label.tag = tag + 10
        let slider = NSSlider(value: tag == 2 ? musicVolume : tag == 3 ? sfxVolume : volume, minValue: 0, maxValue: 1, target: self, action: #selector(volumeChanged(_:)))
        slider.frame = NSRect(x: 18, y: 4, width: 196, height: 20)
        slider.isContinuous = true; slider.tag = tag
        v.addSubview(label); v.addSubview(slider)
        let item = NSMenuItem(); item.view = v
        return item
    }
    @objc func toggleLook() { lookOn.toggle(); rebuildMenu() }
    // ไอคอนบนแถบเมนู: โทรศัพท์สีชมพูจาก UI ของเกม (assets/statusicon.png) — จางเป็นสีเทาเมื่อปิดโหมดโต้ตอบ
    func updateStatusIcon() {
        let file = root.appendingPathComponent(interact ? "assets/statusicon.png" : "assets/statusicon_off.png")
        if let img = NSImage(contentsOf: file) {
            img.size = NSSize(width: 18 * img.size.width / img.size.height, height: 18)
            status.button?.image = img
            status.button?.title = ""
        } else {
            status.button?.image = nil
            status.button?.title = interact ? "🌸" : "🌙"
        }
    }
    @objc func toggleInteract() { interact.toggle(); rebuildMenu() }
    // หยุดเอง/จอดับ = หยุดทั้งภาพและเพลง, ถูกบังมิด = หยุดแค่ภาพ (เพลงยังเล่นต่อ)
    @objc func togglePause() { paused.toggle(); js("BA.pause(\(paused || covered), \(paused))"); rebuildMenu() }
    @objc func resetView() { js("BA.resetView()") }
    @objc func openFolder() { NSWorkspace.shared.open(charsDir) }
    @objc func reload() { load(); rebuildMenu() }

    func jsonString(_ s: String) -> String {
        String(data: try! JSONEncoder().encode([s]), encoding: .utf8)!.dropFirst().dropLast().description
    }
}

extension AppDelegate: NSMenuDelegate {
    // สแกนโฟลเดอร์ใหม่ทุกครั้งที่เปิดเมนู เผื่อเพิ่งก๊อปตัวละครเข้ามา
    func menuNeedsUpdate(_ menu: NSMenu) {
        DispatchQueue.main.async { [weak self] in self?.rebuildMenuIfChanged() }
    }
    func rebuildMenuIfChanged() {
        let names = scanCharacters().map(\.name)
        let shown = status.menu?.items.filter { $0.indentationLevel == 1 }.map(\.title) ?? []
        if names != shown { rebuildMenu() }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
