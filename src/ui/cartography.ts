import { ROAD, TRAIL, MAP_BOUNDS, pathDistance, seededRandom, type Point2 } from '../engine/landscape';
import type { WorldState } from '../engine/world';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export class Cartography {
  private atlas = document.createElement('canvas');
  private world: Bounds = { minX: -57, maxX: 57, minZ: -65, maxZ: 49 };
  private scale = 1024 / 114;
  constructor() { this.atlas.width = this.atlas.height = 1024; this.paintAtlas(); }
  private paintAtlas() {
    const ctx = this.atlas.getContext('2d')!, rng = seededRandom(415);
    ctx.fillStyle = '#28382d'; ctx.fillRect(0, 0, 1024, 1024);
    const project = (p: Point2) => [(p.x - this.world.minX) * this.scale, (p.z - this.world.minZ) * this.scale];
    for (let i = 0; i < 15000; i++) {
      const x = rng() * 1024, y = rng() * 1024, r = 1 + rng() * 17;
      ctx.fillStyle = ['#314334', '#344636', '#3c4c37', '#22352b', '#384837', '#45533d', '#30432e'][Math.floor(rng() * 7)];
      ctx.globalAlpha = .1 + rng() * .5; ctx.beginPath(); ctx.ellipse(x, y, r, r * (.65 + rng() * .4), rng() * 3, 0, Math.PI * 2); ctx.fill();
      if (i % 3 === 0) { ctx.lineWidth = .4; ctx.strokeStyle = '#9f9a6f'; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    const stroke = (path: Point2[], width: number, color: string) => {
      ctx.beginPath(); path.forEach((p, i) => { const [x, y] = project(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = color; ctx.lineWidth = width * this.scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    };
    for (const path of [ROAD, TRAIL]) {
      const w = path === ROAD ? 4.7 : 1.64;
      stroke(path, w + 4.4, '#1b2b23'); stroke(path, w + 3.3, '#5c6345');
      stroke(path, w + 2.7, '#293c2c'); stroke(path, w + 1, '#6b6d4e');
      stroke(path, w + .34, '#918567'); stroke(path, w, '#b4a383');
      stroke(path, w * .75, '#bca989');
      ctx.setLineDash([1, 7]); stroke(path, .075, '#7a7455'); ctx.setLineDash([]);
    }
    for (let i = 0; i < 6500; i++) {
      const wx = this.world.minX + rng() * 114, wz = this.world.minZ + rng() * 114, d = pathDistance(wx, wz);
      if (d > 2.8 || d < -.3) continue;
      const [x, y] = project({ x: wx, z: wz });
      ctx.fillStyle = ['#465c3d', '#3d5138', '#677452', '#819068'][Math.floor(rng() * 4)];
      ctx.globalAlpha = .3 + rng() * .6; ctx.beginPath(); ctx.arc(x, y, .5 + rng() * 2.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = .35;
    for (let i = 0; i < 10000; i++) { ctx.fillStyle = rng() > .5 ? '#d2c7a1' : '#14261d'; ctx.fillRect(rng() * 1024, rng() * 1024, .7, .7); }
    ctx.globalAlpha = 1;
  }
  render(canvas: HTMLCanvasElement, state: WorldState, expanded = false) {
    const ratio = 2, width = canvas.clientWidth || (expanded ? 560 : 190), height = canvas.clientHeight || (expanded ? 490 : 160);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const ctx = canvas.getContext('2d')!; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const bounds: Bounds = expanded ? { ...MAP_BOUNDS, minX: -20, maxX: 21, minZ: -24, maxZ: 15 } : { minX: state.x - 10.5, maxX: state.x + 10.5, minZ: state.z - 12, maxZ: state.z + 7.5 };
    const sx = (bounds.minX - this.world.minX) * this.scale, sy = (bounds.minZ - this.world.minZ) * this.scale;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#25382c'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(this.atlas, sx, sy, (bounds.maxX - bounds.minX) * this.scale, (bounds.maxZ - bounds.minZ) * this.scale, 0, 0, width, height);
    const point = (x: number, z: number) => [(x - bounds.minX) / (bounds.maxX - bounds.minX) * width, (z - bounds.minZ) / (bounds.maxZ - bounds.minZ) * height];
    if (expanded) {
      const vignette = ctx.createRadialGradient(width * .5, height * .5, width * .15, width * .5, height * .5, width * .7);
      vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, '#0c1e1666'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
      const label = (text: string, x: number, z: number, size = 15, color = '#d9ceaa') => {
        const [px, py] = point(x, z); ctx.font = `${size}px "Cormorant Garamond", Georgia`; ctx.textAlign = 'center'; ctx.fillStyle = color;
        ctx.shadowColor = '#111f16'; ctx.shadowBlur = 5; ctx.fillText(text, px, py); ctx.shadowBlur = 0;
      };
      label('To Cragmaw Hideout', 1, -21.7, 19);
      label('↑', -1.1, -19.4, 24);
      label('Neverwinter Wood', -8, -10, 21, '#9dba8b');
      label('Triboar Trail', -9.5, 3.4, 21, '#342c20');
      label('To Phandalin →', 12.6, 9.1, 19);
      label('The ambush clearing', 10, -.8, 16);
      const [cx, cy] = point(9.7, 2.0);
      ctx.strokeStyle = '#d7ba77'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.ellipse(cx, cy, 26, 32, .6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      for (const horse of state.horses) {
        const [px, py] = point(horse.x, horse.z); ctx.save(); ctx.translate(px, py); ctx.rotate(-horse.yaw);
        ctx.fillStyle = '#3b3c2a'; ctx.beginPath(); ctx.ellipse(0, 0, 3, 7, 0, 0, 6.28); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, -7.2, 2, 3, 0, 0, 6.28); ctx.fill(); ctx.restore();
      }
      this.compass(ctx, width - 42, 53, 24);
      ctx.strokeStyle = '#c7bd94'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(25, height - 28); ctx.lineTo(25 + 5 / (bounds.maxX - bounds.minX) * width, height - 28); ctx.stroke();
      ctx.font = '9px Manrope, sans-serif'; ctx.fillStyle = '#c7bd94'; ctx.textAlign = 'left'; ctx.fillText('5 METRES', 25, height - 36);
    } else {
      this.compass(ctx, width - 15, 20, 7);
      const [cx, cy] = point(9.7, 2.0); ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#c8b17b'; ctx.fillRect(-3, -3, 6, 6); ctx.restore();
    }
    const [wx, wy] = point(state.wagon.x, state.wagon.z);
    ctx.save(); ctx.translate(wx, wy); ctx.rotate(-state.wagon.yaw);
    ctx.fillStyle = '#bdb18b'; ctx.strokeStyle = '#25362b'; ctx.lineWidth = 1;
    ctx.fillRect(-3.7, -4.5, 7.4, 9); ctx.strokeRect(-3.7, -4.5, 7.4, 9); ctx.restore();
    let [x, y] = point(state.x, state.z);
    x = Math.max(11, Math.min(width - 11, x)); y = Math.max(11, Math.min(height - 11, y));
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#e9d8a720'; ctx.beginPath(); ctx.arc(0, 0, expanded ? 15 : 12, 0, 6.28); ctx.fill();
    ctx.strokeStyle = '#e1cf9d55'; ctx.lineWidth = .8; ctx.stroke();
    ctx.rotate(-state.yaw); ctx.fillStyle = '#f3e5bd'; ctx.shadowColor = '#b4a570'; ctx.shadowBlur = 9;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  private compass(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#d6c79877'; ctx.fillStyle = '#d6c798'; ctx.lineWidth = .7;
    if (radius > 10) { ctx.beginPath(); ctx.arc(0, 0, radius * .62, 0, 6.28); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, -radius); ctx.lineTo(3, 4); ctx.lineTo(0, 1); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill();
    ctx.font = '9px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -radius - 5); ctx.restore();
  }
}
export function paintCompass(canvas: HTMLCanvasElement, yaw: number) {
  const w = 286, h = 51;
  if (canvas.width !== w * 2) { canvas.width = w * 2; canvas.height = h * 2; }
  const ctx = canvas.getContext('2d')!; ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, w, h);
  const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
  const directions: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let offset = -100; offset <= 100; offset++) {
    const degree = Math.floor(heading) + offset;
    if (degree % 5 !== 0) continue;
    const x = w / 2 + (degree - heading) * 2.2, normalized = (degree % 360 + 360) % 360;
    const alpha = Math.max(0, 1 - Math.abs(x - w / 2) / (w / 2));
    ctx.globalAlpha = alpha; ctx.strokeStyle = '#ebe8d9'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 29); ctx.lineTo(x, degree % 15 === 0 ? 23 : 26); ctx.stroke();
    if (directions[normalized]) { ctx.font = `${normalized % 90 === 0 ? 11 : 9}px Manrope, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = normalized % 90 === 0 ? '#e8e5d7' : '#bdc1ad'; ctx.fillText(directions[normalized], x, 16); }
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#cfb77f'; ctx.beginPath(); ctx.moveTo(w / 2 - 3, 34); ctx.lineTo(w / 2 + 3, 34); ctx.lineTo(w / 2, 30); ctx.closePath(); ctx.fill();
  ctx.font = '8px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#dbd8c5aa'; ctx.fillText(`${Math.round(heading).toString().padStart(3, '0')}°`, w / 2, 48);
}
