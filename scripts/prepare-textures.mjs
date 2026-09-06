import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('public/textures', { recursive: true });
for (const name of ['earth-path', 'forest-floor', 'bark', 'rock']) {
  const { data, info } = await sharp(`assets-source/${name}.jpg`).resize(1024,1024).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const w=info.width, h=info.height, c=info.channels;
  const height=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)height[i]=(data[i*c]*.299+data[i*c+1]*.587+data[i*c+2]*.114)/255;
  const out=Buffer.alloc(w*h*3);
  const amount=name==='bark'?3.8:name==='rock'?3.3:2.2;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=(height[y*w+(x+1)%w]-height[y*w+(x+w-1)%w])*amount;
    const dy=(height[((y+1)%h)*w+x]-height[((y+h-1)%h)*w+x])*amount;
    const n=1/Math.sqrt(dx*dx+dy*dy+1),i=(y*w+x)*3;
    out[i]=Math.round((-dx*n*.5+.5)*255);out[i+1]=Math.round((dy*n*.5+.5)*255);out[i+2]=Math.round((n*.5+.5)*255);
  }
  await sharp(out,{raw:{width:w,height:h,channels:3}}).webp({quality:93,effort:6}).toFile(`public/textures/${name}-normal.webp`);
  await sharp(data,{raw:{width:w,height:h,channels:c}}).webp({quality:87}).toFile(`public/textures/${name}.webp`);
}
const {data,info}=await sharp('assets-source/oak-branch.jpg').resize(768,768).removeAlpha().raw().toBuffer({resolveWithObject:true});
const out=Buffer.alloc(info.width*info.height*4);
for(let i=0;i<info.width*info.height;i++){
  const r=data[i*3],g=data[i*3+1],b=data[i*3+2];
  const alpha=Math.min(255,Math.max(0,(Math.max(r,g,b)-13)*8));
  out[i*4]=alpha<5?85:r;out[i*4+1]=alpha<5?105:g;out[i*4+2]=alpha<5?35:b;out[i*4+3]=alpha;
}
await sharp(out,{raw:{width:info.width,height:info.height,channels:4}}).webp({quality:94,alphaQuality:100}).toFile('public/textures/oak-leaves.webp');
console.log('Prepared PBR normal maps and alpha-tested foliage.');
