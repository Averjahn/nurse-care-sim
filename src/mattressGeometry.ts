import { BufferAttribute, BufferGeometry } from 'three'

/** Add longitudinal samples to the existing mattress mesh; preserve its outline, UVs and material. */
export function subdivideMattress(source: BufferGeometry): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = []
  const p = source.getAttribute('position'), n = source.getAttribute('normal'), uv = source.getAttribute('uv')
  const cuts = Array.from({ length: 80 }, (_, i) => -1.8 + i * .05).concat([0, .195, .81]).sort((a, b) => a - b)
  type Vertex = { p: number[]; n: number[]; uv: number[] }
  const vertex = (i: number): Vertex => ({ p: [p.getX(i), p.getY(i), p.getZ(i)], n: n ? [n.getX(i), n.getY(i), n.getZ(i)] : [0, 1, 0], uv: uv ? [uv.getX(i), uv.getY(i)] : [0, 0] })
  const blend = (a: Vertex, b: Vertex, t: number): Vertex => ({ p: a.p.map((v, i) => v + (b.p[i] - v) * t), n: a.n.map((v, i) => v + (b.n[i] - v) * t), uv: a.uv.map((v, i) => v + (b.uv[i] - v) * t) })
  const clip = (poly: Vertex[], cut: number, lower: boolean) => {
    const out: Vertex[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], insideA = lower ? a.p[2] <= cut : a.p[2] >= cut, insideB = lower ? b.p[2] <= cut : b.p[2] >= cut
      if (insideA) out.push(a)
      if (insideA !== insideB) out.push(blend(a, b, (cut - a.p[2]) / (b.p[2] - a.p[2])))
    }
    return out
  }
  const emit = (poly: Vertex[]) => { for (let i = 1; i < poly.length - 1; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) { positions.push(...v.p); normals.push(...v.n); uvs.push(...v.uv) } }
  const count = source.index?.count ?? p.count
  for (let i = 0; i < count; i += 3) {
    let rest = [0, 1, 2].map(k => vertex(source.index ? source.index.getX(i + k) : i + k))
    const min = Math.min(...rest.map(v => v.p[2])), max = Math.max(...rest.map(v => v.p[2]))
    for (const cut of cuts) if (cut > min + 1e-6 && cut < max - 1e-6) { emit(clip(rest, cut, true)); rest = clip(rest, cut, false) }
    emit(rest)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3)); geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3)); geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.computeBoundingSphere()
  return geometry
}
