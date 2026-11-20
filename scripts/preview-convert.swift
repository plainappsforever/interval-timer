// Converts a simulator recording to Apple's app preview size: 886 x 1920 portrait, H.264, 30 fps, no audio track.
// Usage: swift scripts/preview-convert.swift <in.mov> <out.mp4> [startSeconds durationSeconds]  (Apple: 15 to 30 s)
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 3 || args.count == 5 else { print("Usage: preview-convert.swift in.mov out.mp4"); exit(1) }
let inURL = URL(fileURLWithPath: args[1]), outURL = URL(fileURLWithPath: args[2])
let asset = AVURLAsset(url: inURL)
let sem = DispatchSemaphore(value: 0)
Task {
  do {
    let track = try await asset.loadTracks(withMediaType: .video)[0]
    let size = try await track.load(.naturalSize)
    let duration = try await asset.load(.duration)
    print("in: \(size) \(CMTimeGetSeconds(duration)) s")
    let from = args.count == 5 ? Double(args[3])! : 0
    let length = args.count == 5 ? Double(args[4])! : CMTimeGetSeconds(duration)
    let range = CMTimeRange(start: CMTime(seconds: from, preferredTimescale: 600), duration: CMTime(seconds: length, preferredTimescale: 600))
    let comp = AVMutableVideoComposition()
    comp.renderSize = CGSize(width: 886, height: 1920)
    comp.frameDuration = CMTime(value: 1, timescale: 30)
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(CGAffineTransform(scaleX: 886 / size.width, y: 1920 / size.height), at: .zero)
    instruction.layerInstructions = [layer]
    comp.instructions = [instruction]
    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else { print("no export session"); exit(1) }
    export.videoComposition = comp
    export.timeRange = range
    try await export.export(to: outURL, as: .mp4)
    print("wrote \(outURL.path)")
  } catch { print("failed: \(error)"); exit(1) }
  sem.signal()
}
sem.wait()
