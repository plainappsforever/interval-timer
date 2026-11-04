import AVFoundation
import ExpoModulesCore

// SPEC §6.2 / D15: renders a cue text with AVSpeechSynthesizer.write(_:toBufferCallback:) into an AVAudioFile (CAF,
// the synthesizer's own PCM format), so the cue is later played by the same audio path as the beeps — which keeps
// working while the iPhone is locked, unlike live utterances (Apple forum 849627). One render at a time (JS queues).
public class VoiceRenderModule: Module {
  private var synthesizer: AVSpeechSynthesizer?
  private var job: RenderJob?

  public func definition() -> ModuleDefinition {
    Name("VoiceRender")

    AsyncFunction("render") { (text: String, language: String, voiceId: String?, outPath: String, promise: Promise) in
      DispatchQueue.main.async { self.render(text: text, language: language, voiceId: voiceId, outPath: outPath, promise: promise) }
    }

    AsyncFunction("voices") { (language: String) -> [[String: Any]] in
      let prefix = language.lowercased()
      return AVSpeechSynthesisVoice.speechVoices()
        .filter { $0.language.lowercased().hasPrefix(prefix) }
        .map { v in
          let quality: String
          switch v.quality {
          case .enhanced: quality = "enhanced"
          case .premium: quality = "premium"
          default: quality = "default"
          }
          return ["id": v.identifier, "name": v.name, "language": v.language, "quality": quality, "offline": true]
        }
    }
  }

  private func render(text: String, language: String, voiceId: String?, outPath: String, promise: Promise) {
    if job != nil {
      promise.resolve(["ok": false, "reason": "error", "message": "busy"])
      return
    }
    var voice: AVSpeechSynthesisVoice?
    if let id = voiceId { voice = AVSpeechSynthesisVoice(identifier: id) }
    if voice == nil { voice = AVSpeechSynthesisVoice(language: language) }
    guard let chosen = voice else {
      promise.resolve(["ok": false, "reason": "no-voice"])
      return
    }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = chosen
    let url = URL(fileURLWithPath: outPath)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: url) // our own cache file of the same clip id, re-rendered
    let synth = synthesizer ?? AVSpeechSynthesizer()
    synthesizer = synth
    let current = RenderJob(url: url, promise: promise) { [weak self] in self?.job = nil }
    job = current
    // A synthesizer that never answers (seen with missing voice assets on simulators) must not hang the queue.
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { current.finish(error: "timeout") }
    synth.write(utterance) { buffer in
      DispatchQueue.main.async { current.append(buffer) }
    }
  }
}

private final class RenderJob {
  let url: URL
  let promise: Promise
  let done: () -> Void
  var file: AVAudioFile?
  var frames: AVAudioFramePosition = 0
  var sampleRate: Double = 0
  var finished = false

  init(url: URL, promise: Promise, done: @escaping () -> Void) {
    self.url = url
    self.promise = promise
    self.done = done
  }

  func append(_ buffer: AVAudioBuffer) {
    if finished { return }
    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 {
      // The synthesizer's end marker.
      finish(error: nil)
      return
    }
    do {
      if file == nil {
        file = try AVAudioFile(forWriting: url, settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
        sampleRate = pcm.format.sampleRate
      }
      try file?.write(from: pcm)
      frames += AVAudioFramePosition(pcm.frameLength)
    } catch {
      finish(error: "write: \(error.localizedDescription)")
    }
  }

  func finish(error: String?) {
    if finished { return }
    finished = true
    file = nil // closes the file
    done()
    if let error = error, frames == 0 || error != "timeout" {
      promise.resolve(["ok": false, "reason": "error", "message": error])
      return
    }
    if frames == 0 || sampleRate <= 0 {
      promise.resolve(["ok": false, "reason": "no-voice", "message": "empty"])
      return
    }
    promise.resolve(["ok": true, "path": url.path, "durationMs": Double(frames) / sampleRate * 1000])
  }
}
