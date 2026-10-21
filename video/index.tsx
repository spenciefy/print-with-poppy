import React from 'react';
import {AbsoluteFill, Composition, Img, interpolate, Easing, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import masks from './masks.json';

function Poppy() {
  const frame=useCurrentFrame();
  const {durationInFrames}=useVideoConfig();
  const reveal=interpolate(frame,[0,155],[32,100],{extrapolateRight:'clamp'});
  const finish=interpolate(frame,[155,205],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)});
  const phase=frame/durationInFrames*Math.PI*2;
  // Animate the original print, preserving its actual petal silhouettes and texture.
  // Low-frequency displacement gives a restrained organic breathing motion.
  const flow=7+4*Math.sin(phase);
  const palette=[[255,94,0],[248,199,35],[235,43,22]];
  const colors=masks.map((_,i)=>{
    const position=(frame/durationInFrames*3+i*.618033*3)%3;
    const step=Math.floor(position), t=(1-Math.cos((position-step)*Math.PI))/2;
    return palette[step].map((v,c)=>(v+(palette[(step+1)%3][c]-v)*t)/255);
  });
  return <AbsoluteFill style={{background:'#eee7db',padding:30,overflow:'hidden'}}>
    <svg width="0" height="0" style={{position:'absolute'}} aria-hidden="true">
      <defs>
        {colors.map(([r,g,b],i)=><filter key={i} id={`color-${i}`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={`${r} 0 0 0 0  ${g} 0 0 0 0  ${b} 0 0 0 0  0 0 0 1 0`}/></filter>)}
        <filter id="bloom" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.006" numOctaves="1" seed="7" result="flow"/>
          <feDisplacementMap in="SourceGraphic" in2="flow" scale={flow} xChannelSelector="R" yChannelSelector="G"/>
        </filter>
      </defs>
    </svg>
    <div style={{width:'100%',height:'100%',padding:22,background:'#fff',boxSizing:'border-box',boxShadow:`0 ${5+finish*9}px ${14+finish*14}px rgba(62,42,20,.18)`,transform:`translateY(${finish*7}px) rotate(${-finish*.65}deg) scale(${.98+finish*.01})`}}>
      <div style={{position:'relative',width:'100%',height:'100%',overflow:'hidden',background:'#fff'}}>
        <div style={{position:'relative',width:'100%',height:'100%',clipPath:`inset(0 0 ${100-reveal}% 0)`,filter:'url(#bloom)',transform:`scale(${1.025+.003*Math.sin(phase)}) translate(${Math.sin(phase)*1.5}px,${Math.cos(phase)*1.5}px)`}}>
          <Img src={staticFile('photos/poppy-abstract-cluster.webp')} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover'}}/>
          {masks.map((mask,i)=>{
            // Each flower has a different phase on the orange → yellow → red cycle.

            return <Img key={i} src={staticFile('photos/poppy-abstract-cluster.webp')} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',maskImage:`url("${mask}")`,maskMode:'luminance',maskSize:'cover',maskPosition:'center',filter:`url(#color-${i})`}}/>;
          })}
        </div>
        {frame<155 && <div style={{position:'absolute',top:`${reveal}%`,left:0,right:0,height:3,background:'rgba(64,48,31,.18)',boxShadow:'0 -4px 10px rgba(255,177,48,.22)',transform:'translateY(-1px)'}}/>}
      </div>
    </div>
  </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Poppy" component={Poppy} durationInFrames={300} fps={30} width={1200} height={630}/>);
