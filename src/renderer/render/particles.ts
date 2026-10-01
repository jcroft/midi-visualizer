// Stress mode: 200k particles swirling behind the river. Positions are a pure
// function of (instance index, time) in the vertex shader, so the CPU does
// nothing per particle and nothing is uploaded per frame.
import { InstancedBufferGeometry, Mesh, MeshBasicNodeMaterial, PlaneGeometry, type Scene } from 'three/webgpu';
import { clamp, cos, float, hash, instanceIndex, length, mix, positionGeometry, sin, sqrt, uniform, varying, vec3, vec4 } from 'three/tsl';
import { NOTE_RGB } from './color';
import { type Layout, premultipliedBlend } from './layout';
import { PARTICLE_COUNT, PARTICLE_GAIN, PARTICLE_SIZE_MAX, PARTICLE_SIZE_MIN, PARTICLE_SPEED } from './tuning';

export class Particles {
  readonly mesh: Mesh;
  readonly uTime = uniform(0);

  constructor(scene: Scene, L: Layout) {
    const plane = new PlaneGeometry(2, 2);
    const geo = new InstancedBufferGeometry();
    geo.setIndex(plane.getIndex());
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.instanceCount = PARTICLE_COUNT;

    const h1 = hash(instanceIndex);
    const h2 = hash(instanceIndex.add(PARTICLE_COUNT));
    const h3 = hash(instanceIndex.add(PARTICLE_COUNT * 2));
    const r = mix(float(0.06), float(1.0), sqrt(h1));
    // Differential rotation: inner particles orbit faster.
    const speed = float(PARTICLE_SPEED).mul(float(0.3).add(float(0.7).div(r.add(0.3)))).mul(mix(float(0.8), float(1.2), h3));
    const ang = h2.mul(Math.PI * 2).add(this.uTime.mul(speed));
    const wobble = sin(this.uTime.mul(0.9).add(h3.mul(97))).mul(0.03);
    const rr = r.add(wobble);
    const cx = L.uNowX.mul(0.5);
    const cy = L.uH.mul(0.5);
    const rx = L.uNowX.mul(0.62);
    const ry = L.uH.mul(0.52);
    const size = mix(float(PARTICLE_SIZE_MIN), float(PARTICLE_SIZE_MAX), h3).mul(L.uScale);
    const mat = new MeshBasicNodeMaterial();
    mat.positionNode = vec3(
      cx.add(cos(ang).mul(rr).mul(rx)).add(positionGeometry.x.mul(size)),
      cy.add(sin(ang).mul(rr).mul(ry)).add(positionGeometry.y.mul(size)),
      0,
    );
    // Two hues from the palette (fifths-adjacent), chosen per particle.
    const a = vec3(NOTE_RGB[0], NOTE_RGB[1], NOTE_RGB[2]);
    const b = vec3(NOTE_RGB[21], NOTE_RGB[22], NOTE_RGB[23]);
    const col = varying(mix(a, b, h2).mul(float(0.5).add(h3)));
    const d = length(positionGeometry.xy);
    const cov = clamp(float(1).sub(d), 0, 1);
    mat.fragmentNode = vec4(col.mul(cov).mul(PARTICLE_GAIN), 0);
    premultipliedBlend(mat);

    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
}
