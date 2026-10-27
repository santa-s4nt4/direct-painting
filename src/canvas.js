// Painting coordinates and cached rasters cover UHD. The editor/output viewport
// stays Full HD; a view transform selects a bounded region of the painting.
export const CANVAS_WIDTH = 3840;
export const CANVAS_HEIGHT = 2160;
export const VIEWPORT_WIDTH = 1920;
export const VIEWPORT_HEIGHT = 1080;
export const MAX_BRUSH_SIZE = 3000;
export const MARKER_DIAMETER = 15;
export const CANVAS_SPEC = Object.freeze({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

export const BOX_SPEC = Object.freeze({ width: 3840, height: 3480, depth: 3480 });
