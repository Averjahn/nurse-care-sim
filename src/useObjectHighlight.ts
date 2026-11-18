import { useEffect, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Object3D } from 'three'
import { bindInteractionHighlight } from './interactionHighlight'

export function useObjectHighlight(ref: RefObject<Object3D | null>, active: boolean, hovered: boolean, growth: number, color: string) {
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const cached = useRef<{ child: Object3D; binding: ReturnType<typeof bindInteractionHighlight>; color: string } | null>(null)
  const elapsed = useRef(0)
  useEffect(() => () => cached.current?.binding.dispose(), [])
  useFrame((_, delta) => {
    const root = ref.current
    if (!root) return
    const child = root.children[0]
    if (child && cached.current?.child !== child) {
      cached.current?.binding.dispose()
      cached.current = { child, binding: bindInteractionHighlight(child), color: '' }
    }
    const current = cached.current
    if (!current) return
    if (current.color !== color) { current.binding.tint.value.set(color); current.color = color }
    if (!active && !hovered) {
      elapsed.current = 0; current.binding.strength.value = 0
      if (root.scale.x !== 1) root.scale.setScalar(1)
      return
    }
    elapsed.current += delta
    const pulse = reducedMotion ? 0.5 : (1 - Math.cos(elapsed.current * Math.PI * 2 / 1.6)) / 2
    root.scale.setScalar(active && !reducedMotion ? 1 + growth * pulse : 1)
    current.binding.strength.value = active ? 0.3 + 0.65 * pulse : 0.25
  })
}
