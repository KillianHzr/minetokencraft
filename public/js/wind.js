// Wind in the grass and foliage: a small vertex offset, stronger at the top than at the base,
// that varies from plant to plant depending on its position.

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.3 },
};

/**
 * Makes a material sway. `sway`: amplitude in blocks in strong wind; `anchor`: height of the base (local y).
 */
export function addWind(material, { sway, anchor }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 windOrigin = vec3(instanceMatrix[3]);
        #else
          vec3 windOrigin = vec3(modelMatrix[3]);
        #endif
        float windHeight = max(position.y - (${anchor.toFixed(2)}), 0.0);
        float windPhase = uTime * (1.2 + uWind * 1.8) + windOrigin.x * 0.7 + windOrigin.z * 1.1;
        float windSway = (sin(windPhase) + 0.35 * sin(windPhase * 2.3)) * uWind * ${sway.toFixed(3)} * windHeight;
        transformed.x += windSway;
        transformed.z += windSway * 0.5;`);
  };
  // Separate program from the static materials that share the same settings.
  material.customProgramCacheKey = () => `wind:${sway}:${anchor}`;
  return material;
}
