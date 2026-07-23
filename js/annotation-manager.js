/**
 * Antigravity PDF Studio - Clean & Optimized Annotation Engine
 * Supports Freehand Ink, Highlighter, Vector Shapes (Lines, Arrows, Callouts), Text,
 * Pins, Layer Toggles, and Full Undo/Redo Stack.
 */

export class AnnotationManager {
  constructor(commentsContainerElement) {
    this.commentsContainer = commentsContainerElement;
    
    this.currentTool = 'select';
    this.currentColor = '#6366f1';
    this.currentStrokeWidth = 3;
    this.currentFontSize = 14;

    this.layerVisibility = {
      strokes: true,
      shapes: true,
      text: true,
      pins: true
    };

    this.annotations = {}; // { [pageNum]: { strokes: [], shapes: [], textAnnots: [], comments: [] } }
    this.historyStack = [];
    this.redoStack = [];

    this.isDrawing = false;
    this.startPt = null;
    this.currentPt = null;
    this.currentPath = [];

    this.onCommentAdded = null;
    this.onCommentJump = null;
  }

  setTool(toolName) {
    this.currentTool = toolName;
    this.updateCanvasInteractivity();
  }

  setColor(colorHex) {
    this.currentColor = colorHex;
  }

  setStrokeWidth(width) {
    this.currentStrokeWidth = width;
  }

  toggleLayer(layerName) {
    if (this.layerVisibility[layerName] !== undefined) {
      this.layerVisibility[layerName] = !this.layerVisibility[layerName];
      this.refreshAllPageLayers();
      return this.layerVisibility[layerName];
    }
    return true;
  }

  refreshAllPageLayers() {
    const pageCards = document.querySelectorAll('.pdf-page-card');
    pageCards.forEach(card => {
      const pageNum = parseInt(card.dataset.pageNum, 10);
      const canvas = card.querySelector('.annotation-layer-canvas');
      if (canvas) {
        this.redrawPageCanvas(pageNum, canvas);
      }
      this.renderCommentPinsForPage(pageNum, card);
    });
  }

  updateCanvasInteractivity() {
    const activeTools = ['pen', 'highlighter', 'line', 'arrow', 'text', 'callout', 'eraser', 'comment'];
    const annotCanvases = document.querySelectorAll('.annotation-layer-canvas');
    annotCanvases.forEach(canvas => {
      if (activeTools.includes(this.currentTool)) {
        canvas.classList.add('active-draw');
      } else {
        canvas.classList.remove('active-draw');
      }
    });
  }

  attachToPageCards() {
    const pageCards = document.querySelectorAll('.pdf-page-card');
    pageCards.forEach(card => {
      const pageNum = parseInt(card.dataset.pageNum, 10);
      const canvas = card.querySelector('.annotation-layer-canvas');
      if (!canvas) return;

      this.ensurePageObject(pageNum);

      this.redrawPageCanvas(pageNum, canvas);
      this.renderCommentPinsForPage(pageNum, card);

      canvas.onpointerdown = (e) => this.handlePointerDown(e, pageNum, canvas, card);
      canvas.onpointermove = (e) => this.handlePointerMove(e, pageNum, canvas);
      canvas.onpointerup = (e) => this.handlePointerUp(e, pageNum, canvas);
      canvas.onpointerleave = (e) => this.handlePointerUp(e, pageNum, canvas);
    });

    this.updateCanvasInteractivity();
  }

  ensurePageObject(pageNum) {
    if (!this.annotations[pageNum]) {
      this.annotations[pageNum] = { strokes: [], shapes: [], textAnnots: [], comments: [] };
    }
  }

  handlePointerDown(e, pageNum, canvas, card) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (this.currentTool === 'comment') {
      const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
      this.addComment(pageNum, xPercent, yPercent, card);
      return;
    }

    if (this.currentTool === 'text') {
      this.addTextAnnotation(pageNum, x, y, canvas, scaleX);
      return;
    }

    if (!['pen', 'highlighter', 'line', 'arrow', 'callout', 'eraser'].includes(this.currentTool)) return;

    this.isDrawing = true;
    this.startPt = { x, y };
    this.currentPt = { x, y };
    this.currentPath = [{ x, y }];

    if (this.currentTool === 'eraser') {
      this.eraseAtPoint(pageNum, x, y, canvas);
    }
  }

  handlePointerMove(e, pageNum, canvas) {
    if (!this.isDrawing) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    this.currentPt = { x, y };

    if (this.currentTool === 'eraser') {
      this.eraseAtPoint(pageNum, x, y, canvas);
      return;
    }

    if (['pen', 'highlighter'].includes(this.currentTool)) {
      this.currentPath.push({ x, y });
    }

    this.redrawPageCanvas(pageNum, canvas);
    this.drawActiveShapePreview(canvas, scaleX);
  }

  handlePointerUp(e, pageNum, canvas) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    this.ensurePageObject(pageNum);

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;

    if (['pen', 'highlighter'].includes(this.currentTool) && this.currentPath.length > 1) {
      const strokeObj = {
        tool: this.currentTool,
        color: this.currentColor,
        width: this.currentStrokeWidth * scaleX * (this.currentTool === 'highlighter' ? 4 : 1),
        path: [...this.currentPath]
      };
      this.annotations[pageNum].strokes.push(strokeObj);
      this.pushHistory('add_stroke', pageNum, strokeObj);
    } else if (['line', 'arrow'].includes(this.currentTool) && this.startPt && this.currentPt) {
      if (Math.hypot(this.currentPt.x - this.startPt.x, this.currentPt.y - this.startPt.y) > 5) {
        const shapeObj = {
          tool: this.currentTool,
          x1: this.startPt.x,
          y1: this.startPt.y,
          x2: this.currentPt.x,
          y2: this.currentPt.y,
          color: this.currentColor,
          width: this.currentStrokeWidth * scaleX
        };
        this.annotations[pageNum].shapes.push(shapeObj);
        this.pushHistory('add_shape', pageNum, shapeObj);
      }
    } else if (this.currentTool === 'callout' && this.startPt && this.currentPt) {
      if (Math.hypot(this.currentPt.x - this.startPt.x, this.currentPt.y - this.startPt.y) > 5) {
        const textStr = prompt('引出線テキストを入力してください (Callout Text):');
        if (textStr && textStr.trim() !== '') {
          const calloutObj = {
            tool: 'callout',
            targetX: this.startPt.x,
            targetY: this.startPt.y,
            boxX: this.currentPt.x,
            boxY: this.currentPt.y,
            text: textStr.trim(),
            color: this.currentColor,
            fontSize: 13
          };
          this.annotations[pageNum].shapes.push(calloutObj);
          this.pushHistory('add_shape', pageNum, calloutObj);
        }
      }
    }

    this.startPt = null;
    this.currentPt = null;
    this.currentPath = [];
    this.redrawPageCanvas(pageNum, canvas);
  }

  addTextAnnotation(pageNum, x, y, canvas) {
    const textStr = prompt('テキストを入力してください (Enter Text):');
    if (!textStr || textStr.trim() === '') return;

    this.ensurePageObject(pageNum);

    const textObj = {
      tool: 'text',
      x,
      y,
      text: textStr.trim(),
      color: this.currentColor,
      fontSize: 14
    };

    this.annotations[pageNum].textAnnots.push(textObj);
    this.pushHistory('add_text', pageNum, textObj);
    this.redrawPageCanvas(pageNum, canvas);
  }

  pushHistory(actionType, pageNum, item) {
    this.historyStack.push({ actionType, pageNum, item });
    this.redoStack = [];
  }

  undo() {
    if (this.historyStack.length === 0) return false;
    const lastAction = this.historyStack.pop();
    this.redoStack.push(lastAction);

    const { actionType, pageNum, item } = lastAction;
    const pageObj = this.annotations[pageNum];
    if (!pageObj) return true;

    if (actionType === 'add_stroke') {
      pageObj.strokes = pageObj.strokes.filter(s => s !== item);
    } else if (actionType === 'add_shape') {
      pageObj.shapes = pageObj.shapes.filter(s => s !== item);
    } else if (actionType === 'add_text') {
      pageObj.textAnnots = pageObj.textAnnots.filter(t => t !== item);
    }

    this.refreshAllPageLayers();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const action = this.redoStack.pop();
    this.historyStack.push(action);

    const { actionType, pageNum, item } = action;
    this.ensurePageObject(pageNum);
    const pageObj = this.annotations[pageNum];

    if (actionType === 'add_stroke') {
      pageObj.strokes.push(item);
    } else if (actionType === 'add_shape') {
      pageObj.shapes.push(item);
    } else if (actionType === 'add_text') {
      pageObj.textAnnots.push(item);
    }

    this.refreshAllPageLayers();
    return true;
  }

  drawActiveShapePreview(canvas) {
    if (!this.startPt || !this.currentPt) return;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.strokeStyle = this.currentColor;
    ctx.fillStyle = this.currentColor;
    ctx.lineWidth = this.currentStrokeWidth;

    if (this.currentTool === 'line') {
      ctx.beginPath();
      ctx.moveTo(this.startPt.x, this.startPt.y);
      ctx.lineTo(this.currentPt.x, this.currentPt.y);
      ctx.stroke();
    } else if (this.currentTool === 'arrow') {
      this.drawArrowOnCanvas(ctx, this.startPt.x, this.startPt.y, this.currentPt.x, this.currentPt.y, this.currentStrokeWidth, this.currentColor);
    } else if (this.currentTool === 'callout') {
      this.drawArrowOnCanvas(ctx, this.currentPt.x, this.currentPt.y, this.startPt.x, this.startPt.y, 2, this.currentColor);
      
      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.strokeStyle = this.currentColor;
      ctx.lineWidth = 1;
      ctx.fillRect(this.currentPt.x, this.currentPt.y - 20, 100, 24);
      ctx.strokeRect(this.currentPt.x, this.currentPt.y - 20, 100, 24);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.fillText('引出線テキスト', this.currentPt.x + 6, this.currentPt.y - 4);
    }

    ctx.restore();
  }

  redrawPageCanvas(pageNum, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageData = this.annotations[pageNum];
    if (!pageData) return;

    // 1. Redraw Freehand & Highlighter Strokes
    if (this.layerVisibility.strokes) {
      (pageData.strokes || []).forEach(stroke => {
        if (stroke.path.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(stroke.path[0].x, stroke.path[0].y);
        for (let i = 1; i < stroke.path.length; i++) {
          ctx.lineTo(stroke.path[i].x, stroke.path[i].y);
        }

        if (stroke.tool === 'highlighter') {
          ctx.strokeStyle = this.hexToRgba(stroke.color, 0.4);
          ctx.lineWidth = stroke.width;
          ctx.lineCap = 'square';
        } else {
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.width;
          ctx.lineCap = 'round';
        }
        ctx.stroke();
      });
    }

    // 2. Redraw Vector Shapes (Lines, Arrows, Callouts)
    if (this.layerVisibility.shapes) {
      (pageData.shapes || []).forEach(shape => {
        ctx.save();
        if (shape.tool === 'line') {
          ctx.beginPath();
          ctx.moveTo(shape.x1, shape.y1);
          ctx.lineTo(shape.x2, shape.y2);
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = shape.width;
          ctx.stroke();
        } else if (shape.tool === 'arrow') {
          this.drawArrowOnCanvas(ctx, shape.x1, shape.y1, shape.x2, shape.y2, shape.width, shape.color);
        } else if (shape.tool === 'callout') {
          this.drawArrowOnCanvas(ctx, shape.boxX, shape.boxY, shape.targetX, shape.targetY, 2, shape.color);

          ctx.font = `${shape.fontSize || 13}px sans-serif`;
          const metrics = ctx.measureText(shape.text);
          const boxWidth = metrics.width + 16;
          const boxHeight = (shape.fontSize || 13) + 12;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = 1.5;
          ctx.fillRect(shape.boxX, shape.boxY - boxHeight + 4, boxWidth, boxHeight);
          ctx.strokeRect(shape.boxX, shape.boxY - boxHeight + 4, boxWidth, boxHeight);

          ctx.fillStyle = '#ffffff';
          ctx.fillText(shape.text, shape.boxX + 8, shape.boxY - 4);
        }
        ctx.restore();
      });
    }

    // 3. Redraw Text Annotations
    if (this.layerVisibility.text) {
      (pageData.textAnnots || []).forEach(t => {
        ctx.save();
        ctx.fillStyle = t.color;
        ctx.font = `${t.fontSize || 14}px sans-serif`;
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
      });
    }
  }

  drawArrowOnCanvas(ctx, fromX, fromY, toX, toY, width, color) {
    const headlen = Math.max(10, width * 3);
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(toX, toY);
    ctx.fillStyle = color;
    ctx.fill();
  }

  eraseAtPoint(pageNum, x, y, canvas) {
    const pageData = this.annotations[pageNum];
    if (!pageData) return;

    const threshold = 18;

    pageData.strokes = (pageData.strokes || []).filter(stroke => {
      return !stroke.path.some(pt => Math.hypot(pt.x - x, pt.y - y) < threshold);
    });

    pageData.shapes = (pageData.shapes || []).filter(shape => {
      if (shape.tool === 'line' || shape.tool === 'arrow') {
        return Math.hypot(shape.x1 - x, shape.y1 - y) > threshold && Math.hypot(shape.x2 - x, shape.y2 - y) > threshold;
      } else if (shape.tool === 'callout') {
        return Math.hypot(shape.targetX - x, shape.targetY - y) > threshold && Math.hypot(shape.boxX - x, shape.boxY - y) > threshold;
      }
      return true;
    });

    pageData.textAnnots = (pageData.textAnnots || []).filter(t => {
      return Math.hypot(t.x - x, t.y - y) > threshold;
    });

    this.redrawPageCanvas(pageNum, canvas);
  }

  addComment(pageNum, xPercent, yPercent, cardElement) {
    const commentText = prompt('コメントを入力してください (Add Comment):');
    if (!commentText || commentText.trim() === '') return;

    const commentObj = {
      id: Date.now().toString(),
      pageNum,
      xPercent,
      yPercent,
      author: 'ユーザー (Google User)',
      text: commentText.trim(),
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    };

    this.ensurePageObject(pageNum);
    this.annotations[pageNum].comments.push(commentObj);
    this.renderCommentPinsForPage(pageNum, cardElement);
    this.renderSidebarComments();

    if (this.onCommentAdded) {
      this.onCommentAdded(commentObj);
    }
  }

  renderCommentPinsForPage(pageNum, cardElement) {
    const existingPins = cardElement.querySelectorAll('.comment-pin');
    existingPins.forEach(p => p.remove());

    if (!this.layerVisibility.pins) return;

    const comments = this.annotations[pageNum]?.comments || [];
    comments.forEach((c, idx) => {
      const pin = document.createElement('div');
      pin.className = 'comment-pin';
      pin.dataset.commentId = c.id;
      pin.style.left = `${c.xPercent}%`;
      pin.style.top = `${c.yPercent}%`;
      pin.innerHTML = `<span>${idx + 1}</span>`;
      pin.title = `${c.author}: ${c.text}`;
      
      pin.onclick = (e) => {
        e.stopPropagation();
        alert(`【P.${c.pageNum} 注釈 #${idx + 1}】\n${c.author} (${c.timestamp}):\n${c.text}`);
      };

      cardElement.appendChild(pin);
    });
  }

  renderSidebarComments() {
    this.commentsContainer.innerHTML = '';
    
    let totalCount = 0;
    Object.keys(this.annotations).forEach(pageNumStr => {
      const pageNum = parseInt(pageNumStr, 10);
      const pageComments = this.annotations[pageNum]?.comments || [];
      
      pageComments.forEach((c, idx) => {
        totalCount++;
        const card = document.createElement('div');
        card.className = 'comment-card';
        card.title = 'クリックして該当する注釈ピンへジャンプ';
        card.innerHTML = `
          <div class="comment-card-header">
            <span class="comment-author">📍 P.${c.pageNum} ピン #${idx + 1}</span>
            <span>${c.timestamp}</span>
          </div>
          <div class="comment-text">${c.text}</div>
          <div class="comment-card-footer">
            <span>${c.author}</span>
            <button class="comment-delete-btn" data-id="${c.id}" data-page="${pageNum}">削除</button>
          </div>
        `;

        card.onclick = (e) => {
          if (e.target.classList.contains('comment-delete-btn')) return;
          if (this.onCommentJump) {
            this.onCommentJump(c.pageNum, c.id);
          }
        };

        card.querySelector('.comment-delete-btn').onclick = (e) => {
          e.stopPropagation();
          this.deleteComment(c.id, pageNum);
        };

        this.commentsContainer.appendChild(card);
      });
    });

    if (totalCount === 0) {
      this.commentsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <p style="font-size: 0.8rem;">注釈コメントはまだありません。<br>「ピン」ツールでPDF上の任意の場所をタップして追加できます。</p>
        </div>
      `;
    }
  }

  pulsePinMarker(commentId) {
    const pin = document.querySelector(`.comment-pin[data-comment-id="${commentId}"]`);
    if (pin) {
      pin.classList.add('pulse-highlight');
      setTimeout(() => {
        pin.classList.remove('pulse-highlight');
      }, 3000);
    }
  }

  deleteComment(commentId, pageNum) {
    if (!this.annotations[pageNum]) return;
    this.annotations[pageNum].comments = this.annotations[pageNum].comments.filter(c => c.id !== commentId);
    
    const pageCard = document.querySelector(`.pdf-page-card[data-page-num="${pageNum}"]`);
    if (pageCard) {
      this.renderCommentPinsForPage(pageNum, pageCard);
    }
    this.renderSidebarComments();
  }

  hexToRgba(hex, alpha = 1.0) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }
}
