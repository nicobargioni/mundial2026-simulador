/* ============================================================
   Motor de simulación (Elo + Dixon-Coles + Monte Carlo) + UI.
   Corre 100% en el navegador. Datos en data.js (const DATA).
   ============================================================ */
'use strict';
const T = DATA.teams, IC = DATA.intercept, RHO = DATA.rho;

// Orden del bracket (hojas → final), derivado del árbol oficial.
const R32order = [75,78,79,80,85,87,86,88,81,82,83,84,73,74,76,77];
const R16order = [89,90,93,94,91,92,95,96];
const QForder  = [97,98,99,100];
const SForder  = [101,102];
const FINAL_ID = 104;
const DECIDED_SCORE = { '73':[0,1] };   // Canadá 1-0 (visitante) — ya jugado
const ROUND_LABELS = ['Ronda de 32','Octavos','Cuartos','Semifinal','Final'];

// ---------- mates ----------
const FACT = [1,1,2,6,24,120,720,5040,40320,362880,3628800];
const pois = (k,l)=> Math.exp(-l)*Math.pow(l,k)/FACT[k];
function lambdas(h,a){ return [Math.exp(IC+T[h].atk+T[a].dfn), Math.exp(IC+T[a].atk+T[h].dfn)]; }
function tau(x,y,lh,la){
  if(x===0&&y===0) return 1-lh*la*RHO;
  if(x===0&&y===1) return 1+lh*RHO;
  if(x===1&&y===0) return 1+la*RHO;
  if(x===1&&y===1) return 1-RHO;
  return 1;
}
const eloWin = (h,a)=> 1/(1+Math.pow(10,(T[a].elo-T[h].elo)/400));   // P(h gana en penales ≈ Elo)

const _oc = {};
function outcome(h,a){            // {pH,pD,pA} con corrección Dixon-Coles
  const key=h+'|'+a; if(_oc[key]) return _oc[key];
  const [lh,la]=lambdas(h,a); let pH=0,pD=0,pA=0,s=0;
  for(let x=0;x<=8;x++) for(let y=0;y<=8;y++){
    let p=pois(x,lh)*pois(y,la); if(x<=1&&y<=1) p*=tau(x,y,lh,la);
    s+=p; if(x>y)pH+=p; else if(x===y)pD+=p; else pA+=p;
  }
  const o={pH:pH/s,pD:pD/s,pA:pA/s}; _oc[key]=o; return o;
}
const _adv={};
function pAdvance(h,a){           // P(h pasa de ronda) incluyendo penales
  const key=h+'|'+a; if(_adv[key]!==undefined) return _adv[key];
  const o=outcome(h,a); const v=o.pH + o.pD*eloWin(h,a); _adv[key]=v; return v;
}
function rpois(l){ if(l<=0)return 0; const L=Math.exp(-l); let k=0,p=1; do{k++;p*=Math.random();}while(p>L); return k-1; }
function sampleScore(h,a){        // marcador muestreado (Dixon-Coles por rechazo)
  const [lh,la]=lambdas(h,a);
  for(let it=0;it<24;it++){ const x=rpois(lh),y=rpois(la); const t=(x<=1&&y<=1)?tau(x,y,lh,la):1; if(Math.random()<t/1.3) return [x,y]; }
  return [rpois(lh),rpois(la)];
}
function resolve(t1,t2,withScore){
  if(withScore){
    let [s1,s2]=sampleScore(t1,t2); let pens=false, win;
    if(s1>s2) win=t1; else if(s2>s1) win=t2; else { pens=true; win=Math.random()<eloWin(t1,t2)?t1:t2; }
    return {a:t1,b:t2,sa:s1,sb:s2,winner:win,pens};
  }
  return {a:t1,b:t2,winner: Math.random()<pAdvance(t1,t2)?t1:t2};
}
function simulateOnce(withScore){
  const W={}, res={};
  for(const num of R32order){
    const k=String(num), [t1,t2]=DATA.r32[k];
    if(DATA.decided[k]){ W[k]=DATA.decided[k]; const sc=DECIDED_SCORE[k]; res[k]={a:t1,b:t2,sa:sc[0],sb:sc[1],winner:W[k],pens:false}; }
    else { res[k]=resolve(t1,t2,withScore); W[k]=res[k].winner; }
  }
  for(const [order,tree] of [[R16order,DATA.R16],[QForder,DATA.QF],[SForder,DATA.SF]])
    for(const num of order){ const k=String(num),[f1,f2]=tree[k]; res[k]=resolve(W[f1],W[f2],withScore); W[k]=res[k].winner; }
  const [f1,f2]=DATA.FINAL; res[FINAL_ID]=resolve(W[f1],W[f2],withScore);
  return {res, champion:res[FINAL_ID].winner};
}
function monteCarlo(N){
  const c={}; for(let i=0;i<N;i++){ const ch=simulateOnce(false).champion; c[ch]=(c[ch]||0)+1; }
  return c;
}

/* ===================== UI (solo en navegador) ===================== */
if (typeof document !== 'undefined') {
  const $=s=>document.querySelector(s), el=(t,c)=>{const e=document.createElement(t); if(c)e.className=c; return e;};
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = ms => new Promise(r=>setTimeout(r, REDUCED?0:ms));
  const fmtPct = p => (p*100).toFixed(1)+'%';
  document.getElementById('year').textContent='datos a jun-2026';

  // flags ticker
  const flags=Object.values(T).map(t=>t.flag);
  $('#ticker').textContent = flags.concat(flags).join('  ');

  // ---------- construir bracket ----------
  const rounds=[R32order,R16order,QForder,SForder,[FINAL_ID]];
  const trees={R16:DATA.R16,QF:DATA.QF,SF:DATA.SF};
  const matchEl={};                 // num -> {slots:[{root,fl,nm,sc}], el}
  const childOf={};                 // feederNum -> {m, slot}
  for(const [order,tree] of [[R16order,DATA.R16],[QForder,DATA.QF],[SForder,DATA.SF]])
    for(const num of order){ const [f1,f2]=tree[String(num)]; childOf[f1]={m:num,slot:0}; childOf[f2]={m:num,slot:1}; }
  childOf[DATA.FINAL[0]]={m:FINAL_ID,slot:0}; childOf[DATA.FINAL[1]]={m:FINAL_ID,slot:1};

  function slotDOM(team){
    const s=el('div','slot'); const fl=el('span','fl'), nm=el('span','nm'), sc=el('span','sc');
    if(team){ fl.textContent=T[team].flag; nm.textContent=T[team].es; sc.textContent='–'; }
    else { s.classList.add('tbd'); nm.textContent='—'; sc.textContent=''; }
    s.append(fl,nm,sc); return {root:s,fl,nm,sc,team};
  }
  const roundsBox=$('#rounds');
  rounds.forEach((order,ri)=>{
    const col=el('div','round'+(ri===4?' r-final':'')); const lab=el('div','round-label'); lab.textContent=ROUND_LABELS[ri]; col.append(lab);
    order.forEach(num=>{
      const k=String(num); const card=el('div','match'); if(ri>0)card.classList.add('pending');
      let t1=null,t2=null;
      if(ri===0){ [t1,t2]=DATA.r32[k]; }
      const s1=slotDOM(t1), s2=slotDOM(t2); card.append(s1.root,s2.root);
      matchEl[num]={el:card,slots:[s1,s2]};
      col.append(card);
    });
    roundsBox.append(col);
  });
  // M73 ya jugado: pintarlo resuelto y propagar Canadá
  paintDecided();
  function paintDecided(){
    for(const k in DATA.decided){
      const m=matchEl[k]; const sc=DECIDED_SCORE[k]; m.slots[0].sc.textContent=sc[0]; m.slots[1].sc.textContent=sc[1];
      const wi = sc[0]>sc[1]?0:1; m.slots[wi].root.classList.add('win'); m.el.classList.remove('pending');
      propagate(Number(k), DATA.decided[k]);
    }
  }
  function fillSlot(num,slot,team){
    const s=matchEl[num].slots[slot]; s.team=team; s.root.classList.remove('tbd');
    s.fl.textContent=T[team].flag; s.nm.textContent=T[team].es; s.sc.textContent='–';
  }
  function propagate(num,winner){ const c=childOf[num]; if(c) fillSlot(c.m,c.slot,winner); }

  function resetBracket(){
    for(const num in matchEl){ const m=matchEl[num];
      m.el.classList.remove('playing'); if(Number(num) in {})continue;
    }
    // re-render limpio es más simple: recargar slots
    rounds.forEach((order,ri)=>order.forEach(num=>{
      const m=matchEl[num]; m.el.classList.toggle('pending', ri>0);
      m.slots.forEach((s,i)=>{ s.root.classList.remove('win');
        let team = ri===0 ? DATA.r32[String(num)][i] : null;
        if(team){ s.team=team; s.root.classList.remove('tbd'); s.fl.textContent=T[team].flag; s.nm.textContent=T[team].es; s.sc.textContent='–'; }
        else { s.team=null; s.root.classList.add('tbd'); s.fl.textContent=''; s.nm.textContent='—'; s.sc.textContent=''; }
        const pen=s.root.querySelector('.pen'); if(pen)pen.remove();
      });
    }));
    paintDecided();
  }

  // ---------- animación de una simulación ----------
  let running=false, skip=false;
  const btnSim=$('#btn-sim'), btnMc=$('#btn-mc'), btnSkip=$('#btn-skip'), champBox=$('#champion');

  async function reveal(){
    if(running) return; running=true; skip=false; champBox.hidden=true;
    btnSim.disabled=true; btnMc.disabled=true; btnSkip.hidden=false;
    resetBracket();
    const {res,champion}=simulateOnce(true);
    const seq=[[R32order,0],[R16order,1],[QForder,2],[SForder,3],[[FINAL_ID],4]];
    for(const [order,ri] of seq){
      for(const num of order){
        const k=String(num); if(DATA.decided[k]) continue;
        const m=matchEl[num], r=res[k];
        // asegurar que los equipos estén puestos (vienen propagados)
        if(!m.slots[0].team) fillSlot(num,0,r.a); if(!m.slots[1].team) fillSlot(num,1,r.b);
        m.el.classList.remove('pending'); m.el.classList.add('playing');
        if(!skip) await sleep(ri>=3?620:ri===2?360:200);
        m.slots[0].sc.textContent=r.sa; m.slots[1].sc.textContent=r.sb;
        const wi = r.winner===m.slots[0].team?0:1;
        m.slots[wi].root.classList.add('win');
        if(r.pens){ const p=el('span','pen'); p.textContent='(pen)'; m.slots[wi].nm.after(p); }
        m.el.classList.remove('playing');
        propagate(num, r.winner);
        if(!skip) await sleep(ri>=3?260:80);
      }
    }
    showChampion(champion); fireConfetti();
    btnSim.disabled=false; btnMc.disabled=false; btnSkip.hidden=true; running=false;
  }
  function showChampion(team){
    champBox.innerHTML=`<span class="cup">🏆</span><span class="cflag">${T[team].flag}</span>
      <span class="ctxt"><small>Campeón de esta simulación</small><b>${T[team].es}</b></span>`;
    champBox.hidden=false;
  }
  btnSim.onclick=reveal;
  btnSkip.onclick=()=>{skip=true;};

  // ---------- 10.000 simulaciones → probabilidades ----------
  btnMc.onclick=()=>{
    if(running) return;
    btnMc.disabled=true; btnMc.textContent='Simulando…';
    setTimeout(()=>{
      const N=10000, c=monteCarlo(N);
      const arr=Object.entries(c).map(([t,n])=>[t,n/N]).sort((a,b)=>b[1]-a[1]).slice(0,10);
      const box=$('#prob-bars'); box.innerHTML=''; const max=arr[0][1];
      arr.forEach(([t,p],i)=>{
        const row=el('div','barrow'+(i===0?' lead':''));
        row.innerHTML=`<div class="who"><span class="fl">${T[t].flag}</span>${T[t].es}</div>
          <div class="track"><i style="width:${(p/max*100).toFixed(1)}%"></i></div>
          <div class="pct">${fmtPct(p)}</div>`;
        box.append(row);
      });
      $('#prob-sub').textContent=`· ${N.toLocaleString('es')} simulaciones`;
      $('#prob-section').hidden=false;
      $('#prob-section').scrollIntoView({behavior:REDUCED?'auto':'smooth',block:'start'});
      btnMc.disabled=false; btnMc.textContent='📊 Tirar 10.000 veces';
    },30);
  };

  // ---------- panel Elo ----------
  const aliveSorted=Object.keys(T).filter(t=>!(t==='South Africa')).sort((a,b)=>T[b].elo-T[a].elo);
  function fillSel(sel,def){ aliveSorted.forEach(t=>{const o=el('option');o.value=t;o.textContent=T[t].flag+' '+T[t].es;sel.append(o);}); sel.value=def; }
  const eA=$('#elo-a'),eB=$('#elo-b'); fillSel(eA,'Argentina'); fillSel(eB,'Brazil');
  function renderElo(){
    const a=eA.value,b=eB.value, o=outcome(a,b);
    $('#elo-bar').innerHTML=`<span class="w-a" style="width:${o.pH*100}%">${o.pH>0.12?fmtPct(o.pH):''}</span>
      <span class="w-d" style="width:${o.pD*100}%">${o.pD>0.12?'X':''}</span>
      <span class="w-b" style="width:${o.pA*100}%">${o.pA>0.12?fmtPct(o.pA):''}</span>`;
    $('#elo-read').innerHTML=`Elo: <b>${T[a].es} ${Math.round(T[a].elo)}</b> vs <b>${T[b].es} ${Math.round(T[b].elo)}</b>.
      Gana ${T[a].es} ${fmtPct(o.pH)} · empate ${fmtPct(o.pD)} · gana ${T[b].es} ${fmtPct(o.pA)}.`;
  }
  eA.onchange=renderElo; eB.onchange=renderElo; renderElo();

  // ---------- panel Dixon-Coles (heatmap) ----------
  const dA=$('#dc-a'),dB=$('#dc-b'); fillSel(dA,'Spain'); fillSel(dB,'Morocco');
  function renderDC(){
    const a=dA.value,b=dB.value,[lh,la]=lambdas(a,b); const G=$('#dc-grid'); G.innerHTML='';
    G.append(corner('')); for(let y=0;y<=4;y++) G.append(corner(y));   // header fila: goles de B
    let best=[0,0,0];
    const M=[];
    for(let x=0;x<=4;x++){ M[x]=[]; for(let y=0;y<=4;y++){ let p=pois(x,lh)*pois(y,la); if(x<=1&&y<=1)p*=tau(x,y,lh,la); M[x][y]=p; if(p>best[2])best=[x,y,p]; } }
    let mx=best[2];
    for(let x=0;x<=4;x++){ G.append(corner(x));
      for(let y=0;y<=4;y++){ const c=el('div','dc-cell'+(x===y?' dc-diag':'')); const inten=M[x][y]/mx;
        c.style.background=`rgba(70,192,138,${(0.12+inten*0.88).toFixed(2)})`; c.textContent=(M[x][y]*100).toFixed(0);
        c.title=`${a} ${x}-${y} ${b}: ${(M[x][y]*100).toFixed(1)}%`; G.append(c); } }
    $('#dc-read').innerHTML=`Marcador más probable: <b>${T[a].es} ${best[0]}-${best[1]} ${T[b].es}</b>
      (${(best[2]*100).toFixed(1)}%). Las celdas <span style="color:var(--gold)">marcadas</span> son empates: Dixon-Coles
      les sube la probabilidad respecto del Poisson simple.`;
    function corner(txt){const c=el('div','dc-axis');c.textContent=txt;return c;}
  }
  dA.onchange=renderDC; dB.onchange=renderDC; renderDC();

  // ---------- panel Monte Carlo (convergencia) ----------
  const cvs=$('#mc-canvas'), ctx=cvs.getContext('2d');
  let mcN=0, mcCount={}, mcFav=null, mcHist=[];
  function mcStep(){
    const batch=200; const c=monteCarlo(batch); for(const t in c) mcCount[t]=(mcCount[t]||0)+c[t]; mcN+=batch;
    if(!mcFav) mcFav=Object.entries(mcCount).sort((a,b)=>b[1]-a[1])[0][0];
    mcHist.push((mcCount[mcFav]||0)/mcN);
    $('#mc-count').textContent=`${mcN.toLocaleString('es')} simulaciones · ${T[mcFav].flag} ${T[mcFav].es}: ${fmtPct((mcCount[mcFav]||0)/mcN)}`;
    drawMC();
  }
  function drawMC(){
    const w=cvs.width=cvs.clientWidth, h=cvs.height; ctx.clearRect(0,0,w,h);
    const top=Math.max(0.4, Math.max(...mcHist,0.3)*1.2);
    // grilla
    ctx.strokeStyle='rgba(255,255,255,.07)'; ctx.lineWidth=1;
    for(let g=0;g<=4;g++){const y=h-(g/4)*h*0.86-8; ctx.beginPath();ctx.moveTo(34,y);ctx.lineTo(w-6,y);ctx.stroke();
      ctx.fillStyle='#6f8a7e';ctx.font='10px Inter';ctx.fillText(((g/4)*top*100).toFixed(0)+'%',4,y+3);}
    if(mcHist.length<2){ctx.fillStyle='#6f8a7e';ctx.font='12px Inter';ctx.fillText('Tocá "+200 simulaciones"',44,h/2);return;}
    ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--gold')||'#f0c24b';
    ctx.lineWidth=2.4; ctx.beginPath();
    mcHist.forEach((v,i)=>{const x=34+(i/(mcHist.length-1))*(w-40); const y=h-(v/top)*h*0.86-8; i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.stroke();
  }
  $('#mc-step').onclick=mcStep;
  $('#mc-reset').onclick=()=>{mcN=0;mcCount={};mcFav=null;mcHist=[];$('#mc-count').textContent='0 simulaciones';drawMC();};
  drawMC();

  // ---------- confeti ----------
  const cc=$('#confetti'), cx=cc.getContext('2d'); let parts=[],raf=null;
  function fireConfetti(){
    if(REDUCED) return;
    cc.width=innerWidth; cc.height=innerHeight;
    const cols=['#f0c24b','#46c08a','#ffffff','#7B68A6','#e0664a'];
    parts=Array.from({length:160},()=>({x:innerWidth/2+(Math.random()-.5)*200,y:innerHeight*0.28,
      vx:(Math.random()-.5)*10,vy:Math.random()*-9-3,g:0.28+Math.random()*0.15,
      s:5+Math.random()*6,c:cols[(Math.random()*cols.length)|0],r:Math.random()*6,vr:(Math.random()-.5)*0.4,life:0}));
    if(raf)cancelAnimationFrame(raf); tick();
  }
  function tick(){
    cx.clearRect(0,0,cc.width,cc.height); let alive=false;
    for(const p of parts){ p.life++; p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.r+=p.vr;
      if(p.y<cc.height+20){alive=true;} cx.save(); cx.translate(p.x,p.y); cx.rotate(p.r);
      cx.fillStyle=p.c; cx.fillRect(-p.s/2,-p.s/2,p.s,p.s*0.6); cx.restore(); }
    if(alive) raf=requestAnimationFrame(tick); else cx.clearRect(0,0,cc.width,cc.height);
  }
}
