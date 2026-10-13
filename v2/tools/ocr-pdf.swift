//
//  ocr-pdf.swift — macOS-native OCR for scanned PDFs, no external dependencies.
//
//  Scanned PDFs (and PDFs whose text is outlined/curves) carry no text layer, so
//  the Superman memory cannot recall them: the browser-side reader answers
//  `{ text: '', note: 'no-text' }` and the file enters the memory as bytes only.
//  Vision can read those pages, so this tool renders each page with PDFKit and
//  recognises Simplified Chinese + English text on the bitmap.
//
//  Usage:
//      ocr-pdf <input.pdf> [--max-pages N] [--scale S] [--progress]
//      ocr-pdf --version
//
//  Output (stdout): one `## page N` marker per page, then that page's recognised
//  lines in reading order. Pages are written as they are recognised, so a caller
//  that enforces a timeout still receives every page finished so far.
//  Diagnostics go to stderr; the exit status is non-zero when the document
//  cannot be opened or no page can be rendered.
//
//  Build:
//      swiftc -O tools/ocr-pdf.swift -o ocr-pdf \
//          -framework Vision -framework PDFKit -framework AppKit
//

import AppKit
import CoreGraphics
import Foundation
import PDFKit
import Vision

/** Version reported by `--version`, mirrored in the bundle's `index.js`. */
let toolVersion = "ocr-pdf 1.0.0"
/** Default rendering scale: 2x the PDF point size, which Vision reads well. */
let defaultScale: CGFloat = 2.0
/** Default page budget when the caller does not pass `--max-pages`. */
let defaultMaxPages = 40
/** Hard ceiling, so a runaway caller cannot pin the process forever. */
let hardMaxPages = 200
/** Largest rendered edge in pixels; bigger pages are rendered down to this. */
let maxRenderEdge: CGFloat = 4000

/** Write one diagnostic line to stderr and exit non-zero. */
func die(_ message: String) -> Never {
	let text = "ocr-pdf: \(message)\n"
	FileHandle.standardError.write(Data(text.utf8))
	exit(1)
}

/** One parsed command line. */
struct Options {
	var input: String
	var maxPages: Int
	var scale: CGFloat
	var progress: Bool
}

let usage = """
usage: ocr-pdf <input.pdf> [--max-pages N] [--scale S] [--progress]
       ocr-pdf --version | --help
"""

/** Parse the command line, or exit with a diagnostic. */
func parseArguments(_ arguments: [String]) -> Options {
	var input: String?
	var maxPages = defaultMaxPages
	var scale = defaultScale
	var progress = false
	var index = 0
	while index < arguments.count {
		let argument = arguments[index]
		switch argument {
		case "--version", "-v":
			print(toolVersion)
			exit(0)
		case "--help", "-h":
			print(usage)
			exit(0)
		case "--progress":
			progress = true
		case "--max-pages":
			index += 1
			guard index < arguments.count, let value = Int(arguments[index]), value > 0 else {
				die("--max-pages needs a positive integer")
			}
			maxPages = min(value, hardMaxPages)
		case "--scale":
			index += 1
			guard index < arguments.count, let value = Double(arguments[index]), value > 0 else {
				die("--scale needs a positive number")
			}
			scale = CGFloat(min(max(value, 0.5), 6.0))
		default:
			if argument.hasPrefix("-") { die("unknown option: \(argument)") }
			if input != nil { die("only one input file is accepted") }
			input = argument
		}
		index += 1
	}
	guard let file = input else { die("no input PDF given\n\(usage)") }
	return Options(input: file, maxPages: maxPages, scale: scale, progress: progress)
}

/**
 Render one page to a bitmap at `scale` device pixels per PDF point.
 - Parameter page: the PDF page to draw.
 - Parameter scale: device scale relative to the PDF point size.
 - Returns: the rendered image, or nil when the page has no usable geometry.
 */
func render(_ page: PDFPage, scale: CGFloat) -> CGImage? {
	let box = page.bounds(for: .mediaBox)
	guard box.width > 0, box.height > 0 else { return nil }
	let longest = max(box.width, box.height) * scale
	/* Very large pages are rendered down so one bitmap cannot exhaust memory. */
	let fitted = longest > maxRenderEdge ? scale * (maxRenderEdge / longest) : scale
	let width = Int((box.width * fitted).rounded())
	let height = Int((box.height * fitted).rounded())
	guard width > 0, height > 0 else { return nil }
	guard let context = CGContext(
		data: nil,
		width: width,
		height: height,
		bitsPerComponent: 8,
		bytesPerRow: 0,
		space: CGColorSpaceCreateDeviceRGB(),
		bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
	) else { return nil }
	/* White paper first: a transparent bitmap reads badly for some glyphs. */
	context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
	context.fill(CGRect(x: 0, y: 0, width: width, height: height))
	context.scaleBy(x: fitted, y: fitted)
	context.translateBy(x: -box.origin.x, y: -box.origin.y)
	page.draw(with: .mediaBox, to: context)
	guard let bitmap = context.makeImage() else {
		/* Some pages refuse a bitmap context; the thumbnail renderer still has them. */
		let image = page.thumbnail(of: CGSize(width: width, height: height), for: .mediaBox)
		var proposed = CGRect(origin: .zero, size: image.size)
		return image.cgImage(forProposedRect: &proposed, context: nil, hints: nil)
	}
	return bitmap
}

/**
 Recognise the text lines of one bitmap, top to bottom and left to right.
 - Parameter image: the rendered page.
 - Returns: the recognised lines, whitespace-trimmed, empty ones dropped.
 */
func recognize(_ image: CGImage) throws -> [String] {
	let request = VNRecognizeTextRequest()
	request.recognitionLevel = .accurate
	request.recognitionLanguages = ["zh-Hans", "en-US"]
	request.usesLanguageCorrection = true
	let handler = VNImageRequestHandler(cgImage: image, options: [:])
	try handler.perform([request])
	let observations = request.results ?? []
	/* Vision's order is close to reading order but not guaranteed; sort by the
	   line's vertical centre, then by its left edge. Bounding boxes are
	   normalised with the origin at the bottom-left, so larger y is higher. */
	let ordered = observations.sorted { left, right in
		let leftY = left.boundingBox.midY
		let rightY = right.boundingBox.midY
		if abs(leftY - rightY) > 0.015 { return leftY > rightY }
		return left.boundingBox.minX < right.boundingBox.minX
	}
	var lines: [String] = []
	for observation in ordered {
		guard let candidate = observation.topCandidates(1).first else { continue }
		let line = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
		if line.isEmpty { continue }
		lines.append(line)
	}
	return lines
}

let options = parseArguments(Array(CommandLine.arguments.dropFirst()))
let url = URL(fileURLWithPath: options.input)
guard FileManager.default.fileExists(atPath: url.path) else {
	die("cannot open \(options.input): no such file")
}
guard let document = PDFDocument(url: url) else {
	die("cannot open \(options.input): not a readable PDF")
}
if document.isLocked {
	die("cannot open \(options.input): the document is encrypted")
}
let pageCount = document.pageCount
if pageCount == 0 { die("cannot open \(options.input): the document has no pages") }

var rendered = 0
let limit = min(pageCount, options.maxPages)
for number in 0..<limit {
	guard let page = document.page(at: number) else { continue }
	guard let bitmap = render(page, scale: options.scale) else {
		FileHandle.standardError.write(Data("ocr-pdf: page \(number + 1) produced no bitmap\n".utf8))
		continue
	}
	let lines: [String]
	do {
		lines = try recognize(bitmap)
	} catch {
		FileHandle.standardError.write(Data("ocr-pdf: page \(number + 1) failed: \(error.localizedDescription)\n".utf8))
		continue
	}
	rendered += 1
	/* Each page goes out as soon as it is recognised: a caller that kills the
	   process on a timeout still keeps every page that had finished. */
	var pageText = "## page \(number + 1)\n"
	for line in lines { pageText += line + "\n" }
	FileHandle.standardOutput.write(Data(pageText.utf8))
	if options.progress {
		FileHandle.standardError.write(Data("ocr-pdf: page \(number + 1)/\(limit) \(lines.count) lines\n".utf8))
	}
}
if rendered == 0 { die("no page of \(options.input) could be rendered") }
exit(0)
