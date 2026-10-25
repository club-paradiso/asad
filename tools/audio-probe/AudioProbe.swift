// ASAD macOS audio probe.
//
// A small, dependency-free CoreAudio/AVFoundation command-line tool that
// answers the one question the browser cannot: does a physical audio signal
// actually reach macOS from the device the operator thinks it does?
//
// It never installs anything, never changes a system setting, never writes
// audio unless asked (`--wav`), and uses only public, unprivileged APIs.
//
//   swiftc -O -o audio-probe AudioProbe.swift   (or: ./build.sh)
//
//   audio-probe list [--json]
//   audio-probe capture --device <name|uid|#index> [--seconds 8] [--wav out.wav]
//   audio-probe watch
//
// "Detected" is not "capturing". `list` tells you what macOS sees; `capture`
// tells you what the samples contain; and the verdict it prints is only ever
// about the samples, never about which cable they came through.
import AVFoundation
import CoreAudio
import Foundation

// MARK: - CoreAudio helpers

struct DeviceInfo: Codable {
  let index: Int
  let id: UInt32
  let name: String
  let uid: String
  let manufacturer: String
  let transport: String
  let inputChannels: Int
  let outputChannels: Int
  let nominalSampleRate: Double
  let availableSampleRates: [Double]
  let inputSources: [String]
  let currentInputSource: String?
  let isDefaultInput: Bool
  let isDefaultOutput: Bool
  let isAlive: Bool
  let isRunningSomewhere: Bool
  let hasInput: Bool
}

func address(_ selector: AudioObjectPropertySelector,
             _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
             _ element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain)
  -> AudioObjectPropertyAddress
{
  AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: element)
}

func getString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector,
               scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> String? {
  var addr = address(selector, scope)
  guard AudioObjectHasProperty(object, &addr) else { return nil }
  var size = UInt32(MemoryLayout<CFString?>.size)
  var value: CFString? = nil
  let status = withUnsafeMutablePointer(to: &value) { ptr in
    AudioObjectGetPropertyData(object, &addr, 0, nil, &size, ptr)
  }
  guard status == noErr, let string = value else { return nil }
  return string as String
}

func getUInt32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector,
               scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> UInt32? {
  var addr = address(selector, scope)
  guard AudioObjectHasProperty(object, &addr) else { return nil }
  var size = UInt32(MemoryLayout<UInt32>.size)
  var value: UInt32 = 0
  let status = AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value)
  return status == noErr ? value : nil
}

func getDouble(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Double? {
  var addr = address(selector)
  guard AudioObjectHasProperty(object, &addr) else { return nil }
  var size = UInt32(MemoryLayout<Double>.size)
  var value: Double = 0
  let status = AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value)
  return status == noErr ? value : nil
}

func channelCount(_ device: AudioObjectID, scope: AudioObjectPropertyScope) -> Int {
  var addr = address(kAudioDevicePropertyStreamConfiguration, scope)
  guard AudioObjectHasProperty(device, &addr) else { return 0 }
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr, size > 0 else {
    return 0
  }
  let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
  defer { raw.deallocate() }
  guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, raw) == noErr else { return 0 }
  let list = raw.assumingMemoryBound(to: AudioBufferList.self)
  let buffers = UnsafeMutableAudioBufferListPointer(list)
  return buffers.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func sampleRates(_ device: AudioObjectID) -> [Double] {
  var addr = address(kAudioDevicePropertyAvailableNominalSampleRates)
  guard AudioObjectHasProperty(device, &addr) else { return [] }
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr, size > 0 else {
    return []
  }
  let count = Int(size) / MemoryLayout<AudioValueRange>.size
  var ranges = [AudioValueRange](repeating: AudioValueRange(), count: count)
  guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &ranges) == noErr else { return [] }
  var out: [Double] = []
  for range in ranges {
    if range.mMinimum == range.mMaximum { out.append(range.mMinimum) }
    else { out.append(range.mMinimum); out.append(range.mMaximum) }
  }
  return Array(Set(out)).sorted()
}

func dataSourceName(_ device: AudioObjectID, _ source: UInt32, scope: AudioObjectPropertyScope) -> String {
  var sourceId = source
  var name: CFString? = nil
  var translation = AudioValueTranslation(
    mInputData: &sourceId, mInputDataSize: UInt32(MemoryLayout<UInt32>.size),
    mOutputData: &name, mOutputDataSize: UInt32(MemoryLayout<CFString?>.size))
  var addr = address(kAudioDevicePropertyDataSourceNameForIDCFString, scope)
  var size = UInt32(MemoryLayout<AudioValueTranslation>.size)
  let status = AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &translation)
  if status == noErr, let string = name { return string as String }
  return String(format: "0x%08x", source)
}

func inputSources(_ device: AudioObjectID) -> (all: [String], current: String?) {
  let scope = kAudioObjectPropertyScopeInput
  var addr = address(kAudioDevicePropertyDataSources, scope)
  guard AudioObjectHasProperty(device, &addr) else { return ([], nil) }
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr, size > 0 else {
    return ([], nil)
  }
  let count = Int(size) / MemoryLayout<UInt32>.size
  var ids = [UInt32](repeating: 0, count: count)
  guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &ids) == noErr else { return ([], nil) }
  let names = ids.map { dataSourceName(device, $0, scope: scope) }
  var current: String? = nil
  if let currentId = getUInt32(device, kAudioDevicePropertyDataSource, scope: scope) {
    current = dataSourceName(device, currentId, scope: scope)
  }
  return (names, current)
}

func transportName(_ code: UInt32?) -> String {
  guard let code else { return "unknown" }
  switch code {
  case kAudioDeviceTransportTypeBuiltIn: return "built-in"
  case kAudioDeviceTransportTypeUSB: return "usb"
  case kAudioDeviceTransportTypeBluetooth: return "bluetooth"
  case kAudioDeviceTransportTypeBluetoothLE: return "bluetooth-le"
  case kAudioDeviceTransportTypeAggregate: return "aggregate"
  case kAudioDeviceTransportTypeVirtual: return "virtual"
  case kAudioDeviceTransportTypeAirPlay: return "airplay"
  case kAudioDeviceTransportTypeHDMI: return "hdmi"
  case kAudioDeviceTransportTypeDisplayPort: return "displayport"
  case kAudioDeviceTransportTypeThunderbolt: return "thunderbolt"
  case kAudioDeviceTransportTypePCI: return "pci"
  case kAudioDeviceTransportTypeFireWire: return "firewire"
  case kAudioDeviceTransportTypeAVB: return "avb"
  case kAudioDeviceTransportTypeContinuityCaptureWired: return "continuity-wired"
  case kAudioDeviceTransportTypeContinuityCaptureWireless: return "continuity-wireless"
  default:
    let bytes = [UInt8(code >> 24 & 0xff), UInt8(code >> 16 & 0xff), UInt8(code >> 8 & 0xff), UInt8(code & 0xff)]
    return String(bytes: bytes, encoding: .ascii) ?? "unknown"
  }
}

func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioObjectID? {
  var addr = address(selector)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  var id: AudioObjectID = 0
  let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
  return status == noErr && id != 0 ? id : nil
}

func allDevices() -> [DeviceInfo] {
  var addr = address(kAudioHardwarePropertyDevices)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else {
    return []
  }
  let count = Int(size) / MemoryLayout<AudioObjectID>.size
  var ids = [AudioObjectID](repeating: 0, count: count)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else {
    return []
  }
  let defaultIn = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)
  let defaultOut = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
  return ids.enumerated().map { index, id in
    let inputs = channelCount(id, scope: kAudioObjectPropertyScopeInput)
    let sources = inputSources(id)
    return DeviceInfo(
      index: index,
      id: id,
      name: getString(id, kAudioObjectPropertyName) ?? "(unnamed)",
      uid: getString(id, kAudioDevicePropertyDeviceUID) ?? "",
      manufacturer: getString(id, kAudioObjectPropertyManufacturer) ?? "",
      transport: transportName(getUInt32(id, kAudioDevicePropertyTransportType)),
      inputChannels: inputs,
      outputChannels: channelCount(id, scope: kAudioObjectPropertyScopeOutput),
      nominalSampleRate: getDouble(id, kAudioDevicePropertyNominalSampleRate) ?? 0,
      availableSampleRates: sampleRates(id),
      inputSources: sources.all,
      currentInputSource: sources.current,
      isDefaultInput: defaultIn == id,
      isDefaultOutput: defaultOut == id,
      isAlive: (getUInt32(id, kAudioDevicePropertyDeviceIsAlive) ?? 0) != 0,
      isRunningSomewhere: (getUInt32(id, kAudioDevicePropertyDeviceIsRunningSomewhere) ?? 0) != 0,
      hasInput: inputs > 0)
  }
}

// MARK: - list

func printList(json: Bool) {
  let devices = allDevices()
  if json {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(["devices": devices]), let text = String(data: data, encoding: .utf8) {
      print(text)
    }
    return
  }
  print("CoreAudio devices (\(devices.count))\n")
  for d in devices {
    let flags = [
      d.isDefaultInput ? "DEFAULT IN" : nil,
      d.isDefaultOutput ? "DEFAULT OUT" : nil,
      d.isRunningSomewhere ? "in use" : nil,
      d.isAlive ? nil : "NOT ALIVE",
    ].compactMap { $0 }.joined(separator: " · ")
    print("#\(d.index)  \(d.name)\(flags.isEmpty ? "" : "   [\(flags)]")")
    print("     transport \(d.transport) · \(d.manufacturer.isEmpty ? "" : d.manufacturer + " · ")uid \(d.uid)")
    print("     input \(d.inputChannels) ch · output \(d.outputChannels) ch · \(Int(d.nominalSampleRate)) Hz" +
          (d.availableSampleRates.isEmpty ? "" : " (supports \(d.availableSampleRates.map { String(Int($0)) }.joined(separator: ", ")))"))
    if !d.inputSources.isEmpty {
      print("     input source: \(d.currentInputSource ?? "?") (available: \(d.inputSources.joined(separator: ", ")))")
    }
    if d.inputChannels == 0 {
      print("     → output-only: macOS cannot record from this device")
    }
    print("")
  }
  let recordable = devices.filter { $0.hasInput }
  print("Recordable inputs: \(recordable.isEmpty ? "none" : recordable.map { $0.name }.joined(separator: " | "))")
  print("Note: a listed input proves only that macOS enumerates it. Run `capture` to prove samples arrive.")
}

// MARK: - capture

struct CaptureStats {
  var frames: Int = 0
  var channels: Int = 1
  var sampleRate: Double = 0
  var peak: Float = 0
  var sumSquares: Double = 0
  var clippedSamples: Int = 0
  var dcSum: Double = 0
  var windows: [(rms: Float, peak: Float)] = []
  var perChannelRms: [Double] = []
}

func dbfs(_ linear: Float) -> Float {
  linear <= 0 ? -120 : 20 * log10(linear)
}

func findDevice(_ query: String) -> DeviceInfo? {
  let devices = allDevices()
  if query.hasPrefix("#"), let index = Int(query.dropFirst()) {
    return devices.first { $0.index == index }
  }
  if let byUid = devices.first(where: { $0.uid == query }) { return byUid }
  let lowered = query.lowercased()
  if let exact = devices.first(where: { $0.name.lowercased() == lowered }) { return exact }
  return devices.first { $0.name.lowercased().contains(lowered) }
}

func requestMicrophoneAccess() -> String {
  let status = AVCaptureDevice.authorizationStatus(for: .audio)
  switch status {
  case .authorized: return "authorized"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined:
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { ok in granted = ok; semaphore.signal() }
    _ = semaphore.wait(timeout: .now() + 60)
    return granted ? "authorized" : "denied"
  @unknown default: return "unknown"
  }
}

func capture(deviceQuery: String?, seconds: Double, wavPath: String?, json: Bool) -> Int32 {
  let permission = requestMicrophoneAccess()
  if permission != "authorized" {
    fputs("Microphone permission is \(permission). macOS blocks capture until the terminal app is allowed under System Settings → Privacy & Security → Microphone.\n", stderr)
    return 3
  }

  let engine = AVAudioEngine()
  let input = engine.inputNode
  var chosen: DeviceInfo? = nil

  if let query = deviceQuery {
    guard let device = findDevice(query) else {
      fputs("No audio device matches \"\(query)\". Run `audio-probe list`.\n", stderr)
      return 2
    }
    guard device.hasInput else {
      fputs("\"\(device.name)\" has no input channels — macOS cannot record from it.\n", stderr)
      return 2
    }
    chosen = device
    guard let unit = input.audioUnit else {
      fputs("Could not reach the input audio unit.\n", stderr)
      return 2
    }
    var deviceId = device.id
    let status = AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice,
                                      kAudioUnitScope_Global, 0, &deviceId,
                                      UInt32(MemoryLayout<AudioDeviceID>.size))
    guard status == noErr else {
      fputs("Could not select \"\(device.name)\" for capture (OSStatus \(status)).\n", stderr)
      return 2
    }
  } else {
    chosen = allDevices().first { $0.isDefaultInput }
  }

  let format = input.inputFormat(forBus: 0)
  guard format.sampleRate > 0, format.channelCount > 0 else {
    fputs("The selected device reports no usable input format (\(format)). It may be output-only or not ready.\n", stderr)
    return 2
  }

  var stats = CaptureStats()
  stats.channels = Int(format.channelCount)
  stats.sampleRate = format.sampleRate
  stats.perChannelRms = Array(repeating: 0, count: stats.channels)
  let lock = NSLock()
  var writer: AVAudioFile? = nil
  if let wavPath {
    writer = try? AVAudioFile(forWriting: URL(fileURLWithPath: wavPath), settings: format.settings)
    if writer == nil { fputs("Warning: could not open \(wavPath) for writing; continuing without a file.\n", stderr) }
  }

  // ~100 ms windows for the level timeline.
  let windowFrames = Int(format.sampleRate / 10)
  var windowAccum: (sum: Double, peak: Float, n: Int) = (0, 0, 0)

  input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
    guard let data = buffer.floatChannelData else { return }
    let frames = Int(buffer.frameLength)
    let channels = Int(buffer.format.channelCount)
    lock.lock()
    defer { lock.unlock() }
    try? writer?.write(from: buffer)
    stats.frames += frames
    for frame in 0..<frames {
      var mixed: Float = 0
      for ch in 0..<channels {
        let sample = data[ch][frame]
        mixed += sample
        stats.perChannelRms[ch] += Double(sample * sample)
        if abs(sample) >= 0.985 { stats.clippedSamples += 1 }
      }
      mixed /= Float(channels)
      let magnitude = abs(mixed)
      if magnitude > stats.peak { stats.peak = magnitude }
      stats.sumSquares += Double(mixed * mixed)
      stats.dcSum += Double(mixed)
      windowAccum.sum += Double(mixed * mixed)
      windowAccum.peak = max(windowAccum.peak, magnitude)
      windowAccum.n += 1
      if windowAccum.n >= windowFrames {
        stats.windows.append((Float(sqrt(windowAccum.sum / Double(windowAccum.n))), windowAccum.peak))
        windowAccum = (0, 0, 0)
      }
    }
  }

  // CoreAudio can hand back a device that is still being reconfigured by the
  // previous client (including a previous run of this tool): the engine starts
  // cleanly and the tap simply never fires. Wait briefly for the first buffer
  // and restart once before concluding that nothing is flowing.
  func startAndConfirmFlow() -> Bool {
    for attempt in 0..<2 {
      engine.prepare()
      do {
        try engine.start()
      } catch {
        fputs("Could not start capture: \(error.localizedDescription)\n", stderr)
        return false
      }
      let deadline = Date().addingTimeInterval(1.5)
      while Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
        lock.lock(); let flowing = stats.frames > 0; lock.unlock()
        if flowing { return true }
      }
      engine.stop()
      if attempt == 0 && !json { print("  (no buffers yet — restarting the capture once)") }
      Thread.sleep(forTimeInterval: 0.4)
    }
    return true
  }
  guard startAndConfirmFlow() else { return 2 }

  if !json {
    print("Capturing \(Int(seconds)) s from \"\(chosen?.name ?? "default input")\" (\(stats.channels) ch @ \(Int(stats.sampleRate)) Hz)…")
    print("Speak, or play the programme feed, now.\n")
  }
  let started = Date()
  var printedWindows = 0
  while Date().timeIntervalSince(started) < seconds {
    Thread.sleep(forTimeInterval: 0.25)
    if json { continue }
    lock.lock()
    let windows = stats.windows
    lock.unlock()
    while printedWindows < windows.count {
      let w = windows[printedWindows]
      if printedWindows % 4 == 0 {
        let bar = String(repeating: "█", count: max(0, min(40, Int((dbfs(w.rms) + 60) / 60 * 40))))
        print(String(format: "  %5.1fs  rms %6.1f dBFS  peak %6.1f dBFS  %@", Double(printedWindows) / 10, dbfs(w.rms), dbfs(w.peak), bar))
      }
      printedWindows += 1
    }
  }
  engine.stop()
  input.removeTap(onBus: 0)

  lock.lock()
  defer { lock.unlock() }
  let total = max(1, stats.frames)
  let rms = Float(sqrt(stats.sumSquares / Double(total)))
  let dc = stats.dcSum / Double(total)
  let silentWindows = stats.windows.filter { dbfs($0.rms) < -55 }.count
  let activeWindows = stats.windows.filter { dbfs($0.rms) >= -40 }.count
  let hotWindows = stats.windows.filter { dbfs($0.peak) > -1 }.count
  let clipRatio = Double(stats.clippedSamples) / Double(total * stats.channels)
  let perChannel = stats.perChannelRms.map { Float(sqrt($0 / Double(total))) }

  let verdict: String
  let explanation: String
  if stats.frames == 0 {
    verdict = "NO_SAMPLES"
    explanation = "The device delivered no audio buffers at all. macOS enumerates it but nothing is flowing."
  } else if silentWindows >= Int(Double(stats.windows.count) * 0.95) {
    verdict = "SILENT"
    explanation = "Essentially no signal (< -55 dBFS almost the whole time). Either nothing is connected to this input, the source is muted, or the wrong device is selected."
  } else if clipRatio > 0.002 || hotWindows > stats.windows.count / 4 {
    verdict = "CLIPPING"
    explanation = "The input is being overdriven. A line/headphone-level source into a microphone input needs attenuation, or the source volume must come down."
  } else if activeWindows == 0 {
    verdict = "TOO_LOW"
    explanation = "Signal present but weak (never above -40 dBFS). Raise the source level or the input gain in Audio MIDI Setup before relying on it for recognition."
  } else {
    verdict = "USABLE"
    explanation = "Real samples with speech-like level arrived. This proves capture from this device; it does not by itself prove which physical source produced them."
  }

  let channelNote: String
  if stats.channels > 1 {
    let levels = perChannel.map { String(format: "%.1f", dbfs($0)) }.joined(separator: " / ")
    let maxCh = perChannel.max() ?? 0
    let minCh = perChannel.min() ?? 0
    let imbalance = dbfs(maxCh) - dbfs(minCh)
    channelNote = "per-channel rms \(levels) dBFS" + (imbalance > 12 ? " — one channel is \(Int(imbalance)) dB quieter: likely a mono source on one side of a stereo plug" : "")
  } else {
    channelNote = "mono input"
  }

  if json {
    let report: [String: Any] = [
      "device": chosen?.name ?? "default",
      "uid": chosen?.uid ?? "",
      "transport": chosen?.transport ?? "",
      "channels": stats.channels,
      "sampleRate": stats.sampleRate,
      "seconds": seconds,
      "frames": stats.frames,
      "rmsDbfs": dbfs(rms),
      "peakDbfs": dbfs(stats.peak),
      "dcOffset": dc,
      "clippedSampleRatio": clipRatio,
      "silentWindowRatio": stats.windows.isEmpty ? 1 : Double(silentWindows) / Double(stats.windows.count),
      "activeWindowRatio": stats.windows.isEmpty ? 0 : Double(activeWindows) / Double(stats.windows.count),
      "perChannelRmsDbfs": perChannel.map { dbfs($0) },
      "verdict": verdict,
      "explanation": explanation,
      "wav": wavPath ?? NSNull(),
    ]
    if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]),
       let text = String(data: data, encoding: .utf8) {
      print(text)
    }
  } else {
    print("")
    print("Result for \"\(chosen?.name ?? "default input")\"")
    print(String(format: "  frames %d · rms %.1f dBFS · peak %.1f dBFS · dc %.4f", stats.frames, dbfs(rms), dbfs(stats.peak), dc))
    print(String(format: "  silent windows %d/%d · active windows %d/%d · clipped samples %.3f%%", silentWindows, stats.windows.count, activeWindows, stats.windows.count, clipRatio * 100))
    print("  \(channelNote)")
    print("")
    print("VERDICT: \(verdict)")
    print("  \(explanation)")
    if let wavPath, writer != nil { print("  Recording saved to \(wavPath) — listen to it to confirm the source.") }
  }
  return verdict == "USABLE" ? 0 : 1
}

// MARK: - watch

func watch() {
  print("Watching for audio device changes. Plug or unplug the adapter now. Ctrl-C to stop.\n")
  var known = Dictionary(uniqueKeysWithValues: allDevices().map { ($0.uid, $0) })
  var lastDefault = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)
  func snapshot() {
    let now = Dictionary(uniqueKeysWithValues: allDevices().map { ($0.uid, $0) })
    for (uid, device) in now where known[uid] == nil {
      print("+ added    \(device.name) · \(device.transport) · in \(device.inputChannels) ch / out \(device.outputChannels) ch · \(Int(device.nominalSampleRate)) Hz")
      if !device.inputSources.isEmpty { print("           input source now: \(device.currentInputSource ?? "?")") }
    }
    for (uid, device) in known where now[uid] == nil {
      print("- removed  \(device.name)")
    }
    for (uid, device) in now {
      if let before = known[uid], before.currentInputSource != device.currentInputSource {
        print("~ \(device.name): input source \(before.currentInputSource ?? "?") → \(device.currentInputSource ?? "?")")
      }
    }
    let def = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)
    if def != lastDefault {
      let name = now.values.first { $0.id == def }?.name ?? "none"
      print("* default input is now: \(name)")
      lastDefault = def
    }
    known = now
  }
  let queue = DispatchQueue(label: "audio-probe.watch")
  let listener: AudioObjectPropertyListenerBlock = { _, _ in queue.async { snapshot() } }
  var devicesAddr = address(kAudioHardwarePropertyDevices)
  var defaultAddr = address(kAudioHardwarePropertyDefaultInputDevice)
  AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &devicesAddr, queue, listener)
  AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &defaultAddr, queue, listener)
  // Data-source changes (3.5 mm jack: internal mic ↔ external mic) fire per device.
  for device in known.values where device.hasInput {
    var sourceAddr = address(kAudioDevicePropertyDataSource, kAudioObjectPropertyScopeInput)
    AudioObjectAddPropertyListenerBlock(device.id, &sourceAddr, queue, listener)
  }
  snapshot()
  RunLoop.main.run()
}

// MARK: - main

let args = Array(CommandLine.arguments.dropFirst())
func flag(_ name: String) -> String? {
  guard let at = args.firstIndex(of: name), at + 1 < args.count else { return nil }
  return args[at + 1]
}
let json = args.contains("--json")

switch args.first {
case "list":
  printList(json: json)
case "capture":
  let seconds = Double(flag("--seconds") ?? "8") ?? 8
  exit(capture(deviceQuery: flag("--device"), seconds: seconds, wavPath: flag("--wav"), json: json))
case "watch":
  watch()
default:
  print("""
  ASAD macOS audio probe

    audio-probe list [--json]                 enumerate CoreAudio devices and which can record
    audio-probe capture [--device <name|uid|#index>] [--seconds 8] [--wav out.wav] [--json]
                                              record from one input and judge the samples
    audio-probe watch                         print device add/remove and input-source changes live

  Exit codes for capture: 0 usable · 1 silent/too low/clipping · 2 device problem · 3 permission.
  """)
}
