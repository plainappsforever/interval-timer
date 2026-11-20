// Captioned store screenshots from raw captures (generalises print-cost/scripts/make-appstore-shots.swift).
// Usage: swift scripts/store-frames.swift [--spec store/frames.json] [--root <app folder>] [--out <dir>]
//                                         --platforms <ios|android|ios,android> [--check]
//   --spec       spec file, relative to --root (default store/frames.json)
//   --root       app folder (default current folder); capture paths in the spec are relative to it
//   --out        output folder (default <root>/artifacts/store); files go to <out>/<platform>/<lang>/NN.png
//   --platforms  ios (1320x2868, Apple 6.9"), ios-6.3 (1206x2622), android (1080x1920). REQUIRED (no default, R4 2026-11-19).
//                Source guard: ios frames must come from captures/, android frames from captures-android/;
//                use store/frames.json for ios and store/frames-android.json for android.
//   --check      only validate (captions per language, duplicates, capture files, contrast, caption fit, and the
//                size/alpha of PNGs already written); writes nothing. Generation runs the same check first.
// Spec format and a worked example: docs/STORE_FRAMES.md. Plain CoreGraphics/CoreText/AppKit, system fonts only.
import AppKit
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

var opts: [String: String] = [:]
var flags = Set<String>()
do {
  let a = CommandLine.arguments
  var i = 1
  while i < a.count {
    guard a[i].hasPrefix("--") else { i += 1; continue }
    let k = String(a[i].dropFirst(2))
    if k == "check" { flags.insert(k); i += 1 } else if i + 1 < a.count { opts[k] = a[i + 1]; i += 2 } else { i += 1 }
  }
}
func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

// Apple "Screenshot specifications" (fetched 2026-11-16): iPhone with Dynamic Island large display 1320x2868 (also 1260x2736,
// 1290x2796); medium display 1179x2556 / 1206x2622. Smaller sets are scaled from the large one, so ios is enough.
// Google Play phone screenshots: 320-3840 px per side, longer side at most 2x the shorter; 1080x1920 is the usual choice.
let targets: [String: (w: Int, h: Int, alpha: Bool)] = [
  "ios": (1320, 2868, false), "ios-6.3": (1206, 2622, false), "android": (1080, 1920, true),
]
let allLangs = ["en", "de", "fr", "es", "it", "nl"]
let root = URL(fileURLWithPath: opts["root"] ?? FileManager.default.currentDirectoryPath)
let specURL = URL(fileURLWithPath: opts["spec"] ?? "store/frames.json", relativeTo: root)
let outDir = opts["out"].map { URL(fileURLWithPath: $0) } ?? root.appendingPathComponent("artifacts/store")
guard let platformsOpt = opts["platforms"] else { fail("--platforms is required (ios, ios-6.3 or android). iOS uses store/frames.json, Android store/frames-android.json.") }
let platforms = platformsOpt.split(separator: ",").map(String.init)
for p in platforms where targets[p] == nil { fail("unknown platform \(p) (ios, ios-6.3, android)") }
let checkOnly = flags.contains("check")

// MARK: spec
guard let specData = try? Data(contentsOf: specURL), let spec = (try? JSONSerialization.jsonObject(with: specData)) as? [String: Any] else {
  fail("cannot read spec \(specURL.path)")
}
let langs = (spec["languages"] as? [String]) ?? allLangs
let defaults = (spec["style"] as? [String: Any]) ?? [:]
guard let frames = spec["frames"] as? [[String: Any]], !frames.isEmpty else { fail("spec has no frames") }

struct Style {
  var cropTop: CGFloat = 0.075, layout = "framed", bgType = "gradient", bg: [UInt32] = [0x1E3A5F, 0x0B1B33], position = "top"
  var text: UInt32 = 0xFFFFFF, font = "system", device = true, deviceColor: UInt32 = 0x0B0B0F
  var zoom: [Double] = [0, 0, 1, 0.5]
  var scale: CGFloat = 1   // full-bleed only: enlarge the capture, cutting equal strips off both sides
}
func hex(_ v: Any?) -> UInt32? {
  guard let s = v as? String, let n = UInt32(s.replacingOccurrences(of: "#", with: ""), radix: 16) else { return nil }
  return n
}
func merge(_ base: Style, _ d: [String: Any]) -> Style {
  var s = base
  if let v = d["layout"] as? String { s.layout = v }
  if let v = d["cropTop"] as? Double { s.cropTop = CGFloat(v) }
  if let b = d["background"] as? [String: Any] {
    if let t = b["type"] as? String { s.bgType = t }
    if let c = b["colors"] as? [String] { s.bg = c.compactMap { hex($0) } }
  }
  if let v = d["captionPosition"] as? String { s.position = v }
  if let v = hex(d["textColor"]) { s.text = v }
  if let v = d["font"] as? String { s.font = v }
  if let v = d["deviceFrame"] as? Bool { s.device = v }
  if let v = hex(d["deviceColor"]) { s.deviceColor = v }
  if let v = d["scale"] as? Double { s.scale = CGFloat(v) }
  if let z = d["zoom"] as? [Double], z.count == 4 { s.zoom = z }
  return s
}
let baseStyle = merge(Style(), defaults)

// MARK: drawing helpers
let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ h: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [CGFloat((h >> 16) & 255) / 255, CGFloat((h >> 8) & 255) / 255, CGFloat(h & 255) / 255, a])!
}
func lum(_ h: UInt32) -> Double {
  func ch(_ s: UInt32) -> Double { let c = Double((h >> s) & 255) / 255; return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0)
}
func contrast(_ a: UInt32, _ b: UInt32) -> Double { let x = lum(a), y = lum(b); return (max(x, y) + 0.05) / (min(x, y) + 0.05) }
func load(_ url: URL) -> CGImage? {
  guard let s = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(s, 0, nil)
}
func canvas(_ w: Int, _ h: Int, alpha: Bool) -> CGContext {
  CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
            bitmapInfo: (alpha ? CGImageAlphaInfo.premultipliedLast : CGImageAlphaInfo.noneSkipLast).rawValue)!
}
func uiFont(_ name: String, _ size: CGFloat) -> CTFont {
  var d = NSFont.systemFont(ofSize: size, weight: name == "black" ? .black : .bold).fontDescriptor
  switch name {
  case "rounded": d = d.withDesign(.rounded) ?? d
  case "serif": d = d.withDesign(.serif) ?? d
  default: break
  }
  return NSFont(descriptor: d, size: size) ?? NSFont.boldSystemFont(ofSize: size)
}

struct Fit { var size: CGFloat; var frame: CTFrame; var height: CGFloat; var ok: Bool }
/// Largest bold font size (down to 2.2 % of the width) where the caption wraps in at most 3 lines inside box, no word is
/// broken and the height fits. `ok` is false when even the smallest size does not fit.
func fitCaption(_ text: String, font: String, color: UInt32, box: CGSize, startSize: CGFloat, minSize: CGFloat) -> Fit {
  var size = startSize
  while true {
    let ctFont = uiFont(font, size)
    var align = CTTextAlignment.center
    let para = withUnsafePointer(to: &align) {
      CTParagraphStyleCreate([CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: $0)], 1)
    }
    let attrs: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): ctFont,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): rgb(color),
      NSAttributedString.Key(kCTParagraphStyleAttributeName as String): para,
    ]
    let setter = CTFramesetterCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
    let tall = CGSize(width: box.width, height: 100000)
    let sz = CTFramesetterSuggestFrameSizeWithConstraints(setter, CFRange(location: 0, length: 0), nil, tall, nil)
    let h = ceil(sz.height) + 2
    let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: CGRect(x: 0, y: 0, width: box.width, height: h), transform: nil), nil)
    let lines = (CTFrameGetLines(frame) as! [CTLine])
    let wordsFit = text.split(separator: " ").allSatisfy { w in
      let l = CTLineCreateWithAttributedString(NSAttributedString(string: String(w), attributes: attrs))
      return CTLineGetTypographicBounds(l, nil, nil, nil) <= Double(box.width)
    }
    let f = Fit(size: size, frame: frame, height: h, ok: lines.count <= 3 && wordsFit && h <= box.height)
    if f.ok || size <= minSize { return f }
    size = max(minSize, size * 0.94)
  }
}

/// Geometry shared by check and drawing: caption box and the area left for the capture.
func geometry(_ W: CGFloat, _ H: CGFloat, _ s: Style) -> (caption: CGRect, area: CGRect) {
  let band = H * 0.2, side = W * 0.06
  let capture = s.position == "top" ? CGRect(x: 0, y: 0, width: W, height: H - band) : CGRect(x: 0, y: band, width: W, height: H - band)
  let cap = s.position == "top" ? CGRect(x: 0, y: H - band, width: W, height: band) : CGRect(x: 0, y: 0, width: W, height: band)
  return (cap.insetBy(dx: side, dy: band * 0.1), s.layout == "full-bleed" ? capture : capture.insetBy(dx: side, dy: H * 0.02))
}

// MARK: check
var problems: [String] = []
func problem(_ m: String) { problems.append(m) }
let validLayouts = ["framed", "full-bleed", "zoom"], validFonts = ["system", "rounded", "serif", "black"]
var captures: [Int: CGImage] = [:]
var langCaptures: [String: CGImage] = [:]   // "idx|lang" -> capture of the app in that language (optional "captureByLang")
var styles: [Int: Style] = [:]
for (idx, fr) in frames.enumerated() {
  let n = String(format: "%02d", idx + 1)
  let s = merge(baseStyle, (fr["style"] as? [String: Any]) ?? [:])
  styles[idx] = s
  if !validLayouts.contains(s.layout) { problem("frame \(n): layout \"\(s.layout)\" is not one of \(validLayouts)") }
  if !validFonts.contains(s.font) { problem("frame \(n): font \"\(s.font)\" is not one of \(validFonts)") }
  if !["top", "bottom"].contains(s.position) { problem("frame \(n): captionPosition must be top or bottom") }
  if s.bg.isEmpty || (s.bgType == "gradient" && s.bg.count != 2) { problem("frame \(n): background needs 1 colour (solid) or 2 (gradient)") }
  if s.layout == "zoom" && (s.zoom[0] < 0 || s.zoom[1] < 0 || s.zoom[2] <= 0 || s.zoom[3] <= 0 || s.zoom[0] + s.zoom[2] > 1.0001 || s.zoom[1] + s.zoom[3] > 1.0001) {
    problem("frame \(n): zoom [x, y, w, h] must be fractions inside the capture")
  }
  for c in s.bg where contrast(s.text, c) < 4.5 { problem("frame \(n): text colour has contrast \(String(format: "%.1f", contrast(s.text, c))) against a background colour (needs 4.5)") }
  guard let path = fr["capture"] as? String else { problem("frame \(n): no \"capture\" path"); continue }
  var allPaths = [path]
  allPaths += Array(((fr["captureByLang"] as? [String: String]) ?? [:]).values)
  for p in platforms {
    for cp in allPaths {
      let isAndroid = cp.contains("captures-android")
      if p.hasPrefix("ios") && isAndroid { problem("frame \(n): \(p) frame uses an Android capture \(cp)") }
      if p == "android" && !isAndroid { problem("frame \(n): android frame uses a non-Android capture \(cp)") }
    }
  }
  if let img = load(URL(fileURLWithPath: path, relativeTo: root)) {
    captures[idx] = img
    if img.height < img.width { problem("frame \(n): capture \(path) is landscape (\(img.width) x \(img.height)); phone captures are portrait") }
  } else { problem("frame \(n): cannot read capture \(path)") }
  for (l, lp) in (fr["captureByLang"] as? [String: String]) ?? [:] where langs.contains(l) {
    if let img = load(URL(fileURLWithPath: lp, relativeTo: root)) { langCaptures["\(idx)|\(l)"] = img } else { problem("frame \(n): cannot read \(l) capture \(lp)") }
  }
  let caps = (fr["captions"] as? [String: String]) ?? [:]
  for l in langs {
    guard let t = caps[l], !t.trimmingCharacters(in: .whitespaces).isEmpty else { problem("frame \(n): no \(l) caption"); continue }
    for p in platforms {
      let tg = targets[p]!, g = geometry(CGFloat(tg.w), CGFloat(tg.h), s)
      if !fitCaption(t, font: s.font, color: s.text, box: g.caption.size, startSize: CGFloat(tg.w) * 0.075, minSize: CGFloat(tg.w) * 0.034).ok {
        problem("frame \(n) \(l) (\(p)): caption does not fit even at the smallest size, shorten it: \"\(t)\"")
      }
    }
  }
}
for l in langs {
  var seen: [String: String] = [:]
  for (idx, fr) in frames.enumerated() {
    guard let t = (fr["captions"] as? [String: String])?[l] else { continue }
    let key = t.lowercased().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    if let other = seen[key] { problem("\(l): frames \(other) and \(String(format: "%02d", idx + 1)) have the same caption \"\(t)\"") } else { seen[key] = String(format: "%02d", idx + 1) }
  }
}
// Files already written: right size, and no alpha for Apple.
for p in platforms {
  let tg = targets[p]!
  for l in langs {
    for idx in frames.indices {
      let url = outDir.appendingPathComponent("\(p)/\(l)/\(String(format: "%02d", idx + 1)).png")
      guard let img = load(url) else { continue }
      if img.width != tg.w || img.height != tg.h { problem("\(p)/\(l)/\(String(format: "%02d", idx + 1)).png is \(img.width) x \(img.height), expected \(tg.w) x \(tg.h)") }
      if !tg.alpha, ![CGImageAlphaInfo.none, .noneSkipLast, .noneSkipFirst].contains(img.alphaInfo) { problem("\(p)/\(l)/\(String(format: "%02d", idx + 1)).png has an alpha channel") }
    }
  }
}
if !problems.isEmpty {
  FileHandle.standardError.write((problems.map { "FAIL " + $0 }.joined(separator: "\n") + "\n").data(using: .utf8)!)
  exit(1)
}
if checkOnly { print("ok: \(frames.count) frames x \(langs.count) languages x \(platforms.count) platforms"); exit(0) }

// MARK: render
func roundedPath(_ r: CGRect, _ rad: CGFloat) -> CGPath { CGPath(roundedRect: r, cornerWidth: rad, cornerHeight: rad, transform: nil) }

func render(frame idx: Int, lang: String, platform: String) {
  let tg = targets[platform]!, W = CGFloat(tg.w), H = CGFloat(tg.h)
  let s = styles[idx]!, img = langCaptures["\(idx)|\(lang)"] ?? captures[idx]!
  let fr = frames[idx]
  let c = canvas(tg.w, tg.h, alpha: tg.alpha)
  // Background
  if s.bgType == "solid" || s.bg.count < 2 {
    c.setFillColor(rgb(s.bg[0])); c.fill(CGRect(x: 0, y: 0, width: W, height: H))
  } else {
    let g = CGGradient(colorsSpace: space, colors: [rgb(s.bg[0]), rgb(s.bg[1])] as CFArray, locations: [0, 1])!
    c.drawLinearGradient(g, start: CGPoint(x: 0, y: H), end: CGPoint(x: W, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
  }
  let geo = geometry(W, H, s)
  // Caption, vertically centred in its box.
  let text = ((fr["captions"] as? [String: String]) ?? [:])[lang] ?? ""
  let fit = fitCaption(text, font: s.font, color: s.text, box: geo.caption.size, startSize: W * 0.075, minSize: W * 0.034)
  let cy = geo.caption.midY - fit.height / 2
  c.saveGState()
  c.translateBy(x: geo.caption.minX, y: cy)
  CTFrameDraw(fit.frame, c)
  c.restoreGState()
  // Capture
  let iw = CGFloat(img.width), ih = CGFloat(img.height)
  var area = geo.area
  var src = CGRect(x: 0, y: 0, width: iw, height: ih)   // region of the capture, top-left origin
  var dest: CGRect
  switch s.layout {
  case "zoom":
    src = CGRect(x: s.zoom[0] * iw, y: s.zoom[1] * ih, width: s.zoom[2] * iw, height: s.zoom[3] * ih)
    let sc = min(area.width / src.width, area.height / src.height)
    dest = CGRect(x: area.midX - src.width * sc / 2, y: area.midY - src.height * sc / 2, width: src.width * sc, height: src.height * sc)
  case "full-bleed":
    // Cover the area (full width), keep the top of the capture, crop the bottom; no rounded corners, no device frame.
    let sc = max(area.width / iw, area.height / ih) * s.scale
    let vh = area.height / sc
    let vw = min(iw, area.width / sc), left = (iw - vw) / 2
    // cropTop (default 7.5 %) hides the simulator status bar, which would float mid-frame under the top caption
    let top = s.cropTop * ih
    src = CGRect(x: left, y: top, width: vw, height: min(ih - top, vh))
    dest = CGRect(x: area.minX, y: area.maxY - src.height * sc, width: vw * sc, height: src.height * sc)
    area = dest
  default:
    let sc = min(area.width / iw, area.height / ih)
    dest = CGRect(x: area.midX - iw * sc / 2, y: area.midY - ih * sc / 2, width: iw * sc, height: ih * sc)
  }
  let radius = s.layout == "full-bleed" ? 0 : dest.width * 0.075
  if s.layout != "full-bleed" && s.device {
    let bez = dest.width * 0.022
    let outer = dest.insetBy(dx: -bez, dy: -bez)
    // keep the bezel inside the area: shrink the capture instead of the bezel
    let k = min(1, min(geo.area.width / outer.width, geo.area.height / outer.height))
    if k < 1 { dest = CGRect(x: geo.area.midX - dest.width * k / 2, y: geo.area.midY - dest.height * k / 2, width: dest.width * k, height: dest.height * k) }
    let b = dest.width * 0.022
    let o = dest.insetBy(dx: -b, dy: -b)
    c.saveGState()
    c.setShadow(offset: CGSize(width: 0, height: -W * 0.012), blur: W * 0.04, color: rgb(0x000000, 0.4))
    c.addPath(roundedPath(o, radius + b)); c.setFillColor(rgb(s.deviceColor)); c.fillPath()
    c.restoreGState()
  } else if s.layout != "full-bleed" {
    c.saveGState()
    c.setShadow(offset: CGSize(width: 0, height: -W * 0.012), blur: W * 0.04, color: rgb(0x000000, 0.35))
    c.addPath(roundedPath(dest, radius)); c.setFillColor(rgb(0x000000)); c.fillPath()
    c.restoreGState()
  }
  c.saveGState()
  c.addPath(roundedPath(dest, radius)); c.clip()
  c.interpolationQuality = .high
  // CGImage cropping uses top-left origin; draw the cropped part into dest.
  if let part = img.cropping(to: src) { c.draw(part, in: dest) }
  c.restoreGState()
  let url = outDir.appendingPathComponent("\(platform)/\(lang)/\(String(format: "%02d", idx + 1)).png")
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let d = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(d, c.makeImage()!, nil)
  guard CGImageDestinationFinalize(d) else { fail("could not write \(url.path)") }
}

var count = 0
for p in platforms { for l in langs { for idx in frames.indices { render(frame: idx, lang: l, platform: p); count += 1 } } }
print("wrote \(count) PNGs under \(outDir.path)")
