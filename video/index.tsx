import React from 'react';
import {AbsoluteFill, Composition, interpolate, spring, registerRoot, useCurrentFrame, useVideoConfig} from 'remotion';

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
// Extra blooms grow in place over the established pattern, building up layers.
const newcomers = [
  [125,130,100,12,0], [355,120,115,-25,2], [555,140,90,34,1],
  [820,130,118,15,0], [1080,145,105,-20,2],
  [190,335,110,28,1], [440,350,125,-8,0], [670,330,100,22,2],
  [930,390,115,-35,1], [1160,360,100,16,0],
  [80,580,90,20,2], [315,580,105,-20,1], [560,575,115,12,0],
  [805,575,110,35,2], [1130,585,100,-15,1],
];
const colors=['#fa5705','#efbb22','#e72e1b'];
// Broad, asymmetric four-petal silhouettes with soft corners, like the printed artwork.
const petals=[
  'M -4 5 C -24 -2 -69 -9 -92 -30 C -111 -47 -110 -67 -100 -82 C -87 -102 -63 -111 -46 -101 C -22 -86 -11 -38 -4 5 Z',
  'M -4 5 C -30 -1 -75 -13 -94 -37 C -108 -55 -105 -76 -90 -91 C -75 -108 -52 -111 -38 -97 C -20 -79 -8 -30 -4 5 Z',
  'M -4 5 C -25 -5 -64 -7 -88 -26 C -111 -45 -113 -67 -97 -85 C -81 -104 -58 -108 -42 -96 C -22 -80 -11 -34 -4 5 Z',
  'M -4 5 C -33 -3 -77 -15 -97 -40 C -108 -57 -101 -81 -85 -95 C -67 -110 -48 -105 -33 -88 C -17 -67 -8 -24 -4 5 Z',
];
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
function Poppy() {
  const frame=useCurrentFrame(); const {durationInFrames,fps}=useVideoConfig();
  const phase=frame/durationInFrames*Math.PI*2;
  return <AbsoluteFill style={{background:'#eee7db',padding:18,overflow:'hidden'}}>
    <div style={{width:'100%',height:'100%',padding:22,background:'#fff',boxSizing:'border-box',boxShadow:'0 4px 14px rgba(62,42,20,.16)'}}>
    <svg width="100%" height="100%" viewBox="0 0 1200 630" preserveAspectRatio="xMidYMid slice" style={{display:'block',background:'#faf5e9'}} aria-label="A white-bordered photo print of overlapping orange, yellow and red poppies blooming into a dense pattern">
      {[...flowers,...newcomers].map(([x,y,size,angle,color],i)=>{
        const extra=i-flowers.length;
        const bloom=extra<0 ? 1 : spring({frame:frame-12-extra*5,fps,config:{damping:18,stiffness:85,mass:1}});
        // Return to the populated opening composition for a seamless loop, never an empty frame.
        const retreat=extra<0 ? 1 : 1-interpolate(frame,[199+extra*.7,239],[0,1],clamp);
        const growth=bloom*retreat;

        // Periodic motion keeps the full print visible and loops without a reset.
        const sway=Math.sin(phase+i*.7)*3;
        const dy=Math.cos(phase+i*.7)*2;
        const turn=angle+Math.sin(phase+i*.9)*2.5;
        return <g key={i} transform={`translate(${x+sway} ${y+dy}) rotate(${turn}) scale(${size/125*growth})`}>
          <path d="M 15 38 C 40 9 109 1 143 18 C 118 63 59 76 15 38Z" fill={i%2?'#8e9c6b':'#596626'}/>
          <path d="M -27 -22 C -77 -38 -113 -100 -103 -144 C -56 -121 -19 -73 -27 -22Z" fill={i%3?'#556322':'#9ba77a'}/>
          <path d="M -21 30 C -67 35 -119 78 -121 126 C -65 110 -22 73 -21 30Z" fill="#788648"/>
          {[0,90,180,270].map((r,k)=><path key={r} d={petals[(i+k)%petals.length]} transform={`rotate(${r+(i%3-1)*5}) scale(${k%2?1:.94} ${k%2?.95:1})`} fill={colors[color]}/>)}
          <ellipse rx="24" ry="20" transform={`rotate(${i%2?-22:18})`} fill="#252e29"/>
        </g>;
      })}
    </svg>
    </div>
  </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Poppy" component={Poppy} durationInFrames={240} fps={30} width={1200} height={630}/>);
