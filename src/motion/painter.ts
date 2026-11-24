import * as THREE from 'three'
import { lensPoint, lensScaleGLSL, type LensField } from './heroGeometry'
import { clamp } from './timeline'
import type { Run } from './text'

const quadVertex = `
  uniform vec4 uLens;
  uniform vec2 uLensOrigin;
  varying vec2 vUv;
  varying vec2 vScreen;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.);
    if (uLens.z > 0.) {
      vec2 p = (world.xy - uLensOrigin) / max(uLens.xy, vec2(1.));
      world.xy = uLensOrigin + (world.xy - uLensOrigin) * (${lensScaleGLSL});
    }
    vScreen = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`

const glyphFragment = `
  uniform sampler2D uMap;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform vec2 uMark;
  uniform vec2 uClip;
  uniform float uOpacity;
  uniform float uReveal;
  varying vec2 vUv;
  varying vec2 vScreen;
  void main() {
    vec4 ink = texture2D(uMap, vUv);
    float selectInk = step(uMark.x, vUv.x)*(1.-step(uMark.y, vUv.x));
    float ch = max(ink.r,max(ink.g,ink.b))-min(ink.r,min(ink.g,ink.b));
    vec3 color = mix(ink.rgb * mix(uInk, uAccent, selectInk), ink.rgb, smoothstep(.06,.24,ch));
    float alpha = uOpacity * ink.a;
    alpha *= smoothstep(uClip.x, uClip.x+10., vScreen.y) * (1.-smoothstep(uClip.y-10.,uClip.y,vScreen.y));
    if (uReveal < 1.) {
      if (uReveal >= 0.) alpha *= 1.-step(uReveal, vUv.x);
      else alpha *= step(-uReveal, vUv.x);
    }
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }`

const cardFragment = `
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform vec4 uCard;
  uniform vec2 uSize;
  uniform vec2 uClip;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec2 vScreen;
  void main() {
    float radius = min(uCard.x, .5*min(uSize.x,uSize.y));
    vec2 p = abs(vUv-.5)*uSize - (.5*uSize-radius-1.2);
    float sdf = length(max(p,0.)) + min(max(p.x,p.y),0.) - radius;
    float aa = clamp(fwidth(sdf),.55,1.4);
    float shape = 1.-smoothstep(-aa,aa,sdf);
    float edge = (1.-smoothstep(-uCard.y-aa,-uCard.y+aa,sdf)) * shape;
    edge = shape-edge;
    vec3 color = mix(uInk,uAccent,clamp((vUv.y*.62 + (1.-vUv.x)*.20)*uCard.w + edge*.42,0.,1.));
    float alpha = uOpacity * max(shape*uCard.z, edge);
    alpha *= smoothstep(uClip.x,uClip.x+10.,vScreen.y) * (1.-smoothstep(uClip.y-10.,uClip.y,vScreen.y));
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }`

const strokeVertex = `
  varying vec2 vScreen;
  varying float vAcross;
  void main() {
    vAcross = uv.x;
    vec4 world = modelMatrix * vec4(position,1.);
    vScreen = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`
const strokeFragment = `
  uniform vec3 uInk;
  uniform float uOpacity;
  uniform vec2 uClip;
  varying vec2 vScreen;
  varying float vAcross;
  void main() {
    float alpha = (1.-smoothstep(.42,1.,abs(vAcross)))*uOpacity;
    alpha *= smoothstep(uClip.x,uClip.x+10.,vScreen.y)*(1.-smoothstep(uClip.y-10.,uClip.y,vScreen.y));
    gl_FragColor = vec4(uInk, alpha);
    #include <colorspace_fragment>
  }`

type Uniforms = Record<string, THREE.IUniform>
type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>

export interface Paint {
  opacity?: number
  z?: number
  scale?: number
  angle?: number
  clip?: readonly [number, number]
}
export interface GlyphPaint extends Paint {
  accent?: THREE.ColorRepresentation
  mark?: readonly [number, number]
  reveal?: number
  lens?: LensField
}
export interface CardPaint extends GlyphPaint {
  radius?: number
  border?: number
  fill?: number
  sheen?: number
}
export type Point = readonly [number, number]

export interface NormalizedBox {
  nx: number
  ny: number
  nw: number
  nh: number
  cx: number
  cy: number
  pxWidth: number
  pxHeight: number
}

export interface InspectedGlyph extends NormalizedBox {
  text?: string
  renderOrder: number
  opacity: number
  inkColor: string
  accentColor: string
  mark: readonly [number, number]
  reveal: number
  warped: boolean
  inkBox: NormalizedBox
}

export interface InspectedCard extends NormalizedBox {
  renderOrder: number
  opacity: number
  fillColor: string
  accentColor: string
  radius: number
  fill: number
  border: number
  warped: boolean
}

export interface PainterInspection {
  rootPosition: readonly [number, number, number]
  rootRotation: readonly [number, number, number]
  glyphs: InspectedGlyph[]
  cards: InspectedCard[]
  strokeCount: number
}

function material(vertexShader: string, fragmentShader: string, uniforms: Uniforms) {
  return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })
}

function makeUniforms(): Uniforms {
  return {
    uInk: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() },
    uClip: { value: new THREE.Vector2() }, uOpacity: { value: 1 },
    uLens: { value: new THREE.Vector4() }, uLensOrigin: { value: new THREE.Vector2() },
  }
}

/** Pooled GPU primitives. Paint order is explicit; depth still affects perspective. */
export class Painter {
  readonly root = new THREE.Group()
  private quad = new THREE.PlaneGeometry(1, 1)
  private mesh = new THREE.PlaneGeometry(1, 1, 24, 8)
  private glyphs: Mesh[] = []
  private glyphRuns: Run[] = []
  private cards: Mesh[] = []
  private strokes: Mesh[] = []
  private g = 0
  private c = 0
  private s = 0
  private order = 0

  constructor() { this.root.name = 'Lyric motion content' }

  begin() { this.g = this.c = this.s = this.order = 0 }

  finish() {
    for (let i = this.g; i < this.glyphs.length && this.glyphs[i].visible; i++) {
      const mesh = this.glyphs[i]
      mesh.visible = false
      mesh.material.uniforms.uMap.value = null
    }
    this.glyphRuns.length = this.g
    for (let i = this.c; i < this.cards.length && this.cards[i].visible; i++) this.cards[i].visible = false
    for (let i = this.s; i < this.strokes.length && this.strokes[i].visible; i++) this.strokes[i].visible = false
  }

  private attach(mesh: Mesh) {
    mesh.frustumCulled = false
    this.root.add(mesh)
    return mesh
  }

  private set(mesh: Mesh, x: number, y: number, w: number, h: number, color: THREE.ColorRepresentation, p: GlyphPaint) {
    const u = mesh.material.uniforms, scale = p.scale ?? 1
    mesh.visible = true
    mesh.renderOrder = 100 + this.order++
    mesh.position.set(x, y, p.z ?? 0)
    mesh.scale.set(w * scale, h * scale, 1)
    mesh.rotation.z = p.angle ?? 0
    u.uInk.value.set(color)
    if (u.uAccent) u.uAccent.value.set(p.accent ?? color)
    u.uClip.value.set(p.clip?.[0] ?? -100000., p.clip?.[1] ?? 100000.)
    u.uOpacity.value = clamp(p.opacity ?? 1)
    u.uLens?.value.set(p.lens?.[0] ?? 1, p.lens?.[1] ?? 1, p.lens?.[2] ?? 0, 0)
    u.uLensOrigin?.value.set(p.lens?.[3] ?? 0, p.lens?.[4] ?? 0)
  }

  glyph(run: Run, x: number, y: number, color: THREE.ColorRepresentation, p: GlyphPaint = {}) {
    if ((p.opacity ?? 1) <= .002) return
    const i = this.g++
    const mesh = this.glyphs[i] ?? (this.glyphs[i] = this.attach(new THREE.Mesh(this.quad,
      material(quadVertex, glyphFragment, { ...makeUniforms(), uMap: { value: null }, uMark: { value: new THREE.Vector2() }, uReveal: { value: 1 } }))))
    mesh.geometry = p.lens?.[2] ? this.mesh : this.quad
    this.set(mesh, x, y, run.width, run.height, color, p)
    this.glyphRuns[i] = run
    const u = mesh.material.uniforms
    u.uMap.value = run.texture
    u.uMark.value.set(p.mark?.[0] ?? 2, p.mark?.[1] ?? 2)
    u.uReveal.value = p.reveal ?? 1
  }

  card(x: number, y: number, w: number, h: number, color: THREE.ColorRepresentation, p: CardPaint = {}) {
    if ((p.opacity ?? 1) <= .002 || w < 1 || h < 1) return
    const i = this.c++
    const mesh = this.cards[i] ?? (this.cards[i] = this.attach(new THREE.Mesh(this.quad,
      material(quadVertex, cardFragment, { ...makeUniforms(), uSize: { value: new THREE.Vector2() }, uCard: { value: new THREE.Vector4() } }))))
    mesh.geometry = p.lens?.[2] ? this.mesh : this.quad
    this.set(mesh, x, y, w + 3, h + 3, color, p)
    const u = mesh.material.uniforms
    u.uSize.value.set(w + 3, h + 3)
    u.uCard.value.set(p.radius ?? 12, Math.max(.05, p.border ?? 0), p.fill ?? 1, p.sheen ?? 0)
  }

  /** Width in scene pixels. Partial paths are capped by arc length, not segment count. */
  path(points: readonly Point[], color: THREE.ColorRepresentation, width: number, p: Paint = {}, fraction = 1) {
    if (points.length < 2 || fraction <= 0 || (p.opacity ?? 1) <= .002) return
    const i = this.s++
    let mesh = this.strokes[i]
    if (!mesh) {
      mesh = this.strokes[i] = this.attach(new THREE.Mesh(new THREE.BufferGeometry(),
        material(strokeVertex, strokeFragment, makeUniforms())))
      mesh.material.side = THREE.DoubleSide
    }
    this.set(mesh, 0, 0, 1, 1, color, p)
    const count = (points.length - 1) * 6
    let position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    let uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
    if (!position || !uv || position.count < count) {
      if (position) mesh.geometry.dispose()
      mesh.geometry = new THREE.BufferGeometry()
      const capacity = Math.max(48, 2 ** Math.ceil(Math.log2(count)))
      position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage)
      uv = new THREE.BufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage)
      mesh.geometry.setAttribute('position', position)
      mesh.geometry.setAttribute('uv', uv)
    }
    let remaining = Infinity
    if (fraction < 1) {
      remaining = 0
      for (let j = 1; j < points.length; j++) remaining += Math.hypot(points[j][0] - points[j - 1][0], points[j][1] - points[j - 1][1])
      remaining *= fraction
    }
    let k = 0
    const v = (x: number, y: number, across: number) => {
      position.setXYZ(k, x, y, 0)
      uv.setXY(k++, across, 0)
    }
    for (let j = 1; j < points.length && remaining > 0; j++) {
      const [a, b] = points[j - 1], [c, d] = points[j]
      const dx = c - a, dy = d - b, distance = Math.hypot(dx, dy)
      if (distance < .001) continue
      const portion = Math.min(1, remaining / distance)
      const x = a + dx * portion, y = b + dy * portion
      const nx = -dy / distance * (width + 1) * .5, ny = dx / distance * (width + 1) * .5
      v(a + nx, b + ny, 1); v(a - nx, b - ny, -1); v(x + nx, y + ny, 1)
      v(x + nx, y + ny, 1); v(a - nx, b - ny, -1); v(x - nx, y - ny, -1)
      remaining -= distance
    }
    mesh.geometry.setDrawRange(0, k)
    position.needsUpdate = uv.needsUpdate = true
  }

  /** Project active meshes into normalized [0..1] viewport coordinates for fixture tests. */
  inspect(camera: THREE.Camera, width: number, height: number): PainterInspection {
    this.root.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    const pt = new THREE.Vector3()
    const projectRect = (mesh: Mesh, minU: number, maxU: number, minV: number, maxV: number): NormalizedBox => {
      const u = mesh.material.uniforms
      const lensVec = u.uLens?.value as THREE.Vector4 | undefined
      const lensOrigin = u.uLensOrigin?.value as THREE.Vector2 | undefined
      const warped = !!lensVec && lensVec.z > 0
      const field: LensField | undefined = warped && lensOrigin
        ? [lensVec.x, lensVec.y, lensVec.z, lensOrigin.x, lensOrigin.y]
        : undefined
      const stepsX = warped ? 6 : 1
      const stepsY = warped ? 3 : 1
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (let ix = 0; ix <= stepsX; ix++) {
        const lx = minU + (maxU - minU) * (ix / stepsX)
        for (let iy = 0; iy <= stepsY; iy++) {
          const ly = minV + (maxV - minV) * (iy / stepsY)
          pt.set(lx, ly, 0).applyMatrix4(mesh.matrixWorld)
          if (field) {
            const [wx, wy] = lensPoint(field, pt.x, pt.y)
            pt.x = wx
            pt.y = wy
          }
          pt.project(camera)
          const nx = (pt.x + 1) * .5
          const ny = (1 - pt.y) * .5
          if (nx < minX) minX = nx
          if (nx > maxX) maxX = nx
          if (ny < minY) minY = ny
          if (ny > maxY) maxY = ny
        }
      }
      const nw = Math.max(0, maxX - minX), nh = Math.max(0, maxY - minY)
      return {
        nx: minX, ny: minY, nw, nh,
        cx: minX + nw * .5, cy: minY + nh * .5,
        pxWidth: nw * width, pxHeight: nh * height,
      }
    }

    const glyphs: InspectedGlyph[] = []
    for (let i = 0; i < this.g; i++) {
      const mesh = this.glyphs[i]
      if (!mesh?.visible) continue
      const u = mesh.material.uniforms
      const run = this.glyphRuns[i]
      const quadBox = projectRect(mesh, -.5, .5, -.5, .5)
      let inkBox = quadBox
      if (run && run.width > 0 && run.height > 0) {
        const minU = (run.ink.x - run.ink.width * .5) / run.width
        const maxU = (run.ink.x + run.ink.width * .5) / run.width
        const minV = (run.ink.y - run.ink.height * .5) / run.height
        const maxV = (run.ink.y + run.ink.height * .5) / run.height
        inkBox = projectRect(mesh, clamp(minU, -.5, .5), clamp(maxU, -.5, .5), clamp(minV, -.5, .5), clamp(maxV, -.5, .5))
      }
      glyphs.push({
        ...quadBox,
        text: run?.text,
        renderOrder: mesh.renderOrder,
        opacity: u.uOpacity.value as number,
        inkColor: '#' + (u.uInk.value as THREE.Color).getHexString(),
        accentColor: '#' + (u.uAccent.value as THREE.Color).getHexString(),
        mark: [u.uMark.value.x as number, u.uMark.value.y as number],
        reveal: u.uReveal.value as number,
        warped: (u.uLens.value as THREE.Vector4).z > 0,
        inkBox,
      })
    }

    const cards: InspectedCard[] = []
    for (let i = 0; i < this.c; i++) {
      const mesh = this.cards[i]
      if (!mesh?.visible) continue
      const u = mesh.material.uniforms
      const cardVec = u.uCard.value as THREE.Vector4
      cards.push({
        ...projectRect(mesh, -.5, .5, -.5, .5),
        renderOrder: mesh.renderOrder,
        opacity: u.uOpacity.value as number,
        fillColor: '#' + (u.uInk.value as THREE.Color).getHexString(),
        accentColor: '#' + (u.uAccent.value as THREE.Color).getHexString(),
        radius: cardVec.x,
        border: cardVec.y,
        fill: cardVec.z,
        warped: (u.uLens.value as THREE.Vector4).z > 0,
      })
    }

    return {
      rootPosition: [this.root.position.x, this.root.position.y, this.root.position.z],
      rootRotation: [this.root.rotation.x, this.root.rotation.y, this.root.rotation.z],
      glyphs,
      cards,
      strokeCount: this.s,
    }
  }

  dispose() {
    for (const m of [...this.glyphs, ...this.cards, ...this.strokes]) m.material.dispose()
    for (const m of this.strokes) m.geometry.dispose()
    this.quad.dispose()
    this.mesh.dispose()
    this.root.clear()
    this.glyphs.length = this.glyphRuns.length = this.cards.length = this.strokes.length = 0
  }
}
