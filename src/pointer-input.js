// A contact is owned by both device type and id. IDs may be reused for the
// next Pencil contact; an older event must not finish that new stroke.
export function matchesPointer(contact, event) {
  if (!contact || event.pointerId !== contact.pointerId) return false;
  if (event.pointerType && contact.pointerType && event.pointerType !== contact.pointerType) return false;
  return !(event.timeStamp > 0 && contact.pointerStartedAt > 0 && event.timeStamp < contact.pointerStartedAt);
}

export function penInContact(event) {
  return event.pointerType === 'pen' && ((event.buttons & 1) !== 0 || event.buttons === 0 && event.pressure > 0);
}

export function capturePointer(element, id) {
  try { element.setPointerCapture(id); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
}

export function releasePointer(element, id) {
  try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
}

export function ignoreCaptureLoss(element, event) {
  // Implicit capture can move from an SVG child to its parent. The child's
  // bubbling notification does not mean the parent lost its own capture.
  return event.type === 'lostpointercapture' && (event.target !== element || element.hasPointerCapture(event.pointerId));
}
