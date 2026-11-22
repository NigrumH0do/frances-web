// Shaders de la ráfaga. Cadenas puras: este módulo no importa three.
// El sello es un disco con smoothstep; no hay discard (early-Z en Mali).

export const burstVertexShader = `
attribute float aAlpha;
attribute float aKind;
varying float vAlpha;
varying float vKind;
varying vec2 vUv;

void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vKind = aKind;
  vec3 transformed = position;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

export const burstFragmentShader = `
uniform vec3 uPaper;
uniform vec3 uGold3d;
uniform vec3 uInk;
varying float vAlpha;
varying float vKind;
varying vec2 vUv;

void main() {
  float disk = smoothstep(0.5, 0.42, length(vUv - 0.5));
  float mask = mix(1.0, disk, step(0.5, vKind));
  vec3 col = mix(mix(uPaper, uInk, 0.08), uGold3d, step(0.5, vKind));
  gl_FragColor = vec4(col, vAlpha * mask);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
