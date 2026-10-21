import React from 'react';
import {AbsoluteFill, Composition, Img, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

// Use the original dense floral artwork, not a redrawn approximation.
const prints = [
  {x:300,y:200,w:440,h:310,a:-16,c:'yellow',at:-100},
  {x:850,y:180,w:325,h:430,a:15,c:'red',at:-100},
  {x:570,y:380,w:455,h:320,a:-7,c:'orange',at:-100},
  {x:270,y:405,w:325,h:430,a:10,c:'orange',at:10},
  {x:850,y:410,w:450,h:315,a:-12,c:'yellow',at:34},
  {x:530,y:190,w:440,h:310,a:9,c:'red',at:60},
  {x:680,y:335,w:330,h:440,a:-9,c:'orange',at:86},
  {x:425,y:345,w:465,h:325,a:5,c:'yellow',at:114},
];
const images={yellow:'poppy-abstract-yellow.webp',red:'poppy-abstract-red.webp',orange:'poppy-abstract-close.webp'};
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
function Poppy() {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  return <AbsoluteFill style={{background:'#faf5eb',overflow:'hidden'}}>
    {prints.map((p,i)=>{
      const base=p.at<0;
      const settle=base?1:spring({frame:frame-p.at,fps,config:{damping:24,stiffness:95,mass:1}});
      const visible=base?1:interpolate(frame,[p.at,p.at+8],[0,1],clamp);
      // A short movement onto the tabletop, not a fall from outside the frame.
      const lift=1-settle;
      const retreat=base?1:1-interpolate(frame,[215+(7-i)*2,239],[0,1],clamp);
      return <div key={i} style={{position:'absolute',left:p.x-p.w/2,top:p.y-p.h/2,width:p.w,height:p.h,padding:15,boxSizing:'border-box',background:'#fff',opacity:visible*retreat,transform:`translate(${lift*(i%2?35:-35)}px,${-lift*55}px) rotate(${p.a+lift*(i%2?8:-8)}deg) scale(${1+lift*.12})`,boxShadow:`0 ${5+lift*20}px ${14+lift*28}px rgba(58,38,17,${.13+lift*.06}), 0 1px 3px rgba(58,38,17,.06)`}}>
        <Img src={staticFile('photos/'+images[p.c as keyof typeof images])} style={{display:'block',width:'100%',height:'100%',objectFit:'cover'}}/>
      </div>;
    })}
  </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Poppy" component={Poppy} durationInFrames={240} fps={30} width={1200} height={630}/>);
