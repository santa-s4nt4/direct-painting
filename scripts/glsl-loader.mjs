import { readFile } from 'node:fs/promises';
// Let offline shader checks import the same raw GLSL assets that Vite supplies.
export async function load(url, context, next) {
 if(url.endsWith('.glsl?raw'))return {format:'module',shortCircuit:true,source:`export default ${JSON.stringify(await readFile(new URL(url.split('?')[0]),'utf8'))}`};
 return next(url,context);
}
