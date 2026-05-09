"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.extractPDFToMarkdown = extractPDFToMarkdown;exports.isPDF = isPDF;






var _unpdf = await jitiImport("unpdf");
var _promises = await jitiImport("node:fs/promises");
var _nodePath = await jitiImport("node:path");
var _nodeOs = await jitiImport("node:os"); /**
 * PDF Content Extractor
 * 
 * Extracts text from PDF files and saves to markdown.
 * Uses unpdf (pdfjs-dist wrapper) for text extraction.
 */









const DEFAULT_MAX_PAGES = 100;
const DEFAULT_OUTPUT_DIR = (0, _nodePath.join)((0, _nodeOs.homedir)(), "Downloads");

/**
 * Extract text from a PDF buffer and save to markdown file
 */
async function extractPDFToMarkdown(
buffer,
url,
options = {})
{
  const {
    maxPages = DEFAULT_MAX_PAGES,
    outputDir = DEFAULT_OUTPUT_DIR,
    filename
  } = options;

  const safeMaxPages = Number.isFinite(maxPages) ?
  Math.max(1, Math.floor(maxPages)) :
  DEFAULT_MAX_PAGES;

  const pdf = await (0, _unpdf.getDocumentProxy)(new Uint8Array(buffer));
  const metadata = await pdf.getMetadata();
  const metadataInfo = metadata.info && typeof metadata.info === "object" ?
  metadata.info :
  null;

  // Extract title from metadata or URL
  const metaTitle = typeof metadataInfo?.Title === "string" ? metadataInfo.Title : undefined;
  const metaAuthor = typeof metadataInfo?.Author === "string" ? metadataInfo.Author : undefined;
  const urlTitle = extractTitleFromURL(url);
  const title = metaTitle?.trim() || urlTitle;

  // Determine pages to extract
  const pagesToExtract = Math.min(pdf.numPages, safeMaxPages);
  const truncated = pdf.numPages > safeMaxPages;

  // Extract text page by page for better structure
  const pages = [];
  for (let i = 1; i <= pagesToExtract; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.
    map((item) => {
      const textItem = item;
      return textItem.str || "";
    }).
    join(" ").
    replace(/\s+/g, " ").
    trim();

    if (pageText) {
      pages.push({ pageNum: i, text: pageText });
    }
  }

  // Build markdown content
  const lines = [];

  // Header with metadata
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`> Source: ${url}`);
  lines.push(`> Pages: ${pdf.numPages}${truncated ? ` (extracted first ${pagesToExtract})` : ""}`);
  if (metaAuthor) {
    lines.push(`> Author: ${metaAuthor}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Content with page markers
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) {
      lines.push("");
      lines.push(`<!-- Page ${pages[i].pageNum} -->`);
      lines.push("");
    }
    lines.push(pages[i].text);
  }

  if (truncated) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`*[Truncated: Only first ${pagesToExtract} of ${pdf.numPages} pages extracted]*`);
  }

  const content = lines.join("\n");

  // Generate output filename
  const outputFilename = filename || sanitizeFilename(title) + ".md";
  const outputPath = (0, _nodePath.join)(outputDir, outputFilename);

  // Ensure output directory exists
  await (0, _promises.mkdir)(outputDir, { recursive: true });

  // Write file
  await (0, _promises.writeFile)(outputPath, content, "utf-8");

  return {
    title,
    pages: pdf.numPages,
    chars: content.length,
    outputPath
  };
}

/**
 * Extract a reasonable title from URL
 */
function extractTitleFromURL(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Get filename without extension
    let filename = (0, _nodePath.basename)(pathname, ".pdf");

    // Handle arxiv URLs: /pdf/1706.03762 → "arxiv-1706.03762"
    if (urlObj.hostname.includes("arxiv.org")) {
      const match = pathname.match(/\/(?:pdf|abs)\/(\d+\.\d+)/);
      if (match) {
        filename = `arxiv-${match[1]}`;
      }
    }

    // Clean up filename
    filename = filename.
    replace(/[_-]+/g, " ").
    replace(/\s+/g, " ").
    trim();

    return filename || "document";
  } catch {
    return "document";
  }
}

/**
 * Sanitize string for use as filename
 */
function sanitizeFilename(name) {
  return name.
  toLowerCase().
  replace(/[^a-z0-9\s-]/g, "").
  replace(/\s+/g, "-").
  replace(/-+/g, "-").
  slice(0, 100).
  replace(/^-|-$/g, "") ||
  "document";
}

/**
 * Check if URL or content-type indicates a PDF
 */
function isPDF(url, contentType) {
  if (contentType?.includes("application/pdf")) {
    return true;
  }
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
} /* v9-0fe2a52e2f39cf7d */
