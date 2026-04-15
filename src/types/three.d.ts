/* eslint-disable */

declare module '@react-three/fiber' {
  export const Canvas: any;
  export const useFrame: any;
  export * from 'react-three-fiber';
  export namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      directionalLight: any;
      mesh: any;
      sphereGeometry: any;
      meshStandardMaterial: any;
    }
  }
}

declare module '@react-three/drei' {
  export const Html: any;
  export * from 'drei';
}

declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      'data-counter-type'?: any;
    }
  }
}
