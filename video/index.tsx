import React from 'react';
import {AbsoluteFill, Composition, interpolate, registerRoot, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// Hand-shaped petals and leaves, matching the loose botanical shapes in the print artwork.
const flowers = [
  [-25,30,155,-18,0], [210,60,118,24,1], [420,-15,130,-12,2],
  [665,60,168,32,0], [945,5,145,-20,1], [1195,95,155,12,2],
  [65,285,142,28,2], [310,255,170,-15,0], [535,265,105,18,1],
  [810,290,173,-22,2], [1070,285,128,35,0],
  [-30,525,164,-12,1], [200,540,122,20,0], [425,510,159,10,2],
  [665,555,128,-25,1], [960,540,176,15,0], [1205,550,137,-18,2],
  [140,410,70,-10,1], [590,410,78,20,0], [1100,435,66,15,1],
];
const colors=['#fa5705','#efbb22','#e72e1b'];
const clamp = {extrapolateLeft:'clamp', extrapolateRight:'clamp'} as const;
const petal='M -5 4 C -42 -3 -97 -23 -100 -61 C -104 -99 -64 -119 -31 -94 C -5 -75 8 -31 -5 4 Z';
function Poppy() {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  return <AbsoluteFill style={{background:'#faf5e9',overflow:'hidden'}}>
    <svg width="1200" height="630" viewBox="0 0 1200 630" aria-label="Orange, yellow and red poppies falling into a leafy floral pattern">
      {flowers.map(([x,y,size,angle,color],i)=>{
        const delay=(i*17)%57;
        const f=frame-delay;
        const landed=spring({frame:f,fps,config:{damping:21,stiffness:60,mass:1.3}});
        const exit=interpolate(frame,[198+delay*.28,239],[0,1],clamp);
        const dy=(-850-y)*(1-landed)+exit*exit*1100;
        const sway=Math.sin(Math.max(0,f)/18+i)*55*(1-Math.min(1,landed));
        const turn=angle+(1-landed)*(i%2?65:-65)+exit*(i%2?25:-25);
        return <g key={i} transform={`translate(${x+sway} ${y+dy}) rotate(${turn}) scale(${size/125})`}>
          <path d="M 15 38 C 40 9 109 1 143 18 C 118 63 59 76 15 38Z" fill={i%2?'#8e9c6b':'#596626'}/>
          <path d="M -27 -22 C -77 -38 -113 -100 -103 -144 C -56 -121 -19 -73 -27 -22Z" fill={i%3?'#556322':'#9ba77a'}/>
          <path d="M -21 30 C -67 35 -119 78 -121 126 C -65 110 -22 73 -21 30Z" fill="#788648"/>
          {[0,90,180,270].map((r,k)=><path key={r} d={petal} transform={`rotate(${r+(i%3-1)*5}) scale(${k%2?1:.94} ${k%2?.95:1})`} fill={colors[color]}/>)}
          <ellipse rx="24" ry="21" transform="rotate(-15)" fill="#252e29"/>
        </g>;
      })}
    </svg>
  </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Poppy" component={Poppy} durationInFrames={240} fps={30} width={1200} height={630}/>);
