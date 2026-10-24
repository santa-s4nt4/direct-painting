// Shared by the editor, live transport, output page and video encoder.
export const FPS = 60;
export const FRAME_MS = 1000 / FPS;
// A fixed frame grid avoids falling to 30fps when a 60Hz callback arrives a
// fraction of a millisecond early, and caps 120Hz/144Hz displays at 60 updates.
export const frameNumber = milliseconds => Math.floor(milliseconds / FRAME_MS + 1e-7);
