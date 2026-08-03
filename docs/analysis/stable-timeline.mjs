#!/usr/bin/env node
//
// How long, in REAL days, before ONE player's stable holds six genuinely good horses?
// Run with:  node docs/analysis/stable-timeline.mjs
//
// This is the companion to population-sim.mjs and answers a different question. That one asks
// "does the population improve at all?" (answer: it plateaus — see slice 0018). This one asks
// "how long until a child feels successful?", which is the question slice 0019 exists to fix.
// It is the acceptance test for slice 0019: re-run it after any tuning change and check the
// median is still inside the 6-8 real-month window the operator asked for.
//
// Same standing rules as population-sim.mjs, and for the same reasons — read that file's header
// first. In short: analysis tool, not game code, not a vitest test; own PRNG, own copy of the
// game's constants, and THAT COPY CAN DRIFT. Every constant below names its source. If you retune
// one in the game, retune it here or delete the file.
//
// WHAT IT MODELS
//   One stable, 10 stalls, starting from a founding grant (best 2 of 4 mares, best 1 of 2
//   stallions - migration 0025). Tick-level: coverings booked on a mare's real oestrous cycle,
//   real conception rolls, real gestation, real ageing and death, the four Quarter Horse disease
//   loci with the real seeded frequencies, GBED foals lost, affected horses excluded from
//   breeding, carrier x carrier crosses vetoed, and capacity culling on what the player can SEE
//   (birth noise and COI included) rather than on the truth.
//
// WHAT IT SIMPLIFIES
//   Money is not a constraint. Care, training, tack and age decline are all absent. The player is
//   modelled as competent at selection, so these are optimistic. The `missRate` and
//   `colourDistraction` knobs stand in for a real child: heats missed because nobody logged in,
//   and pairings chosen for a pretty foal instead of the best match.

// ---------------------------------------------------------------------------
// CONSTANTS — each copied from the live source named beside it
// ---------------------------------------------------------------------------
const GDPT = 10;                 // game_days_per_tick,            migration 0009
const TICKS_PER_REAL_DAY = 3;    // world.tick_times_local,        migration 0008
const GDPY = 360;                // game_days_per_year,            migration 0009
const CAPACITY = 10;             // starting_stable_capacity,      migration 0009

const GESTATION = 60;            // gestation_days_mean - operator's change, was 340 (migration 0020)
const MIN_BREED_AGE = 1080;      // min_breeding_age_game_days,    migration 0016
const RECOVERY = 30;             // mare_recovery_game_days,       migration 0016
const CYCLE_TICKS = 4, ESTRUS_TICKS = 1;              // migration 0020
const SEASON_START = 30, SEASON_LEN = 180;            // migration 0020
const CONC_BASE = 0.68, CONC_MIN = 0.05, CONC_MAX = 0.90;                    // migration 0020
const MARE_KNOTS = [[3,0.85],[4,1.00],[10,1.00],[14,0.92],[17,0.75],[20,0.50],[25,0.30]];
const STAL_KNOTS = [[3,0.90],[4,1.00],[15,1.00],[18,0.92],[22,0.80],[28,0.60]];
const FERT_MIN = 0.75, FERT_MAX = 1.10, INBREED_FERT = 0.5;                  // migration 0020
const TWIN_DOUBLE = 0.15, TWIN_BOTH = 0.02;                                  // migration 0020
const NOISE_SD = 6, INBREED_DEPRESSION = 1.0;                                // migration 0031
const LIFE_MEAN = 8280, LIFE_SD = 1260, LIFE_MIN = 5040, LIFE_MAX = 11880;   // migration 0060
const BAND = 0.50;                                    // quality_bands.mid,   migration 0025

// migration 0035 — the Quarter Horse's ideal vector. Targets are INTERMEDIATE: a founding horse
// drawn at the mid band already scores ~78 of 100 here.
const IDEAL = { neck:{t:55,w:1.0}, shoulder:{t:70,w:1.2}, back:{t:35,w:1.1}, hock:{t:50,w:0.9} };
const TR = Object.keys(IDEAL);

// migration 0063 — Barrel Racing, the only seeded discipline. Ability traits are higher_better
// with NO target (traits.ts's TRAIT_DIRECTION), so a mid-band founder scores only ~50 of 99 here.
// Note jump_scope's weight of 0: a jump_scope specialist is worthless until jumping is seeded.
const ABIL = { speed:1.4, agility:1.5, trainability:0.8, stamina:0.2, jump_scope:0 };
const AT = Object.keys(ABIL);
const AT_LIVE = AT.filter((t) => ABIL[t] > 0);        // the only traits worth specialising in today
const ABIL_SUM = AT.reduce((a, c) => a + ABIL[c], 0);

// migration 0051 — Quarter Horse founding_allele_pool disease frequencies.
const DISEASE = { HYPP:{f:0.02,dom:true}, PSSM1:{f:0.03,dom:true},
                  HERDA:{f:0.06,dom:false}, GBED:{f:0.05,dom:false,lethal:true} };
const DIS = Object.keys(DISEASE);

// ---------------------------------------------------------------------------
function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);
  t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
let rnd = mulberry32(1);
function normal(m,s){const u=Math.max(1e-12,rnd()),v=rnd();
  return m+s*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function interp(knots,x){if(x<=knots[0][0])return knots[0][1];const L=knots[knots.length-1];
  if(x>=L[0])return L[1];
  for(let i=0;i<knots.length-1;i++){const[a,b]=knots[i],[c,d]=knots[i+1];
    if(x>=a&&x<=c)return b+((x-a)/(c-a))*(d-b);}return L[1];}

// ---- slice 0019's proposed founding-stock changes, as switches ----
let CONF_SPEC = 0;        // conformation traits guaranteed near the breed's target, per founder
let ABIL_SPEC = 0;        // ability traits guaranteed high, per founder
let SPEC_SLACK = 1;       // "near" = within this many alleles
let ABIL_TARGET = 15;     // 15/20 = 75% of maximum: strong, with real headroom left

let nextId = 1;
let DISC = false;         // is this player breeding for the discipline rather than the ring?

/** Exactly k '1' alleles at random positions among the 20, so potential is exactly k. */
function allelesWithPotential(k){
  const a=new Uint8Array(20);let placed=0;
  while(placed<k){const i=Math.floor(rnd()*20);if(!a[i]){a[i]=1;placed++;}}
  return a;
}
function bandAlleles(){const a=new Uint8Array(20);for(let i=0;i<20;i++)a[i]=rnd()<BAND?1:0;return a;}

function founder(){
  const poly={},dis={},abil={};
  const cpool=TR.slice(),cspec=[];
  for(let i=0;i<CONF_SPEC&&cpool.length;i++)cspec.push(cpool.splice(Math.floor(rnd()*cpool.length),1)[0]);
  for(const tr of TR){
    if(cspec.includes(tr)){
      const target=IDEAL[tr].t/5;                                   // potential that hits it exactly
      const off=Math.round((rnd()*2-1)*SPEC_SLACK);
      poly[tr]=allelesWithPotential(Math.min(20,Math.max(0,target+off)));
    } else poly[tr]=bandAlleles();
  }
  const apool=AT_LIVE.slice(),aspec=[];
  for(let i=0;i<ABIL_SPEC&&apool.length;i++)aspec.push(apool.splice(Math.floor(rnd()*apool.length),1)[0]);
  for(const t of AT){
    if(aspec.includes(t)){
      const off=Math.round((rnd()*2-1)*SPEC_SLACK);
      abil[t]=allelesWithPotential(Math.min(20,Math.max(0,ABIL_TARGET+off)));
    } else abil[t]=bandAlleles();
  }
  for(const d of DIS){const f=DISEASE[d].f;let p=[rnd()<f?1:0,rnd()<f?1:0];
    if(DISEASE[d].lethal&&p[0]===1&&p[1]===1)p=[1,0];               // lethal clamp, generate.ts
    dis[d]=p;}
  const noise={},anoise={};
  for(const tr of TR)noise[tr]=Math.round(normal(0,NOISE_SD));
  for(const t of AT)anoise[t]=Math.round(normal(0,NOISE_SD));
  return {id:nextId++,sire:null,dam:null,poly,abil,dis,noise,anoise,fert:bandAlleles(),coi:0};
}

function mate(sire,dam,coi){
  const poly={},abil={},dis={};
  const cross=(S,D)=>{const a=new Uint8Array(20);
    for(let i=0;i<10;i++){a[i*2]=rnd()<0.5?S[i*2]:S[i*2+1];a[i*2+1]=rnd()<0.5?D[i*2]:D[i*2+1];}return a;};
  for(const tr of TR)poly[tr]=cross(sire.poly[tr],dam.poly[tr]);
  for(const t of AT)abil[t]=cross(sire.abil[t],dam.abil[t]);
  for(const d of DIS)dis[d]=[rnd()<0.5?sire.dis[d][0]:sire.dis[d][1],rnd()<0.5?dam.dis[d][0]:dam.dis[d][1]];
  const noise={},anoise={};
  for(const tr of TR)noise[tr]=Math.round(normal(0,NOISE_SD));
  for(const t of AT)anoise[t]=Math.round(normal(0,NOISE_SD));
  return {id:nextId++,sire:sire.id,dam:dam.id,poly,abil,dis,noise,anoise,fert:cross(sire.fert,dam.fert),coi};
}

const pot=(a)=>{let c=0;for(let i=0;i<20;i++)c+=a[i];return c;};
function fertPot(h){return FERT_MIN+(pot(h.fert)/20)*(FERT_MAX-FERT_MIN);}

/** Conformation: distance from target through the falloff (scoreEntry). Genes only. */
function confMerit(h){let ws=0,w=0;
  for(const tr of TR){const gv=Math.min(99,Math.max(1,pot(h.poly[tr])*5));
    ws+=IDEAL[tr].w*Math.max(0,100-Math.abs(gv-IDEAL[tr].t)*2);w+=IDEAL[tr].w;}return ws/w;}
function confVisible(h){let ws=0,w=0;const r=1-h.coi*INBREED_DEPRESSION;
  for(const tr of TR){const gv=Math.min(99,Math.max(1,pot(h.poly[tr])*5+h.noise[tr]));
    const e=50+(gv-50)*r;ws+=IDEAL[tr].w*Math.max(0,100-Math.abs(e-IDEAL[tr].t)*2);w+=IDEAL[tr].w;}
  return ws/w;}
/** Discipline: a plain weighted mean, no target (scoreAbilityEntry). Genes only. */
function abilMerit(h){let ws=0;
  for(const t of AT)ws+=ABIL[t]*Math.min(99,Math.max(1,pot(h.abil[t])*5));return ws/ABIL_SUM;}
function abilVisible(h){let ws=0;const r=1-h.coi*INBREED_DEPRESSION;
  for(const t of AT)ws+=ABIL[t]*Math.min(99,Math.max(1,pot(h.abil[t])*5+h.anoise[t]))*r;
  return ws/ABIL_SUM;}
const merit=(h)=>DISC?abilMerit(h):confMerit(h);
const visible=(h)=>DISC?abilVisible(h):confVisible(h);

function affected(h){for(const d of DIS){const p=h.dis[d];
  if(DISEASE[d].dom){if(p[0]||p[1])return true;}else if(p[0]&&p[1])return true;}return false;}
const carrier=(h,d)=>h.dis[d][0]+h.dis[d][1]===1;

// ---- COI: pedigree.ts's tabular kinship, truncated at PEDIGREE_DEPTH 6 ----
function ancWithin(id,all,depth){const seen=new Set();let fr=[id];
  for(let d=0;d<=depth&&fr.length;d++){const nx=[];
    for(const x of fr){if(x==null||seen.has(x))continue;seen.add(x);const h=all.get(x);
      if(h){if(h.sire)nx.push(h.sire);if(h.dam)nx.push(h.dam);}}fr=nx;}return seen;}
function coiOf(s,d,all){
  const vis=new Set([...ancWithin(s.id,all,6),...ancWithin(d.id,all,6)]);const memo=new Map();
  function f(x,y){if(!x||!y||!vis.has(x)||!vis.has(y))return 0;
    const k=x<=y?x+':'+y:y+':'+x;if(memo.has(k))return memo.get(k);let r;
    if(x===y){const h=all.get(x);r=0.5*(1+(h?h.coi:0));}
    else{const yo=all.get(Math.max(x,y)),ol=Math.min(x,y);
      r=!yo?0:0.5*((yo.sire?f(ol,yo.sire):0)+(yo.dam?f(ol,yo.dam):0));}
    memo.set(k,r);return r;}
  return f(s.id,d.id);}

const rollLifespan=()=>Math.min(LIFE_MAX,Math.max(LIFE_MIN,Math.round(normal(LIFE_MEAN,LIFE_SD))));
const inSeason=(day)=>{const doy=((day%GDPY)+GDPY)%GDPY;return doy>=SEASON_START&&doy<SEASON_START+SEASON_LEN;};

// ---------------------------------------------------------------------------
function runOne(opts){
  const {missRate=0.25, colourDistraction=0.20, maxGameYears=60, buyPerYear=0,
         goal=6, threshold=90, discipline=false,
         confSpecialists=0, abilitySpecialists=0, slack=1, abilityTarget=15}=opts;
  DISC=discipline; CONF_SPEC=confSpecialists; ABIL_SPEC=abilitySpecialists;
  SPEC_SLACK=slack; ABIL_TARGET=abilityTarget;

  const all=new Map(), barn=[];
  const add=(h,sex,bornDay,anchor)=>{all.set(h.id,h);
    barn.push({h,sex,bornDay,deathDay:bornDay+rollLifespan(),pregnant:null,booked:null,lastFoaled:null,anchor});};

  const mareCands=[],stalCands=[];
  for(let i=0;i<4;i++)mareCands.push(founder());
  for(let i=0;i<2;i++)stalCands.push(founder());
  mareCands.sort((a,b)=>visible(b)-visible(a));
  stalCands.sort((a,b)=>visible(b)-visible(a));
  const startAge=()=>-(1440+Math.floor(rnd()*1441));
  add(mareCands[0],'mare',startAge(),0); add(mareCands[1],'mare',startAge(),1);
  add(stalCands[0],'stallion',startAge(),0);

  const milestones={};
  const maxTicks=maxGameYears*GDPY/GDPT;

  for(let tick=0;tick<maxTicks;tick++){
    const day=tick*GDPT;
    for(let i=barn.length-1;i>=0;i--) if(day>=barn[i].deathDay) barn.splice(i,1);

    for(const e of barn){
      if(e.pregnant&&day>=e.pregnant.dueDay){
        const sire=all.get(e.pregnant.sireId);
        const n=(rnd()<TWIN_DOUBLE&&rnd()<TWIN_BOTH/TWIN_DOUBLE)?2:1;
        for(let k=0;k<n;k++){
          const foal=mate(sire,e.h,e.pregnant.coi);
          if(foal.dis.GBED[0]&&foal.dis.GBED[1]){all.set(foal.id,foal);continue;}   // lethal
          add(foal,rnd()<0.5?'mare':'stallion',day,tick+1);
        }
        e.lastFoaled=day; e.pregnant=null; e.anchor=tick+1;
      }
    }

    if(buyPerYear>0 && tick>0 && tick%Math.round(GDPY/GDPT/buyPerYear)===0)
      add(founder(),rnd()<0.5?'mare':'stallion',day-(1440+Math.floor(rnd()*1441)),tick+1);

    // Capacity: reserve breeding stock (2 stallions, 5 mares) before filling the rest with the
    // best of what is left. A real player does not sell every mare because a colt scored higher.
    if(barn.length>CAPACITY){
      const val=e=>visible(e.h)-(affected(e.h)?25:0);
      const byVal=(a,b)=>val(b)-val(a);
      const keep=new Set();
      for(const e of barn) if(e.pregnant) keep.add(e);
      for(const e of barn.filter(e=>e.sex==='stallion'&&!affected(e.h)).sort(byVal).slice(0,2)) keep.add(e);
      for(const e of barn.filter(e=>e.sex==='mare'&&!affected(e.h)).sort(byVal).slice(0,5)) keep.add(e);
      for(const e of barn.slice().sort(byVal)){ if(keep.size>=CAPACITY)break; keep.add(e); }
      if(keep.size>CAPACITY) for(const e of [...keep].sort(byVal).slice(CAPACITY)) if(!e.pregnant) keep.delete(e);
      for(let i=barn.length-1;i>=0;i--) if(!keep.has(barn[i])) barn.splice(i,1);
    }

    if(inSeason(day)){
      const stallions=barn.filter(e=>e.sex==='stallion'&&day-e.bornDay>=MIN_BREED_AGE&&!affected(e.h));
      for(const m of barn){
        if(m.sex!=='mare'||m.pregnant||m.booked)continue;
        if(day-m.bornDay<MIN_BREED_AGE)continue;
        if(affected(m.h))continue;                                   // health blocks a great mare
        if(m.lastFoaled!==null&&day<m.lastFoaled+RECOVERY)continue;
        if((((tick-m.anchor)%CYCLE_TICKS)+CYCLE_TICKS)%CYCLE_TICKS>=ESTRUS_TICKS)continue;
        if(rnd()<missRate)continue;                                  // heat missed, nobody logged in
        if(!stallions.length)continue;
        let pick=null;
        if(rnd()<colourDistraction){
          pick=stallions[Math.floor(rnd()*stallions.length)];        // bred for looks, not merit
        } else {
          let best=-Infinity;
          for(const s of stallions){
            let veto=false;
            for(const d of DIS) if(!DISEASE[d].dom&&carrier(s.h,d)&&carrier(m.h,d)) veto=true;
            if(veto)continue;
            const v=visible(s.h)*(1-coiOf(s.h,m.h,all)*INBREED_DEPRESSION);
            if(v>best){best=v;pick=s;}
          }
          if(!pick)pick=stallions[0];
        }
        m.booked={sireId:pick.h.id};
      }
    }

    for(const m of barn){
      if(!m.booked)continue;
      const sire=all.get(m.booked.sireId);
      const sireEntry=barn.find(e=>e.h.id===m.booked.sireId);
      m.booked=null;
      if(!sire||!sireEntry)continue;
      const coi=coiOf(sire,m.h,all);
      const raw=CONC_BASE*interp(MARE_KNOTS,(day-m.bornDay)/GDPY)*interp(STAL_KNOTS,(day-sireEntry.bornDay)/GDPY)
        *fertPot(m.h)*fertPot(sire)*(1-INBREED_FERT*coi);
      if(rnd()<Math.min(CONC_MAX,Math.max(CONC_MIN,raw)))
        m.pregnant={sireId:sire.id,dueDay:day+GESTATION,coi};
    }

    const good=barn.filter(e=>merit(e.h)>=threshold&&!affected(e.h)).length;
    for(const n of [1,3,6]) if(good>=n&&milestones[n]===undefined) milestones[n]=tick/TICKS_PER_REAL_DAY;
    if(milestones[goal]!==undefined) break;
  }

  const mares=barn.filter(e=>e.sex==='mare').length, stals=barn.filter(e=>e.sex==='stallion').length;
  milestones._diag={extinct:mares===0||stals===0,
    bestMerit:barn.length?Math.max(...barn.map(e=>merit(e.h))):0,
    meanCoi:barn.length?barn.reduce((a,e)=>a+e.h.coi,0)/barn.length:0};
  return milestones;
}

function summarise(label,opts,reps=200){
  const got={1:[],3:[],6:[]};let fails=0,extinct=0;const stuck=[],stuckCoi=[];
  for(let r=0;r<reps;r++){
    rnd=mulberry32(1000+r);nextId=1;
    const m=runOne(opts);
    if(m[6]===undefined){fails++;if(m._diag.extinct)extinct++;else{stuck.push(m._diag.bestMerit);stuckCoi.push(m._diag.meanCoi);}}
    // Censored, not dropped: a run that never got there counts as longer than the cap, so the
    // quantiles describe every player rather than only the lucky ones.
    for(const n of [1,3,6]) got[n].push(m[n]!==undefined?m[n]:Infinity);
  }
  const q=(xs,p)=>{const s=xs.slice().sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(s.length*p))];};
  const fmt=(d)=>!isFinite(d)?'never':(d>=365?(d/365).toFixed(1)+'y':Math.round(d)+'d');
  console.log('\n'+label);
  console.log('  milestone            p25     median      p75     reached');
  for(const n of [1,3,6])
    console.log('  '+(n+' good horse'+(n>1?'s':'')).padEnd(20)+fmt(q(got[n],0.25)).padStart(7)+
      fmt(q(got[n],0.5)).padStart(11)+fmt(q(got[n],0.75)).padStart(9)+
      ('  '+got[n].filter(isFinite).length+'/'+reps).padStart(12));
  if(fails){
    const mean=xs=>xs.length?xs.reduce((a,c)=>a+c,0)/xs.length:0;
    console.log('  failed in '+fails+'/'+reps+' — '+extinct+' lines died out, '+(fails-extinct)+' alive but stuck'+
      (stuck.length?' (best merit ~'+mean(stuck).toFixed(0)+', COI ~'+(mean(stuckCoi)*100).toFixed(0)+'%)':''));
  }
}

// ---------------------------------------------------------------------------
console.log('='.repeat(74));
console.log('TIME TO SIX GOOD HORSES — one stable, 10 stalls, casual player');
console.log('(45% of heats missed, 35% of pairings chosen for colour rather than merit)');
console.log('30 game days per real day. Gestation '+GESTATION+' game days, breeding age 3 years.');
console.log('='.repeat(74));
const CASUAL={missRate:0.45,colourDistraction:0.35};

console.log('\n\n--- CONFORMATION (bar: genes score >=90 of 100, and not disease-affected) ---');
summarise('As built', {...CASUAL});
summarise('Slice 0019: 1 conformation specialist per founder',
  {...CASUAL,confSpecialists:1});
summarise('Slice 0019: 1 conformation specialist + consignment at 2 horses/game year',
  {...CASUAL,confSpecialists:1,buyPerYear:2});

console.log('\n\n--- BARREL RACING (a mid-band horse scores ~50, so that is the NPC field) ---');
summarise('As built — 6 horses that dominate the field (>=70)', {...CASUAL,discipline:true,threshold:70});
summarise('Slice 0019: 1 ability specialist at '+15+'/20 + consignment — dominate (>=70)',
  {...CASUAL,discipline:true,threshold:70,abilitySpecialists:1,buyPerYear:2});
summarise('Slice 0019: same, but the long-term goal — elite (>=78)',
  {...CASUAL,discipline:true,threshold:78,abilitySpecialists:1,buyPerYear:2});
