// Plain Intervals icon (redesign R1, DESIGN_IDENTITIES sheet): a ring of eight segments with small gaps, seven at 45 %
// opacity, one solid and thicker (the current round) on a signal red field. Same output files as make-icon.swift plus
// the iOS dark and tinted variants (app.config.ts ios.icon = { light, dark, tinted }).
// Usage: swift scripts/make-icon-ring.swift [--out <app folder>]
// Sketch from the sheet (viewBox 64): circle r 18, stroke 7, dash 11.6 / 2.5, solid arc from 12 o'clock to 45 degrees, stroke 9.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
var outPath = FileManager.default.currentDirectoryPath
if let i = args.firstIndex(of: "--out"), i + 1 < args.count { outPath = args[i + 1] }
let root = URL(fileURLWithPath: outPath)
let images = root.appendingPathComponent("assets/images")
let bundle = root.appendingPathComponent("assets/expo.icon/Assets")
try FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)
let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ h: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [CGFloat((h >> 16) & 255) / 255, CGFloat((h >> 8) & 255) / 255, CGFloat(h & 255) / 255, a])!
}
func canvas(_ size: Int, opaque: Bool) -> CGContext {
  let info = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info)!
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: 1, y: -1)  // top-left origin, y down: increasing angle runs clockwise on screen
  return ctx
}
func save(_ ctx: CGContext, _ name: String, in dir: URL) {
  let url = dir.appendingPathComponent(name)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
  guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(url.path)") }
  print("wrote \(url.path.replacingOccurrences(of: root.path + "/", with: ""))")
}
func resized(_ ctx: CGContext, to size: Int) -> CGContext {
  let out = canvas(size, opaque: false)
  out.interpolationQuality = .high
  out.translateBy(x: 0, y: CGFloat(size))
  out.scaleBy(x: 1, y: -1)
  out.draw(ctx.makeImage()!, in: CGRect(x: 0, y: 0, width: size, height: size))
  return out
}

/// Arc as a polyline (1 degree steps), degrees clockwise from 3 o'clock, butt ends.
func arc(_ ctx: CGContext, c: CGFloat, r: CGFloat, from: Double, to: Double) {
  var pts: [CGPoint] = []
  var a = from
  while a < to { pts.append(CGPoint(x: c + r * CGFloat(cos(a * .pi / 180)), y: c + r * CGFloat(sin(a * .pi / 180)))); a += 1 }
  pts.append(CGPoint(x: c + r * CGFloat(cos(to * .pi / 180)), y: c + r * CGFloat(sin(to * .pi / 180))))
  ctx.addLines(between: pts)
  ctx.strokePath()
}

/// The ring in a 1024 canvas: `scale` = share of the sheet's size (1 = the sketch's own proportions, ring 43 of 64).
/// `base` = colour of the seven quiet segments (with `baseAlpha`), `solid` = the current round.
func ring(_ ctx: CGContext, scale: CGFloat, base: UInt32, baseAlpha: CGFloat, solid: UInt32) {
  let u = 1024.0 / 64.0 * scale
  let c: CGFloat = 512
  ctx.setLineCap(.butt)
  ctx.setStrokeColor(rgb(base, baseAlpha))
  ctx.setLineWidth(7 * u)
  let turn = 2 * Double.pi * 18
  for k in 0..<8 { arc(ctx, c: c, r: 18 * u, from: Double(k) * 360 / 8, to: Double(k) * 360 / 8 + 11.6 / turn * 360) }
  ctx.setStrokeColor(rgb(solid))
  ctx.setLineWidth(9 * u)
  arc(ctx, c: c, r: 18 * u, from: -90, to: -45)
}

let red: UInt32 = 0xD42A1E
// iOS store icon, light: opaque, full bleed.
do {
  let ctx = canvas(1024, opaque: true)
  ctx.setFillColor(rgb(red)); ctx.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  ring(ctx, scale: 1.12, base: 0xFFFFFF, baseAlpha: 0.45, solid: 0xFFFFFF)
  save(ctx, "icon.png", in: images)
  save(resized(ctx, to: 48), "favicon.png", in: images)
}
// iOS dark: the sheet's dark background with the dark accent ring.
do {
  let ctx = canvas(1024, opaque: true)
  ctx.setFillColor(rgb(0x201B1E)); ctx.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  ring(ctx, scale: 1.12, base: 0xFF6A5C, baseAlpha: 0.45, solid: 0xFF6A5C)
  save(ctx, "icon-dark.png", in: images)
}
// iOS tinted: greyscale on black, the system applies the user's tint.
do {
  let ctx = canvas(1024, opaque: true)
  ctx.setFillColor(rgb(0x000000)); ctx.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  ring(ctx, scale: 1.12, base: 0xFFFFFF, baseAlpha: 0.45, solid: 0xFFFFFF)
  save(ctx, "icon-tinted.png", in: images)
}
// Android adaptive layers: 66 % safe zone, ring diameter about 0.55 of the canvas.
do {
  let fg = canvas(1024, opaque: false)
  ring(fg, scale: 0.84, base: 0xFFFFFF, baseAlpha: 0.45, solid: 0xFFFFFF)
  save(fg, "android-icon-foreground.png", in: images)
  let bg = canvas(1024, opaque: true)
  bg.setFillColor(rgb(red)); bg.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  save(bg, "android-icon-background.png", in: images)
  let mono = canvas(1024, opaque: false)
  ring(mono, scale: 0.84, base: 0xFFFFFF, baseAlpha: 0.45, solid: 0xFFFFFF)
  save(mono, "android-icon-monochrome.png", in: images)
}
// Splash: the ring alone in the accent red (the splash colour is the app's background, light or dark).
do {
  let ctx = canvas(1024, opaque: false)
  ring(ctx, scale: 1.3, base: red, baseAlpha: 0.45, solid: red)
  save(ctx, "splash-icon.png", in: images)
}
// Icon Composer bundle (kept as the fallback to ios.icon = .icon): white ring layer over the red fill.
do {
  let ctx = canvas(1024, opaque: false)
  ring(ctx, scale: 1.12, base: 0xFFFFFF, baseAlpha: 0.45, solid: 0xFFFFFF)
  save(ctx, "glyph.png", in: bundle)
}
