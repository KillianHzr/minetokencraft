// Vent dans l'herbe et les feuillages : un petit décalage des sommets, plus fort en haut qu'au pied,
// qui varie d'une plante à l'autre selon sa position.

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.3 },
};

/**
 * Fait onduler un matériau. `sway` : amplitude en blocs par grand vent ; `anchor` : hauteur du pied (y local).
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
  // Programme distinct des matériaux immobiles qui partagent les mêmes réglages.
  material.customProgramCacheKey = () => `wind:${sway}:${anchor}`;
  return material;
}
