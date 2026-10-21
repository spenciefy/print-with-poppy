import React from 'react';
import {AbsoluteFill, Composition, Img, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

const prints = [
  {image:'poppy-abstract-yellow.webp', x:390, y:385, angle:-15, delay:5},
  {image:'poppy-abstract-red.webp', x:810, y:385, angle:14, delay:17},
  {image:'poppy-abstract-close.webp', x:600, y:370, angle:-3, delay:29},
];
const clamp = {extrapolateLeft:'clamp', extrapolateRight:'clamp'} as const;
function Poppy() {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  return <AbsoluteFill style={{background:'#fbf5eb',color:'#302219',overflow:'hidden',fontFamily:'Hanken'}}>
    <style>{`@font-face{font-family:Hanken;src:url('${staticFile('fonts/hanken-regular.ttf')}')}@font-face{font-family:Young;src:url('${staticFile('fonts/young-serif.ttf')}')}`}</style>
    <div style={{position:'absolute',top:45,width:'100%',textAlign:'center',fontSize:36,letterSpacing:-1}}>Print with <span style={{fontFamily:'Young'}}>Poppy</span></div>
    <div style={{position:'absolute',top:100,width:'100%',textAlign:'center',fontSize:20,color:'#776b5a'}}>Your photos, printed</div>
    {prints.map((p,i)=>{
      const f=frame-p.delay;
      const settle=spring({frame:f,fps,config:{damping:16,stiffness:65,mass:1.2}});
      const leave=interpolate(frame,[205+p.delay/3,238],[0,1],clamp);
      const y=-360+(p.y+360)*settle+leave*leave*850;
      const x=p.x+Math.sin(Math.max(f,0)/14)*(1-Math.min(settle,1))*90;
      const angle=p.angle+(1-settle)*(i===1?48:-40)+leave*(i===1?22:-18);
      return <div key={p.image} style={{position:'absolute',left:x-145,top:y-180,width:290,height:360,padding:13,background:'#fff',boxSizing:'border-box',transform:`rotate(${angle}deg) scale(${1.08-.08*Math.min(settle,1)})`,boxShadow:`0 ${12+18*(1-Math.min(settle,1))}px 35px rgba(69,43,19,.16), 0 2px 5px rgba(69,43,19,.08)`}}>
        <Img src={staticFile('photos/'+p.image)} style={{width:'100%',height:'100%',objectFit:'cover'}} />
      </div>;
    })}
    <div style={{position:'absolute',bottom:22,width:'100%',textAlign:'center',fontSize:16,color:'#857967',letterSpacing:.5}}>printwithpoppy.com</div>
  </AbsoluteFill>;
}
registerRoot(()=> <Composition id="Poppy" component={Poppy} durationInFrames={240} fps={30} width={1200} height={630}/>);
