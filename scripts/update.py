"""
Auto-actualización del predictor Mundial 2026.
Baja los resultados más nuevos, reentrena el ensamble, BLOQUEA los partidos ya jugados
(de cualquier ronda) y simula solo lo que falta -> reescribe ../data.js.
Pensado para correr en GitHub Actions (cron). Idempotente.
"""
import os, sys, math, json, urllib.request, warnings, datetime as dt
from collections import defaultdict
import numpy as np, pandas as pd
from scipy.optimize import minimize_scalar
import scipy.sparse as sp
from sklearn.linear_model import LogisticRegression, PoissonRegressor
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import log_loss, accuracy_score
import xgboost as xgb
from bracket import R16, QF, SF, FINAL, build_bracket
warnings.filterwarnings('ignore')

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '..', 'data.js')
RESULTS_URL   = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
SHOOTOUTS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/shootouts.csv"
REF=pd.Timestamp('2026-06-11'); VAL0=pd.Timestamp('2025-06-10'); GROUP_END=pd.Timestamp('2026-06-27')
HALFLIFE=2.5; KSCALE=0.4; HFA=70.0

def fetch(url):
    req=urllib.request.Request(url, headers={'User-Agent':'mundial2026-updater'})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read().decode('utf-8')

# ---------- datos ----------
import io
df=pd.read_csv(io.StringIO(fetch(RESULTS_URL)))
try: shoot=pd.read_csv(io.StringIO(fetch(SHOOTOUTS_URL)))
except Exception: shoot=pd.DataFrame(columns=['date','home_team','away_team','winner'])
df['date']=pd.to_datetime(df['date']); df=df.sort_values('date').reset_index(drop=True)
played=df[df.home_score.notna()].copy()
played['home_score']=played.home_score.astype(int); played['away_score']=played.away_score.astype(int)
played['neutral_i']=played.neutral.map({True:1,False:0,'TRUE':1,'FALSE':0}).fillna(0).astype(int)
played['y']=np.where(played.home_score>played.away_score,0,np.where(played.home_score==played.away_score,1,2))
wc=df[(df.tournament=='FIFA World Cup') & (df.date.dt.year==2026)].copy()
ko=wc[wc.date>GROUP_END].sort_values('date')                 # knockout (R32 en adelante)
r32=[(r.home_team,r.away_team) for r in ko.head(16).itertuples()]   # primeros 16 = ronda de 32

# ---------- Elo (display K×1, modelo K×0.4) ----------
def k_base(t):
    t=str(t).lower()
    return (60 if t=='fifa world cup' else 20 if 'friendly' in t else
            50 if any(x in t for x in ['uefa euro','copa am','african cup','afc asian','gold cup','confederations']) else
            40 if ('qualif' in t or 'nations league' in t) else 30)
def elo_run(kscale):
    elo=defaultdict(lambda:1500.0); he=[];ae=[]
    for r in played.itertuples():
        eh,ea=elo[r.home_team],elo[r.away_team]; adv=0 if r.neutral else HFA
        exp=1/(1+10**((ea-eh-adv)/400)); he.append(eh);ae.append(ea)
        gd=abs(r.home_score-r.away_score); sh=1.0 if r.home_score>r.away_score else(0.0 if r.home_score<r.away_score else .5)
        mov=np.log(gd+1)*(2.2/(abs(eh-ea+adv)*.001+2.2)); d=k_base(r.tournament)*kscale*mov*(sh-exp)
        elo[r.home_team]+=d; elo[r.away_team]-=d
    return np.array(he),np.array(ae),dict(elo)
HE1,AE1,ELO_DISP=elo_run(1.0); HE,AE,ELO=elo_run(KSCALE)
def elo_p3(eh,ea,neutral):
    adv=0 if neutral else HFA; we=1/(1+10**((ea-eh-adv)/400)); pD=0.27*np.exp(-(max(0,eh-ea+adv)/400)**2*2)
    pH,pA=max(we-pD/2,1e-4),max(1-we-pD/2,1e-4); s=pH+pD+pA; return np.array([pH/s,pD/s,pA/s])

# ---------- forma ----------
last=defaultdict(list)
def form(t):
    h=last[t][:5]; return (0.0,1.0) if not h else (np.mean([x[0] for x in h]),np.mean([x[1] for x in h]))
hg,hp,ag,ap=[],[],[],[]
for r in played.itertuples():
    g,p=form(r.home_team);hg.append(g);hp.append(p); g,p=form(r.away_team);ag.append(g);ap.append(p)
    gd=r.home_score-r.away_score
    last[r.home_team].insert(0,(gd,3 if gd>0 else(1 if gd==0 else 0))); last[r.away_team].insert(0,(-gd,3 if gd<0 else(1 if gd==0 else 0)))
played['hf_gd']=hg;played['hf_pt']=hp;played['af_gd']=ag;played['af_pt']=ap
CUR_FORM={t:form(t) for t in ELO}
def feats_rows(d):
    return pd.DataFrame({'elo_diff':HE[d.index]-AE[d.index],'abs_elo':(HE[d.index]+AE[d.index])/2-1500,
        'hadv':(1-d.neutral_i)*1.0,'f_gd':d.hf_gd-d.af_gd,'f_pt':d.hf_pt-d.af_pt})

# ---------- ensamble (train < Mundial) ----------
tr=played[(played.date>='2005-01-01')&(played.date<REF)].copy()
age=(REF-tr.date).dt.days.clip(lower=0).values; W=0.5**(age/(HALFLIFE*365.0))
Xtr=feats_rows(tr); ytr=tr.y.values; sc=StandardScaler().fit(Xtr); Xtr_s=sc.transform(Xtr)
LR=LogisticRegression(max_iter=2000).fit(Xtr_s,ytr,sample_weight=W)
RF=RandomForestClassifier(n_estimators=400,max_depth=8,min_samples_leaf=20,random_state=42,n_jobs=-1).fit(Xtr,ytr)
XG=xgb.XGBClassifier(n_estimators=300,max_depth=4,learning_rate=0.05,subsample=0.8,colsample_bytree=0.8,
    objective='multi:softprob',num_class=3,eval_metric='mlogloss',random_state=42).fit(Xtr,ytr)
NN=MLPClassifier(hidden_layer_sizes=(32,16),max_iter=800,alpha=1e-3,random_state=42).fit(Xtr_s,ytr)
ti={t:i for i,t in enumerate(sorted(set(tr.home_team)|set(tr.away_team)))}; n=len(ti)
A=[];D=[];H=[];Y=[];Wp=[]
for r,w in zip(tr.itertuples(),W):
    if r.home_team in ti and r.away_team in ti:
        A+=[ti[r.home_team],ti[r.away_team]];D+=[ti[r.away_team],ti[r.home_team]];H+=[1,0];Y+=[r.home_score,r.away_score];Wp+=[w,w]
att=sp.csr_matrix((np.ones(len(A)),(np.arange(len(A)),A)),shape=(len(A),n))
dfn=sp.csr_matrix((np.ones(len(D)),(np.arange(len(D)),D)),shape=(len(D),n))
Xp=sp.hstack([att,dfn,sp.csr_matrix(np.array(H).reshape(-1,1))]).tocsr()
g=PoissonRegressor(alpha=1e-3,max_iter=600).fit(Xp,np.array(Y),sample_weight=np.array(Wp))
ATT,DEF,HC,IC=g.coef_[:n],g.coef_[n:2*n],g.coef_[2*n],g.intercept_
def lam(h,a):
    if h not in ti or a not in ti: return None
    return math.exp(IC+ATT[ti[h]]+DEF[ti[a]]), math.exp(IC+ATT[ti[a]]+DEF[ti[h]])
def tau(x,y,lh,la,rho): return (1-lh*la*rho) if (x,y)==(0,0) else (1+lh*rho) if (x,y)==(0,1) else (1+la*rho) if (x,y)==(1,0) else (1-rho) if (x,y)==(1,1) else 1.0
low=[(r.home_score,r.away_score,*lam(r.home_team,r.away_team),w) for r,w in zip(tr.itertuples(),W)
     if r.home_team in ti and r.away_team in ti and r.home_score<=1 and r.away_score<=1]
def nll(rho):
    s=0
    for x,y,lh,la,w in low:
        t=tau(x,y,lh,la,rho)
        if t<=0: return 1e9
        s+=w*math.log(t)
    return -s
RHO=minimize_scalar(nll,bounds=(-0.3,0.3),method='bounded').x
def pois3(h,a):
    L=lam(h,a)
    if L is None: return None
    lh,la=L; ph=[math.exp(-lh)*lh**k/math.factorial(k) for k in range(11)]; pa=[math.exp(-la)*la**k/math.factorial(k) for k in range(11)]
    M=np.outer(ph,pa)
    for c in [(0,0),(0,1),(1,0),(1,1)]: M[c]*=tau(c[0],c[1],lh,la,RHO)
    M/=M.sum(); return np.array([np.tril(M,-1).sum(),np.trace(M),np.triu(M,1).sum()])
def ens(elo_h,elo_a,fgd,fpt,h,a,neutral=True):
    pe=elo_p3(elo_h,elo_a,neutral); pp=pois3(h,a); pp=pp if pp is not None else pe
    X=pd.DataFrame([{'elo_diff':elo_h-elo_a,'abs_elo':(elo_h+elo_a)/2-1500,'hadv':0.0 if neutral else 1.0,'f_gd':fgd,'f_pt':fpt}])
    Xs=sc.transform(X)
    return np.mean([pe,pp,LR.predict_proba(Xs)[0],RF.predict_proba(X)[0],XG.predict_proba(X)[0],NN.predict_proba(Xs)[0]],axis=0)
def apply_T(p,T): q=np.clip(p,1e-9,1)**(1.0/T); return q/q.sum()

# calibración + stats sobre los partidos del Mundial ya jugados (out-of-sample)
val=played[(played.date>=VAL0)&(played.date<REF)]
Pval=np.array([ens(HE[r.Index],AE[r.Index],r.hf_gd-r.af_gd,r.hf_pt-r.af_pt,r.home_team,r.away_team,not bool(r.neutral_i)) for r in val.itertuples()])
T_OPT=minimize_scalar(lambda T:log_loss(val.y.values,np.array([apply_T(p,T) for p in Pval]),labels=[0,1,2]),bounds=(0.5,3.0),method='bounded').x
test=played[(played.tournament=='FIFA World Cup')&(played.date>=REF)]
def rps(P,y):
    O=np.zeros((len(y),3));O[np.arange(len(y)),y]=1; cp=np.cumsum(P,1);co=np.cumsum(O,1); return float(np.mean(np.sum((cp[:,:2]-co[:,:2])**2,1)/2))
if len(test):
    Pte=np.array([apply_T(ens(HE[r.Index],AE[r.Index],r.hf_gd-r.af_gd,r.hf_pt-r.af_pt,r.home_team,r.away_team,not bool(r.neutral_i)),T_OPT) for r in test.itertuples()])
    yte=test.y.values; hits=int((Pte.argmax(1)==yte).sum())
    STATS=dict(n=int(len(yte)),hits=hits,acc=round(hits/len(yte)*100,1),rps=round(rps(Pte,yte),3),
               logloss=round(float(log_loss(yte,Pte,labels=[0,1,2])),3))
else:
    STATS=dict(n=0,hits=0,acc=0,rps=0,logloss=0)

# ---------- bracket + LOCKS (partidos ya jugados de cualquier ronda) ----------
grp_df=played[(played.tournament=='FIFA World Cup')&(played.date>=REF)&(played.date<=GROUP_END)]
_,ASSIGN=build_bracket(grp_df, r32)
ko_played=played[(played.tournament=='FIFA World Cup')&(played.date>GROUP_END)]
def winner_played(a,b):
    sub=ko_played[((ko_played.home_team==a)&(ko_played.away_team==b))|((ko_played.home_team==b)&(ko_played.away_team==a))]
    if not len(sub): return None
    r=sub.iloc[0]
    if r.home_score>r.away_score: return r.home_team
    if r.away_score>r.home_score: return r.away_team
    sh=shoot[((shoot.home_team==a)&(shoot.away_team==b))|((shoot.home_team==b)&(shoot.away_team==a))]
    if len(sh) and pd.notna(sh.iloc[0].get('winner')): return sh.iloc[0]['winner']
    return a if ELO.get(a,1500)>=ELO.get(b,1500) else b   # fallback (raro): mejor Elo
LOCK={}  # match_num -> ganador
for m,(a,b) in ASSIGN.items():
    w=winner_played(a,b);
    if w: LOCK[str(m)]=w
def part(m):  # participantes de un match_num según ASSIGN/tree y locks
    m=int(m)
    if m in ASSIGN: return ASSIGN[m]
    for tree in (R16,QF,SF):
        if m in tree:
            f1,f2=tree[m]; return (LOCK.get(str(f1)), LOCK.get(str(f2)))
    if m==104: return (LOCK.get(str(FINAL[0])), LOCK.get(str(FINAL[1])))
    return (None,None)
for tree in (R16,QF,SF):
    for m in tree:
        a,b=part(m)
        if a and b:
            w=winner_played(a,b)
            if w: LOCK[str(m)]=w
fa,fb=part(104)
if fa and fb:
    w=winner_played(fa,fb)
    if w: LOCK['104']=w

# ---------- MATRIZ par-a-par (ensamble calibrado, neutral) ----------
alive=sorted(set([t for ab in ASSIGN.values() for t in ab]))
def eloPen(h,a): return 1/(1+10**((ELO[a]-ELO[h])/400))
MATRIX={}
for h in alive:
    MATRIX[h]={}; fh=CUR_FORM.get(h,(0,1))
    for a in alive:
        if h==a: continue
        fa2=CUR_FORM.get(a,(0,1))
        p3=apply_T(ens(ELO[h],ELO[a],fh[0]-fa2[0],fh[1]-fa2[1],h,a,True),T_OPT)
        MATRIX[h][a]=round(float(p3[0]+p3[1]*eloPen(h,a)),4)

# ---------- escribir data.js ----------
ES={'Canada':'Canadá','Brazil':'Brasil','Japan':'Japón','Germany':'Alemania','Paraguay':'Paraguay','Netherlands':'Países Bajos','Morocco':'Marruecos','Ivory Coast':'Costa de Marfil','Norway':'Noruega','France':'Francia','Sweden':'Suecia','Mexico':'México','Ecuador':'Ecuador','England':'Inglaterra','DR Congo':'RD Congo','Belgium':'Bélgica','Senegal':'Senegal','United States':'EE.UU.','Bosnia and Herzegovina':'Bosnia','Spain':'España','Austria':'Austria','Portugal':'Portugal','Croatia':'Croacia','Switzerland':'Suiza','Algeria':'Argelia','Australia':'Australia','Egypt':'Egipto','Argentina':'Argentina','Cape Verde':'Cabo Verde','Colombia':'Colombia','Ghana':'Ghana','South Africa':'Sudáfrica'}
FLAG={'Canada':'🇨🇦','Brazil':'🇧🇷','Japan':'🇯🇵','Germany':'🇩🇪','Paraguay':'🇵🇾','Netherlands':'🇳🇱','Morocco':'🇲🇦','Ivory Coast':'🇨🇮','Norway':'🇳🇴','France':'🇫🇷','Sweden':'🇸🇪','Mexico':'🇲🇽','Ecuador':'🇪🇨','England':'🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f','DR Congo':'🇨🇩','Belgium':'🇧🇪','Senegal':'🇸🇳','United States':'🇺🇸','Bosnia and Herzegovina':'🇧🇦','Spain':'🇪🇸','Austria':'🇦🇹','Portugal':'🇵🇹','Croatia':'🇭🇷','Switzerland':'🇨🇭','Algeria':'🇩🇿','Australia':'🇦🇺','Egypt':'🇪🇬','Argentina':'🇦🇷','Cape Verde':'🇨🇻','Colombia':'🇨🇴','Ghana':'🇬🇭','South Africa':'🇿🇦'}
teams={t:dict(es=ES.get(t,t),flag=FLAG.get(t,'🏳️'),elo=round(ELO_DISP[t],1),
              atk=round(ATT[ti[t]],4) if t in ti else 0.0,dfn=round(DEF[ti[t]],4) if t in ti else 0.0) for t in alive}
data=dict(intercept=round(IC,4),rho=round(RHO,4),T=round(T_OPT,3),
          updated=dt.datetime.utcnow().strftime('%Y-%m-%d'),
          teams=teams, r32={str(m):list(v) for m,v in ASSIGN.items()}, decided=LOCK,
          R16={str(k):list(v) for k,v in R16.items()}, QF={str(k):list(v) for k,v in QF.items()},
          SF={str(k):list(v) for k,v in SF.items()}, FINAL=list(FINAL), matrix=MATRIX, stats=STATS)
with open(OUT,'w',encoding='utf-8') as f:
    f.write('// Datos: ensamble final calibrado (Elo K×0.4 + Dixon-Coles + ML). Auto-actualizado por scripts/update.py\n')
    f.write('// matrix[a][b]=P(a pasa vs b); decided[matchNum]=ganador ya jugado; stats=validación out-of-sample.\n')
    f.write('const DATA = '+json.dumps(data,ensure_ascii=False)+';\n')
print(f"OK -> data.js | jugados KO bloqueados: {len(LOCK)} | stats {STATS} | T {round(T_OPT,3)}")
