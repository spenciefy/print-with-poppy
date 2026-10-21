import React from 'react';
import {AbsoluteFill, Composition, Img, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

function Poppy() {
  const frame=useCurrentFrame();
  const {durationInFrames}=useVideoConfig();
  const phase=frame/durationInFrames*Math.PI*2;
  // Animate the original print, preserving its actual petal silhouettes and texture.
  // Low-frequency displacement gives a restrained organic breathing motion.
  const flow=7+4*Math.sin(phase);
  return <AbsoluteFill style={{background:'#eee7db',padding:18,overflow:'hidden'}}>
    <svg width="0" height="0" style={{position:'absolute'}} aria-hidden="true">
      <defs>
        <filter id="bloom" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.006" numOctaves="1" seed="7" result="flow"/>
          <feDisplacementMap in="SourceGraphic" in2="flow" scale={flow} xChannelSelector="R" yChannelSelector="G"/>
        </filter>
      </defs>
    </svg>
    <div style={{width:'100%',height:'100%',padding:22,background:'#fff',boxSizing:'border-box',boxShadow:'0 4px 14px rgba(62,42,20,.16)'}}>
      <div style={{width:'100%',height:'100%',overflow:'hidden',background:'#faf5e9'}}>
        <Img src={staticFile('photos/poppy-abstract-cluster.webp')} alt="Original orange poppy print with gently flowing petals" style={{display:'block',width:'100%',height:'100%',objectFit:'cover',filter:'url(#bloom)',transform:`scale(${1.025+.003*Math.sin(phase)}) translate(${Math.sin(phase)*1.5}px,${Math.cos(phase)*1.5}px)`}}/>
      </div>
    </div>
  </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Poppy" component={Poppy} durationInFrames={300} fps={30} width={1200} height={630}/>);
