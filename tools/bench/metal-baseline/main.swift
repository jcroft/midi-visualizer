// MetalBaseline: the native comparison for the latency spike.
//
// A window that is black, except that on any frame following a MIDI note-on
// (velocity > 0) the whole view is cleared to white for exactly one frame.
// This matches the Electron app's "Flash test" mode, so the two can be filmed
// side by side at 240 fps.
//
// It also prints the software leg for each flash: the CoreMIDI timestamp of the
// note-on to the drawable's actual presentedTime (when the frame went to the
// display). Panel response (~3 ms) comes on top of that.
//
// Build + run:  ./build.sh      (needs Xcode Command Line Tools)
// Keys: any key = test flash · Cmd+F = fullscreen · Cmd+Q = quit

import AppKit
import CoreMIDI
import Metal
import MetalKit
import QuartzCore

// MARK: - Host clock

enum HostClock {
    /// Seconds per mach_absolute_time tick (same clock as CoreMIDI timestamps and CACurrentMediaTime).
    static let secondsPerTick: Double = {
        var tb = mach_timebase_info_data_t()
        mach_timebase_info(&tb)
        return Double(tb.numer) / Double(tb.denom) / 1_000_000_000
    }()

    static func seconds(_ ticks: UInt64) -> Double { Double(ticks) * secondsPerTick }
}

// MARK: - Shared flash state (written on the CoreMIDI thread, read on the main thread)

final class FlashState: @unchecked Sendable {
    private let lock = NSLock()
    private var pending = 0
    private var firstStamp: UInt64 = 0

    func noteOn(stamp: UInt64) {
        let ts = stamp != 0 ? stamp : mach_absolute_time()
        lock.lock()
        if pending == 0 { firstStamp = ts }
        pending += 1
        lock.unlock()
    }

    /// Returns (flash this frame?, earliest note-on host time since the last frame, note count).
    func take() -> (Bool, UInt64, Int) {
        lock.lock()
        let n = pending
        let ts = firstStamp
        pending = 0
        firstStamp = 0
        lock.unlock()
        return (n > 0, ts, n)
    }
}

// MARK: - CoreMIDI input (all sources, hot-plug)

final class MIDIIn {
    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var connected: [MIDIEndpointRef] = []
    private let state: FlashState

    /// Universal MIDI Packet sizes in 32-bit words, indexed by message type (high nibble).
    private static let umpWords: [Int] = [1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4]

    init(state: FlashState) {
        self.state = state
    }

    func start() {
        var status = MIDIClientCreateWithBlock("MetalBaseline" as CFString, &client) { [weak self] note in
            if note.pointee.messageID == .msgSetupChanged {
                DispatchQueue.main.async { self?.reconnect() }
            }
        }
        guard status == 0 else {
            print("MIDIClientCreateWithBlock failed: \(status)")
            return
        }
        let flash = state
        let sizes = MIDIIn.umpWords
        // MIDI 1.0 protocol: every message arrives as a 32-bit MIDI 1.0 channel-voice UMP (type 2).
        status = MIDIInputPortCreateWithProtocol(client, "MetalBaseline In" as CFString, ._1_0, &port) { listPtr, _ in
            for packet in listPtr.unsafeSequence() {
                let stamp = packet.pointee.timeStamp
                let count = min(Int(packet.pointee.wordCount), 64)
                withUnsafeBytes(of: packet.pointee.words) { raw in
                    var i = 0
                    while i < count {
                        let w = raw.load(fromByteOffset: i * 4, as: UInt32.self)
                        let messageType = Int(w >> 28)
                        if messageType == 2 {
                            let statusByte = (w >> 16) & 0xF0
                            let velocity = w & 0x7F
                            if statusByte == 0x90 && velocity > 0 {
                                flash.noteOn(stamp: stamp)
                            }
                        }
                        i += sizes[messageType]
                    }
                }
            }
        }
        guard status == 0 else {
            print("MIDIInputPortCreateWithProtocol failed: \(status)")
            return
        }
        reconnect()
    }

    func reconnect() {
        for src in connected { MIDIPortDisconnectSource(port, src) }
        connected.removeAll()
        let n = MIDIGetNumberOfSources()
        for i in 0..<n {
            let src = MIDIGetSource(i)
            if src == 0 { continue }
            if MIDIPortConnectSource(port, src, nil) == 0 {
                connected.append(src)
                print("MIDI: listening to \(MIDIIn.name(of: src))")
            }
        }
        if connected.isEmpty { print("MIDI: no sources found (any key on the Mac keyboard also flashes)") }
    }

    static func name(of obj: MIDIObjectRef) -> String {
        var str: Unmanaged<CFString>?
        if MIDIObjectGetStringProperty(obj, kMIDIPropertyDisplayName, &str) == 0, let s = str {
            return s.takeRetainedValue() as String
        }
        return "source \(obj)"
    }
}

// MARK: - Latency log

final class LatencyLog {
    private var samples: [Double] = []
    var onUpdate: ((String) -> Void)?

    func add(ms: Double, notes: Int) {
        samples.append(ms)
        print(String(format: "flash #%d  MIDI→present %6.2f ms  (+~3 ms panel)%@",
                     samples.count, ms, notes > 1 ? "  [\(notes) notes]" : ""))
        let line = summary()
        if samples.count % 20 == 0 { print(line) }
        onUpdate?(line)
    }

    func summary() -> String {
        let s = samples.sorted()
        func p(_ q: Double) -> Double { s[min(s.count - 1, Int((q * Double(s.count - 1)).rounded()))] }
        return String(format: "n=%d  MIDI→present p50 %.1f  p95 %.1f  p99 %.1f ms", s.count, p(0.5), p(0.95), p(0.99))
    }
}

/// Built outside any actor-isolated type: Metal calls this on its own thread.
enum PresentLog {
    static func handler(noteSeconds: Double, notes: Int, log: LatencyLog) -> MTLDrawablePresentedHandler {
        return { d in
            let presented = d.presentedTime // 0 if the frame was never shown
            guard presented > 0 else { return }
            let ms = (presented - noteSeconds) * 1000
            DispatchQueue.main.async { log.add(ms: ms, notes: notes) }
        }
    }
}

// MARK: - View + renderer

final class FlashView: MTKView {
    var onKey: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        let cmd = event.modifierFlags.contains(.command)
        let ch = event.charactersIgnoringModifiers?.lowercased() ?? ""
        if cmd && ch == "f" {
            window?.toggleFullScreen(nil)
        } else if cmd && ch == "q" {
            NSApp.terminate(nil)
        } else if !event.isARepeat {
            onKey?()
        }
    }
}

final class Renderer: NSObject, MTKViewDelegate {
    private let queue: MTLCommandQueue
    private let state: FlashState
    private let log: LatencyLog
    private var frames = 0
    private var lastFpsT = CACurrentMediaTime()

    init(device: MTLDevice, state: FlashState, log: LatencyLog) {
        self.queue = device.makeCommandQueue()!
        self.state = state
        self.log = log
        super.init()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        let (flash, stamp, notes) = state.take()
        guard let pass = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let cmd = queue.makeCommandBuffer() else { return }
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = flash
            ? MTLClearColor(red: 1, green: 1, blue: 1, alpha: 1)
            : MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        if let enc = cmd.makeRenderCommandEncoder(descriptor: pass) {
            enc.endEncoding()
        }
        if flash {
            drawable.addPresentedHandler(PresentLog.handler(noteSeconds: HostClock.seconds(stamp), notes: notes, log: log))
        }
        cmd.present(drawable)
        cmd.commit()

        frames += 1
        let now = CACurrentMediaTime()
        if now - lastFpsT >= 5 {
            print(String(format: "render rate: %.1f fps", Double(frames) / (now - lastFpsT)))
            frames = 0
            lastFpsT = now
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var renderer: Renderer?
    private var midi: MIDIIn?
    private let state = FlashState()
    private let log = LatencyLog()

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let device = MTLCreateSystemDefaultDevice() else {
            print("No Metal device")
            NSApp.terminate(nil)
            return
        }
        let rect = NSRect(x: 0, y: 0, width: 1000, height: 640)
        let view = FlashView(frame: rect, device: device)
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        view.preferredFramesPerSecond = 120
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        if let layer = view.layer as? CAMetalLayer {
            layer.displaySyncEnabled = true
        }
        let state = self.state
        view.onKey = { state.noteOn(stamp: mach_absolute_time()) }

        let renderer = Renderer(device: device, state: state, log: log)
        view.delegate = renderer
        self.renderer = renderer

        let window = NSWindow(contentRect: rect,
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered,
                              defer: false)
        window.title = "Metal Baseline: flash on note-on"
        window.collectionBehavior = [.fullScreenPrimary]
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(view)
        self.window = window
        log.onUpdate = { [weak window] line in window?.title = "Metal Baseline: \(line)" }

        let midi = MIDIIn(state: state)
        midi.start()
        self.midi = midi

        NSApp.activate(ignoringOtherApps: true)
        print("Metal Baseline running at up to 120 Hz. Cmd+F fullscreen, Cmd+Q quit.")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
