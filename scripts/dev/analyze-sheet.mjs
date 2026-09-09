import sharp from 'sharp';
const file = process.argv[2];
const img = sharp(file);
const meta = await img.metadata();
console.log('size:', meta.width, 'x', meta.height);
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const corners = [[0,0],[W-20,0],[0,H-20],[W-20,H-20]].map(([x,y]) => {
  let r=0,g=0,b=0,n=0;
  for (let yy=y; yy<y+20; yy++) for (let xx=x; xx<x+20; xx++) { const i=(yy*W+xx)*C; r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++; }
  return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
});
console.log('corner colors:', JSON.stringify(corners));
const isBg = (i) => { const r=data[i],g=data[i+1],b=data[i+2]; return Math.min(r,b)-g > 60; };
let bgCount = 0; for (let i=0;i<W*H;i++) if (isBg(i*C)) bgCount++;
console.log('magenta fraction:', (bgCount/(W*H)).toFixed(3));
// detect content column bands and row bands
const colBg = new Array(W).fill(0), rowBg = new Array(H).fill(0);
for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (isBg((y*W+x)*C)) { colBg[x]++; rowBg[y]++; }
const bands = (arr, limit) => { const out=[]; let start=-1;
  for (let i=0;i<arr.length;i++){ const empty = arr[i] > limit; if(!empty && start<0) start=i; if(empty && start>=0){ out.push([start,i-1]); start=-1; } }
  if(start>=0) out.push([start,arr.length-1]); return out; };
const colBands = bands(colBg.map(v=>v/H), H*0.985);
const rowBands = bands(rowBg.map(v=>v/W), W*0.985);
console.log('content col bands:', colBands.map(b=>b[1]-b[0]+1).join(','), JSON.stringify(colBands));
console.log('content row bands:', rowBands.map(b=>b[1]-b[0]+1).join(','), JSON.stringify(rowBands));
// per-cell stats on detected bands (cap at 4x4)
const cw = colBands.length, rw = rowBands.length;
for (let cy=0; cy<Math.min(rw,4); cy++) { let line='';
  for (let cx=0; cx<Math.min(cw,4); cx++) {
    const [x0,x1]=colBands[cx], [y0,y1]=rowBands[cy];
    let minX=1e9,maxX=-1,minY=1e9,maxY=-1,count=0, rs=0,gs=0,bs=0;
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) if(!isBg((y*W+x)*C)){ count++; rs+=data[(y*W+x)*C]; gs+=data[(y*W+x)*C+1]; bs+=data[(y*W+x)*C+2];
      if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    if (count===0) line += '[empty]'; else line += `[${maxX-minX+1}x${maxY-minY+1} ${Math.round(100*count/((x1-x0+1)*(y1-y0+1)))}% avg(${Math.round(rs/count)},${Math.round(gs/count)},${Math.round(bs/count)})]`;
  } console.log('row',cy,':',line); }
