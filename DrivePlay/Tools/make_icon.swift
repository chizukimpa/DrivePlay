import AppKit
import Foundation

// Gera os PNGs do ícone do app em todos os tamanhos necessários.
// Uso: swift Tools/make_icon.swift <pasta-de-saída>

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write(Data("uso: make_icon.swift <pasta>\n".utf8))
    exit(1)
}

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try? FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let sizes = [16, 32, 64, 128, 256, 512, 1024]

for size in sizes {
    let side = CGFloat(size)
    let image = NSImage(size: NSSize(width: side, height: side))
    image.lockFocus()

    NSGraphicsContext.current?.imageInterpolation = .high

    // Fundo arredondado com gradiente azul → roxo.
    let inset = side * 0.055
    let rect = NSRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2)
    let background = NSBezierPath(roundedRect: rect, xRadius: side * 0.21, yRadius: side * 0.21)

    let gradient = NSGradient(colors: [
        NSColor(calibratedRed: 0.30, green: 0.52, blue: 1.00, alpha: 1),
        NSColor(calibratedRed: 0.48, green: 0.26, blue: 0.96, alpha: 1)
    ])!
    gradient.draw(in: background, angle: -60)

    // Brilho sutil no topo.
    let highlight = NSBezierPath(roundedRect: rect, xRadius: side * 0.21, yRadius: side * 0.21)
    NSColor.white.withAlphaComponent(0.10).setFill()
    highlight.fill()

    // Triângulo de play.
    let centerX = side * 0.52
    let centerY = side * 0.5
    let radius = side * 0.20

    let triangle = NSBezierPath()
    triangle.move(to: NSPoint(x: centerX - radius * 0.55, y: centerY + radius))
    triangle.line(to: NSPoint(x: centerX - radius * 0.55, y: centerY - radius))
    triangle.line(to: NSPoint(x: centerX + radius * 0.95, y: centerY))
    triangle.close()

    NSColor.white.setFill()
    triangle.fill()

    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write(Data("falha ao gerar ícone \(size)\n".utf8))
        exit(1)
    }

    let url = outputDirectory.appendingPathComponent("icon_\(size).png")
    try png.write(to: url)
}

print("ícones gerados em \(outputDirectory.path)")
