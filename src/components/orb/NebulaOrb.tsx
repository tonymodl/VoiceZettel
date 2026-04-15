
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';


/**
 * NebulaOrb – premium 3D sphere that reacts to voice semantics.
 * Uses Three.js via react-three-fiber. Colors are driven by a simple
 * semantic map (placeholder). Lip‑sync animation is a scale pulse.
 */
const SemanticColors: Record<string, string> = {
  neutral: 'hsl(210, 30%, 20%)',
  happy: 'hsl(45, 80%, 55%)',
  sad: 'hsl(220, 30%, 30%)',
  angry: 'hsl(0, 80%, 45%)',
  // extend as needed
};

interface NebulaOrbProps {
  /** Semantic label that drives the orb color */
  sentiment?: keyof typeof SemanticColors;
  /** Amplitude of the lip‑sync pulse (0‑1) */
  voiceLevel?: number;
}

export const NebulaOrb: React.FC<NebulaOrbProps> = ({ sentiment = 'neutral', voiceLevel = 0 }) => {
  const meshRef = useRef<THREE.Mesh>(null!);

  // Update color when sentiment changes
  useEffect(() => {
    if (meshRef.current) {
      const color = new THREE.Color(SemanticColors[sentiment]);
      (meshRef.current.material as THREE.MeshStandardMaterial).color = color;
    }
  }, [sentiment]);

  // Lip‑sync pulse – scale based on voiceLevel (0‑1)
  useFrame(() => {
    if (meshRef.current) {
      const base = 1;
      const pulse = 0.2 * voiceLevel; // max 20% increase
      meshRef.current.scale.setScalar(base + pulse);
    }
  });

  return (
    <Canvas camera={{ position: [0, 0, 3] }} style={{ width: '100%', height: '100%' }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial metalness={0.6} roughness={0.2} />
      </mesh>
      {/* Optional label for debugging */}
      <Html center>
        <div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: '0.8rem' }}>
          {sentiment}
        </div>
      </Html>
    </Canvas>
  );
};

