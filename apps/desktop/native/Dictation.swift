import Foundation
import AVFoundation
import Speech
import Darwin

let socketPath = CommandLine.arguments.dropFirst().first ?? ""
let socketFD = socket(AF_UNIX, SOCK_STREAM, 0)
var address = sockaddr_un()
address.sun_family = sa_family_t(AF_UNIX)
let bytes = Array(socketPath.utf8) + [0]
guard !socketPath.isEmpty, bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { exit(1) }
withUnsafeMutableBytes(of: &address.sun_path) { buffer in buffer.copyBytes(from: bytes) }
let connected = withUnsafePointer(to: &address) { pointer in
 pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(socketFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
}
guard connected == 0 else { exit(1) }
let channel = FileHandle(fileDescriptor: socketFD, closeOnDealloc: true)
signal(SIGPIPE, SIG_IGN)
var channelOpen = true
// Audio stays in this process; only text and volume levels reach the parent.
func emit(_ status: String, text: String? = nil, error: String? = nil, segments: [[String: Any]]? = nil, level: Float? = nil, session: Int? = nil, settled: Bool? = nil, range: [String: Double]? = nil) {
    guard channelOpen else { return }
    var event: [String: Any] = ["status": status]
    if let text = text { event["text"] = text }
    if let error = error { event["error"] = error }
    if let segments = segments { event["segments"] = segments }
    if let level = level { event["level"] = level }
    if let session = session { event["session"] = session }
    if let settled = settled { event["settled"] = settled }
    if let range = range { event["range"] = range }
    if let data = try? JSONSerialization.data(withJSONObject: event) {
        try? channel.write(contentsOf: data + Data([10]))
    }
}
protocol Recording {
    func start()
    func stop()
    func finish(_ error: String?)
}

final class Dictation: Recording {
    let engine = AVAudioEngine()
    let audioLock = NSLock()
    var request: SFSpeechAudioBufferRecognitionRequest?
    var tasks: [Int: SFSpeechRecognitionTask] = [:]
    var session = -1
    var recognizer: SFSpeechRecognizer?
    var finished = false
    var stopping = false
    var tapped = false

    func finish(_ error: String? = nil) {
        guard !finished else { return }
        finished = true
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0) }
        for task in tasks.values { task.cancel() }
        emit(error == nil ? "stopped" : "error", error: error)
        exit(error == nil ? 0 : 1)
    }
    func stop() {
        guard !finished, !stopping else { return }
        stopping = true
        engine.stop()
        audioLock.lock()
        request?.endAudio()
        request = nil
        audioLock.unlock()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.finish() }
    }
    func start() {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard !self.stopping else { return }
                guard status == .authorized else {
                    self.finish("Speech recognition is not allowed. Enable Hubble Dictation in System Settings → Privacy & Security → Speech Recognition, then try again.")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { allowed in
                    DispatchQueue.main.async {
                        guard !self.stopping else { return }
                        guard allowed else {
                            self.finish("Microphone access is not allowed. Enable Hubble Dictation in System Settings → Privacy & Security → Microphone, then try again.")
                            return
                        }
                        self.listen()
                    }
                }
            }
        }
    }
    func listen() {
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
            finish("Speech recognition is unavailable for your current language. Try again after checking macOS Dictation settings.")
            return
        }
        guard recognizer.supportsOnDeviceRecognition else {
            finish("On-device speech recognition is unavailable for your current language. Enable and download that language in macOS Dictation settings, then try again.")
            return
        }
        self.recognizer = recognizer
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            finish("No microphone is available. Connect a microphone and try again.")
            return
        }
        beginSession()
        var meterFrames: AVAudioFrameCount = 0
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            self.audioLock.lock()
            self.request?.append(buffer)
            self.audioLock.unlock()
            meterFrames += buffer.frameLength
            guard Double(meterFrames) / format.sampleRate >= 0.05 else { return }
            meterFrames = 0
            let level = microphoneLevel(buffer)
            DispatchQueue.main.async {
                guard !self.finished, !self.stopping else { return }
                emit("listening", level: level)
            }
        }
        tapped = true
        do {
            engine.prepare()
            try engine.start()
            emit("listening")
            DispatchQueue.main.asyncAfter(deadline: .now() + 180) { self.stop() }
        } catch {
            finish("Could not start the microphone. Check your audio input in System Settings and try again.")
        }
    }
    func beginSession() {
        guard !finished, !stopping, let recognizer = recognizer else { return }
        session += 1
        let id = session
        let next = SFSpeechAudioBufferRecognitionRequest()
        next.requiresOnDeviceRecognition = true
        next.shouldReportPartialResults = true
        next.taskHint = .dictation
        if #available(macOS 13.0, *) { next.addsPunctuation = true }
        tasks[id] = recognizer.recognitionTask(with: next) { result, error in
            DispatchQueue.main.async {
                guard !self.finished else { return }
                if let result = result {
                    let transcription = result.bestTranscription
                    let text = transcription.formattedString
                    let formatted = text as NSString
                    let segments: [[String: Any]] = transcription.segments.enumerated().map { index, segment in
                        let start = index == 0 ? 0 : segment.substringRange.location
                        let end = index + 1 < transcription.segments.count ? transcription.segments[index + 1].substringRange.location : formatted.length
                        return ["start": segment.timestamp, "end": segment.timestamp + segment.duration, "text": formatted.substring(with: NSRange(location: start, length: end - start))]
                    }
                    // On-device recognition can settle an utterance without ending the task.
                    let settled = result.isFinal || (result.speechRecognitionMetadata?.speechDuration ?? 0) > 0
                    emit(self.stopping ? "stopping" : "listening", text: text, segments: segments, session: id, settled: settled)
                    if result.isFinal {
                        self.tasks.removeValue(forKey: id)
                        if self.stopping {
                            if self.tasks.isEmpty { self.finish() }
                        } else if id == self.session { self.beginSession() }
                        return
                    }
                }
                if let error = error as NSError? {
                    self.tasks.removeValue(forKey: id)
                    // Retired sessions may report an error after their audio ends.
                    guard id == self.session else {
                        if self.stopping && self.tasks.isEmpty { self.finish() }
                        return
                    }
                    let message = error.domain == "kLSRErrorDomain" && error.code == 201
                        ? "macOS Dictation is turned off. Open System Settings → Keyboard → Dictation, turn it on, then record again."
                        : "Speech recognition stopped. Any recognized text remains in your draft. Check the Dictation language in System Settings → Keyboard → Dictation, then record again."
                    self.finish(self.stopping ? nil : message)
                }
            }
        }
        // Keep microphone capture running while the prior recognizer settles its final words.
        audioLock.lock()
        request?.endAudio()
        request = next
        audioLock.unlock()
        DispatchQueue.main.asyncAfter(deadline: .now() + 55) {
            if id == self.session { self.beginSession() }
        }
    }

}
@available(macOS 26.0, *)
@MainActor
final class ModernDictation: @preconcurrency Recording {
    let engine = AVAudioEngine()
    let transcriber: SpeechTranscriber
    let fallback: () -> Void
    var analyzer: SpeechAnalyzer?
    var continuation: AsyncStream<AnalyzerInput>.Continuation?
    var work: Task<Void, Never>?
    var results: Task<Void, Never>?
    var finished = false
    var stopping = false
    var tapped = false
    var listening = false

    init(transcriber: SpeechTranscriber, fallback: @escaping () -> Void) {
        self.transcriber = transcriber
        self.fallback = fallback
    }
    static func make(fallback: @escaping () -> Void) async -> ModernDictation? {
        guard SpeechTranscriber.isAvailable,
              let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) else { return nil }
        return ModernDictation(transcriber: SpeechTranscriber(locale: locale, preset: .progressiveTranscription), fallback: fallback)
    }
    func start() {
        work = Task { @MainActor in
            guard await AVCaptureDevice.requestAccess(for: .audio) else {
                self.finish("Microphone access is not allowed. Enable Hubble Dictation in System Settings → Privacy & Security → Microphone, then try again.")
                return
            }
            guard !self.finished, !self.stopping else { return }
            do {
                if let install = try await AssetInventory.assetInstallationRequest(supporting: [self.transcriber]) {
                    try await install.downloadAndInstall()
                }
                guard !self.finished, !self.stopping else { return }
                let format = self.engine.inputNode.outputFormat(forBus: 0)
                guard format.sampleRate > 0, format.channelCount > 0 else {
                    self.finish("No microphone is available. Connect a microphone and try again.")
                    return
                }
                guard let target = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [self.transcriber], considering: format),
                      let converter = AVAudioConverter(from: format, to: target) else {
                    self.useFallback()
                    return
                }
                let analyzer = SpeechAnalyzer(modules: [self.transcriber])
                self.analyzer = analyzer
                try await analyzer.prepareToAnalyze(in: target)
                guard !self.finished, !self.stopping else { return }
                let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
                self.continuation = continuation
                self.results = Task { @MainActor in
                    do {
                        for try await result in self.transcriber.results {
                            guard !self.finished else { return }
                            let start = result.range.start.seconds
                            let end = result.range.end.seconds
                            guard start.isFinite, end.isFinite, start >= 0, end > start else { continue }
                            emit(self.stopping ? "stopping" : "listening",
                                 text: String(result.text.characters),
                                 range: ["start": start, "end": end])
                        }
                    } catch {
                        if !self.finished, !self.listening, !self.stopping { self.useFallback() }
                        else { self.finish("Speech recognition stopped. Your transcript remains in the draft. Try recording again.") }
                    }
                }
                try await analyzer.start(inputSequence: stream)
                guard !self.finished, !self.stopping else { return }
                var meterFrames: AVAudioFrameCount = 0
                self.engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                    // The tap reuses its buffer; conversion gives the async analyzer its own copy.
                    let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * target.sampleRate / format.sampleRate)) + 32
                    guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
                    var supplied = false
                    var error: NSError?
                    converter.convert(to: converted, error: &error) { _, status in
                        if supplied { status.pointee = .noDataNow; return nil }
                        supplied = true
                        status.pointee = .haveData
                        return buffer
                    }
                    if error != nil {
                        DispatchQueue.main.async { self.finish("Could not process microphone audio. Try recording again.") }
                        return
                    }
                    if converted.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: converted)) }
                    meterFrames += buffer.frameLength
                    if Double(meterFrames) / format.sampleRate >= 0.05 {
                        meterFrames = 0
                        let level = microphoneLevel(buffer)
                        DispatchQueue.main.async {
                            if !self.finished, !self.stopping { emit("listening", level: level) }
                        }
                    }
                }
                self.tapped = true
                self.engine.prepare()
                try self.engine.start()
                self.listening = true
                emit("listening")
                DispatchQueue.main.asyncAfter(deadline: .now() + 180) { self.stop() }
            } catch {
                if !self.finished, !self.stopping, !self.listening { self.useFallback() }
                else if !self.finished { self.finish("Could not start speech recognition. Try recording again.") }
            }
        }
    }
    func useFallback() {
        guard !finished, !stopping else { return }
        finished = true
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0) }
        continuation?.finish()
        results?.cancel()
        Task { @MainActor in
            if let analyzer = analyzer { await analyzer.cancelAndFinishNow() }
            guard channelOpen else { exit(0) }
            fallback()
        }
    }
    func stop() {
        guard !finished, !stopping else { return }
        stopping = true
        engine.stop()
        continuation?.finish()
        guard listening, let analyzer = analyzer else { finish(nil); return }
        Task { @MainActor in
            do {
                try await analyzer.finalizeAndFinishThroughEndOfInput()
                await self.results?.value
                self.finish(nil)
            } catch {
                self.finish("Could not finish transcription. Your transcript remains in the draft. Try recording again.")
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            self.finish("Could not finish transcription. Your transcript remains in the draft. Try recording again.")
        }
    }
    func finish(_ error: String? = nil) {
        guard !finished else { return }
        finished = true
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0) }
        continuation?.finish()
        work?.cancel()
        results?.cancel()
        emit(error == nil ? "stopped" : "error", error: error)
        exit(error == nil ? 0 : 1)
    }
}

func microphoneLevel(_ buffer: AVAudioPCMBuffer) -> Float {
    guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
    var squares: Float = 0
    for index in 0..<Int(buffer.frameLength) { squares += samples[index] * samples[index] }
    let rms = sqrt(squares / Float(buffer.frameLength))
    return min(1, max(0, (20 * log10(max(rms, 0.00001)) + 55) / 43))
}

let legacy = Dictation()
var dictation: any Recording = legacy
channel.readabilityHandler = { handle in
    let data = handle.availableData
    DispatchQueue.main.async {
        if data.isEmpty { channelOpen = false; dictation.finish(nil) }
        else { dictation.stop() }
    }
}
emit("starting")
Task { @MainActor in
    if #available(macOS 26.0, *), let modern = await ModernDictation.make(fallback: {
        dictation = legacy
        legacy.start()
    }) {
        guard !legacy.stopping else { return }
        dictation = modern
        modern.start()
    } else { legacy.start() }
}
RunLoop.main.run()
