import { memo, useEffect, useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'
import { CatmullRomCurve3, ExtrudeGeometry, Shape, TubeGeometry, Vector3 } from 'three'

const cream = '#e7dfd3'
export const CONCENTRATOR_BASE_OFFSET = .458
function HousingPart({ size, at, color = cream, radius = .012 }: { size: [number, number, number]; at: [number, number, number]; color?: string; radius?: number }) {
  return <RoundedBox args={size} position={at} radius={Math.min(radius, ...size.map(v => v * .45))} smoothness={3} bevelSegments={2}>
    <meshStandardMaterial color={color} roughness={.65}/>
  </RoundedBox>
}

/** Code-native, unbranded wheeled concentrator based on the supplied reference. */
function OxygenConcentrator({ running }: { running: boolean }) {
  const geometries = useMemo(() => {
    const profile = new Shape()
    profile.moveTo(-.21, .12); profile.lineTo(.21, .12); profile.lineTo(.21, .84)
    profile.lineTo(.13, .90); profile.lineTo(-.21, .66); profile.closePath()
    const body = new ExtrudeGeometry(profile, { depth: .54, bevelEnabled: true, bevelThickness: .022, bevelSize: .022, bevelSegments: 3, steps: 1, curveSegments: 4 })
    body.rotateY(Math.PI / 2); body.translate(-.27, 0, 0)
    const tube = (points: number[][], radius: number) => new TubeGeometry(new CatmullRomCurve3(points.map(p => new Vector3(...p))), 24, radius, 8, false)
    const handle = tube([[-.22, .94, -.12], [-.16, 1.02, -.12], [0, 1.04, -.12], [.16, 1.02, -.12], [.22, .94, -.12]], .027)
    const hose = tube([[-.20, .75, .13], [-.25, .77, .23], [-.24, .76, .34], [-.19, .735, .29]], .006)
    const cable = tube([[-.23, .18, -.22], [-.29, .08, -.28], [-.26, .025, -.35], [-.12, .018, -.34], [-.09, .018, -.26]], .005)
    return { body, handle, hose, cable }
  }, [])
  useEffect(() => () => Object.values(geometries).forEach(g => g.dispose()), [geometries])

  // Preserve the interaction origin; caster contact matches the tiled floor.
  return <group name="oxygen-concentrator" position={[0, -CONCENTRATOR_BASE_OFFSET, 0]}>
    <group scale={.85}>
      <mesh geometry={geometries.body} name="concentrator-housing"><meshStandardMaterial color={cream} roughness={.62}/></mesh>
      <HousingPart size={[.61, .065, .48]} at={[0, .105, 0]} color="#80666a" radius={.018}/>
      <HousingPart size={[.60, .035, .47]} at={[0, .15, 0]} radius={.012}/>
      {[-.25, .25].flatMap(x => [-.17, .17].map(z => <group key={`${x}-${z}`} name="concentrator-caster" position={[x, 0, z]}>
        <mesh position={[0, .045, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.045, .045, .035, 16]}/><meshStandardMaterial color="#4f5658" roughness={.8}/></mesh>
        <HousingPart size={[.04, .065, .035]} at={[0, .10, 0]} color="#88918e" radius={.006}/>
      </group>))}
      {[-.22, .22].map(x => <HousingPart key={x} size={[.05, .11, .06]} at={[x, .915, -.12]} radius={.015}/>)}
      <mesh geometry={geometries.handle} name="concentrator-handle"><meshStandardMaterial color={cream} roughness={.55}/></mesh>

      <HousingPart size={[.012, .25, .27]} at={[-.294, .66, -.01]} color="#d4cabe" radius={.005}/>
      {[-1, 1].map(side => <group key={side} position={[side * .295, .34, -.01]} name="concentrator-air-filter">
        <HousingPart size={[.015, .31, .18]} at={[0, 0, 0]} color="#434c4c" radius={.005}/>
        {Array.from({ length: 10 }, (_, i) => <HousingPart key={i} size={[.019, .008, .17]} at={[0, -.13 + i * .029, 0]} color="#727c79" radius={.002}/>)}
      </group>)}

      <group name="concentrator-controls" position={[.065, .7743, .1016]} rotation={[-.955, 0, 0]}>
        <HousingPart size={[.30, .28, .022]} at={[0, 0, 0]} color="#626b6c" radius={.014}/>
        <HousingPart size={[.135, .052, .012]} at={[.023, .074, .018]} color="#283d45" radius={.004}/>
        {[0, 1, 2].map(i => <HousingPart key={i} size={[.025, .009, .003]} at={[-.017 + i * .033, .075, .026]} color={running ? '#9fdfcc' : '#607779'} radius={.001}/>)}
        <mesh name="concentrator-flowmeter" position={[-.10, -.005, .029]}><cylinderGeometry args={[.014, .014, .18, 12]}/><meshStandardMaterial color="#d9f0ed" transparent opacity={.48} depthWrite={false}/></mesh>
        {[-.103, .103].map(y => <mesh key={y} position={[-.10, y, .03]}><cylinderGeometry args={[.02, .02, .025, 12]}/><meshStandardMaterial color="#b3bbb8" metalness={.3} roughness={.5}/></mesh>)}
        {Array.from({ length: 7 }, (_, i) => <HousingPart key={i} size={[.025, .003, .003]} at={[-.065, -.074 + i * .024, .028]} color="#e2e7df" radius={.0005}/>)}
        <mesh name="concentrator-flow-indicator" position={[-.10, running ? .03 : -.075, .029]}><sphereGeometry args={[.009, 10, 8]}/><meshStandardMaterial color="#355a60"/></mesh>
        <HousingPart size={[.095, .065, .008]} at={[.04, -.005, .019]} color="#879b98" radius={.004}/>
        <group position={[.075, -.085, .027]} rotation={[running ? -.12 : .12, 0, 0]}><HousingPart size={[.045, .04, .018]} at={[0, 0, 0]} color="#323f43" radius={.005}/></group>
        <mesh name="concentrator-power-indicator" position={[.024, -.085, .026]}><circleGeometry args={[.008, 12]}/><meshBasicMaterial color={running ? '#55cc94' : '#a4a66e'}/></mesh>
      </group>

      <mesh position={[-.20, .756, .135]} rotation={[Math.PI / 2 - .955, 0, 0]}><cylinderGeometry args={[.013, .013, .05, 12]}/><meshStandardMaterial color="#aab5b2" metalness={.5} roughness={.4}/></mesh>
      <group name="concentrator-humidifier" position={[-.19, .62, .29]}>
        <mesh><cylinderGeometry args={[.052, .044, .18, 20]}/><meshStandardMaterial color="#e3efed" transparent opacity={.35} depthWrite={false} roughness={.15}/></mesh>
        <mesh position={[0, -.04, 0]}><cylinderGeometry args={[.042, .038, .08, 16]}/><meshStandardMaterial color="#a4d2d1" transparent opacity={.28} depthWrite={false}/></mesh>
        <mesh position={[0, .105, 0]}><cylinderGeometry args={[.059, .058, .035, 16]}/><meshStandardMaterial color="#858f91" roughness={.55}/></mesh>
        <mesh position={[0, -.015, -.012]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.058, .004, 6, 20]}/><meshStandardMaterial color="#a3aca8" metalness={.4}/></mesh>
      </group>
      <mesh geometry={geometries.hose} name="concentrator-oxygen-tube"><meshStandardMaterial color="#bedfdb" transparent opacity={.65} roughness={.35}/></mesh>
      <mesh geometry={geometries.cable}><meshStandardMaterial color="#58625f" roughness={.8}/></mesh>
    </group>
  </group>
}

export default memo(OxygenConcentrator)
