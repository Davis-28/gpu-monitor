import { useState, useEffect, useCallback, useRef } from 'react'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { api } from './api.js'
import s from './App.module.css'

// ── helpers ────────────────────────────────────────────────────────────
const fmt     = (n, d=1) => (+(n??0)).toFixed(d)
const fmtUSD  = n => `$${(+(n??0)).toFixed(4)}`
const fmtUSD2 = n => `$${(+(n??0)).toFixed(2)}`
const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
const fmtDate = ts => new Date(ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
const gpuKey  = m => `${m.machine_id}_${m.gpu_id}`
const scoreColor = sc => sc>=70?'var(--green)':sc>=40?'var(--yel)':'var(--red)'
const sevColor   = sv => sv==='high'?'var(--red)':sv==='medium'?'var(--yel)':'var(--ac)'
const typeColor  = t  => t==='warning'?'var(--orange)':t==='optimization'?'var(--ac)':t==='action'?'var(--red)':'var(--purple)'

const PHASE_CFG = {
  training:   {color:'var(--green)', label:'TRAINING'},
  evaluation: {color:'var(--yel)',   label:'EVAL'},
  idle:       {color:'var(--red)',   label:'IDLE'},
  moderate:   {color:'var(--ac)',    label:'ACTIVE'},
}

const Tooltip_ = ({active,payload,label}) => {
  if(!active||!payload?.length) return null
  return (
    <div style={{background:'var(--surf2)',border:'1px solid var(--brd2)',padding:'8px 12px',borderRadius:4,fontFamily:'var(--font-mono)',fontSize:10}}>
      <div style={{color:'var(--txm)',marginBottom:4}}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{color:p.color}}>{p.name}: {fmt(p.value)}{p.unit||''}</div>)}
    </div>
  )
}

// ── atoms ──────────────────────────────────────────────────────────────
function Dot({on}) {
  return <span className={s.dot} style={{background:on?'var(--green)':'var(--red)',animation:on?undefined:'none'}}/>
}
function Gauge({label,value,max=100,color,unit='%'}) {
  return (
    <div className={s.gauge}>
      <div className={s.gaugeLbl}>
        <span>{label}</span>
        <span style={{fontFamily:'var(--font-mono)',color}}>{fmt(value)}{unit}</span>
      </div>
      <div className={s.gaugeTrack}>
        <div className={s.gaugeFill} style={{width:`${Math.min(value/max*100,100)}%`,background:color}}/>
      </div>
    </div>
  )
}
function MC({title,value,unit,sub,color}) {
  return (
    <div className={s.mc}>
      <div className={s.mcTitle}>{title}</div>
      <div className={s.mcVal} style={{color,fontFamily:'var(--font-mono)'}}>{value}<span className={s.mcUnit}>{unit}</span></div>
      {sub&&<div className={s.mcSub}>{sub}</div>}
    </div>
  )
}
function ScoreRing({score}) {
  const color=scoreColor(score), C=2*Math.PI*50
  const label=score>=70?'EFICIENTE':score>=40?'MÉDIO':'INEFICIENTE'
  return (
    <div className={s.scoreWrap}>
      <svg viewBox="0 0 116 116" width="104" height="104">
        <circle cx="58" cy="58" r="50" fill="none" stroke="var(--surf3)" strokeWidth="7"/>
        <circle cx="58" cy="58" r="50" fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={C} strokeDashoffset={C-(score/100)*C}
          strokeLinecap="round" transform="rotate(-90 58 58)"
          style={{transition:'stroke-dashoffset .8s,stroke .4s'}}/>
        <text x="58" y="54" textAnchor="middle" fill={color} style={{fontFamily:'var(--font-mono)',fontSize:20,fontWeight:700}}>{Math.round(score)}</text>
        <text x="58" y="68" textAnchor="middle" fill="var(--txm)" style={{fontFamily:'var(--font-ui)',fontSize:8,fontWeight:600,letterSpacing:1}}>{label}</text>
      </svg>
    </div>
  )
}

// ── Overview (aba financeira) ──────────────────────────────────────────
function Overview({costs, insights, gpuKeys}) {
  const totalCost    = costs?.total_cost_usd   ?? 0
  const totalWasted  = costs?.total_wasted_usd ?? 0
  const allTime      = costs?.total_all_time_usd ?? 0
  const allWasted    = costs?.total_wasted_all_time_usd ?? 0
  const savings_pct  = totalCost > 0 ? Math.round(totalWasted/totalCost*100) : 0

  // Problemas consolidados de todos os insights
  const problems = []
  for (const ins of insights) {
    for (const w of (ins.waste_signals||[])) {
      const cph = costs?.gpus?.find(g=>g.machine_id===ins.machine_id&&g.gpu_id===ins.gpu_id)?.cost_per_hour??2.5
      const wasted_hr = cph * (w.waste_pct/100)
      problems.push({
        machine_id: ins.machine_id, gpu_id: ins.gpu_id, gpu_name: ins.gpu_name,
        ...w, wasted_per_hour: wasted_hr,
      })
    }
    for (const i of (ins.insights||[])) {
      if (i.type==='action'||i.type==='warning') {
        problems.push({
          machine_id: ins.machine_id, gpu_id: ins.gpu_id, gpu_name: ins.gpu_name,
          code: i.title, severity: i.type==='action'?'high':'medium',
          message: i.title, action: i.description,
          waste_pct: 0, wasted_per_hour: i.estimated_savings_per_hour??0,
          can_automate: false,
        })
      }
    }
  }
  problems.sort((a,b)=>b.wasted_per_hour-a.wasted_per_hour)

  return (
    <div className="anim">
      {/* Money cards */}
      <div className={s.overviewGrid}>
        <div className={s.moneyCard}>
          <div className={s.moneyLabel}>Gasto na última hora</div>
          <div className={s.moneyValue} style={{color:'var(--ac)'}}>{fmtUSD2(totalCost)}</div>
          <div className={s.moneySub}>período atual</div>
        </div>
        <div className={s.moneyCard}>
          <div className={s.moneyLabel}>Dinheiro perdido (ociosidade)</div>
          <div className={s.moneyValue} style={{color:'var(--red)'}}>{fmtUSD2(totalWasted)}</div>
          <div className={s.moneySub}>{savings_pct}% do gasto desperdiçado</div>
        </div>
        <div className={s.moneyCard}>
          <div className={s.moneyLabel}>Gasto total acumulado</div>
          <div className={s.moneyValue} style={{color:'var(--purple)'}}>{fmtUSD2(allTime)}</div>
          <div className={s.moneySub}>desde o início do monitoramento</div>
        </div>
        <div className={s.moneyCard}>
          <div className={s.moneyLabel}>Total desperdiçado acumulado</div>
          <div className={s.moneyValue} style={{color:'var(--orange)'}}>{fmtUSD2(allWasted)}</div>
          <div className={s.moneySub}>poderia ter sido economizado</div>
        </div>
      </div>

      {/* Problems */}
      {problems.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,letterSpacing:2,textTransform:'uppercase',color:'var(--txd)',marginBottom:10,fontWeight:600}}>
            ⚠ Problemas detectados — {problems.length} item{problems.length!==1?'ns':''}
          </div>
          <div className={s.problemList}>
            {problems.slice(0,8).map((p,i)=>{
              const color=sevColor(p.severity)
              return (
                <div key={i} className={s.problemCard} style={{borderLeftColor:color}}>
                  <div className={s.problemLeft}>
                    <div className={s.problemTitle} style={{color}}>{p.message}</div>
                    <div className={s.problemDesc}>{p.action}</div>
                    <div className={s.problemMeta}>{p.gpu_name} · GPU {p.gpu_id} · {p.machine_id}</div>
                  </div>
                  <div className={s.problemRight}>
                    {p.wasted_per_hour>0&&(
                      <div className={s.problemCost} style={{color:'var(--red)'}}>
                        -{fmtUSD2(p.wasted_per_hour)}/h
                      </div>
                    )}
                    <div style={{fontSize:9,color:'var(--txd)',fontFamily:'var(--font-mono)'}}>
                      {p.severity.toUpperCase()}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {problems.length===0&&(
        <div style={{background:'var(--surf)',border:'1px solid rgba(0,255,136,.2)',borderRadius:'var(--r2)',padding:'16px 20px',color:'var(--green)',fontSize:13,fontWeight:600}}>
          ✓ Nenhum problema detectado — todas as GPUs operando de forma eficiente
        </div>
      )}
    </div>
  )
}

// ── GPU Panel ──────────────────────────────────────────────────────────
function GPUPanel({machine_id,gpu_id,gpu_name,insight,history,costData}) {
  const score   = insight?.efficiency_score??0
  const latest  = history[history.length-1]
  const phase   = insight?.phase||latest?.phase
  const phCfg   = PHASE_CFG[phase]||null
  const gpu_cost= costData?.gpus?.find(g=>g.machine_id===machine_id&&g.gpu_id===gpu_id)
  const cost_hr = gpu_cost?.cost_per_hour??2.5
  const idle_s  = insight?.idle_seconds??0
  const id      = `${machine_id}_${gpu_id}`

  const chartData = history.slice(-80).map(m=>({
    t:    fmtTime(m.timestamp),
    util: m.utilization,
    vram: m.vram_total_mb>0?Math.round(m.vram_used_mb/m.vram_total_mb*100):0,
    score:m.efficiency_score,
    thr:  m.throughput_tokens_per_sec,
    errR: m.error_rate,
    bw:   m.memory_bandwidth_pct,
  }))

  return (
    <div className={s.panel+' anim'}>
      {/* Header */}
      <div className={s.panelHdr}>
        <div>
          <div className={s.gpuId}>GPU {gpu_id} · {machine_id}</div>
          <div className={s.gpuName}>{gpu_name||`GPU ${gpu_id}`}</div>
          {phCfg&&<div className={s.gpuPhase} style={{color:phCfg.color,borderColor:phCfg.color+'50'}}>{phCfg.label}</div>}
          {idle_s>60&&<div style={{fontSize:9,color:'var(--red)',fontFamily:'var(--font-mono)',marginTop:3}}>
            OCIOSA há {Math.floor(idle_s/60)}min {idle_s%60}s
          </div>}
        </div>
        <ScoreRing score={score}/>
      </div>

      {/* Cost strip — dinheiro em primeiro lugar */}
      {latest&&(
        <div className={s.costStrip}>
          <div className={s.costChip}>
            <div className={s.costChipLabel}>Custo/hora</div>
            <div className={s.costChipValue} style={{color:'var(--ac)'}}>${fmt(cost_hr,2)}</div>
            <div className={s.costChipSub}>configurado</div>
          </div>
          <div className={s.costChip}>
            <div className={s.costChipLabel}>Custo real/hora</div>
            <div className={s.costChipValue} style={{color:'var(--yel)'}}>
              ${fmt(cost_hr*(latest.utilization/100+0.1),2)}
            </div>
            <div className={s.costChipSub}>proporcional ao uso</div>
          </div>
          <div className={s.costChip}>
            <div className={s.costChipLabel}>Gasto hoje est.</div>
            <div className={s.costChipValue} style={{color:'var(--purple)'}}>
              ${fmt(gpu_cost?.cost_usd??0,3)}
            </div>
            <div className={s.costChipSub}>período ativo</div>
          </div>
          <div className={s.costChip}>
            <div className={s.costChipLabel}>Perdido hoje est.</div>
            <div className={s.costChipValue} style={{color:'var(--red)'}}>
              ${fmt(gpu_cost?.wasted_cost_usd??0,3)}
            </div>
            <div className={s.costChipSub}>{fmt(gpu_cost?.waste_pct??0,0)}% ociosidade</div>
          </div>
        </div>
      )}

      {/* Metrics row 1 — utilização e memória */}
      {latest&&(
        <div className={s.mRow}>
          <MC title="Utilização" value={fmt(latest.utilization)} unit="%"
            color={latest.utilization>60?'var(--green)':latest.utilization>30?'var(--yel)':'var(--red)'}/>
          <MC title="VRAM usada" value={latest.vram_total_mb>0?fmt(latest.vram_used_mb/latest.vram_total_mb*100):'—'} unit="%"
            sub={`${(latest.vram_used_mb/1024).toFixed(1)}/${(latest.vram_total_mb/1024).toFixed(0)} GB`}
            color="var(--ac)"/>
          <MC title="VRAM livre" value={latest.vram_total_mb>0?fmt(latest.vram_free_mb/latest.vram_total_mb*100):'—'} unit="%"
            sub={`${(latest.vram_free_mb/1024).toFixed(1)} GB`}
            color="var(--ac2)"/>
          <MC title="Temperatura" value={fmt(latest.temperature_c,0)} unit="°C"
            color={latest.temperature_c>=85?'var(--red)':latest.temperature_c>=78?'var(--orange)':'var(--tx)'}/>
          <MC title="Energia" value={fmt(latest.power_draw_w,0)} unit="W"
            sub={latest.power_limit_w?`lim ${latest.power_limit_w}W`:null}
            color="var(--purple)"/>
        </div>
      )}

      {/* Metrics row 2 — perf */}
      {latest&&(latest.throughput_tokens_per_sec!=null||latest.latency_ms!=null)&&(
        <div className={s.mRow}>
          {latest.throughput_tokens_per_sec!=null&&<MC title="Throughput" value={fmt(latest.throughput_tokens_per_sec,0)} unit=" tok/s" color="var(--green)"/>}
          {latest.latency_ms!=null&&<MC title="Latência" value={fmt(latest.latency_ms,1)} unit=" ms"
            color={latest.latency_ms>500?'var(--red)':latest.latency_ms>200?'var(--yel)':'var(--ac)'}/>}
          {latest.batch_efficiency!=null&&<MC title="Batch Eff." value={fmt(latest.batch_efficiency,0)} unit="%"
            color={latest.batch_efficiency>60?'var(--green)':latest.batch_efficiency>30?'var(--yel)':'var(--red)'}/>}
          {latest.error_rate!=null&&<MC title="Error Rate" value={fmt(latest.error_rate,2)} unit="%"
            color={latest.error_rate>2?'var(--red)':latest.error_rate>0.5?'var(--yel)':'var(--green)'}/>}
          {latest.memory_bandwidth_pct!=null&&<MC title="Mem BW" value={fmt(latest.memory_bandwidth_pct,0)} unit="%" color="var(--blue)"/>}
        </div>
      )}

      {/* Gauges */}
      {latest&&(
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          <Gauge label="GPU Utilização" value={latest.utilization}
            color={latest.utilization>60?'var(--green)':latest.utilization>30?'var(--yel)':'var(--red)'}/>
          <Gauge label="VRAM usada"
            value={latest.vram_total_mb>0?latest.vram_used_mb/latest.vram_total_mb*100:0}
            color="var(--ac)"/>
          {latest.batch_efficiency!=null&&
            <Gauge label="Batch Efficiency" value={latest.batch_efficiency}
              color={latest.batch_efficiency>60?'var(--green)':latest.batch_efficiency>30?'var(--yel)':'var(--red)'}/>}
          {latest.memory_bandwidth_pct!=null&&
            <Gauge label="Memory Bandwidth" value={latest.memory_bandwidth_pct} color="var(--blue)"/>}
        </div>
      )}

      {/* Chart Util + VRAM — igual ao primeiro dashboard */}
      {chartData.length>1&&(
        <div className={s.chartWrap}>
          <div className={s.chartTitle}>Utilização &amp; VRAM — últimas leituras</div>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={chartData} margin={{top:4,right:8,bottom:0,left:-22}}>
              <defs>
                <linearGradient id={`gu${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--green)" stopOpacity={.28}/>
                  <stop offset="95%" stopColor="var(--green)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id={`gv${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--ac)" stopOpacity={.22}/>
                  <stop offset="95%" stopColor="var(--ac)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--brd)" vertical={false}/>
              <XAxis dataKey="t" tick={{fill:'var(--txd)',fontSize:8}} tickLine={false} interval="preserveStartEnd"/>
              <YAxis domain={[0,100]} tick={{fill:'var(--txd)',fontSize:8}} tickLine={false}/>
              <Tooltip content={<Tooltip_/>}/>
              <ReferenceLine y={30} stroke="var(--red)" strokeDasharray="4 4" strokeOpacity={.4}/>
              <Area type="monotone" dataKey="util" name="GPU %" stroke="var(--green)" fill={`url(#gu${id})`} strokeWidth={1.5} dot={false} unit="%"/>
              <Area type="monotone" dataKey="vram" name="VRAM %" stroke="var(--ac)" fill={`url(#gv${id})`} strokeWidth={1.5} dot={false} unit="%"/>
              <Line type="monotone" dataKey="score" name="Score" stroke="var(--yel)" strokeWidth={1} dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Chart Throughput + Error rate */}
      {chartData.length>1&&chartData.some(d=>d.thr!=null)&&(
        <div className={s.chartWrap}>
          <div className={s.chartTitle}>Throughput &amp; Error Rate</div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={chartData} margin={{top:4,right:8,bottom:0,left:-22}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--brd)" vertical={false}/>
              <XAxis dataKey="t" tick={{fill:'var(--txd)',fontSize:8}} tickLine={false} interval="preserveStartEnd"/>
              <YAxis yAxisId="l" tick={{fill:'var(--txd)',fontSize:8}} tickLine={false}/>
              <YAxis yAxisId="r" orientation="right" tick={{fill:'var(--txd)',fontSize:8}} tickLine={false}/>
              <Tooltip content={<Tooltip_/>}/>
              <Line yAxisId="l" type="monotone" dataKey="thr"  name="Throughput" stroke="var(--green)" strokeWidth={1.5} dot={false} unit=" tok/s"/>
              <Line yAxisId="r" type="monotone" dataKey="errR" name="Error Rate" stroke="var(--red)"   strokeWidth={1.5} dot={false} unit="%"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Waste signals */}
      {insight?.waste_signals?.length>0&&(
        <div className={s.sec}>
          <div className={s.secTitle}>⚠ Desperdício detectado</div>
          {insight.waste_signals.map((w,i)=>(
            <div key={i} className={s.waste} style={{borderLeftColor:sevColor(w.severity)}}>
              <div className={s.wasteSev} style={{color:sevColor(w.severity)}}>{w.severity.toUpperCase()}</div>
              <div className={s.wasteMsg}>{w.message}</div>
              <div className={s.wasteAct}>➡ {w.action}</div>
              {w.waste_pct>0&&<div className={s.wastePct} style={{color:'var(--red)'}}>~{fmt(w.waste_pct,0)}% do custo desperdiçado</div>}
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {insight?.insights?.length>0&&(
        <div className={s.sec}>
          <div className={s.secTitle}>💡 O que fazer agora</div>
          {insight.insights.map((ins,i)=>{
            const color=typeColor(ins.type)
            const icons={warning:'⚠',optimization:'⚡',info:'ℹ',action:'🔴'}
            return (
              <div key={i} className={s.insight} style={{borderColor:color+'40'}}>
                <div className={s.insightHdr}>
                  <span style={{color,fontSize:13}}>{icons[ins.type]||'•'}</span>
                  <span className={s.insightTitle}>{ins.title}</span>
                  <span className={s.insightType} style={{color,borderColor:color+'60'}}>{ins.type}</span>
                </div>
                <div className={s.insightDesc}>{ins.description}</div>
                {ins.estimated_savings_per_hour>0&&(
                  <div className={s.insightSavings}>economia potencial: {fmtUSD2(ins.estimated_savings_per_hour)}/hora</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Processes Panel ─────────────────────────────────────────────────────
function ProcessesPanel({gpuKeys}) {
  const [procs,  setProcs]  = useState([])
  const [period, setPeriod] = useState(30)

  useEffect(()=>{
    api.processes({minutes:period}).then(setProcs).catch(console.error)
    const t = setInterval(()=>api.processes({minutes:period}).then(setProcs).catch(()=>{}),10000)
    return ()=>clearInterval(t)
  },[period])

  const PERIODS=[{l:'15 min',v:15},{l:'30 min',v:30},{l:'1 hora',v:60},{l:'6 horas',v:360}]
  const total_cost = procs.reduce((a,p)=>a+(p.total_cost||0),0)

  return (
    <div className="anim" style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
        <div style={{fontSize:18,fontWeight:800}}>📊 Custo por Processo / Job</div>
        <div className={s.periodPicker}>
          {PERIODS.map(p=>(
            <button key={p.v} className={s.periodBtn+(period===p.v?' '+s.periodActive:'')} onClick={()=>setPeriod(p.v)}>{p.l}</button>
          ))}
        </div>
      </div>
      <div style={{background:'var(--surf)',border:'1px solid var(--brd2)',borderRadius:'var(--r2)',padding:'14px 18px',display:'flex',gap:24,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:1.5,color:'var(--txm)',fontWeight:600}}>Custo total processos</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:24,fontWeight:700,color:'var(--ac)'}}>{fmtUSD2(total_cost)}</div>
        </div>
        <div>
          <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:1.5,color:'var(--txm)',fontWeight:600}}>Processos ativos</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:24,fontWeight:700,color:'var(--green)'}}>{procs.length}</div>
        </div>
      </div>
      {procs.length>0?(
        <div style={{background:'var(--surf)',border:'1px solid var(--brd)',borderRadius:'var(--r2)',overflow:'hidden'}}>
          <table className={s.procTable}>
            <thead>
              <tr>
                <th className={s.procTh}>Processo</th>
                <th className={s.procTh}>PID</th>
                <th className={s.procTh}>Máquina / GPU</th>
                <th className={s.procTh}>Mem. Média</th>
                <th className={s.procTh}>Util. Média</th>
                <th className={s.procTh}>Custo Total</th>
                <th className={s.procTh}>Eficiência</th>
                <th className={s.procTh}>Último visto</th>
              </tr>
            </thead>
            <tbody>
              {procs.map((p,i)=>{
                const cost_pct = total_cost>0?p.total_cost/total_cost*100:0
                const eff = p.avg_util>60?'var(--green)':p.avg_util>30?'var(--yel)':'var(--red)'
                return (
                  <tr key={i} className={s.procTr}>
                    <td className={s.procTd}><span className={s.procName}>{p.name}</span></td>
                    <td className={s.procTd}>{p.pid}</td>
                    <td className={s.procTd}>{p.machine_id} · GPU {p.gpu_id}</td>
                    <td className={s.procTd}>{Math.round(p.avg_mem)} MB</td>
                    <td className={s.procTd} style={{color:eff}}>{fmt(p.avg_util,1)}%</td>
                    <td className={s.procTd} style={{color:'var(--ac)',fontWeight:700}}>{fmtUSD(p.total_cost)}
                      <span style={{color:'var(--txd)',fontSize:9,marginLeft:4}}>{fmt(cost_pct,0)}%</span>
                    </td>
                    <td className={s.procTd}>
                      <div style={{width:60,height:4,background:'var(--surf3)',borderRadius:2,overflow:'hidden'}}>
                        <div style={{width:`${Math.min(p.avg_util,100)}%`,height:'100%',background:eff,borderRadius:2}}/>
                      </div>
                    </td>
                    <td className={s.procTd}>{p.last_seen?fmtDate(p.last_seen):'—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ):(
        <div style={{color:'var(--txm)',fontSize:12,padding:16,textAlign:'center'}}>
          Nenhum processo registrado no período. Aguardando dados do agent...
        </div>
      )}
    </div>
  )
}

// ── Cost Panel ─────────────────────────────────────────────────────────
function CostPanel({costs,costHistory,period,onPeriodChange,onExport}) {
  const PERIODS=[{l:'15 min',v:15},{l:'1 hora',v:60},{l:'6 horas',v:360},{l:'24 horas',v:1440},{l:'7 dias',v:10080}]
  return (
    <div className={s.costPanel+' anim'}>
      <div className={s.costHdr}>
        <div className={s.costTitle}>💰 Análise de Custos</div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <div className={s.periodPicker}>
            {PERIODS.map(p=>(
              <button key={p.v} className={s.periodBtn+(period===p.v?' '+s.periodActive:'')} onClick={()=>onPeriodChange(p.v)}>{p.l}</button>
            ))}
          </div>
          <a className={s.exportBtn} href={onExport()} download>⬇ CSV</a>
        </div>
      </div>
      <div className={s.totalRow}>
        <div className={s.totalCard}><div className={s.totalLabel}>Custo no período</div><div className={s.totalValue} style={{color:'var(--ac)'}}>{fmtUSD2(costs?.total_cost_usd)}</div></div>
        <div className={s.totalCard}><div className={s.totalLabel}>Desperdiçado no período</div><div className={s.totalValue} style={{color:'var(--red)'}}>{fmtUSD2(costs?.total_wasted_usd)}</div></div>
        <div className={s.totalCard}><div className={s.totalLabel}>Total acumulado</div><div className={s.totalValue} style={{color:'var(--purple)'}}>{fmtUSD2(costs?.total_all_time_usd)}</div></div>
        <div className={s.totalCard}><div className={s.totalLabel}>Total desperdiçado acumulado</div><div className={s.totalValue} style={{color:'var(--orange)'}}>{fmtUSD2(costs?.total_wasted_all_time_usd)}</div></div>
      </div>
      {costHistory?.length>1&&(
        <div className={s.chartWrap}>
          <div className={s.chartTitle}>Custo acumulado &amp; Score — histórico</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={costHistory} margin={{top:4,right:8,bottom:0,left:-10}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--brd)" vertical={false}/>
              <XAxis dataKey="t" tick={{fill:'var(--txd)',fontSize:8}} tickLine={false} interval="preserveStartEnd"/>
              <YAxis yAxisId="l" tick={{fill:'var(--txd)',fontSize:8}} tickLine={false}/>
              <YAxis yAxisId="r" orientation="right" domain={[0,100]} tick={{fill:'var(--txd)',fontSize:8}} tickLine={false}/>
              <Tooltip content={<Tooltip_/>}/>
              <Line yAxisId="l" type="monotone" dataKey="cumulative_cost" name="Custo $" stroke="var(--ac)" strokeWidth={2} dot={false} unit="$"/>
              <Line yAxisId="r" type="monotone" dataKey="avg_score"       name="Score"  stroke="var(--green)" strokeWidth={1.5} dot={false}/>
              <Line yAxisId="r" type="monotone" dataKey="avg_util"        name="Util %"  stroke="var(--yel)" strokeWidth={1} dot={false} unit="%"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className={s.gpuCostGrid}>
        {(costs?.gpus||[]).map((g,i)=>(
          <div key={i} className={s.gpuCostCard}>
            <div className={s.gpuCostName}>{g.gpu_name} · GPU {g.gpu_id}</div>
            <div className={s.gpuCostMachine}>{g.machine_id}</div>
            <div className={s.gpuCostRow}><span>Custo no período</span><span style={{fontFamily:'var(--font-mono)',color:'var(--ac)'}}>{fmtUSD(g.cost_usd)}</span></div>
            <div className={s.gpuCostRow}><span>Custo desperdiçado</span><span style={{fontFamily:'var(--font-mono)',color:'var(--red)'}}>{fmtUSD(g.wasted_cost_usd)}</span></div>
            <div className={s.gpuCostRow}><span>Horas ativas</span><span style={{fontFamily:'var(--font-mono)'}}>{g.hours_active}h</span></div>
            <div className={s.gpuCostRow}><span>Custo/hora</span><span style={{fontFamily:'var(--font-mono)'}}>${g.cost_per_hour}/h</span></div>
            <Gauge label="Util. média" value={g.avg_utilization}
              color={g.avg_utilization>60?'var(--green)':g.avg_utilization>30?'var(--yel)':'var(--red)'}/>
            <Gauge label="Score médio" value={g.avg_efficiency_score} color={scoreColor(g.avg_efficiency_score)}/>
            {g.avg_batch_efficiency>0&&<Gauge label="Batch Eff. média" value={g.avg_batch_efficiency}
              color={g.avg_batch_efficiency>60?'var(--green)':g.avg_batch_efficiency>30?'var(--yel)':'var(--red)'}/>}
            {g.waste_pct>0&&<div className={s.wasteTag}>{fmt(g.waste_pct,0)}% ocioso — {fmtUSD(g.wasted_cost_usd)} perdido</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Projection ──────────────────────────────────────────────────────────
function ProjectionPanel({gpuKeys}) {
  const [proj,setProj]=useState(null)
  const [hours,setHours]=useState('')
  const [sel,setSel]=useState(gpuKeys[0]?.key||'')
  const [loading,setLoading]=useState(false)
  const selected=gpuKeys.find(g=>g.key===sel)
  const load=useCallback(async()=>{
    if(!selected) return
    setLoading(true)
    try {
      const p={machine_id:selected.machine_id,gpu_id:selected.gpu_id}
      if(hours) p.estimated_total_hours=hours
      setProj(await api.projection(p))
    } catch(e){console.error(e)}
    setLoading(false)
  },[selected,hours])
  useEffect(()=>{load()},[load])
  return (
    <div className={s.projPanel+' anim'}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{fontSize:18,fontWeight:800}}>📈 Projeção de Custo</div>
        {gpuKeys.length>1&&(
          <select value={sel} onChange={e=>setSel(e.target.value)}
            style={{background:'var(--surf2)',border:'1px solid var(--brd2)',color:'var(--tx)',padding:'5px 10px',borderRadius:3,fontFamily:'var(--font-mono)',fontSize:11}}>
            {gpuKeys.map(g=><option key={g.key} value={g.key}>{g.machine_id} · GPU {g.gpu_id}</option>)}
          </select>
        )}
      </div>
      <div className={s.projInput}>
        <span className={s.projInputLbl}>Duração total estimada do treino (horas):</span>
        <input className={s.projInputField} type="number" min="0.1" step="0.5" value={hours} onChange={e=>setHours(e.target.value)} placeholder="ex: 24"/>
        <button className={s.projBtn} onClick={load}>{loading?'...':'Calcular'}</button>
      </div>
      {proj&&!proj.error&&(
        <>
          <div className={s.projGrid}>
            <div className={s.projCard}><div className={s.projLabel}>Custo atual</div><div className={s.projValue} style={{color:'var(--ac)'}}>{fmtUSD2(proj.current_cost)}</div><div className={s.projSub}>{fmt(proj.elapsed_hours,2)}h decorridas</div></div>
            <div className={s.projCard}><div className={s.projLabel}>Taxa de queima</div><div className={s.projValue} style={{color:'var(--yel)'}}>$ {fmt(proj.burn_rate_per_hour,4)}/h</div><div className={s.projSub}>custo real por hora</div></div>
            {proj.projected_total!=null&&<div className={s.projCard}><div className={s.projLabel}>Custo total projetado</div><div className={s.projValue} style={{color:'var(--purple)'}}>{fmtUSD2(proj.projected_total)}</div><div className={s.projSub}>{fmt(proj.estimated_total_hours??0,1)}h total estimado</div></div>}
            {proj.projected_remaining!=null&&<div className={s.projCard}><div className={s.projLabel}>Custo restante estimado</div><div className={s.projValue} style={{color:'var(--orange)'}}>{fmtUSD2(proj.projected_remaining)}</div><div className={s.projSub}>{fmt(proj.remaining_hours??0,1)}h restantes</div></div>}
          </div>
          {proj.vram_exhaustion_minutes!=null&&proj.vram_exhaustion_minutes<120&&(
            <div className={s.vramAlert}>
              <div className={s.vramAlertTitle}>⚠ VRAM pode esgotar em ~{fmt(proj.vram_exhaustion_minutes,0)} minutos</div>
              <div className={s.vramAlertDesc}>A taxa de crescimento de VRAM indica possível OOM. Use gradient checkpointing ou reduza batch size.</div>
            </div>
          )}
        </>
      )}
      {proj?.error&&<div style={{color:'var(--txm)',fontSize:12,padding:'16px 0'}}>Aguardando dados suficientes...</div>}
    </div>
  )
}

// ── Automation Panel ────────────────────────────────────────────────────
function AutomationPanel() {
  const [rules,setRules]=useState([])
  const [log,  setLog]  =useState([])
  const [idleMin,setIdleMin]=useState('15')
  const [saved,setSaved]=useState(false)

  useEffect(()=>{
    const load=async()=>{
      try {
        const [r,l,st]=await Promise.all([api.autoRules(),api.autoLog(),api.settings()])
        setRules(r); setLog(l)
        if(st.idle_shutdown_minutes) setIdleMin(st.idle_shutdown_minutes)
      } catch(e){console.error(e)}
    }
    load()
    const t=setInterval(load,10000)
    return ()=>clearInterval(t)
  },[])

  const toggleRule=async(code,enabled)=>{
    await api.setAutoRule(code,enabled)
    setRules(prev=>prev.map(r=>r.code===code?{...r,enabled}:r))
  }

  const saveIdle=async()=>{
    await api.saveSetting('idle_shutdown_minutes',idleMin)
    await api.saveSetting('auto_shutdown_enabled','true')
    setSaved(true); setTimeout(()=>setSaved(false),2500)
  }

  return (
    <div className={s.autoPanel+' anim'}>
      <div className={s.autoTitle}>🤖 Automações</div>

      {/* Idle config */}
      <div style={{background:'var(--surf)',border:'1px solid var(--brd)',borderRadius:'var(--r2)',padding:'16px 20px'}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Desligar GPU ociosa automaticamente</div>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:'var(--txm)'}}>Desligar após</span>
          <input style={{background:'var(--surf2)',border:'1px solid var(--brd2)',color:'var(--tx)',fontFamily:'var(--font-mono)',fontSize:13,padding:'6px 10px',borderRadius:'var(--r)',width:80}}
            type="number" min="1" max="60" value={idleMin} onChange={e=>setIdleMin(e.target.value)}/>
          <span style={{fontSize:12,color:'var(--txm)'}}>minutos de ociosidade</span>
          <button className={s.saveBtn} onClick={saveIdle}>Ativar</button>
          {saved&&<span className={s.savedOk}>✓ Salvo</span>}
        </div>
        <div style={{fontSize:10,color:'var(--txd)',marginTop:8,fontFamily:'var(--font-mono)'}}>
          O sistema registra a ação no log — em produção com acesso ao provider (AWS/GCP/Azure) executaria o shutdown real via API.
        </div>
      </div>

      {/* Rules */}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <div className={s.secTitle}>Regras de automação</div>
        {rules.map((r,i)=>(
          <div key={i} className={s.ruleCard}>
            <div className={s.ruleInfo}>
              <div className={s.ruleName}>{r.description}</div>
              <div className={s.ruleDesc}>Ação: <span style={{color:'var(--ac)',fontFamily:'var(--font-mono)',fontSize:11}}>{r.action}</span></div>
              <div className={s.ruleCond}>Condição: {r.condition}</div>
            </div>
            <label className={s.toggle}>
              <input type="checkbox" checked={r.enabled} onChange={e=>toggleRule(r.code,e.target.checked)}/>
              <span className={s.toggleSlider}/>
            </label>
          </div>
        ))}
      </div>

      {/* Log */}
      {log.length>0&&(
        <div>
          <div className={s.secTitle} style={{marginBottom:10}}>Log de ações executadas</div>
          <div className={s.logList}>
            {log.slice(0,20).map((l,i)=>(
              <div key={i} className={s.logItem}>
                <span className={s.logTime}>{l.timestamp?fmtDate(l.timestamp):'—'}</span>
                <span className={s.logAction}>{l.action}</span>
                <span className={s.logReason}>{l.reason}</span>
                <span className={s.logExecuted} style={{
                  background:l.executed?'rgba(0,255,136,.1)':'rgba(255,61,90,.1)',
                  color:l.executed?'var(--green)':'var(--red)',
                  border:`1px solid ${l.executed?'rgba(0,255,136,.3)':'rgba(255,61,90,.3)'}`,
                }}>{l.executed?'executado':'pendente'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Cluster ─────────────────────────────────────────────────────────────
function ClusterPanel({machines,insightMap,costs}) {
  return (
    <div className={s.clusterPanel+' anim'}>
      <div style={{fontSize:18,fontWeight:800,marginBottom:4}}>◈ Visão do Cluster</div>
      <div className={s.clusterGrid}>
        {machines.map((m,i)=>{
          const key=`${m.machine_id}_${m.gpu_id}`
          const ins=insightMap[key]
          const score=ins?.efficiency_score??m.avg_score??0
          const color=scoreColor(score)
          const gpu_cost=costs?.gpus?.find(g=>g.machine_id===m.machine_id&&g.gpu_id===m.gpu_id)
          return (
            <div key={i} className={s.clusterCard}>
              <div>
                <div className={s.clusterName}>{m.machine_id}</div>
                <div className={s.clusterGpu}>GPU {m.gpu_id} · {m.gpu_name}</div>
              </div>
              <div className={s.clusterScore} style={{color}}>{Math.round(score)}</div>
              <div style={{fontSize:9,color:'var(--txm)',fontFamily:'var(--font-mono)'}}>SCORE DE EFICIÊNCIA</div>
              <Gauge label="Eficiência" value={score} color={color}/>
              {gpu_cost&&(
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--txm)'}}>
                  <span>Gasto</span>
                  <span style={{fontFamily:'var(--font-mono)',color:'var(--ac)'}}>{fmtUSD(gpu_cost.cost_usd)}</span>
                </div>
              )}
              {gpu_cost?.wasted_cost_usd>0&&(
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--txm)'}}>
                  <span>Desperdiçado</span>
                  <span style={{fontFamily:'var(--font-mono)',color:'var(--red)'}}>{fmtUSD(gpu_cost.wasted_cost_usd)}</span>
                </div>
              )}
              {ins?.waste_signals?.slice(0,2).map((w,j)=>(
                <div key={j} style={{fontSize:10,color:sevColor(w.severity),borderLeft:`2px solid ${sevColor(w.severity)}`,paddingLeft:6,lineHeight:1.5}}>{w.message}</div>
              ))}
              <div className={s.clusterLastSeen}>Visto: {m.last_seen?fmtDate(m.last_seen):'—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────
function SettingsPanel() {
  const [cost,setCost]=useState('')
  const [machine,setMachine]=useState('')
  const [slack,setSlack]=useState('')
  const [saved,setSaved]=useState(false)
  useEffect(()=>{
    api.settings().then(d=>{
      if(d.gpu_cost_per_hour)  setCost(d.gpu_cost_per_hour)
      if(d.machine_label)      setMachine(d.machine_label)
      if(d.slack_webhook_note) setSlack(d.slack_webhook_note)
    }).catch(()=>{})
  },[])
  const save=async()=>{
    const items=[['gpu_cost_per_hour',cost],['machine_label',machine],['slack_webhook_note',slack]]
    await Promise.all(items.filter(([,v])=>v).map(([k,v])=>api.saveSetting(k,v)))
    setSaved(true); setTimeout(()=>setSaved(false),2500)
  }
  return (
    <div className={s.settingsPanel+' anim'}>
      <div style={{fontSize:18,fontWeight:800}}>⚙ Configurações</div>
      <div className={s.settingsCard}>
        <div className={s.settingsTitle}>Custo &amp; Identificação</div>
        <div className={s.settingsRow}><span className={s.settingsLbl}>Custo por hora da GPU (USD)</span><input className={s.settingsInput} type="number" min="0" step="0.01" value={cost} onChange={e=>setCost(e.target.value)} placeholder="ex: 2.50"/></div>
        <div className={s.settingsRow}><span className={s.settingsLbl}>Label desta máquina</span><input className={s.settingsInput} type="text" value={machine} onChange={e=>setMachine(e.target.value)} placeholder="ex: Servidor A"/></div>
        <div className={s.settingsRow}><span className={s.settingsLbl}>Slack Webhook (nota)</span><input className={s.settingsInput} type="text" value={slack} onChange={e=>setSlack(e.target.value)} placeholder="Configurado no .env"/></div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button className={s.saveBtn} onClick={save}>Salvar</button>
          {saved&&<span className={s.savedOk}>✓ Salvo</span>}
        </div>
      </div>
      <div className={s.settingsCard}>
        <div className={s.settingsTitle}>Exportar Dados</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          {[15,60,360,1440].map(m=>(
            <a key={m} className={s.exportBtn} href={api.exportCsvUrl({minutes:m})} download>
              ⬇ {m<60?`${m}min`:`${m/60}h`}
            </a>
          ))}
        </div>
        <div style={{fontSize:11,color:'var(--txm)',marginTop:4}}>CSV completo com todas as métricas técnicas.</div>
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────
const TABS=[
  {id:'overview',  label:'💰 Resumo Financeiro'},
  {id:'gpus',      label:'⬡ GPUs & Métricas'},
  {id:'processes', label:'📊 Processos'},
  {id:'cluster',   label:'◈ Cluster'},
  {id:'costs',     label:'$ Histórico de Custos'},
  {id:'projection',label:'📈 Projeção'},
  {id:'automation',label:'🤖 Automações'},
  {id:'settings',  label:'⚙ Config'},
]

export default function App() {
  const [connected,   setConnected]   = useState(false)
  const [gpuKeys,     setGpuKeys]     = useState([])
  const [historyMap,  setHistoryMap]  = useState({})
  const [insightMap,  setInsightMap]  = useState({})
  const [machines,    setMachines]    = useState([])
  const [costs,       setCosts]       = useState(null)
  const [costHistory, setCostHistory] = useState([])
  const [costPeriod,  setCostPeriod]  = useState(60)
  const [lastUpdate,  setLastUpdate]  = useState(null)
  const [tab,         setTab]         = useState('overview')
  const timer = useRef(null)

  const refresh = useCallback(async()=>{
    try { await api.health(); setConnected(true) }
    catch { setConnected(false); return }
    try {
      const [metrics,insights,mach,c,ch]=await Promise.all([
        api.metrics({minutes:5,limit:500}),
        api.insights(),
        api.machines(),
        api.costs({minutes:costPeriod}),
        api.costHistory({minutes:costPeriod,buckets:40}),
      ])
      const byKey={}
      for(const m of metrics){
        const k=gpuKey(m)
        if(!byKey[k]) byKey[k]=[]
        byKey[k].push(m)
      }
      for(const k in byKey) byKey[k].sort((a,b)=>a.timestamp.localeCompare(b.timestamp))
      setHistoryMap(byKey)
      setGpuKeys(Object.keys(byKey).map(k=>{
        const last=byKey[k][byKey[k].length-1]
        return {key:k,machine_id:last.machine_id,gpu_id:last.gpu_id,gpu_name:last.gpu_name}
      }))
      const iMap={}
      for(const ins of insights) iMap[gpuKey(ins)]=ins
      setInsightMap(iMap)
      setMachines(mach)
      setCosts(c)
      setCostHistory(ch)
      setLastUpdate(new Date())
    } catch(e){console.error('refresh:',e)}
  },[costPeriod])

  useEffect(()=>{
    refresh()
    timer.current=setInterval(refresh,5000)
    return ()=>clearInterval(timer.current)
  },[refresh])

  return (
    <div className={s.app}>
      <header className={s.hdr}>
        <div className={s.hL}>
          <div className={s.logoWrap}>
            <img src="/logo.png" alt="Bledot" className={s.logoImg}/>
            <div className={s.logoDivider}/>
            <div>
              <div className={s.logoProduct}>GPU Monitor</div>
              <div className={s.logoSub}>by Bledot</div>
            </div>
          </div>
          <span className={s.tagline}>AI Cost Intelligence</span>
        </div>
        <div className={s.hR}>
          <div style={{display:'flex',alignItems:'center'}}>
            <Dot on={connected}/>
            <span className={s.statusTxt} style={{color:connected?'var(--green)':'var(--red)'}}>
              {connected?'ONLINE':'OFFLINE'}
            </span>
          </div>
          {lastUpdate&&<span className={s.lastUpd}>upd {fmtTime(lastUpdate.toISOString())}</span>}
          <div className={s.badge}>{gpuKeys.length} GPU{gpuKeys.length!==1?'s':''}</div>
        </div>
      </header>

      <nav className={s.nav}>
        {TABS.map(t=>(
          <button key={t.id} className={s.navBtn+(tab===t.id?' '+s.navActive:'')} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </nav>

      <main className={s.main}>
        {!connected&&(
          <div className={s.offline}>
            <div className={s.offlineTitle}>Backend não encontrado</div>
            <div className={s.offlineDesc}>
              Inicie o backend: <code>uvicorn main:app --reload</code><br/>
              Inicie o agent: <code>python agent.py</code>
            </div>
          </div>
        )}
        {connected&&gpuKeys.length===0&&(
          <div className={s.empty}>
            <div className={s.emptyIcon}>◈</div>
            <div className={s.emptyTitle}>Aguardando dados...</div>
            <div className={s.emptyDesc}>Inicie o agent: <code>python agent/agent.py</code></div>
          </div>
        )}

        {tab==='overview'&&connected&&<Overview costs={costs} insights={Object.values(insightMap)} gpuKeys={gpuKeys}/>}

        {tab==='gpus'&&connected&&(
          <div className={s.gpuGrid}>
            {gpuKeys.map(({key,machine_id,gpu_id,gpu_name})=>(
              <GPUPanel key={key} machine_id={machine_id} gpu_id={gpu_id} gpu_name={gpu_name}
                insight={insightMap[key]} history={historyMap[key]||[]} costData={costs}/>
            ))}
          </div>
        )}

        {tab==='processes'&&connected&&<ProcessesPanel gpuKeys={gpuKeys}/>}

        {tab==='cluster'&&connected&&<ClusterPanel machines={machines} insightMap={insightMap} costs={costs}/>}

        {tab==='costs'&&connected&&(
          <CostPanel costs={costs} costHistory={costHistory} period={costPeriod}
            onPeriodChange={p=>{setCostPeriod(p);setTimeout(refresh,100)}}
            onExport={()=>api.exportCsvUrl({minutes:costPeriod})}/>
        )}

        {tab==='projection'&&connected&&<ProjectionPanel gpuKeys={gpuKeys}/>}

        {tab==='automation'&&<AutomationPanel/>}

        {tab==='settings'&&<SettingsPanel/>}
      </main>
    </div>
  )
}
