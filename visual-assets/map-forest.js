import { palette } from './renderer.js';

const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const smooth = (a,b,n) => { const t=clamp((n-a)/(b-a)); return t*t*(3-2*t); };
const fract = n => n-Math.floor(n);
const variants = new Map();
function random(index, seed) {
  let h=(seed|0)^Math.imul(index+1,0x9e3779b1);
  h=Math.imul(h^(h>>>16),0x85ebca6b); h=Math.imul(h^(h>>>13),0xc2b2ae35);
  return ((h^(h>>>16))>>>0)/4294967296;
}
function polygon(ctx,p) { ctx.beginPath();p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill(); }
function line(ctx,p) { ctx.beginPath();p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke(); }

function variantFor(seed) {
  const key=seed|0;if(variants.has(key))return variants.get(key);
  const r=i=>random(i,key), shape={
    dx:(r(1)-.5)*.11,dy:(r(2)-.5)*.10,
    ash:['#7b7166','#86786a','#746e64','#80786f','#81756b'][Math.floor(r(3)*5)],
    charcoal:['#333832','#3c3d35','#303731','#414138'][Math.floor(r(4)*4)],
    ground:[],scorch:[],trees:[],logs:[],grain:[],flames:[],smoke:[],smokeWeight:.76+r(5)*.34,
  };
  const rx=.24+r(6)*.14,ry=.075+r(7)*.065,rotation=(r(8)-.5)*.45;
  for(let i=0;i<13;i++) {
    const a=i/13*Math.PI*2,rr=.76+r(20+i)*.28,xx=Math.cos(a)*rx*rr,yy=Math.sin(a)*ry*rr;
    shape.ground.push([xx*Math.cos(rotation)-yy*Math.sin(rotation),xx*Math.sin(rotation)+yy*Math.cos(rotation)]);
    shape.scorch.push([xx*.65+.035*(r(40+i)-.5),yy*.55]);
  }
  const treeCount=1+Math.floor(r(61)*3);
  for(let i=0;i<treeCount;i++) {
    const tree={x:i===0?(r(63)-.5)*.10:(i===1?-.14:.15)+(r(64+i)-.5)*.08,y:(r(70+i)-.5)*.075,
      height:i===0?.34+r(75+i)*.17:.20+r(75+i)*.19,lean:(r(80+i)-.5)*.16,width:.017+r(85+i)*.016,
      branches:[],stump:i>0&&r(90+i)<.24,remnant:r(95+i)<.20};
    const count=3+Math.floor(r(100+i)*3);
    for(let j=0;j<count;j++)tree.branches.push({start:.30+j/count*.52+r(110+i*10+j)*.08,
      side:(j+(r(120+i)>.5?1:0))%2?-1:1,spread:.065+r(130+i*10+j)*.09,rise:.04+r(160+i*10+j)*.07,fork:r(190+i*10+j)>.42});
    shape.trees.push(tree);
  }
  shape.trees.sort((a,b)=>a.y-b.y);
  for(let i=0;i<2+Math.floor(r(220)*3);i++)shape.logs.push({x:(r(225+i)-.5)*.37,y:(r(230+i)-.5)*.10,angle:(r(235+i)-.5)*1.8,length:.06+r(240+i)*.10});
  for(let i=0;i<13;i++)shape.grain.push({x:(r(250+i)-.5)*rx*1.55,y:(r(270+i)-.5)*ry*1.5,length:.012+r(290+i)*.03});
  const count=3+Math.floor(r(320)*5);
  for(let i=0;i<count;i++)shape.flames.push({x:(i/(count-1)-.5)*rx*1.5+(r(325+i)-.5)*.04,y:(r(340+i)-.5)*.065,
    height:i===0?.24+r(350+i)*.12:.13+r(350+i)*.18,width:.026+r(360+i)*.027,phase:r(370+i)*Math.PI*2,speed:4+r(380+i)*4});
  for(let i=0;i<6;i++)shape.smoke.push({x:(r(400+i)-.5)*.24,phase:i/6+r(410+i)*.10,period:5.6+r(420+i)*3.8,
    wind:.11+r(430+i)*.20,spread:.14+r(440+i)*.07,rise:1.05+r(450+i)*.40});
  if(variants.size>2048)variants.clear();variants.set(key,shape);return shape;
}

/** Terrain bounds support selection; full bounds also include rising smoke. */
export function forestPatchBounds({x=0,y=0,scale=1,seed=11,layer='all'}={}) {
  const size=Math.max(0,Number.isFinite(scale)?scale:0),shape=variantFor(seed),effect=Math.hypot(size,30);
  const cx=x+shape.dx*size,cy=y+shape.dy*size;
  const left=layer==='terrain'?cx-.46*size:cx-.46*size-.48*effect;
  const right=layer==='terrain'?cx+.46*size:cx+.46*size+.90*effect;
  const top=layer==='terrain'?cy-.58*size:cy-.12*size-1.85*effect;
  const bottom=cy+.24*size+(layer==='terrain'?0:.12*effect);
  return {x:left,y:top,left,top,right,bottom,width:right-left,height:bottom-top};
}

function drawTrunk(ctx,tree,charcoal,detail) {
  ctx.save();ctx.translate(tree.x,tree.y);
  const h=tree.stump?tree.height*.28:tree.height,bend=tree.lean;
  ctx.fillStyle=charcoal;
  polygon(ctx,[[-tree.width,.005],[-tree.width*.67+bend*.45,-h*.55],[-tree.width*.28+bend,-h],
    [tree.width*.30+bend,-h*.98],[tree.width*.63+bend*.40,-h*.48],[tree.width*1.2,.005]]);
  if(!tree.stump) {
    ctx.strokeStyle=charcoal;
    for(const b of tree.branches) {
      const sx=bend*b.start,sy=-h*b.start,ex=sx+b.side*b.spread,ey=sy-b.rise;
      ctx.lineWidth=tree.width*.58;line(ctx,[[sx,sy],[sx+b.side*b.spread*.65,sy-b.rise*.40],[ex,ey]]);
      if(b.fork&&detail>.01) {ctx.save();ctx.globalAlpha*=detail;ctx.lineWidth=tree.width*.34;
        line(ctx,[[sx+b.side*b.spread*.58,sy-b.rise*.36],[ex+b.side*.024,ey+.016]]);ctx.restore();}
    }
    if(tree.remnant) {ctx.save();ctx.globalAlpha*=.58;polygon(ctx,[[bend-.04,-h*.87],[bend-.065,-h*.96],[bend-.012,-h*1.01],[bend+.045,-h*.96],[bend+.03,-h*.88]]);ctx.restore();}
  }
  ctx.restore();
}

function drawTerrain(ctx,shape,size,wetness) {
  ctx.save();ctx.scale(size,size);ctx.fillStyle=shape.ash;polygon(ctx,shape.ground);
  ctx.save();ctx.globalAlpha*=.16;ctx.fillStyle='#70766a';polygon(ctx,shape.scorch);ctx.restore();
  const detail=smooth(8,27,size*.58);ctx.lineWidth=.008;
  for(let i=0;i<shape.grain.length;i+=size<20?3:1) {const g=shape.grain[i];ctx.strokeStyle=i%3?'#818779':'#ebe8dc';
    ctx.save();ctx.globalAlpha*=.48+detail*.40;line(ctx,[[g.x,g.y],[g.x+g.length,g.y-.005]]);ctx.restore();}
  for(const tree of shape.trees)drawTrunk(ctx,tree,shape.charcoal,detail);
  ctx.strokeStyle=shape.charcoal;
  for(const log of shape.logs) {ctx.save();ctx.translate(log.x,log.y);ctx.rotate(log.angle);ctx.lineWidth=.019;
    line(ctx,[[-log.length/2,0],[log.length/2,-.006]]);ctx.lineWidth=.009;line(ctx,[[log.length*.1,-.001],[log.length*.18,-.027]]);ctx.restore();}
  drawWetMarks(ctx,shape,wetness);
  ctx.restore();
}

function drawWetMarks(ctx,shape,wetness) {
  if(wetness<=.005)return;
  ctx.save();ctx.globalAlpha*=wetness*.66;ctx.strokeStyle=palette.rain;ctx.lineWidth=.012;
  for(let i=0;i<3;i++){const g=shape.grain[i*4];line(ctx,[[g.x,g.y],[g.x+.045,g.y-.003]]);}ctx.restore();
}

function drawFire(ctx,shape,scale,effect,time,flame,ember) {
  const alpha=ctx.globalAlpha;
  for(let i=0;i<shape.flames.length;i+=scale<20?2:1) {
    const fire=shape.flames[i],xx=fire.x*scale,yy=fire.y*scale;
    const pulse=.91+.10*Math.sin(time*fire.speed+fire.phase)+.05*Math.sin(time*fire.speed*1.7+i);
    const h=fire.height*effect*flame*pulse,w=fire.width*effect;
    if(ember>.001) {ctx.save();ctx.globalAlpha*=ember*(.66+.34*Math.sin(time*2.3+fire.phase)**2);
      ctx.strokeStyle='#ce8c37';ctx.lineWidth=Math.max(.55,effect*.029);line(ctx,[[xx-w*.65,yy+.007*scale],[xx+w*.74,yy]]);ctx.restore();}
    if(h>.015) {
      const sway=Math.sin(time*fire.speed*.65+fire.phase)*h*.22;ctx.fillStyle=i%2?'#d4502b':'#e87632';
      ctx.beginPath();ctx.moveTo(xx-w,yy);ctx.bezierCurveTo(xx-w*1.05,yy-h*.34,xx+sway-w*.18,yy-h*.66,xx+sway,yy-h);
      ctx.bezierCurveTo(xx+sway+w*.70,yy-h*.70,xx+w*.45,yy-h*.35,xx+w,yy);ctx.closePath();ctx.fill();
      ctx.fillStyle='#f5af4e';ctx.beginPath();ctx.moveTo(xx-w*.58,yy);
      ctx.bezierCurveTo(xx-w*.56,yy-h*.20,xx+sway*.33,yy-h*.40,xx+sway*.56,yy-h*.64);
      ctx.bezierCurveTo(xx+w*.38,yy-h*.27,xx+w*.52,yy-h*.10,xx+w*.56,yy);ctx.closePath();ctx.fill();
      if(h>3){ctx.fillStyle='#ffd278';polygon(ctx,[[xx-w*.21,yy],[xx+sway*.20,yy-h*.30],[xx+w*.28,yy]]);}
    }
  }
  if(flame>.02){ctx.fillStyle='#db8b36';for(let i=0;i<3;i++) {
    const fire=shape.flames[i%shape.flames.length],age=fract(time*.36+fire.phase/6.3);
    ctx.globalAlpha=alpha*flame*Math.sin(age*Math.PI)*.82;
    const px=fire.x*scale+Math.sin(age*4+i)*.04*effect,py=fire.y*scale-age*.44*effect;
    ctx.fillRect(px,py,Math.max(.5,.015*effect),Math.max(.8,.023*effect));}}
  ctx.globalAlpha=alpha;
}

function drawSmoke(ctx,shape,scale,effect,time,amount) {
  if(amount<=.001)return;const alpha=ctx.globalAlpha;
  for(let i=0;i<shape.smoke.length;i+=scale<20?2:1) {
    const puff=shape.smoke[i],age=fract(time/puff.period+puff.phase);
    const xx=puff.x*scale+puff.wind*age*effect+Math.sin(age*4.2+i)*.055*effect;
    const yy=-.03*scale-age*puff.rise*effect,radius=(.052+age*puff.spread)*effect;
    const opacity=amount*shape.smokeWeight*Math.sin(age*Math.PI)**.72*(1-age*.22);
    // Copper-orange body stays legible above the dark map and the shared
    // atmosphere. The darker second lobe preserves each plume's depth.
    ctx.fillStyle=i%2?'#df772c':'#ba501b';ctx.globalAlpha=alpha*opacity*.57;
    ctx.beginPath();ctx.ellipse(xx,yy,radius*1.28,radius*.88,-.22,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=alpha*opacity*.255;ctx.beginPath();ctx.ellipse(xx-radius*.34,yy+radius*.14,radius*1.02,radius*.76,.12,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=alpha*opacity*.285;ctx.strokeStyle='#f5a354';ctx.lineWidth=Math.max(.3,effect*.008);
    ctx.beginPath();ctx.moveTo(xx-radius*.80,yy+radius*.12);
    ctx.bezierCurveTo(xx-radius*1.05,yy-radius*.40,xx-radius*.10,yy-radius*.85,xx+radius*.49,yy-radius*.45);ctx.stroke();
  }
  ctx.globalAlpha=alpha;
}

/**
 * Seeded, geography-anchored trees and organic ash. Effects retain a gentle
 * readability floor at wide zoom. Paint all terrain, all fire, then all smoke
 * so neighboring ground cannot erase a plume. The default all draws one patch.
 */
export function drawMapForest(ctx,{
  x=0,y=0,scale=1,time=0,heat=1,surfaceWetness=0,extinguished=false,
  smokeTail=0,tailHeat=.15,seed=11,layer='all',
}={}) {
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(scale)||scale<=0)return;
  const wetness=clamp(surfaceWetness),residual=extinguished?0:clamp(heat);
  // Out terrain is already cached by the main display. Avoid clipping and
  // walking every flame/smoke shape when this effect layer contains no marks.
  if(layer==='fire'&&residual===0&&wetness<=.005)return;
  if(layer==='smoke'&&residual===0&&clamp(smokeTail)*clamp(tailHeat)<=.001/.90)return;
  const shape=variantFor(seed),effect=Math.hypot(scale,22),smokeEffect=Math.hypot(scale,30);
  const flame=extinguished?0:smooth(.10,.78,residual*(1-.95*wetness));
  const ember=residual*(.35+.65*(1-flame)),smoke=Math.max(residual*.90,clamp(smokeTail)*clamp(tailHeat)*.90);
  const bounds=forestPatchBounds({x,y,scale,seed,layer});
  ctx.save();ctx.beginPath();ctx.rect(bounds.left,bounds.top,bounds.width,bounds.height);ctx.clip();
  ctx.translate(x+shape.dx*scale,y+shape.dy*scale);ctx.lineCap='round';ctx.lineJoin='round';
  if(layer==='all'||layer==='terrain')drawTerrain(ctx,shape,scale,wetness);
  if(layer==='fire'&&wetness>.005){ctx.save();ctx.scale(scale,scale);drawWetMarks(ctx,shape,wetness);ctx.restore();}
  if(layer==='all'||layer==='fire')drawFire(ctx,shape,scale,effect,time,flame,ember);
  if(layer==='all'||layer==='smoke')drawSmoke(ctx,shape,scale,smokeEffect,time,smoke);
  ctx.restore();
}
