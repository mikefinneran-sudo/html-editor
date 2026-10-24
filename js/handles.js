// Selection handles: 8 resize handles, a move grip, and 4 padding handles,
// drawn in the overlay above the canvas iframe. Pointer Events only (with
// pointer capture), so mouse, touch and Apple Pencil share one code path.
// Every edit lands on the selected element in the canvas DOM and is
// committed with ES.snapshot, so undo and the splice-save path apply.
window.Handles = (function() {
  const ES = window.EditorState;
  const RESIZE = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const PAD = ['pad-top', 'pad-right', 'pad-bottom', 'pad-left'];
  const PAD_INSET = 26;   // keep padding handles clear of the edge handles
  const PAD_MIN_SIZE = 80; // too small for padding handles on that axis
  const TITLES = {
    move: 'Drag to reorder among siblings',
    'pad-top': 'Drag to change top padding',
    'pad-right': 'Drag to change right padding',
    'pad-bottom': 'Drag to change bottom padding',
    'pad-left': 'Drag to change left padding',
  };
  let layer, iframe;
  const handles = {};
  let drag = null;

  function init() {
    layer = document.getElementById('sel-handles');
    iframe = document.getElementById('canvas');
    for (const name of [...RESIZE, ...PAD, 'move']) {
      const h = document.createElement('div');
      h.className = 'sel-handle ' + (RESIZE.includes(name) ? 'resize' : name === 'move' ? 'move' : 'pad');
      h.dataset.handle = name;
      h.title = TITLES[name] || 'Drag to resize';
      if (name === 'move') h.innerHTML = '<i data-lucide="grip-vertical"></i>';
      h.addEventListener('pointerdown', onDown);
      h.addEventListener('pointermove', onMove);
      h.addEventListener('pointerup', onUp);
      h.addEventListener('pointercancel', onCancel);
      h.addEventListener('lostpointercapture', onCancel);
      layer.appendChild(h);
      handles[name] = h;
    }
  }

  // Called from Canvas.updateOverlay with the selection's rect in
  // canvas-frame coordinates.
  function update(el, rect) {
    if (!layer) return;
    const doc = el.ownerDocument;
    if (!doc || !doc.defaultView) return;
    const isRoot = el === doc.body || el === doc.documentElement;
    const cs = doc.defaultView.getComputedStyle(el);
    const L = rect.left, T = rect.top, W = rect.width, H = rect.height;
    const R = L + W, B = T + H, cx = L + W / 2, cy = T + H / 2;
    const inset = (p, size) => Math.min(Math.max(parseFloat(p) || 0, PAD_INSET), size / 2);
    const pos = {
      nw: [L, T], n: [cx, T], ne: [R, T], e: [R, cy],
      se: [R, B], s: [cx, B], sw: [L, B], w: [L, cy],
      move: [L, T + H / 4],
      'pad-top': [cx, T + inset(cs.paddingTop, H)],
      'pad-bottom': [cx, B - inset(cs.paddingBottom, H)],
      'pad-left': [L + inset(cs.paddingLeft, W), cy],
      'pad-right': [R - inset(cs.paddingRight, W), cy],
    };
    for (const name in handles) {
      const h = handles[name];
      let show = true;
      if (RESIZE.includes(name) || name === 'move') show = !isRoot && !!el.parentElement;
      else if (name === 'pad-left' || name === 'pad-right') show = W >= PAD_MIN_SIZE;
      else show = H >= PAD_MIN_SIZE;
      if (drag && drag.h === h) show = true; // never hide a handle mid-drag
      h.hidden = !show;
      h.style.left = pos[name][0] + 'px';
      h.style.top = pos[name][1] + 'px';
    }
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = ES.state.selected;
    if (!el || drag) return;
    e.preventDefault();
    e.stopPropagation();
    const h = e.currentTarget;
    h.setPointerCapture(e.pointerId);
    const name = h.dataset.handle;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    const px = (p) => parseFloat(cs[p]) || 0;
    drag = { h, name, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, style0: el.getAttribute('style'), target: null };
    if (RESIZE.includes(name)) {
      // Inline width/height mean the content box unless border-box.
      const r = el.getBoundingClientRect();
      const content = cs.boxSizing !== 'border-box';
      drag.w0 = r.width - (content ? px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth') : 0);
      drag.h0 = r.height - (content ? px('paddingTop') + px('paddingBottom') + px('borderTopWidth') + px('borderBottomWidth') : 0);
    } else if (name !== 'move') {
      drag.side = name.slice(4);
      drag.p0 = px('padding' + drag.side[0].toUpperCase() + drag.side.slice(1));
    }
    h.classList.add('active');
    layer.classList.add('dragging');
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    const { el, name } = drag;
    if (name === 'move') {
      drag.target = moveTarget(e);
      if (drag.target) window.Canvas.showDropIndicator(drag.target.sib, drag.target.after ? 'after' : 'before', drag.target.axis);
      else window.Canvas.hideDropIndicator();
    } else if (drag.side) {
      const delta = { top: dy, bottom: -dy, left: dx, right: -dx }[drag.side];
      el.style.setProperty('padding-' + drag.side, Math.max(0, Math.round(drag.p0 + delta)) + 'px');
    } else {
      if (name.includes('e')) el.style.width = Math.max(1, Math.round(drag.w0 + dx)) + 'px';
      if (name.includes('w')) el.style.width = Math.max(1, Math.round(drag.w0 - dx)) + 'px';
      if (name.includes('s')) el.style.height = Math.max(1, Math.round(drag.h0 + dy)) + 'px';
      if (name.includes('n')) el.style.height = Math.max(1, Math.round(drag.h0 - dy)) + 'px';
    }
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    if (d.name === 'move') {
      const t = moveTarget(e);
      if (t && moveAmongSiblings(d.el, t.sib, t.after)) ES.snapshot('move');
    } else if (d.el.getAttribute('style') !== d.style0) {
      ES.snapshot(d.side ? 'padding' : 'resize');
    }
    end();
  }

  // Interrupted gesture (palm rejection, OS gesture, capture lost): put the
  // element back the way it was.
  function onCancel(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.name !== 'move') {
      if (drag.style0 === null) drag.el.removeAttribute('style');
      else drag.el.setAttribute('style', drag.style0);
    }
    end();
  }

  function end() {
    const h = drag.h;
    drag = null;
    h.classList.remove('active');
    layer.classList.remove('dragging');
    window.Canvas.hideDropIndicator();
    window.Canvas.updateOverlay();
  }

  // The sibling of the dragged element under the pointer, and which side
  // of it to drop on (along the axis the parent lays its children out).
  function moveTarget(e) {
    const el = drag.el, parent = el.parentElement;
    if (!parent) return null;
    const fr = iframe.getBoundingClientRect();
    const x = e.clientX - fr.left, y = e.clientY - fr.top;
    let hit = el.ownerDocument.elementFromPoint(x, y);
    while (hit && hit.parentElement !== parent) hit = hit.parentElement;
    if (!hit || hit === el) return null;
    const { axis, reverse } = flowAxis(parent, hit);
    const r = hit.getBoundingClientRect();
    let after = axis === 'x' ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    if (reverse) after = !after;
    return { sib: hit, after, axis };
  }

  function flowAxis(parent, sib) {
    const view = parent.ownerDocument.defaultView;
    const cs = view.getComputedStyle(parent);
    if (/flex/.test(cs.display)) {
      return { axis: cs.flexDirection.startsWith('row') ? 'x' : 'y', reverse: cs.flexDirection.endsWith('reverse') };
    }
    if (/grid/.test(cs.display)) return { axis: 'x', reverse: false };
    return { axis: /^inline/.test(view.getComputedStyle(sib).display) ? 'x' : 'y', reverse: false };
  }

  // Reorder `el` before/after `sib`, carrying the whitespace text node that
  // precedes `el` with it so the source keeps its indentation. Returns false
  // when the drop wouldn't change the order.
  function moveAmongSiblings(el, sib, after) {
    const parent = el.parentNode;
    const isWs = (n) => n && n.nodeType === 3 && !n.nodeValue.trim();
    const lead = isWs(el.previousSibling) ? el.previousSibling : null;
    if (sib === el || (after ? el.previousElementSibling : el.nextElementSibling) === sib) return false;
    const ref = after ? sib.nextSibling : (isWs(sib.previousSibling) ? sib.previousSibling : sib);
    if (lead) parent.insertBefore(lead, ref);
    parent.insertBefore(el, ref);
    return true;
  }

  return { init, update };
})();
