"use strict";
/* ============================================================
   ゴットファイブ！ エンジン（got5_core.js）
   DOMに触らない純ロジック部。ソロ版・（将来の）サーバー版・
   nodeテストの唯一の正。ルールは ルール仕様.md を参照。
   ============================================================ */

/* ---------- 乱数（シード固定でテスト再現可） ---------- */
let RNG = mulberry32(20260831);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function setSeed(s){RNG=mulberry32(s|0);}
function rnd(n){return Math.floor(RNG()*n);}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=rnd(i+1);const t=a[i];a[i]=a[j];a[j]=t;}return a;}
function pick(a){return a[rnd(a.length)];}

/* ---------- タイル定義（独自仕様：ルール仕様.md） ---------- */
const COLORS=['red','blue','yellow','green','purple'];
const COLOR_JP={red:'赤',blue:'青',yellow:'黄',green:'緑',purple:'紫'};
function colorOf(n){return COLORS[(n-1)%5];}   /* 1=赤 2=青 3=黄 4=緑 5=紫 の循環 */
/* ドット＝各色の小さい数字から1→2→3の繰り返し（赤なら1=●,6=●●,11=●●●,16=●,…）
   ＝1〜5:● 6〜10:●● 11〜15:●●● 16〜20:● …（15ごとの循環） */
function dotsOf(n){return (Math.floor((n-1)/5)%3)+1;}

/* ---------- ゲーム生成 ---------- */
function newGame(opts){
  opts=opts||{};
  if(opts.seed!=null)setSeed(opts.seed);
  const defs=opts.players||[{name:'あなた',ai:false},{name:'AI 1',ai:true}];
  if(defs.length<2||defs.length>4)throw new Error('players 2-4');
  const byColor=COLORS.map(function(c){
    const a=[];for(let n=1;n<=60;n++)if(colorOf(n)===c)a.push(n);
    return shuffle(a);
  });
  const players=defs.map(function(d){
    return {name:d.name,ai:!!d.ai,level:d.level||'normal',hand:[],alive:true,revealed:false};
  });
  players.forEach(function(p){
    p.hand=byColor.map(function(a){return a.pop();}).sort(function(x,y){return x-y;});
  });
  const rest=shuffle([].concat.apply([],byColor));
  const field=rest.map(function(n){return {n:n,up:false,used:false};});
  for(let i=0;i<5&&i<field.length;i++)field[i].up=true; /* 開始時に5枚おもて向き */
  return {
    players:players,
    field:field,
    lastFlip:null,                     /* このターンにめくった場のindex（ターンが移るとnull） */
    turn:0, phase:'flip',              /* flip → ask → (endTurn) / over */
    qa:players.map(function(){return [];}),  /* 各プレイヤーが受けた回答（公開情報） */
    log:[{t:'start',np:players.length}],
    winner:null
  };
}

/* ---------- 回答の計算 ---------- */
function posAnswer(hand,t){let k=0;for(let i=0;i<5;i++)if(hand[i]<t)k++;return k;}
function dotAnswer(hand,slot,t){return dotsOf(hand[slot])===dotsOf(t);}

/* ---------- 手番の進行 ---------- */
function aliveCount(G){return G.players.filter(function(p){return p.alive;}).length;}
function hasFaceDown(G){return G.field.some(function(f){return !f.up;});}
function endTurn(G){
  if(G.phase==='over')return;
  let n=G.turn;
  do{n=(n+1)%G.players.length;}while(!G.players[n].alive);
  G.turn=n;
  G.lastFlip=null;
  G.phase=hasFaceDown(G)?'flip':'ask';
}

/* ---------- アクション（不正ならthrow・UI側で事前検証する） ---------- */
function actFlip(G,idx){
  if(G.phase!=='flip')throw new Error('phase');
  const f=G.field[idx];
  if(!f||f.up)throw new Error('bad flip');
  f.up=true;
  G.lastFlip=idx;
  G.log.push({t:'flip',p:G.turn,n:f.n});
  G.phase='ask';
}
function faceUpTile(G,idx){
  const f=G.field[idx];
  if(!f||!f.up||f.used)throw new Error('not face-up');
  return f.n;
}
function actAskPos(G,idx){
  if(G.phase!=='ask')throw new Error('phase');
  const t=faceUpTile(G,idx), pi=G.turn;
  G.field[idx].used=true; /* 質問に使ったタイルは場から取り除く（公開情報のまま） */
  const ans=posAnswer(G.players[pi].hand,t);
  G.qa[pi].push({q:'pos',t:t,ans:ans});
  G.log.push({t:'pos',p:pi,n:t,ans:ans});
  endTurn(G);
  return ans;
}
function actAskDot(G,idx,slot){
  if(G.phase!=='ask')throw new Error('phase');
  if(!(slot>=0&&slot<5))throw new Error('slot');
  const t=faceUpTile(G,idx), pi=G.turn;
  G.field[idx].used=true;
  const ans=dotAnswer(G.players[pi].hand,slot,t);
  G.qa[pi].push({q:'dot',t:t,slot:slot,ans:ans});
  G.log.push({t:'dot',p:pi,n:t,slot:slot,ans:ans});
  endTurn(G);
  return ans;
}
function actPass(G){
  if(G.phase!=='ask')throw new Error('phase');
  G.log.push({t:'pass',p:G.turn});
  endTurn(G);
}
function actDeclare(G,guess){
  if(G.phase!=='flip'&&G.phase!=='ask')throw new Error('phase');
  const pi=G.turn, P=G.players[pi];
  const ok=Array.isArray(guess)&&guess.length===5&&
           guess.every(function(v,i){return v===P.hand[i];});
  if(ok){
    G.winner=pi; G.phase='over';
    G.log.push({t:'win',p:pi,hand:P.hand.slice()});
  }else{
    P.alive=false; P.revealed=true;
    G.log.push({t:'bust',p:pi,guess:guess.slice(),hand:P.hand.slice()});
    if(aliveCount(G)===1){
      const w=G.players.findIndex(function(p){return p.alive;});
      G.winner=w; G.phase='over';
      G.log.push({t:'lastman',p:w});
    }else endTurn(G);
  }
  return ok;
}

/* ============================================================
   知識モデル（プレイヤーpiから見た「自分の5枚」の候補）
   位置質問の答えは昇順性より「k-1枚目<t かつ k枚目>t」という
   スロット単位の範囲制約に還元できるため、全制約は
   「各スロットの候補集合＋昇順」だけになり、DPで厳密に数えられる。
   ============================================================ */
function slotSets(G,pi){
  const vis=Object.create(null);
  G.players.forEach(function(pl,j){
    if(j!==pi)pl.hand.forEach(function(n){vis[n]=1;});
  });
  G.field.forEach(function(f){if(f.up)vis[f.n]=1;});
  const cols=G.players[pi].hand.map(colorOf);
  const S=[];
  for(let i=0;i<5;i++){
    const a=[];
    for(let n=1;n<=60;n++)if(colorOf(n)===cols[i]&&!vis[n])a.push(n);
    S.push(a);
  }
  G.qa[pi].forEach(function(q){
    if(q.q==='dot'){
      const d=dotsOf(q.t);
      S[q.slot]=S[q.slot].filter(function(v){return (dotsOf(v)===d)===q.ans;});
    }else{
      const k=q.ans;
      if(k>0)S[k-1]=S[k-1].filter(function(v){return v<q.t;});
      if(k<5)S[k]=S[k].filter(function(v){return v>q.t;});
    }
  });
  return S;
}

/* DP表。L[i][v]=スロット0..iを昇順に埋めてiがvで終わる場合の数
   R[i][v]=スロットi..4を昇順に埋めてiがvで始まる場合の数
   SufR[i][v]=Σ_{w>v}R[i][w]（SufR[5][*]=1）
   M[i][v]=スロットiが値vである組合せ数（周辺分布） */
function dpTables(S){
  const inS=S.map(function(a){const s=new Array(61).fill(false);a.forEach(function(v){s[v]=true;});return s;});
  const L=[],R=[];
  for(let i=0;i<5;i++){L.push(new Array(61).fill(0));R.push(new Array(61).fill(0));}
  for(let v=1;v<=60;v++)if(inS[0][v])L[0][v]=1;
  for(let i=1;i<5;i++){
    let pre=0;
    for(let v=1;v<=60;v++){if(inS[i][v])L[i][v]=pre;pre+=L[i-1][v];}
  }
  for(let v=1;v<=60;v++)if(inS[4][v])R[4][v]=1;
  for(let i=3;i>=0;i--){
    let suf=0;
    for(let v=60;v>=1;v--){if(inS[i][v])R[i][v]=suf;suf+=R[i+1][v];}
  }
  const SufR=[];
  for(let i=0;i<5;i++){
    const a=new Array(61).fill(0);let s=0;
    for(let v=60;v>=0;v--){a[v]=s;if(v>0)s+=R[i][v];}
    SufR.push(a);
  }
  SufR.push(new Array(61).fill(1)); /* SufR[5] */
  const PreL=[];
  for(let i=0;i<5;i++){
    const a=new Array(61).fill(0);let s=0;
    for(let v=1;v<=60;v++){s+=L[i][v];a[v]=s;}
    PreL.push(a);
  }
  const M=[];
  for(let i=0;i<5;i++){
    const a=new Array(61).fill(0);
    for(let v=1;v<=60;v++)a[v]=L[i][v]*SufR[i+1][v];
    M.push(a);
  }
  return {L:L,R:R,SufR:SufR,PreL:PreL,M:M,total:PreL[4][60]};
}
function analyze(G,pi){
  const S=slotSets(G,pi);
  const dp=dpTables(S);
  return {S:S,dp:dp,total:dp.total};
}
/* スロットごとの候補値リスト（かんたんモード表示・AI用） */
function marginals(G,pi){
  const a=analyze(G,pi), out=[];
  for(let i=0;i<5;i++){
    const c=[];
    for(let v=1;v<=60;v++)if(a.dp.M[i][v]>0)c.push(v);
    out.push(c);
  }
  return out;
}

/* 質問の答えの分布（候補組合せ数ベースの厳密値） */
function posCounts(dp,t){
  const c=new Array(6).fill(0);
  c[0]=dp.SufR[0][t];
  for(let k=1;k<5;k++)c[k]=dp.PreL[k-1][t-1]*dp.SufR[k][t];
  c[5]=dp.PreL[4][t-1];
  return c;
}
function dotCounts(dp,S,t,slot){
  const d=dotsOf(t);let yes=0;
  S[slot].forEach(function(v){if(dotsOf(v)===d)yes+=dp.M[slot][v];});
  return [yes,dp.total-yes];
}
/* 候補の中から一様ランダムに1組サンプル */
function sampleAssign(dp){
  const out=[];let prev=0;
  for(let i=0;i<5;i++){
    let w=dp.SufR[i][prev];
    if(w<=0)return null;
    let r=rnd(w),v=prev+1;
    for(;v<=60;v++){if(dp.R[i][v]>r)break;r-=dp.R[i][v];}
    out.push(v);prev=v;
  }
  return out;
}
function uniqueAssign(dp){
  const out=[];
  for(let i=0;i<5;i++){
    let f=0;
    for(let v=1;v<=60;v++)if(dp.M[i][v]>0){f=v;break;}
    out.push(f);
  }
  return out;
}

/* ============================================================
   AI（1手番=最大2アクション：flip → ask/declare。UIから
   aiStep()を繰り返し呼ぶ。1回の呼び出しで1アクション実行）
   ============================================================ */
function aiStep(G){
  if(G.phase==='over')return {t:'over'};
  const pi=G.turn, P=G.players[pi];
  if(!P.ai)throw new Error('not ai turn');
  const a=analyze(G,pi);

  if(a.total===1){actDeclare(G,uniqueAssign(a.dp));return {t:'declare'};}

  if(G.phase==='flip'){
    /* 自分の候補が多い色をめくる（不確実性の高い色から場を減らす） */
    const colCnt={};
    for(let i=0;i<5;i++){
      const c=colorOf(P.hand[i]);let n=0;
      a.S[i].forEach(function(v){if(a.dp.M[i][v]>0)n++;});
      colCnt[c]=(colCnt[c]||0)+n;
    }
    const downs=[];
    G.field.forEach(function(f,ix){if(!f.up)downs.push(ix);});
    let best=[],bestScore=-1;
    downs.forEach(function(ix){
      const sc=colCnt[colorOf(G.field[ix].n)]||0;
      if(sc>bestScore){bestScore=sc;best=[ix];}
      else if(sc===bestScore)best.push(ix);
    });
    actFlip(G,pick(best));
    return {t:'flip'};
  }

  /* phase==='ask'：情報量最大の質問を選ぶ（使用済みタイルは選べない） */
  const ups=[];
  G.field.forEach(function(f,ix){if(f.up&&!f.used)ups.push(ix);});
  const qs=[]; /* {kind,idx,slot,score} score=期待残候補数（小さいほど良い） */
  ups.forEach(function(ix){
    const t=G.field[ix].n;
    const pc=posCounts(a.dp,t);
    let s=0;pc.forEach(function(c){s+=c*c;});
    qs.push({kind:'pos',idx:ix,score:s/a.total});
    for(let sl=0;sl<5;sl++){
      const dc=dotCounts(a.dp,a.S,t,sl);
      qs.push({kind:'dot',idx:ix,slot:sl,score:(dc[0]*dc[0]+dc[1]*dc[1])/a.total});
    }
  });
  const informative=qs.filter(function(q){return q.score<a.total-1e-9;});
  if(informative.length===0){
    /* 今は何を聞いても絞れない。場に裏が残っていれば待つ（次の
       めくりで必ず情報が増える）。裏が無ければ候補は1のはずだが
       保険として最有力候補で勝負する。 */
    if(hasFaceDown(G)){actPass(G);return {t:'pass'};}
    actDeclare(G,sampleAssign(a.dp)||uniqueAssign(a.dp));
    return {t:'declare'};
  }
  let q;
  if(P.level==='easy'){
    q=pick(informative);
  }else{
    let bs=Infinity,cand=[];
    informative.forEach(function(x){
      if(x.score<bs-1e-9){bs=x.score;cand=[x];}
      else if(Math.abs(x.score-bs)<=1e-9)cand.push(x);
    });
    q=pick(cand);
  }
  if(q.kind==='pos')actAskPos(G,q.idx);
  else actAskDot(G,q.idx,q.slot);
  return {t:q.kind};
}

/* ---------- ログの日本語化（UI・テスト共用） ---------- */
function fmtDots(n){return '●'.repeat(dotsOf(n));}
function fmtTile(n){return COLOR_JP[colorOf(n)]+n+'('+fmtDots(n)+')';}
function fmtEvent(G,e){
  const nm=function(p){return G.players[p].name;};
  switch(e.t){
    case 'start':return '--- ゲーム開始（'+e.np+'人） ---';
    case 'flip':return nm(e.p)+' が場のタイルをめくった → '+fmtTile(e.n);
    case 'pos':return nm(e.p)+'「'+e.n+' は私の並びのどこ？」→ '+
      (e.ans===0?'一番左より前':e.ans===5?'一番右より後':e.ans+'枚目と'+(e.ans+1)+'枚目の間');
    case 'dot':return nm(e.p)+'「私の'+(e.slot+1)+'枚目は '+e.n+' とドットが同じ？」→ '+(e.ans?'はい':'いいえ');
    case 'pass':return nm(e.p)+' は質問しなかった';
    case 'win':return '🎉 '+nm(e.p)+'「ゴットファイブ！」→ 全問正解で勝利！ ['+e.hand.join(', ')+']';
    case 'bust':return '💥 '+nm(e.p)+'「ゴットファイブ！」→ はずれ！脱落… 宣言['+e.guess.join(', ')+'] 正解['+e.hand.join(', ')+']';
    case 'lastman':return '🎉 残ったのは '+nm(e.p)+' だけ。'+nm(e.p)+'の勝ち！';
  }
  return JSON.stringify(e);
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={
    COLORS:COLORS,COLOR_JP:COLOR_JP,colorOf:colorOf,dotsOf:dotsOf,
    setSeed:setSeed,newGame:newGame,
    posAnswer:posAnswer,dotAnswer:dotAnswer,
    actFlip:actFlip,actAskPos:actAskPos,actAskDot:actAskDot,actPass:actPass,actDeclare:actDeclare,
    slotSets:slotSets,dpTables:dpTables,analyze:analyze,marginals:marginals,
    posCounts:posCounts,dotCounts:dotCounts,sampleAssign:sampleAssign,uniqueAssign:uniqueAssign,
    aiStep:aiStep,hasFaceDown:hasFaceDown,
    fmtTile:fmtTile,fmtDots:fmtDots,fmtEvent:fmtEvent
  };
}
