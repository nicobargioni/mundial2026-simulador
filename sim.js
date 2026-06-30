/* ============================================================
   Predicción Mundial 2026 — Monte Carlo del ensamble final + paneles.
   Corre 100% en el navegador. Datos en data.js (const DATA).
   ============================================================ */
'use strict';
const T = DATA.teams, IC = DATA.intercept, RHO = DATA.rho, MX = DATA.matrix;

// Bracket (match nums) — del árbol oficial verificado.
const R32order = [75,78,79,80,85,87,86,88,81,82,83,84,73,74,76,77];

// ---------- modelo de goles (para el panel Dixon-Coles) ----------
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
// 3-way SOLO Elo (para el panel educativo de Elo)
function elo3(h,a){
  const we=1/(1+Math.pow(10,(T[a].elo-T[h].elo)/400));
  const pD=0.27*Math.exp(-Math.pow(Math.max(0,T[h].elo-T[a].elo)/400,2)*2);
  let pH=Math.max(we-pD/2,1e-4), pA=Math.max(1-we-pD/2,1e-4); const s=pH+pD+pA;
  return {pH:pH/s,pD:pD/s,pA:pA/s};
}

// ---------- Monte Carlo del torneo (usa la matriz del ensamble final) ----------
function simulateOnce(){
  const W={};
  for(const num of R32order){ const k=String(num),[t1,t2]=DATA.r32[k];
    W[k]=DATA.decided[k] ? DATA.decided[k] : (Math.random()<MX[t1][t2]?t1:t2); }
  for(const [tree] of [[DATA.R16],[DATA.QF],[DATA.SF]])
    for(const k in tree){ const [f1,f2]=tree[k]; const a=W[f1],b=W[f2]; W[k]=Math.random()<MX[a][b]?a:b; }
  const [f1,f2]=DATA.FINAL; const a=W[f1],b=W[f2];
  return Math.random()<MX[a][b]?a:b;
}
function monteCarlo(N){ const c={}; for(let i=0;i<N;i++){ const ch=simulateOnce(); c[ch]=(c[ch]||0)+1; } return c; }

/* ===================== UI ===================== */
if (typeof document !== 'undefined') {
  const $=s=>document.querySelector(s), el=(t,c)=>{const e=document.createElement(t); if(c)e.className=c; return e;};
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = p => (p*100).toFixed(1)+'%';
  $('#year').textContent='datos a jun-2026';

  const flags=Object.values(T).map(t=>t.flag);
  $('#ticker').textContent = flags.concat(flags).join('  ');

  // tarjeta de credibilidad
  const S=DATA.stats;
  $('#cred').innerHTML=`<div class="cred-head"><span class="dot"></span>¿Qué tan confiable es el modelo?</div>
    <div class="cred-row">
      <div class="stat"><b>${S.hits}<span class="den">/${S.n}</span></b><small>resultados acertados<br>(${S.acc}%)</small></div>
      <div class="stat"><b>${S.rps}</b><small>RPS<br>(error; más bajo, mejor)</small></div>
      <div class="stat"><b>${S.logloss}</b><small>log-loss</small></div>
    </div>
    <p>Medido contra los <b>${S.n} partidos del Mundial que ya se jugaron</b> y que el modelo <b>no vio</b> al
      entrenar. Acierta cerca de <b>6 de cada 10</b>: el fútbol es ruidoso por diseño, pero le gana claro al azar.</p>`;

  // ---------- PREDICCIÓN con ANIMACIÓN de Monte Carlo (corre sola al entrar) ----------
  const MEDAL=['🥇','🥈','🥉'];
  const pod=$('#podium'), counter=$('#sim-counter'), favEl=$('#sim-fav');
  const hcanvas=$('#hero-mc'), hctx=hcanvas.getContext('2d');
  function renderPodium(arr){
    pod.innerHTML='';
    arr.slice(0,3).forEach(([t,p],i)=>{
      const c=el('div','pod'+(i===0?' p1':''));
      c.innerHTML=`<span class="medal">${MEDAL[i]}</span><span class="pflag">${T[t].flag}</span>
        <span class="pname">${T[t].es}</span><span class="ppct">${fmt(p)}</span>`;
      pod.append(c);
    });
  }
  function renderBars(arr){
    const box=$('#prob-bars'); box.innerHTML=''; const max=arr[0][1];
    arr.slice(0,10).forEach(([t,p],i)=>{
      const row=el('div','barrow'+(i===0?' lead':''));
      row.innerHTML=`<div class="who"><span class="fl">${T[t].flag}</span>${T[t].es}</div>
        <div class="track"><i style="width:${(p/max*100).toFixed(1)}%"></i></div>
        <div class="pct">${fmt(p)}</div>`;
      box.append(row);
    });
  }
  function drawHero(hist){
    const w=hcanvas.width=hcanvas.clientWidth, h=hcanvas.height; hctx.clearRect(0,0,w,h);
    const top=Math.max(0.35, Math.max(...hist,0.2)*1.25);
    hctx.strokeStyle='rgba(255,255,255,.08)';
    for(let g=0;g<=2;g++){const y=h-(g/2)*(h-12)-6; hctx.beginPath();hctx.moveTo(0,y);hctx.lineTo(w,y);hctx.stroke();}
    if(hist.length<2) return;
    const gold=getComputedStyle(document.documentElement).getPropertyValue('--gold')||'#f0c24b';
    hctx.strokeStyle=gold; hctx.lineWidth=2.2; hctx.beginPath();
    hist.forEach((v,i)=>{const x=(i/(hist.length-1))*w; const y=h-(v/top)*(h-12)-6; i?hctx.lineTo(x,y):hctx.moveTo(x,y);});
    hctx.stroke();
    const lastY=h-(hist[hist.length-1]/top)*(h-12)-6;
    hctx.fillStyle=gold; hctx.beginPath(); hctx.arc(w-2,lastY,3,0,7); hctx.fill();
  }
  function animatePrediction(){
    const target=10000, batch = REDUCED?target:200;
    const count={}; let n=0, fav=null; const hist=[];
    $('#prob-bars').innerHTML=''; $('#btn-recalc').disabled=true;
    function step(){
      const b=Math.min(batch,target-n); const c=monteCarlo(b);
      for(const t in c) count[t]=(count[t]||0)+c[t]; n+=b;
      const arr=Object.entries(count).map(([t,k])=>[t,k/n]).sort((x,y)=>y[1]-x[1]);
      if(!fav) fav=arr[0][0];
      renderPodium(arr);
      counter.textContent=n.toLocaleString('es');
      const fp=(count[fav]||0)/n; hist.push(fp);
      favEl.innerHTML=`${T[fav].flag} ${T[fav].es}: <b>${fmt(fp)}</b>`;
      drawHero(hist);
      if(n<target) requestAnimationFrame(step);
      else { renderBars(arr); $('#btn-recalc').disabled=false; }
    }
    step();
  }
  $('#btn-recalc').onclick=animatePrediction;

  // ---------- panel Elo ----------
  const aliveSorted=Object.keys(T).filter(t=>t!=='South Africa').sort((a,b)=>T[b].elo-T[a].elo);
  function fillSel(sel,def){ aliveSorted.forEach(t=>{const o=el('option');o.value=t;o.textContent=T[t].flag+' '+T[t].es;sel.append(o);}); sel.value=def; }
  const eA=$('#elo-a'),eB=$('#elo-b'); fillSel(eA,'Argentina'); fillSel(eB,'Brazil');
  function renderElo(){
    const a=eA.value,b=eB.value, o=elo3(a,b);
    $('#elo-bar').innerHTML=`<span class="w-a" style="width:${o.pH*100}%">${o.pH>0.12?fmt(o.pH):''}</span>
      <span class="w-d" style="width:${o.pD*100}%">${o.pD>0.12?'X':''}</span>
      <span class="w-b" style="width:${o.pA*100}%">${o.pA>0.12?fmt(o.pA):''}</span>`;
    $('#elo-read').innerHTML=`Elo: <b>${T[a].es} ${Math.round(T[a].elo)}</b> vs <b>${T[b].es} ${Math.round(T[b].elo)}</b>.
      Gana ${T[a].es} ${fmt(o.pH)} · empate ${fmt(o.pD)} · gana ${T[b].es} ${fmt(o.pA)}.`;
  }
  eA.onchange=renderElo; eB.onchange=renderElo; renderElo();

  // ---------- panel Dixon-Coles (heatmap) ----------
  const dA=$('#dc-a'),dB=$('#dc-b'); fillSel(dA,'Spain'); fillSel(dB,'Morocco');
  function corner(txt){const c=el('div','dc-axis');c.textContent=txt;return c;}
  function renderDC(){
    const a=dA.value,b=dB.value,[lh,la]=lambdas(a,b); const G=$('#dc-grid'); G.innerHTML='';
    G.append(corner('')); for(let y=0;y<=4;y++) G.append(corner(y));
    const M=[]; let best=[0,0,0];
    for(let x=0;x<=4;x++){ M[x]=[]; for(let y=0;y<=4;y++){ let p=pois(x,lh)*pois(y,la); if(x<=1&&y<=1)p*=tau(x,y,lh,la); M[x][y]=p; if(p>best[2])best=[x,y,p]; } }
    const mx=best[2];
    for(let x=0;x<=4;x++){ G.append(corner(x));
      for(let y=0;y<=4;y++){ const c=el('div','dc-cell'+(x===y?' dc-diag':'')); const inten=M[x][y]/mx;
        c.style.background=`rgba(70,192,138,${(0.12+inten*0.88).toFixed(2)})`; c.textContent=(M[x][y]*100).toFixed(0);
        c.title=`${a} ${x}-${y} ${b}: ${(M[x][y]*100).toFixed(1)}%`; G.append(c); } }
    $('#dc-read').innerHTML=`Marcador más probable: <b>${T[a].es} ${best[0]}-${best[1]} ${T[b].es}</b>
      (${(best[2]*100).toFixed(1)}%). Las celdas <span style="color:var(--gold)">marcadas</span> son empates: Dixon-Coles
      les sube la probabilidad respecto del Poisson simple.`;
  }
  dA.onchange=renderDC; dB.onchange=renderDC; renderDC();

  // ---------- panel Monte Carlo (convergencia) ----------
  const cvs=$('#mc-canvas'), ctx=cvs.getContext('2d');
  let mcN=0, mcCount={}, mcFav=null, mcHist=[];
  function mcStep(){
    const batch=200; const c=monteCarlo(batch); for(const t in c) mcCount[t]=(mcCount[t]||0)+c[t]; mcN+=batch;
    if(!mcFav) mcFav=Object.entries(mcCount).sort((a,b)=>b[1]-a[1])[0][0];
    mcHist.push((mcCount[mcFav]||0)/mcN);
    $('#mc-count').textContent=`${mcN.toLocaleString('es')} simulaciones · ${T[mcFav].flag} ${T[mcFav].es}: ${fmt((mcCount[mcFav]||0)/mcN)}`;
    drawMC();
  }
  function drawMC(){
    const w=cvs.width=cvs.clientWidth, h=cvs.height; ctx.clearRect(0,0,w,h);
    const top=Math.max(0.4, Math.max(...mcHist,0.3)*1.2);
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

  // arrancar: animar la predicción (deja pintar el hero primero)
  setTimeout(animatePrediction, 60);
}
