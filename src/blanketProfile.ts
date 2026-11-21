/** Local coordinates before the shared bed deformation, at the patient's scale. */
export const BLANKET = { width: 1.4, length: 1.47, startZ: -.4 } as const
export function blanketHeight(x: number, z: number) {
  const along = Math.max(0, Math.min(1, (z - BLANKET.startZ) / BLANKET.length))
  const distance = Math.abs(x)
  const body = Math.max(0, 1 - (distance / .38) ** 2) * .16
  const drape = Math.max(0, (distance - .51) / .19) * .28
  const folds = (Math.sin(along * 29 + distance * 8) * .016 + Math.sin(along * 53 - distance * 13) * .007) * (.3 + Math.min(drape, 1))
  const hem = Math.exp(-(((along - .94) / .035) ** 2)) * .045
  return .33 + Math.sin(Math.PI * along) * .08 + .08 * Math.exp(-along / .15) + .07 * Math.exp(-(1 - along) / .15) + body - drape + folds + hem
}
