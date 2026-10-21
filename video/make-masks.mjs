import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
const {data,info}=await sharp('../public/photos/poppy-abstract-cluster.webp').removeAlpha().raw().toBuffer({resolveWithObject:true});
const centers=[[94,100],[600,103],[1028,173],[1340,78],[265,380],[870,500],[1454,386],[1260,540],[129,818],[420,700],[730,889],[1007,922],[1384,855]];
const {width:w,height:h,channels:c}=info;
const eligible=new Uint8Array(w*h),seen=new Uint8Array(w*h);
for(let i=0;i<w*h;i++){const [r,g,b]=data.subarray(i*c,i*c+3);eligible[i]=+(r>120&&r>g*1.4&&b<90);}
const masks=centers.map(()=>Buffer.alloc(w*h));
// Connected petal components avoid slicing a petal across a geometric region.
for(let start=0;start<w*h;start++){
 if(!eligible[start]||seen[start])continue;
 const points=[start];seen[start]=1;let sx=0,sy=0;
 for(let q=0;q<points.length;q++){const i=points[q],x=i%w,y=Math.floor(i/w);sx+=x;sy+=y;
 for(const n of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(n>=0&&eligible[n]&&!seen[n]){seen[n]=1;points.push(n);}}
 const x=sx/points.length,y=sy/points.length;
 let best=0,dist=Infinity;centers.forEach(([cx,cy],j)=>{let d=Infinity;for(const pixel of points){const px=pixel%w,py=Math.floor(pixel/w);d=Math.min(d,(px-cx)**2+(py-cy)**2);}if(d<dist){dist=d;best=j;}});
 // These touching petal components belong to the large central and edge blooms.
 if(x>610&&x<820&&y>230&&y<460)best=5;
 if(x<300&&y>600)best=8;
 for(const i of points)masks[best][i]=255;
}
for(let j=0;j<masks.length;j++){
 const png=await sharp(masks[j],{raw:{width:w,height:h,channels:1}}).blur(.5).png().toBuffer();
 await writeFile(`masks/${j}.png`,png);
}
await writeFile('masks.json',JSON.stringify(await Promise.all(masks.map(async(_,j)=>'data:image/png;base64,'+(await (await import('node:fs/promises')).readFile(`masks/${j}.png`)).toString('base64')))));
