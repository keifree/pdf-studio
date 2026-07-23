/**
 * Antigravity PDF Studio - PDF Export & Metadata Embedding Module
 * Uses pdf-lib to embed Right-to-Left (右綴じ) metadata and bake freehand ink,
 * straight lines, arrows, text boxes, callout leader lines, and comments into PDF pages.
 */

export class PDFExporter {
  static async exportPDF(originalBuffer, annotations, bindingMode = 'rtl') {
    if (!window.PDFLib) {
      throw new Error('pdf-lib library is not loaded');
    }

    const { PDFDocument, PDFName, rgb } = window.PDFLib;

    const pdfDoc = await PDFDocument.load(originalBuffer);
    const catalog = pdfDoc.catalog;

    // 1. Embed ISO/Adobe Standard PDF Right-to-Left (右綴じ) Metadata
    if (bindingMode === 'rtl') {
      try {
        catalog.set(PDFName.of('PageLayout'), PDFName.of('TwoPageRight'));

        const existingViewerPrefs = catalog.get(PDFName.of('ViewerPreferences'));
        if (existingViewerPrefs && typeof existingViewerPrefs.set === 'function') {
          existingViewerPrefs.set(PDFName.of('Direction'), PDFName.of('R2L'));
        } else {
          const viewerPrefs = pdfDoc.context.obj({
            Direction: PDFName.of('R2L')
          });
          catalog.set(PDFName.of('ViewerPreferences'), viewerPrefs);
        }
      } catch (err) {
        console.warn('Could not set R2L metadata:', err);
      }
    } else {
      try {
        catalog.set(PDFName.of('PageLayout'), PDFName.of('TwoPageLeft'));
        const existingViewerPrefs = catalog.get(PDFName.of('ViewerPreferences'));
        if (existingViewerPrefs && typeof existingViewerPrefs.set === 'function') {
          existingViewerPrefs.set(PDFName.of('Direction'), PDFName.of('L2R'));
        } else {
          catalog.set(PDFName.of('ViewerPreferences'), pdfDoc.context.obj({ Direction: PDFName.of('L2R') }));
        }
      } catch (err) {}
    }

    // 2. Embed Annotations (Strokes, Lines, Arrows, Text, Callouts, Comments)
    const pages = pdfDoc.getPages();
    
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const pageNum = pageIdx + 1;
      const page = pages[pageIdx];
      const { width: pageWidth, height: pageHeight } = page.getSize();
      
      const pageAnnots = annotations[pageNum];
      if (!pageAnnots) continue;

      const canvasCard = document.querySelector(`.pdf-page-card[data-page-num="${pageNum}"]`);
      const scaleX = canvasCard ? pageWidth / canvasCard.clientWidth : 1.0;
      const scaleY = canvasCard ? pageHeight / canvasCard.clientHeight : 1.0;

      // A. Draw Freehand Ink Strokes & Highlighters
      const strokes = pageAnnots.strokes || [];
      for (const stroke of strokes) {
        if (!stroke.path || stroke.path.length < 2) continue;
        const rgbColor = this.hexToRgb(stroke.color);

        for (let i = 0; i < stroke.path.length - 1; i++) {
          const pt1 = stroke.path[i];
          const pt2 = stroke.path[i + 1];

          const x1 = pt1.x * scaleX;
          const y1 = pageHeight - (pt1.y * scaleY);
          const x2 = pt2.x * scaleX;
          const y2 = pageHeight - (pt2.y * scaleY);

          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: stroke.width * scaleX,
            color: rgb(rgbColor.r, rgbColor.g, rgbColor.b),
            opacity: stroke.tool === 'highlighter' ? 0.35 : 1.0,
          });
        }
      }

      // B. Draw Vector Shapes (Straight Lines, Arrows, Callout Boxes & Leader Lines)
      const shapes = pageAnnots.shapes || [];
      for (const shape of shapes) {
        const rgbColor = this.hexToRgb(shape.color || '#6366f1');

        if (shape.tool === 'line') {
          const x1 = shape.x1 * scaleX;
          const y1 = pageHeight - (shape.y1 * scaleY);
          const x2 = shape.x2 * scaleX;
          const y2 = pageHeight - (shape.y2 * scaleY);

          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: (shape.width || 2) * scaleX,
            color: rgb(rgbColor.r, rgbColor.g, rgbColor.b)
          });
        } else if (shape.tool === 'arrow') {
          const x1 = shape.x1 * scaleX;
          const y1 = pageHeight - (shape.y1 * scaleY);
          const x2 = shape.x2 * scaleX;
          const y2 = pageHeight - (shape.y2 * scaleY);

          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: (shape.width || 2) * scaleX,
            color: rgb(rgbColor.r, rgbColor.g, rgbColor.b)
          });
        } else if (shape.tool === 'callout') {
          const targetX = shape.targetX * scaleX;
          const targetY = pageHeight - (shape.targetY * scaleY);
          const boxX = shape.boxX * scaleX;
          const boxY = pageHeight - (shape.boxY * scaleY);

          // Leader line
          page.drawLine({
            start: { x: boxX, y: boxY },
            end: { x: targetX, y: targetY },
            thickness: 1.5 * scaleX,
            color: rgb(rgbColor.r, rgbColor.g, rgbColor.b)
          });

          // Text string
          page.drawText(`[引出: ${shape.text}]`, {
            x: Math.max(10, boxX),
            y: Math.max(10, boxY),
            size: 10 * scaleX,
            color: rgb(rgbColor.r, rgbColor.g, rgbColor.b)
          });
        }
      }

      // C. Draw Plain Text Annotations
      const textAnnots = pageAnnots.textAnnots || [];
      for (const t of textAnnots) {
        const rgbColor = this.hexToRgb(t.color || '#6366f1');
        const x = t.x * scaleX;
        const y = pageHeight - (t.y * scaleY);

        page.drawText(t.text, {
          x: Math.max(10, x),
          y: Math.max(10, y),
          size: (t.fontSize || 14) * scaleX,
          color: rgb(rgbColor.r, rgbColor.g, rgbColor.b)
        });
      }

      // D. Draw Comments as Notes
      const comments = pageAnnots.comments || [];
      for (const c of comments) {
        const x = (c.xPercent / 100) * pageWidth;
        const y = pageHeight - ((c.yPercent / 100) * pageHeight);

        page.drawText(`[注釈: ${c.author}] ${c.text}`, {
          x: Math.max(10, x),
          y: Math.max(10, y),
          size: 10,
          color: rgb(0.96, 0.62, 0.04),
        });
      }
    }

    const modifiedBytes = await pdfDoc.save();
    return modifiedBytes.buffer;
  }

  static hexToRgb(hex) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255
    };
  }
}
