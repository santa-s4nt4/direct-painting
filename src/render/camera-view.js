import { CAMERA_DISTANCE, viewRotation } from '../view.js';
// In world Y-up coordinates, this is the inverse of the shared Y-down view
// rotation. The camera's optical axis always intersects the box center.
export function positionCamera(camera,view) {
 const r=viewRotation(view),distance=view.distance??CAMERA_DISTANCE;
 camera.position.set(r[6]*distance,-r[7]*distance,r[8]*distance);
 camera.up.set(-r[3],r[4],-r[5]);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
}
