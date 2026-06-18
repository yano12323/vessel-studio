import { useState, useRef, useEffect } from "react";

/* ═══ API ═══ */
async function callClaude(system, user, maxTokens = 16000, anthropicKey = "") {
  if (!anthropicKey) throw new Error("Anthropic APIキーが設定されていません。Settingsタブで設定してください。");
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "unknown");
        if (attempt < maxRetries - 1 && (res.status === 429 || res.status >= 500)) { await new Promise(r => setTimeout(r, (attempt + 1) * 5000)); continue; }
        throw new Error(`Claude API ${res.status}: ${errText.substring(0, 200)}`);
      }
      const data = await res.json();
      if (data.error) {
        if (attempt < maxRetries - 1 && data.error.type === "overloaded_error") { await new Promise(r => setTimeout(r, (attempt + 1) * 5000)); continue; }
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      const text = data.content.map(b => b.text || "").join("\n");
      if (!text.trim()) throw new Error("空のレスポンス");
      return text;
    } catch (e) {
      if (attempt < maxRetries - 1 && (e.message.includes("fetch") || e.message.includes("network"))) { await new Promise(r => setTimeout(r, (attempt + 1) * 3000)); continue; }
      throw e;
    }
  }
}

async function callClaudeLong(system, user, targetChars = 10000, onProgress, anthropicKey = "") {
  let acc = "";
  for (let part = 0; part < 4; part++) {
    const cur = acc.replace(/\s/g, "").length;
    if (cur >= targetChars * 0.85) break;
    if (onProgress) onProgress(part + 1, cur);
    const prompt = part === 0 ? user : `続きを書いてください。\n【末尾】\n${acc.slice(-1500)}\n\n【元の指示】\n${user}\n\n残り約${targetChars - cur}字。続きから。本文のみ。`;
    const chunk = await callClaude(system, prompt, 16000, anthropicKey);
    if (part === 0) { acc = chunk; } else {
      const tail = acc.slice(-200);
      let overlap = 0;
      for (let len = Math.min(tail.length, chunk.length, 100); len >= 20; len--) { if (chunk.startsWith(tail.slice(-len))) { overlap = len; break; } }
      acc += overlap > 0 ? chunk.slice(overlap) : "\n" + chunk;
    }
  }
  return acc;
}

async function generateImage(apiKey, prompt, size = "1024x1536") {
  if (!apiKey) throw new Error("OpenAI APIキーが設定されていません。Settingsタブで設定してください。");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, size, quality: "high" }),
  });
  if (!res.ok) { const err = await res.text().catch(() => ""); throw new Error(`OpenAI ${res.status}: ${err.substring(0, 200)}`); }
  const data = await res.json();
  if (data.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  if (data.data?.[0]?.url) return data.data[0].url;
  throw new Error("画像データなし");
}

/* ═══ Storage (localStorage for standalone) ═══ */
const SK = { proj: "vessel_projects", active: "vessel_active_id", oaiKey: "vessel_openai_key", claudeKey: "vessel_claude_key" };
function sGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function sSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error(e); } }
function sGetRaw(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
function sSetRaw(k, v) { try { localStorage.setItem(k, v); } catch (e) { console.error(e); } }

/* ═══ Defaults ═══ */
const BLANK = { id: 0, title: "", author: "", genre: "異世界ラブコメ", targetLength: 70000, characters: [], volumes: [], generatedTexts: {}, kdpMeta: {}, mangaPrompts: {}, coverImages: {}, xPosts: {}, volumeStatus: {} };
const GENRES = ["異世界ラブコメ","異世界ファンタジー","現代ラブコメ","アクション/バトル","コメディ","歴史","ミステリー","ホラー","SF","恋愛（一般）","BL","ダークファンタジー"];

/* ═══ Design ═══ */
const T = { bg:"#111118",s:"#191922",s2:"#1e1e2a",bd:"#2a2a3a",tx:"#eaeaf0",t2:"#a0a0b4",t3:"#6a6a80",p:"#6c8cff",sc:"#ff6c9d",ok:"#4cd9a0",w:"#ffb347",mono:"'IBM Plex Mono',monospace",body:"'Noto Sans JP',sans-serif" };

/* ═══ Components ═══ */
const Card = ({children,style,glow}) => <div style={{background:T.s,border:`1px solid ${T.bd}`,borderRadius:16,padding:"22px 20px",marginBottom:14,overflow:"hidden",...(glow?{boxShadow:`0 0 40px -10px ${glow}`}:{}),...style}}>{children}</div>;
const Label = ({children,color=T.p}) => <div style={{fontSize:11,fontWeight:700,color,letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:T.mono,marginBottom:12}}>{children}</div>;
const H = ({children}) => <h3 style={{fontSize:17,fontWeight:800,color:T.tx,margin:"0 0 4px 0",letterSpacing:"-0.02em"}}>{children}</h3>;
const Pill = ({children,color=T.p}) => <span style={{display:"inline-block",fontSize:11,fontWeight:700,color,background:color+"15",padding:"3px 11px",borderRadius:99,border:`1px solid ${color}30`}}>{children}</span>;
const Btn = ({children,onClick,v="primary",disabled,style:sx}) => {
  const bases={primary:{background:`linear-gradient(135deg,${T.p},#8b6cff)`,color:"#fff",border:"none"},secondary:{background:T.s2,color:T.tx,border:`1px solid ${T.bd}`},ghost:{background:"transparent",color:T.t2,border:`1px solid ${T.bd}`},danger:{background:"#ff4d6d15",color:"#ff6b81",border:"1px solid #ff4d6d30"},success:{background:`${T.ok}20`,color:T.ok,border:`1px solid ${T.ok}30`}};
  return <button onClick={onClick} disabled={disabled} style={{padding:"11px 22px",borderRadius:12,fontSize:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.4:1,transition:"all 0.15s",fontFamily:T.body,...bases[v],...sx}}>{children}</button>;
};
const Input = ({value,onChange,placeholder,type="text",style:sx}) => <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={{width:"100%",padding:"12px 14px",background:T.s2,border:`1px solid ${T.bd}`,borderRadius:10,color:T.tx,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:T.body,...sx}}/>;
const TA = ({value,onChange,rows=4,placeholder}) => <textarea value={value} onChange={onChange} rows={rows} placeholder={placeholder} style={{width:"100%",padding:"12px 14px",background:T.s2,border:`1px solid ${T.bd}`,borderRadius:10,color:T.tx,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:T.body,resize:"vertical",lineHeight:1.7,minHeight:rows*28}}/>;
const Sel = ({value,onChange,options}) => <select value={value} onChange={onChange} style={{width:"100%",padding:"12px 14px",background:T.s2,border:`1px solid ${T.bd}`,borderRadius:10,color:T.tx,fontSize:14,fontFamily:T.body,appearance:"auto",outline:"none",boxSizing:"border-box"}}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>;
const CopyBtn = ({text}) => { const [ok,setOk]=useState(false); return <button onClick={()=>{navigator.clipboard.writeText(text);setOk(true);setTimeout(()=>setOk(false),1200);}} style={{padding:"5px 14px",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",background:ok?`${T.ok}20`:T.s2,color:ok?T.ok:T.t3,border:`1px solid ${ok?T.ok+"40":T.bd}`,transition:"all 0.15s",fontFamily:T.mono,whiteSpace:"nowrap",flexShrink:0}}>{ok?"✓":"copy"}</button>;};
const Loader = ({msg}) => <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 0"}}><div style={{width:18,height:18,border:`2px solid ${T.bd}`,borderTop:`2px solid ${T.p}`,borderRadius:"50%",animation:"sp .7s linear infinite"}}/><span style={{fontSize:13,color:T.t2}}>{msg}</span></div>;
const Divider = () => <div style={{height:1,background:T.bd,margin:"16px 0"}}/>;
const Code = ({children}) => <div style={{fontFamily:T.mono,fontSize:12,color:T.p,background:T.bg,borderRadius:10,padding:"14px 16px",lineHeight:1.7,wordBreak:"break-all",border:`1px solid ${T.bd}`}}>{children}</div>;
const Empty = () => <Card style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:28,color:T.t3,opacity:0.3,marginBottom:12}}>◇</div><div style={{fontSize:15,color:T.t3}}>Homeタブでプロジェクトを選択してください</div></Card>;

const TABS = [
  {key:"home",icon:"◇",label:"Home"},
  {key:"studio",icon:"⬡",label:"Studio"},
  {key:"library",icon:"▤",label:"Library"},
  {key:"revenue",icon:"◎",label:"Revenue"},
  {key:"settings",icon:"⚙",label:"Settings"},
];
const STUDIO_SUBS = [
  {key:"novel",label:"Novel"},{key:"kdp",label:"KDP"},{key:"manga",label:"Manga"},{key:"cover",label:"Cover"},{key:"xpost",label:"X Post"},
];

/* ═══════ MAIN APP ═══════ */
export default function App() {
  const [projects,setProjects]=useState(()=>sGet(SK.proj)||[]);
  const [activeId,setActiveId]=useState(()=>sGet(SK.active));
  const [tab,setTab]=useState("home");
  const [studioSub,setStudioSub]=useState("novel");
  const [openaiKey,setOpenaiKey]=useState(()=>sGetRaw(SK.oaiKey));
  const [claudeKey,setClaudeKey]=useState(()=>sGetRaw(SK.claudeKey));
  const [genStatus,setGenStatus]=useState("");
  const [genLog,setGenLog]=useState([]);
  const [genVolNum,setGenVolNum]=useState(null);
  const genAbort=useRef(false);

  const proj=projects.find(p=>p.id===activeId)||null;
  const updateProj=(upd)=>{setProjects(prev=>{const next=prev.map(p=>p.id===activeId?{...p,...upd}:p);sSet(SK.proj,next);return next;});};
  const sv=(ps,id)=>{sSet(SK.proj,ps);sSet(SK.active,id);};

  // Shorthand for Claude calls with key
  const claude=(sys,usr,tok=16000)=>callClaude(sys,usr,tok,claudeKey);
  const claudeLong=(sys,usr,target,onProg)=>callClaudeLong(sys,usr,target,onProg,claudeKey);

  const keysOk = claudeKey && claudeKey.length > 5;

  /* ═══ HOME ═══ */
  function HomeView(){
    const [mode,setMode]=useState("manual");
    const [title,setTitle]=useState("");
    const [genre,setGenre]=useState("異世界ラブコメ");
    const [concept,setConcept]=useState("");
    const [ld,setLd]=useState("");
    const [editingId,setEditingId]=useState(null);
    const [editTitle,setEditTitle]=useState("");
    const [editAuthor,setEditAuthor]=useState("");

    const aiGen=async()=>{
      setLd("企画生成中...");
      try{
        const r=await claude("ラノベ企画編集者。JSONのみ。バッククォート不要。",`${concept?`コンセプト:${concept}\n`:""}ジャンル「${genre}」で売れるラノベ企画。JSON:{"title":"","genre":"","targetLength":70000,"characters":[{"name":"","role":"","desc":"50字"}],"volumes":[{"num":1,"title":"","synopsis":"100字","chapters":["7章分"]}]}キャラ5人。`,3000);
        const p=JSON.parse(r.replace(/```json|```/g,"").trim());
        const np={...BLANK,id:Date.now(),...p};const next=[...projects,np];setProjects(next);setActiveId(np.id);sv(next,np.id);setTab("studio");
      }catch(e){alert(e.message);}setLd("");
    };

    return <>
      {/* API Key Warning */}
      {!keysOk&&<Card style={{background:`${T.sc}10`,border:`1px solid ${T.sc}30`}}>
        <div style={{fontSize:14,fontWeight:700,color:T.sc,marginBottom:8}}>⚠ APIキーが未設定です</div>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:12}}>VESSEL Studioを使うには、最低限Anthropic（Claude）のAPIキーが必要です。表紙画像の生成にはOpenAIのキーも必要です。</div>
        <Btn v="secondary" onClick={()=>setTab("settings")} style={{fontSize:13}}>⚙ Settingsで設定する</Btn>
      </Card>}

      {/* Onboarding */}
      {projects.length===0&&(
        <Card glow={T.p+"30"}>
          <Label color={T.ok}>welcome to vessel studio</Label>
          <H>はじめましょう</H>
          <div style={{fontSize:14,color:T.t2,lineHeight:1.8,margin:"12px 0"}}>
            <div style={{marginBottom:8}}>VESSEL Studioは、小説の執筆からKDP出版まで全工程を管理するツールです。</div>
            <div><span style={{color:T.p,fontWeight:700}}>Step 1:</span> Settingsタブで APIキーを設定</div>
            <div><span style={{color:T.p,fontWeight:700}}>Step 2:</span> 下の「新規作成」でプロジェクトを作る</div>
            <div><span style={{color:T.p,fontWeight:700}}>Step 3:</span> Studioタブで小説を自動生成</div>
            <div><span style={{color:T.p,fontWeight:700}}>Step 4:</span> KDP・漫画・表紙・X投稿を一括生成</div>
          </div>
        </Card>
      )}

      {/* Projects list */}
      {projects.length>0&&(
        <Card>
          <Label>your projects ({projects.length})</Label>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {projects.map(p=>(
              <div key={p.id} style={{padding:"14px 16px",borderRadius:12,background:p.id===activeId?T.p+"15":T.s2,border:`1px solid ${p.id===activeId?T.p+"50":T.bd}`,cursor:"pointer",transition:"all 0.15s"}}
                onClick={()=>{setActiveId(p.id);sv(projects,p.id);setTab("studio");}}>
                {editingId===p.id?(
                  <div onClick={e=>e.stopPropagation()} style={{display:"flex",flexDirection:"column",gap:8}}>
                    <Input value={editTitle} onChange={e=>setEditTitle(e.target.value)} placeholder="タイトル"/>
                    <Input value={editAuthor} onChange={e=>setEditAuthor(e.target.value)} placeholder="著者名"/>
                    <div style={{display:"flex",gap:6}}>
                      <Btn v="success" style={{fontSize:11,padding:"6px 14px"}} onClick={()=>{setProjects(prev=>{const next=prev.map(x=>x.id===p.id?{...x,title:editTitle,author:editAuthor}:x);sSet(SK.proj,next);return next;});setEditingId(null);}}>保存</Btn>
                      <Btn v="ghost" style={{fontSize:11,padding:"6px 14px"}} onClick={()=>setEditingId(null)}>キャンセル</Btn>
                    </div>
                  </div>
                ):(
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontSize:15,fontWeight:700,color:T.tx,marginBottom:4}}>{p.title||"無題"}</div>
                      {p.author&&<div style={{fontSize:12,color:T.t3,marginBottom:4}}>by {p.author}</div>}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        <Pill color={T.p}>{p.genre}</Pill>
                        <Pill color={T.t3}>{p.volumes?.length||0}巻</Pill>
                        {Object.keys(p.generatedTexts||{}).length>0&&<Pill color={T.ok}>{Object.keys(p.generatedTexts).length}巻生成済</Pill>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>{setEditingId(p.id);setEditTitle(p.title);setEditAuthor(p.author||"");}} style={{background:"none",border:"none",color:T.t3,cursor:"pointer",fontSize:14,padding:4}}>✎</button>
                      <button onClick={()=>{if(confirm(`「${p.title||"無題"}」を削除しますか？`)){const next=projects.filter(x=>x.id!==p.id);setProjects(next);if(activeId===p.id)setActiveId(next[0]?.id||null);sv(next,next[0]?.id||null);}}} style={{background:"none",border:"none",color:T.t3,cursor:"pointer",fontSize:14,padding:4}}>×</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* New Project */}
      <Card glow={T.ok+"20"}>
        <Label color={T.ok}>new project</Label>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <Btn onClick={()=>setMode("manual")} v={mode==="manual"?"primary":"ghost"} style={{padding:"8px 18px",fontSize:12}}>手動入力</Btn>
          <Btn onClick={()=>setMode("ai")} v={mode==="ai"?"primary":"ghost"} style={{padding:"8px 18px",fontSize:12}}>AIに提案させる</Btn>
        </div>
        {mode==="manual"?(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Input placeholder="タイトル" value={title} onChange={e=>setTitle(e.target.value)}/>
            <Sel value={genre} onChange={e=>setGenre(e.target.value)} options={GENRES}/>
            <Btn onClick={()=>{const np={...BLANK,id:Date.now(),title,genre};const next=[...projects,np];setProjects(next);setActiveId(np.id);sv(next,np.id);setTab("studio");}}>作成</Btn>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Sel value={genre} onChange={e=>setGenre(e.target.value)} options={GENRES}/>
            <TA value={concept} onChange={e=>setConcept(e.target.value)} rows={3} placeholder="コンセプト（空欄ならAI自由提案）"/>
            {ld?<Loader msg={ld}/>:<Btn onClick={aiGen} disabled={!keysOk}>AIに企画を提案させる</Btn>}
          </div>
        )}
      </Card>
    </>;
  }

  /* ═══ STUDIO ═══ */
  function StudioView(){
    if(!proj)return <Empty/>;
    return <>
      <div style={{display:"flex",gap:4,marginBottom:16,overflowX:"auto",paddingBottom:4}}>
        {STUDIO_SUBS.map(s=>{
          const active=studioSub===s.key;
          const hasContent=s.key==="novel"?Object.keys(proj.generatedTexts||{}).length>0:s.key==="kdp"?Object.keys(proj.kdpMeta||{}).length>0:s.key==="manga"?Object.keys(proj.mangaPrompts||{}).length>0:s.key==="cover"?Object.keys(proj.coverImages||{}).length>0:s.key==="xpost"?proj.xPosts&&Object.keys(proj.xPosts).length>0:false;
          return <button key={s.key} onClick={()=>setStudioSub(s.key)} style={{padding:"9px 18px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",background:active?T.p+"20":"transparent",color:active?T.p:T.t3,border:`1px solid ${active?T.p+"40":T.bd}`,position:"relative"}}>
            {s.label}
            {hasContent&&<span style={{position:"absolute",top:4,right:4,width:6,height:6,borderRadius:"50%",background:T.ok}}/>}
          </button>;
        })}
      </div>
      {studioSub==="novel"&&<NovelSub/>}
      {studioSub==="kdp"&&<KdpSub/>}
      {studioSub==="manga"&&<MangaSub/>}
      {studioSub==="cover"&&<CoverSub/>}
      {studioSub==="xpost"&&<XPostSub/>}
    </>;
  }

  /* ─── Novel Sub (same structure as v4, using claude/claudeLong helpers) ─── */
  function NovelSub(){
    const [selVol,setSelVol]=useState(0);const [ld,setLd]=useState("");const [showReader,setShowReader]=useState(false);
    const [editCharIdx,setEditCharIdx]=useState(null);const [editChapIdx,setEditChapIdx]=useState(null);
    const vol=proj.volumes?.[selVol];

    const addVol=async()=>{setLd("続巻構想中...");try{const ex=(proj.volumes||[]).map(v=>`第${v.num}巻「${v.title}」:${v.synopsis}`).join("\n");const cs=(proj.characters||[]).map(c=>`${c.name}(${c.role}):${c.desc}`).join("\n");
    const r=await claude("続巻企画。JSONのみ。バッククォート不要。",`「${proj.title}」続巻。\n${cs}\n既刊:\n${ex||"なし"}\n次巻:${(proj.volumes?.length||0)+1}\nJSON:{"num":${(proj.volumes?.length||0)+1},"title":"","synopsis":"100字","chapters":["7章"]}`,2000);
    const p=JSON.parse(r.replace(/```json|```/g,"").trim());updateProj({volumes:[...(proj.volumes||[]),p]});}catch(e){alert(e.message);}setLd("");};

    const gen=async(resume=false)=>{
      if(!vol)return;if(!resume&&txt&&!confirm("既存の生成テキストが上書きされます。よろしいですか？"))return;
      genAbort.current=false;setGenStatus("run");setGenLog([]);setGenVolNum(vol.num);
      const addLog=m=>setGenLog(p=>[...p,`${new Date().toLocaleTimeString()} — ${m}`]);
      const cs=(proj.characters||[]).map(c=>`【${c.name}】（${c.role}）${c.desc}`).join("\n");
      const cpc=Math.round((proj.targetLength||70000)/vol.chapters.length);
      let full="",sums=[];let startFrom=0;
      if(resume&&txt){full=txt;startFrom=existingChapCount;addLog(`📂 第${startFrom}章まで完了済み — 第${startFrom+1}章から再開`);
        const parts=txt.split("\n\n\n").filter(s=>s.trim().length>50);
        for(let i=0;i<parts.length;i++){try{const s=await claude("80字以内で要約。",`要約:\n${parts[i].substring(0,2000)}`,200);sums.push(`第${i+1}章:${s}`);}catch{sums.push(`第${i+1}章:（既存章）`);}}
      }
      let done=startFrom;
      for(let i=startFrom;i<vol.chapters.length;i++){
        if(genAbort.current){addLog("中断 — 次回「再開」で続きから");break;}
        addLog(`第${i+1}章/${vol.chapters.length}章 — 執筆中`);
        let ch=null;
        for(let retry=0;retry<3;retry++){
          try{const prev=sums.length?`\n【前章要約】\n${sums.join("\n")}`:"";
          ch=await claudeLong("プロのラノベ作家。本文のみ出力。章の最後まで書ききる。",`【${proj.title}】第${vol.num}巻「${vol.title}」第${i+1}章:${vol.chapters[i]}\n【キャラ】\n${cs}${prev}\n\n約${cpc}字。三人称ラノベ文体。会話「」。段落頭全角スペース。`,cpc,(part,chars)=>addLog(`  パート${part}...（${chars.toLocaleString()}字）`));break;
          }catch(e){addLog(`  エラー(${retry+1}/3):${e.message}`);if(retry<2)await new Promise(r=>setTimeout(r,(retry+1)*10000));}
        }
        if(ch){full+=(done>0?"\n\n\n":"")+ch;done++;addLog(`第${i+1}章完了 — ${ch.replace(/\s/g,"").length.toLocaleString()}字`);
          try{const s=await claude("80字以内で要約。",`要約:\n${ch.substring(0,2000)}`,200);sums.push(`第${i+1}章:${s}`);}catch{sums.push(`第${i+1}章:（要約失敗）`);}
          updateProj({generatedTexts:{...(proj.generatedTexts||{}),[String(vol.num)]:full}});addLog("  💾 保存");
        }
      }
      if(done===vol.chapters.length)addLog(`🎉 全章完成 — ${full.replace(/\s/g,"").length.toLocaleString()}字`);
      else if(done>0)addLog(`⚠️ ${done}/${vol.chapters.length}章完了（途中保存済み）`);
      setGenStatus(done>0?"done":"err");setGenVolNum(null);
    };

    const isGenThis=genStatus==="run"&&genVolNum===vol?.num;
    const txt=proj.generatedTexts?.[String(vol?.num)];
    const existingChapCount=txt?txt.split("\n\n\n").filter(s=>s.trim().length>50).length:0;
    const totalChaps=vol?.chapters?.length||7;const isComplete=existingChapCount>=totalChaps;
    const canResume=txt&&existingChapCount>0&&!isComplete;

    return <>
      {/* Characters */}
      <Card><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><Label color={T.sc}>characters</Label>
        <Btn v="ghost" style={{padding:"6px 14px",fontSize:11}} onClick={async()=>{setLd("...");try{const r=await claude("キャラ設定。JSONのみ。バッククォート不要。",`「${proj.title}」（${proj.genre}）のキャラ5人。JSON:[{"name":"","role":"","desc":"80字"}]`,2000);updateProj({characters:JSON.parse(r.replace(/```json|```/g,"").trim())});}catch(e){alert(e.message);}setLd("");}}>AI生成</Btn></div>
        {(proj.characters||[]).map((c,i)=><div key={i} style={{padding:"12px 14px",background:T.s2,borderRadius:10,border:`1px solid ${T.bd}`,marginBottom:8}}>
          {editCharIdx===i?<div style={{display:"flex",flexDirection:"column",gap:8}}>
            <Input value={c.name} onChange={e=>{const ch=[...proj.characters];ch[i]={...ch[i],name:e.target.value};updateProj({characters:ch});}} placeholder="名前"/>
            <Input value={c.role} onChange={e=>{const ch=[...proj.characters];ch[i]={...ch[i],role:e.target.value};updateProj({characters:ch});}} placeholder="役割"/>
            <TA value={c.desc} onChange={e=>{const ch=[...proj.characters];ch[i]={...ch[i],desc:e.target.value};updateProj({characters:ch});}} rows={2} placeholder="説明"/>
            <Btn v="success" style={{fontSize:11,padding:"6px 14px"}} onClick={()=>setEditCharIdx(null)}>完了</Btn>
          </div>:<div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{display:"flex",gap:8,marginBottom:4}}><span style={{fontWeight:700,color:T.tx}}>{c.name}</span><Pill color={T.sc}>{c.role}</Pill></div><div style={{fontSize:13,color:T.t2}}>{c.desc}</div></div>
            <button onClick={()=>setEditCharIdx(i)} style={{background:"none",border:"none",color:T.t3,cursor:"pointer",flexShrink:0}}>✎</button></div>}
        </div>)}
      </Card>

      {/* Volumes */}
      <Card><div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}><Label>volumes</Label><Btn v="ghost" style={{padding:"6px 14px",fontSize:11}} onClick={addVol}>+ 続巻</Btn></div>
        {(proj.volumes||[]).map((v,i)=><div key={i} onClick={()=>setSelVol(i)} style={{padding:"14px 16px",borderRadius:12,cursor:"pointer",marginBottom:6,background:selVol===i?T.p+"10":T.s2,border:`1px solid ${selVol===i?T.p+"50":T.bd}`}}>
          <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700}}><span style={{fontFamily:T.mono,color:T.p,marginRight:8}}>Vol.{v.num}</span>{v.title}</span>{proj.generatedTexts?.[String(v.num)]&&<Pill color={T.ok}>生成済</Pill>}</div>
          <div style={{fontSize:12,color:T.t3,marginTop:4}}>{v.synopsis}</div>
        </div>)}
      </Card>

      {/* Gen area */}
      {vol&&<Card glow={T.p+"20"}><Label>vol.{vol.num}</Label>
        <div style={{marginBottom:16}}>{vol.chapters.map((ch,i)=><div key={i} style={{display:"flex",gap:8,padding:"6px 0",borderBottom:i<vol.chapters.length-1?`1px solid ${T.bd}`:"none"}}>
          <span style={{fontFamily:T.mono,fontSize:11,color:T.t3,width:20,textAlign:"right"}}>{i+1}</span>
          {editChapIdx===i?<div style={{flex:1,display:"flex",gap:6}}><Input value={ch} onChange={e=>{const vs=[...proj.volumes];vs[selVol]={...vs[selVol],chapters:[...vs[selVol].chapters]};vs[selVol].chapters[i]=e.target.value;updateProj({volumes:vs});}} style={{fontSize:13,padding:"6px 10px"}}/><button onClick={()=>setEditChapIdx(null)} style={{background:"none",border:"none",color:T.ok,cursor:"pointer"}}>✓</button></div>
          :<div style={{flex:1,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,color:T.t2}}>{ch}</span><button onClick={()=>setEditChapIdx(i)} style={{background:"none",border:"none",color:T.t3,cursor:"pointer",flexShrink:0}}>✎</button></div>}
        </div>)}</div>

        {txt&&<div style={{padding:16,background:isComplete?`${T.ok}15`:`${T.w}15`,borderRadius:12,border:`1px solid ${isComplete?T.ok:T.w}30`,marginBottom:16}}>
          <div style={{fontSize:14,fontWeight:700,color:isComplete?T.ok:T.w,marginBottom:6}}>{isComplete?"✓ 全章完了":`⚠ ${existingChapCount}/${totalChaps}章`} — {txt.replace(/\s/g,"").length.toLocaleString()}文字</div>
          <div style={{display:"flex",gap:3,marginBottom:12}}>{Array.from({length:totalChaps}).map((_,i)=><div key={i} style={{flex:1,height:6,borderRadius:99,background:i<existingChapCount?(isComplete?T.ok:T.w):T.s2}}/>)}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><Btn v="success" style={{fontSize:12,padding:"8px 16px"}} onClick={()=>{const b=new Blob([txt],{type:"text/plain;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`${proj.title}_Vol${vol.num}.txt`;a.click();}}>Download</Btn><CopyBtn text={txt}/><Btn v="ghost" style={{fontSize:12,padding:"8px 16px"}} onClick={()=>setShowReader(!showReader)}>{showReader?"閉じる":"全文を読む"}</Btn></div>
          {canResume&&!isGenThis&&<div style={{marginTop:12}}><Btn onClick={()=>gen(true)} style={{width:"100%",padding:"14px",fontSize:14,background:`linear-gradient(135deg,${T.ok},#2dd4bf)`}}>▶ 第{existingChapCount+1}章から再開</Btn></div>}
        </div>}
        {showReader&&txt&&<div style={{maxHeight:500,overflowY:"auto",padding:20,background:T.bg,borderRadius:12,border:`1px solid ${T.bd}`,marginBottom:16,fontSize:14,color:T.t2,lineHeight:2.2,whiteSpace:"pre-wrap",fontFamily:"'Noto Serif JP',serif"}}>{txt}</div>}

        {isGenThis?<><Loader msg="生成中..."/><div style={{background:T.bg,borderRadius:10,padding:12,maxHeight:200,overflowY:"auto",marginTop:8,border:`1px solid ${T.bd}`}}>{genLog.map((l,i)=><div key={i} style={{fontFamily:T.mono,fontSize:12,color:T.t2,lineHeight:2}}>{l}</div>)}</div><Btn v="danger" style={{marginTop:10,fontSize:12}} onClick={()=>{genAbort.current=true;}}>中断</Btn></>
        :<Btn onClick={()=>gen(false)} disabled={genStatus==="run"||!keysOk}>{txt?(isComplete?"最初から再生成":"最初から生成し直す"):`第${vol.num}巻を自動生成`}</Btn>}
      </Card>}
    </>;
  }

  /* ─── KDP Sub ─── */
  function KdpSub(){const [ld,setLd]=useState("");const [data,setData]=useState(null);
    const gen=async n=>{setLd("生成中...");try{const v=proj.volumes?.find(v=>v.num===n);const cs=(proj.characters||[]).map(c=>`${c.name}(${c.role}):${c.desc}`).join("\n");
    const r=await claude("KDPメタデータ専門家。JSONのみ。バッククォート不要。",`KDP入稿メタデータ。\n【タイトル】${proj.title}\n【巻】第${n}巻「${v?.title}」\n【ジャンル】${proj.genre}\n【キャラ】${cs}\n【あらすじ】${v?.synopsis}\n\nJSON:{"title":"","titleKana":"","titleRomaji":"","subtitle":"","seriesName":"","volumeNumber":${n},"description":"4000字以内","descriptionAlt":"A/Bテスト","keywords":["7つ"],"categories":["3つ"],"price":500,"royaltyPlan":"70%"}`,3000);
    const d=JSON.parse(r.replace(/```json|```/g,"").trim());setData(d);updateProj({kdpMeta:{...(proj.kdpMeta||{}),[String(n)]:d}});}catch(e){alert(e.message);}setLd("");};
    return <><Card><Label color={T.w}>kdp metadata</Label><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>{(proj.volumes||[]).map(v=><Btn key={v.num} v={proj.kdpMeta?.[String(v.num)]?"success":"secondary"} style={{fontSize:13}} onClick={()=>gen(v.num)}>第{v.num}巻{proj.kdpMeta?.[String(v.num)]?" ✓":""}</Btn>)}</div>{ld&&<Loader msg={ld}/>}</Card>
    {data&&<Card>{["title","titleKana","titleRomaji","subtitle","seriesName"].map(k=>data[k]&&<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${T.bd}`}}><div><div style={{fontSize:11,color:T.t3,fontFamily:T.mono}}>{k}</div><div style={{fontSize:14,color:T.tx}}>{data[k]}</div></div><CopyBtn text={data[k]}/></div>)}
    <Divider/>{["description","descriptionAlt"].map(k=>data[k]&&<div key={k} style={{marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontFamily:T.mono,fontSize:11,color:T.w,fontWeight:700}}>{k==="description"?"A":"B"}</span><CopyBtn text={data[k]}/></div><div style={{fontSize:13,color:T.t2,background:T.bg,borderRadius:10,padding:14,whiteSpace:"pre-wrap",lineHeight:1.8,border:`1px solid ${T.bd}`}}>{data[k]}</div></div>)}
    {data.keywords&&<div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"8px 0"}}>{data.keywords.map((k,i)=><span key={i} onClick={()=>navigator.clipboard.writeText(k)} style={{fontSize:13,padding:"5px 14px",background:T.p+"15",borderRadius:99,color:T.p,cursor:"pointer",border:`1px solid ${T.p}30`}}>{k}</span>)}</div>}
    </Card>}</>;
  }

  /* ─── Manga Sub ─── */
  function MangaSub(){const [ld,setLd]=useState("");const [data,setData]=useState(null);const [selVol,setSelVol]=useState(1);
    const gen=async()=>{const txt=proj.generatedTexts?.[String(selVol)];if(!txt){alert("先にNovelで小説を生成してください");return;}setLd("生成中...");try{const cs=(proj.characters||[]).map(c=>`${c.name}(${c.role}):${c.desc}`).join("\n");
    const r=await claude("漫画原作者。JSONのみ。バッククォート不要。",`小説→漫画。\n【キャラ】\n${cs}\n【テキスト】\n${txt.substring(0,5000)}\n\nJSON:{"characterSheets":[{"name":"","novelaiPrompt":"monochrome greyscale manga tags","expressions":["smile","angry","surprised"]}],"pages":[{"pageNum":1,"panels":[{"panelNum":1,"size":"large","description":"","novelaiPrompt":"tags","dialogue":"","sfx":""}]}]}\n5ページ。`,4096);
    const d=JSON.parse(r.replace(/```json|```/g,"").trim());setData(d);updateProj({mangaPrompts:{...(proj.mangaPrompts||{}),[String(selVol)]:d}});}catch(e){alert(e.message);}setLd("");};
    return <><Card><Label color={T.sc}>manga</Label><div style={{display:"flex",gap:8,margin:"12px 0",flexWrap:"wrap"}}>{(proj.volumes||[]).map(v=><Btn key={v.num} v={selVol===v.num?"primary":"ghost"} style={{fontSize:12}} onClick={()=>setSelVol(v.num)}>Vol.{v.num} {proj.generatedTexts?.[String(v.num)]?"✓":"—"}{proj.mangaPrompts?.[String(v.num)]?" 🖼":""}</Btn>)}</div>
    {ld?<Loader msg={ld}/>:<Btn onClick={gen} disabled={!keysOk}>生成</Btn>}</Card>
    {data?.characterSheets&&<Card><Label>characters</Label>{data.characterSheets.map((cs,i)=><div key={i} style={{padding:"14px 0",borderBottom:i<data.characterSheets.length-1?`1px solid ${T.bd}`:"none"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontWeight:700,color:T.tx}}>{cs.name}</span><CopyBtn text={cs.novelaiPrompt}/></div><Code>{cs.novelaiPrompt}</Code></div>)}</Card>}
    {data?.pages&&<Card><Label>pages</Label>{data.pages.map(pg=><div key={pg.pageNum} style={{marginBottom:16}}><div style={{fontFamily:T.mono,color:T.w,fontWeight:700,marginBottom:8}}>P{pg.pageNum}</div>{(pg.panels||[]).map(pn=><div key={pn.panelNum} style={{background:T.s2,borderRadius:10,padding:12,marginBottom:6,border:`1px solid ${T.bd}`}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><div style={{display:"flex",gap:6}}><Pill>{pn.panelNum}</Pill><Pill color={T.t3}>{pn.size}</Pill></div><CopyBtn text={pn.novelaiPrompt}/></div><Code>{pn.novelaiPrompt}</Code>{pn.dialogue&&<div style={{color:T.sc,marginTop:6}}>「{pn.dialogue}」</div>}</div>)}</div>)}</Card>}</>;
  }

  /* ─── Cover Sub ─── */
  function CoverSub(){
    const [ld,setLd]=useState("");
    const [sec,setSec]=useState("novel"); // novel | manga
    const [uploadedImg,setUploadedImg]=useState(null); // base64 data URL of uploaded Novel AI image
    const [finalImg,setFinalImg]=useState(proj.coverImages?.novel||null);
    const [mangaFinalImg,setMangaFinalImg]=useState(proj.coverImages?.manga||null);
    const [naiPrompt,setNaiPrompt]=useState("");
    const [titleText,setTitleText]=useState(proj.title||"");
    const [titlePos,setTitlePos]=useState("top"); // top | bottom
    const [titleStyle,setTitleStyle]=useState("bold_glow"); // bold_glow | elegant | impact
    const fileRef=useRef(null);
    const cs=()=>(proj.characters||[]).map(c=>`${c.name}(${c.role}):${c.desc}`).join("\n");

    // Convert data URL to Blob
    const dataUrlToBlob=async(dataUrl)=>{const res=await fetch(dataUrl);return await res.blob();};

    // Create mask: transparent where text should go, black where image is preserved
    const createMask=(width,height,position)=>{
      const canvas=document.createElement("canvas");
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext("2d");
      // Fill entire canvas with BLACK (opaque = preserve original)
      ctx.fillStyle="rgba(0,0,0,1)";
      ctx.fillRect(0,0,width,height);
      // Make title area TRANSPARENT (= area where GPT generates text)
      ctx.clearRect(0,position==="top"?0:height*0.75,width,height*0.25);
      return new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    };

    // Handle image upload
    const handleUpload=(e)=>{
      const file=e.target.files[0];if(!file)return;
      const reader=new FileReader();
      reader.onload=(ev)=>setUploadedImg(ev.target.result);
      reader.readAsDataURL(file);
    };

    // Generate Novel AI prompt for the illustration (no title text)
    const genNaiPrompt=async(type)=>{
      setLd("Novel AIプロンプト生成中...");
      try{
        const style=type==="novel"?"colorful anime illustration, vibrant colors, light novel cover art style":"monochrome, greyscale, manga cover, screentone, black and white";
        const r=await claude("AI画像生成専門家。JSONのみ。バッククォート不要。",
          `Novel AI用の${type==="novel"?"小説":"漫画"}表紙イラストプロンプトを生成。タイトル文字は含めない（後で別途追加するため）。キャラクターを中央に大きく配置。背景はシンプルに。

【タイトル】${proj.title}
【ジャンル】${proj.genre}
【キャラ】${cs()}

JSON:{
  "naiPrompt":"Novel AIタグ形式。${style}。キャラ中心の構図。no text, no title含む。positive: ... | negative: bad anatomy, bad hands, ...",
  "composition":"構図のアドバイス（日本語）",
  "vibeTransferTip":"Vibe Transfer設定のアドバイス（日本語）"
}`,2000);
        const p=JSON.parse(r.replace(/```json|```/g,"").trim());
        setNaiPrompt(p.naiPrompt||"");
        return p;
      }catch(e){alert(e.message);return null;}
      finally{setLd("");}
    };

    // Add title text via GPT Image 2 edit API
    const addTitleToImage=async()=>{
      if(!uploadedImg){alert("先にNovel AIで作った画像をアップロードしてください");return;}
      if(!openaiKey){alert("SettingsでOpenAI APIキーを設定してください");return;}
      if(!titleText.trim()){alert("タイトルを入力してください");return;}

      setLd("GPT Image 2でタイトル文字を追加中...(30〜60秒)");
      try{
        // Get image dimensions
        const img=new Image();
        await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=uploadedImg;});
        const w=img.naturalWidth||1024;const h=img.naturalHeight||1536;

        // Create mask
        const maskBlob=await createMask(w,h,titlePos);
        const imgBlob=await dataUrlToBlob(uploadedImg);

        // Style descriptions
        const styles={
          bold_glow:"Large bold Japanese text with subtle glow effect, high contrast, easy to read",
          elegant:"Elegant serif Japanese typography, refined and sophisticated style",
          impact:"Dynamic impact font, anime/manga style title with dramatic effect"
        };

        // Send to OpenAI edits API
        const formData=new FormData();
        formData.append("image",imgBlob,"image.png");
        formData.append("mask",maskBlob,"mask.png");
        formData.append("prompt",`Add professional book title text: "${titleText}" in large stylish Japanese characters. ${styles[titleStyle]}. The text should be ${titlePos==="top"?"at the top":"at the bottom"} of the image. Only add text, do not change the illustration.`);
        formData.append("model","gpt-image-1");
        formData.append("size",w>=1024?"1024x1536":"1024x1536");

        const res=await fetch("https://api.openai.com/v1/images/edits",{
          method:"POST",
          headers:{"Authorization":`Bearer ${openaiKey}`},
          body:formData,
        });

        if(!res.ok){
          const err=await res.text().catch(()=>"");
          throw new Error(`OpenAI ${res.status}: ${err.substring(0,300)}`);
        }

        const data=await res.json();
        let resultUrl;
        if(data.data?.[0]?.b64_json) resultUrl=`data:image/png;base64,${data.data[0].b64_json}`;
        else if(data.data?.[0]?.url) resultUrl=data.data[0].url;
        else throw new Error("画像データが返されませんでした");

        if(sec==="novel"){setFinalImg(resultUrl);updateProj({coverImages:{...(proj.coverImages||{}),novel:resultUrl}});}
        else{setMangaFinalImg(resultUrl);updateProj({coverImages:{...(proj.coverImages||{}),manga:resultUrl}});}
      }catch(e){alert("エラー: "+e.message);}
      setLd("");
    };

    // Fallback: full GPT generation (no upload needed)
    const genFullGpt=async(type)=>{
      if(!openaiKey){alert("SettingsでOpenAI APIキーを設定してください");return;}
      setLd("GPT Image 2で表紙を一括生成中...");
      try{
        const style=type==="novel"?"vibrant colorful anime":"monochrome manga screentone black and white";
        const r=await claude("表紙デザイン。JSONのみ。バッククォート不要。",
          `${type==="novel"?"小説":"漫画"}表紙プロンプト。\n${proj.title}\n${proj.genre}\n${cs()}\nJSON:{"imagePrompt":"Professional ${type==="novel"?"light novel":"manga"} book cover, ${style}, title '${titleText||proj.title}' in large Japanese text at ${titlePos}, main character centered, 1024x1536, professional layout"}`,1500);
        const p=JSON.parse(r.replace(/```json|```/g,"").trim());
        setLd("画像生成中...(30〜60秒)");
        const img=await generateImage(openaiKey,p.imagePrompt);
        if(type==="novel"){setFinalImg(img);updateProj({coverImages:{...(proj.coverImages||{}),novel:img}});}
        else{setMangaFinalImg(img);updateProj({coverImages:{...(proj.coverImages||{}),manga:img}});}
      }catch(e){alert(e.message);}
      setLd("");
    };

    const dl=(url,suf)=>{const a=document.createElement("a");a.href=url;a.download=`${proj.title}_${suf}.png`;a.click();};
    const currentImg=sec==="novel"?finalImg:mangaFinalImg;
    const currentType=sec==="novel"?"novel":"manga";

    return <>
      {!openaiKey&&<Card style={{background:`${T.w}10`,border:`1px solid ${T.w}30`}}><div style={{fontSize:13,color:T.w}}>⚠ タイトル文字追加にはOpenAI APIキーが必要 → <span style={{textDecoration:"underline",cursor:"pointer"}} onClick={()=>setTab("settings")}>Settings</span></div></Card>}

      {/* Section tabs */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[{k:"novel",l:"🎨 小説表紙",s:"カラー"},{k:"manga",l:"◈ 漫画表紙",s:"モノクロ"}].map(s=>
          <button key={s.k} onClick={()=>setSec(s.k)} style={{flex:1,padding:"14px",borderRadius:12,cursor:"pointer",background:sec===s.k?(s.k==="novel"?T.p:T.sc)+"15":T.s,border:`1px solid ${sec===s.k?(s.k==="novel"?T.p:T.sc)+"50":T.bd}`,color:sec===s.k?(s.k==="novel"?T.p:T.sc):T.t3,fontSize:14,fontWeight:700,textAlign:"center"}}>
            {s.l}<div style={{fontSize:11,fontWeight:400,marginTop:4,opacity:0.7}}>{s.s}</div>
          </button>
        )}
      </div>

      {/* ===== STEP 1: Novel AI Prompt Generation ===== */}
      <Card glow={(sec==="novel"?T.p:T.sc)+"20"}>
        <Label color={T.w}>step 1 — novel ai でイラスト生成</Label>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:14}}>
          Novel AI用のプロンプトを生成します。コピーしてNovel AIでイラストを作成してください。<br/>
          <span style={{color:T.w,fontWeight:700}}>※ タイトル文字は入れない</span>（Step 2で追加します）
        </div>
        {ld&&ld.includes("プロンプト")?<Loader msg={ld}/>:
          <Btn onClick={()=>genNaiPrompt(currentType)} disabled={!keysOk} v="secondary" style={{width:"100%",fontSize:13}}>
            Novel AI用プロンプトを生成
          </Btn>
        }
      </Card>

      {naiPrompt&&<Card glow={T.w+"20"}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
          <Label color={T.w}>novel ai prompt — コピーして使用</Label>
          <CopyBtn text={naiPrompt}/>
        </div>
        <Code>{naiPrompt}</Code>
        <div style={{fontSize:12,color:T.t3,marginTop:10,lineHeight:1.6}}>
          ↑をNovel AIに貼り付けてイラストを生成 → Vibe Transferでキャラ固定推奨<br/>
          生成後、画像を下のStep 2でアップロードしてください
        </div>
      </Card>}

      {/* ===== STEP 2: Upload + Add Title ===== */}
      <Card>
        <Label color={T.ok}>step 2 — 画像アップロード＋タイトル追加</Label>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:14}}>
          Novel AIで作ったイラストをアップロードし、GPT Image 2でタイトル文字を追加します。
        </div>

        {/* Upload */}
        <div style={{padding:16,background:T.s2,borderRadius:12,border:`1px solid ${T.bd}`,marginBottom:12,textAlign:"center"}}>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} style={{display:"none"}}/>
          <Btn v="secondary" onClick={()=>fileRef.current?.click()} style={{width:"100%",fontSize:13}}>
            {uploadedImg?"✓ 画像をアップロード済み — 変更する":"Novel AIの画像をアップロード"}
          </Btn>
          {uploadedImg&&<div style={{marginTop:12}}><img src={uploadedImg} alt="" style={{maxWidth:"100%",maxHeight:300,borderRadius:10,border:`1px solid ${T.bd}`}}/></div>}
        </div>

        {/* Title settings */}
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div>
            <div style={{fontSize:12,color:T.t3,marginBottom:6}}>タイトルテキスト</div>
            <Input value={titleText} onChange={e=>setTitleText(e.target.value)} placeholder="タイトルを入力..."/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:T.t3,marginBottom:6}}>位置</div>
              <div style={{display:"flex",gap:4}}>
                {[{k:"top",l:"上部"},{k:"bottom",l:"下部"}].map(p=>
                  <button key={p.k} onClick={()=>setTitlePos(p.k)} style={{flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",background:titlePos===p.k?T.p+"20":"transparent",color:titlePos===p.k?T.p:T.t3,border:`1px solid ${titlePos===p.k?T.p+"40":T.bd}`}}>{p.l}</button>
                )}
              </div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:T.t3,marginBottom:6}}>スタイル</div>
              <div style={{display:"flex",gap:4}}>
                {[{k:"bold_glow",l:"太字"},{k:"elegant",l:"優雅"},{k:"impact",l:"迫力"}].map(s=>
                  <button key={s.k} onClick={()=>setTitleStyle(s.k)} style={{flex:1,padding:"8px",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",background:titleStyle===s.k?T.sc+"20":"transparent",color:titleStyle===s.k?T.sc:T.t3,border:`1px solid ${titleStyle===s.k?T.sc+"40":T.bd}`}}>{s.l}</button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Generate button */}
        {ld&&!ld.includes("プロンプト")?<Loader msg={ld}/>:
          <Btn onClick={addTitleToImage} disabled={!uploadedImg||!openaiKey} style={{width:"100%",padding:"14px",fontSize:14,background:`linear-gradient(135deg,${T.ok},#2dd4bf)`}}>
            ⚡ GPT Image 2 でタイトルを追加
          </Btn>
        }
      </Card>

      {/* ===== Alternative: Full GPT generation ===== */}
      <Card>
        <Label color={T.t3}>または — gpt image 2 で一括生成</Label>
        <div style={{fontSize:12,color:T.t3,lineHeight:1.6,marginBottom:12}}>
          Novel AIを使わず、GPT Image 2だけで表紙を作ることもできます（キャラ一貫性は低下）
        </div>
        {ld?null:<Btn v="ghost" onClick={()=>genFullGpt(currentType)} disabled={!keysOk} style={{width:"100%",fontSize:12}}>
          GPT Image 2で{sec==="novel"?"小説":"漫画"}表紙を一括生成
        </Btn>}
      </Card>

      {/* ===== Result ===== */}
      {currentImg&&<Card glow={T.ok+"20"}>
        <Label color={T.ok}>完成した{sec==="novel"?"小説":"漫画"}表紙</Label>
        <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
          <div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${T.bd}`,maxWidth:320,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
            <img src={currentImg} alt="cover" style={{width:"100%",display:"block"}}/>
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <Btn v="success" style={{fontSize:12}} onClick={()=>dl(currentImg,currentType)}>ダウンロード</Btn>
          <Btn v="ghost" style={{fontSize:12}} onClick={()=>{if(uploadedImg)addTitleToImage();else genFullGpt(currentType);}}>再生成</Btn>
        </div>
      </Card>}
    </>;
  }

  /* ─── X Post Sub ─── */
  function XPostSub(){const [ld,setLd]=useState("");const [posts,setPosts]=useState(proj.xPosts&&Object.keys(proj.xPosts).length>0?proj.xPosts:null);
    const gen=async()=>{setLd("生成中...");try{const cs=(proj.characters||[]).map(c=>`${c.name}(${c.role}):${c.desc}`).join("\n");
    const r=await claude("SNSマーケ専門家。JSONのみ。バッククォート不要。",`X投稿15本。\n${proj.title}\n${proj.genre}\n${cs}\n\n各3本。140字。#タグ。\nJSON:{"newRelease":["3"],"characterTweet":["3"],"settingTease":["3"],"poll":["3"],"behindTheScenes":["3"]}`,3000);
    const d=JSON.parse(r.replace(/```json|```/g,"").trim());setPosts(d);updateProj({xPosts:d});}catch(e){alert(e.message);}setLd("");};
    const cats=[{key:"newRelease",l:"新刊告知",c:T.ok},{key:"characterTweet",l:"キャラなりきり",c:T.sc},{key:"settingTease",l:"設定ネタ",c:T.p},{key:"poll",l:"アンケート",c:T.w},{key:"behindTheScenes",l:"裏話",c:"#a0a0ff"}];
    return <><Card><Label color="#a0a0ff">x posts</Label>{ld?<Loader msg={ld}/>:<Btn onClick={gen} disabled={!keysOk}>15投稿を生成</Btn>}</Card>
    {posts&&cats.map(cat=><Card key={cat.key}><Pill color={cat.c}>{cat.l}</Pill><div style={{marginTop:10}}>{(posts[cat.key]||[]).map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"12px 0",borderBottom:i<2?`1px solid ${T.bd}`:"none"}}><div style={{fontSize:14,color:T.tx,lineHeight:1.7,flex:1}}>{p}</div><CopyBtn text={p}/></div>)}</div></Card>)}</>;
  }

  /* ═══ LIBRARY ═══ */
  function LibraryView(){const [search,setSearch]=useState("");const [filter,setFilter]=useState("all");const [preview,setPreview]=useState(null);
    const items=[];projects.forEach(p=>{(p.volumes||[]).forEach(v=>{const vk=String(v.num);const base={pt:p.title,vn:v.num,vt:v.title};
    if(p.generatedTexts?.[vk])items.push({...base,type:"novel",label:"小説",chars:p.generatedTexts[vk].replace(/\s/g,"").length,content:p.generatedTexts[vk],c:T.p});
    if(p.kdpMeta?.[vk])items.push({...base,type:"kdp",label:"KDP",content:p.kdpMeta[vk],c:T.w});
    if(p.mangaPrompts?.[vk])items.push({...base,type:"manga",label:"漫画",content:p.mangaPrompts[vk],c:T.sc});});
    if(p.coverImages?.novel)items.push({pt:p.title,type:"cover",label:"小説表紙",content:p.coverImages.novel,c:"#a78bfa",vn:0});
    if(p.coverImages?.manga)items.push({pt:p.title,type:"cover",label:"漫画表紙",content:p.coverImages.manga,c:"#a78bfa",vn:0});
    if(p.xPosts&&Object.keys(p.xPosts).length>0)items.push({pt:p.title,type:"xpost",label:"X投稿",content:p.xPosts,c:"#60a5fa",vn:0});});
    const filtered=items.filter(item=>{if(filter!=="all"&&item.type!==filter)return false;if(search)return(item.pt||"").toLowerCase().includes(search.toLowerCase());return true;});
    return <><Card><Label>library ({items.length})</Label><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="検索..." style={{margin:"12px 0"}}/>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{[{k:"all",l:"すべて"},{k:"novel",l:"小説"},{k:"kdp",l:"KDP"},{k:"manga",l:"漫画"},{k:"cover",l:"表紙"},{k:"xpost",l:"X投稿"}].map(f=><button key={f.k} onClick={()=>setFilter(f.k)} style={{padding:"7px 14px",borderRadius:99,fontSize:12,fontWeight:700,cursor:"pointer",background:filter===f.k?T.p+"20":"transparent",color:filter===f.k?T.p:T.t3,border:`1px solid ${filter===f.k?T.p+"40":T.bd}`}}>{f.l}</button>)}</div></Card>
    {filtered.map((item,i)=><div key={i} onClick={()=>setPreview(item)} style={{background:T.s,border:`1px solid ${T.bd}`,borderRadius:14,padding:"16px 18px",marginBottom:10,cursor:"pointer",borderLeft:`3px solid ${item.c}`}}>
      <div style={{display:"flex",gap:6,marginBottom:6}}><Pill color={item.c}>{item.label}</Pill>{item.vn>0&&<Pill color={T.t3}>Vol.{item.vn}</Pill>}</div>
      <div style={{fontSize:15,fontWeight:700,color:T.tx}}>{item.pt}</div>
      {item.chars&&<div style={{fontSize:12,fontFamily:T.mono,color:T.t3,marginTop:4}}>{item.chars.toLocaleString()}字</div>}
      {item.type==="cover"&&typeof item.content==="string"&&item.content.startsWith("data:")&&<div style={{marginTop:6}}><img src={item.content} alt="" style={{height:80,borderRadius:6}}/></div>}
    </div>)}
    {preview&&<div onClick={()=>setPreview(null)} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}><div onClick={e=>e.stopPropagation()} style={{background:T.s,border:`1px solid ${T.bd}`,borderRadius:20,width:"100%",maxWidth:620,maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"18px 22px",borderBottom:`1px solid ${T.bd}`,display:"flex",justifyContent:"space-between",flexShrink:0}}><div><div style={{fontFamily:T.mono,fontSize:10,color:T.t3}}>PREVIEW</div><div style={{fontSize:16,fontWeight:800,color:T.tx}}>{preview.pt}</div></div><button onClick={()=>setPreview(null)} style={{background:T.s2,border:`1px solid ${T.bd}`,borderRadius:10,width:36,height:36,color:T.t2,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button></div>
      <div style={{flex:1,overflow:"auto",padding:"18px 22px"}}>{preview.type==="novel"&&<div style={{fontSize:14,color:T.t2,lineHeight:2.2,whiteSpace:"pre-wrap",fontFamily:"'Noto Serif JP',serif"}}>{preview.content}</div>}
      {preview.type==="cover"&&typeof preview.content==="string"&&<div style={{textAlign:"center"}}><img src={preview.content} alt="" style={{maxWidth:"100%",maxHeight:500,borderRadius:12}}/></div>}
      {(preview.type==="kdp"||preview.type==="manga")&&<div style={{fontSize:13,color:T.t2,whiteSpace:"pre-wrap"}}>{JSON.stringify(preview.content,null,2)}</div>}
      {preview.type==="xpost"&&Object.entries(preview.content).map(([cat,ps])=><div key={cat} style={{marginBottom:14}}><div style={{fontFamily:T.mono,fontSize:11,color:T.t3,marginBottom:6}}>{cat}</div>{(Array.isArray(ps)?ps:[]).map((p,i)=><div key={i} style={{fontSize:13,color:T.tx,padding:"8px 12px",background:T.s2,borderRadius:8,marginBottom:4}}>{p}</div>)}</div>)}</div>
      <div style={{padding:"14px 22px",borderTop:`1px solid ${T.bd}`,display:"flex",gap:8,flexShrink:0}}><Btn v="ghost" style={{fontSize:12}} onClick={()=>setPreview(null)}>閉じる</Btn></div>
    </div></div>}
    </>;
  }

  /* ═══ REVENUE ═══ */
  function RevenueView(){const totalVols=(proj?.volumes||[]).length||0;
    const [v,setV]=useState({vols:totalVols||5,rpd:10,ppv:220,rate:0.5,ds:20,price:500});
    useEffect(()=>{if(totalVols>0)setV(p=>({...p,vols:totalVols}));},[totalVols]);
    const kenp=v.vols*v.rpd*30*v.ppv*v.rate;const sales=v.ds*(v.price*0.7)*v.vols;const total=kenp+sales;
    return <><Card><Label color={T.w}>revenue</Label><H>収益シミュレーター</H>
      {proj&&<div style={{fontSize:12,color:T.t3,marginBottom:14}}>「{proj.title}」{totalVols}巻を自動反映</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>{[{k:"vols",l:"巻数"},{k:"rpd",l:"KU既読/日/巻"},{k:"ppv",l:"KENP/巻"},{k:"rate",l:"レート(円)"},{k:"ds",l:"直接購入/月/巻"},{k:"price",l:"価格(円)"}].map(f=><label key={f.k} style={{fontSize:12,color:T.t3,fontFamily:T.mono}}>{f.l}<Input type="number" value={v[f.k]} onChange={e=>setV(p=>({...p,[f.k]:parseFloat(e.target.value)||0}))} style={{marginTop:6,fontFamily:T.mono}}/></label>)}</div></Card>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>{[{l:"KU",val:kenp,c:T.ok},{l:"購入",val:sales,c:T.p},{l:"合計",val:total,c:T.w}].map((r,i)=><Card key={i} style={{textAlign:"center",padding:"18px 10px"}}><div style={{fontSize:10,color:T.t3}}>{r.l}</div><div style={{fontFamily:T.mono,fontSize:22,fontWeight:900,color:r.c,margin:"6px 0"}}>¥{Math.round(r.val).toLocaleString()}</div><div style={{fontSize:10,color:T.t3}}>/月</div></Card>)}</div></>;
  }

  /* ═══ SETTINGS ═══ */
  function SettingsView(){
    const [ck,setCk]=useState(claudeKey);const [ok2,setOk2]=useState(openaiKey);const [saved,setSaved]=useState("");
    const saveKeys=async(type)=>{
      if(type==="claude"){setClaudeKey(ck);sSetRaw(SK.claudeKey,ck);}
      if(type==="openai"){setOpenaiKey(ok2);sSetRaw(SK.oaiKey,ok2);}
      setSaved(type);setTimeout(()=>setSaved(""),2000);
    };
    return <>
      <Card><Label color={T.sc}>anthropic api key（必須）</Label><H>Claude APIキー</H>
        <p style={{fontSize:13,color:T.t2,margin:"4px 0 16px",lineHeight:1.6}}>小説生成・KDP・漫画プロンプト・X投稿の全機能に必要です。<br/><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style={{color:T.p}}>console.anthropic.com</a> で取得。</p>
        <div style={{display:"flex",gap:8}}><Input type="password" value={ck} onChange={e=>setCk(e.target.value)} placeholder="sk-ant-..." style={{flex:1}}/>
        <Btn v={saved==="claude"?"success":"primary"} style={{flexShrink:0}} onClick={()=>saveKeys("claude")}>{saved==="claude"?"✓":"保存"}</Btn></div>
        <div style={{fontSize:12,color:T.t3,marginTop:8}}>ステータス: {claudeKey?<span style={{color:T.ok}}>✓ 設定済み</span>:<span style={{color:T.sc}}>未設定</span>}</div>
      </Card>
      <Card><Label color={T.w}>openai api key（表紙生成に必要）</Label><H>OpenAI APIキー</H>
        <p style={{fontSize:13,color:T.t2,margin:"4px 0 16px",lineHeight:1.6}}>表紙画像の生成（GPT Image 2）に必要です。<br/><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" style={{color:T.p}}>platform.openai.com</a> で取得。</p>
        <div style={{display:"flex",gap:8}}><Input type="password" value={ok2} onChange={e=>setOk2(e.target.value)} placeholder="sk-..." style={{flex:1}}/>
        <Btn v={saved==="openai"?"success":"primary"} style={{flexShrink:0}} onClick={()=>saveKeys("openai")}>{saved==="openai"?"✓":"保存"}</Btn></div>
        <div style={{fontSize:12,color:T.t3,marginTop:8}}>ステータス: {openaiKey?<span style={{color:T.ok}}>✓ 設定済み</span>:<span style={{color:T.sc}}>未設定</span>}</div>
      </Card>
      <Card><Label color={T.t3}>about</Label><div style={{fontSize:13,color:T.t2,lineHeight:1.8}}><div style={{fontWeight:700,marginBottom:4}}>VESSEL Studio v4</div>小説生成→KDP入稿→漫画化→表紙→SNS宣伝まで全工程を管理。<br/>データはブラウザに保存されます。APIキーは外部に送信されません（各APIへの直接通信のみ）。</div></Card>
    </>;
  }

  /* ═══ RENDER ═══ */
  const views={home:HomeView,studio:StudioView,library:LibraryView,revenue:RevenueView,settings:SettingsView};
  const View=views[tab];

  return <div style={{minHeight:"100vh",background:T.bg,color:T.tx,fontFamily:T.body,paddingBottom:80}}>
    <div style={{padding:"20px 18px 14px",maxWidth:680,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
      <div><div style={{fontFamily:T.mono,fontSize:10,fontWeight:700,color:T.t3,letterSpacing:"0.18em"}}>VESSEL STUDIO</div><h1 style={{fontSize:20,fontWeight:900,margin:"2px 0 0",color:T.tx}}>VESSEL Studio</h1></div>
      {proj&&proj.title&&<div style={{textAlign:"right"}}><div style={{fontSize:11,color:T.t3}}>active</div><div style={{fontSize:13,fontWeight:700,color:T.p,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{proj.title}</div></div>}
    </div>
    <div style={{maxWidth:680,margin:"0 auto",padding:"0 16px"}}><View/></div>
    {genStatus==="run"&&tab!=="studio"&&<div onClick={()=>{setTab("studio");setStudioSub("novel");}} style={{position:"fixed",bottom:56,left:0,right:0,zIndex:99,background:`${T.p}18`,backdropFilter:"blur(8px)",borderTop:`1px solid ${T.p}30`,padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer"}}><div style={{width:12,height:12,border:`2px solid ${T.p}40`,borderTop:`2px solid ${T.p}`,borderRadius:"50%",animation:"sp .7s linear infinite"}}/><span style={{fontSize:12,fontWeight:700,color:T.p}}>Vol.{genVolNum} 生成中</span></div>}
    <nav style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:"rgba(17,17,24,0.94)",backdropFilter:"blur(16px)",borderTop:`1px solid ${T.bd}`,padding:"8px 0 6px"}}>
      <div style={{display:"flex",justifyContent:"space-around",maxWidth:680,margin:"0 auto"}}>{TABS.map(t=>{const a=tab===t.key;const isGen=t.key==="studio"&&genStatus==="run";return <button key={t.key} onClick={()=>setTab(t.key)} style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 8px",color:a?T.p:isGen?T.ok:T.t3}}>
        <span style={{fontSize:18,fontWeight:a?800:400,opacity:a?1:0.5,position:"relative"}}>{t.icon}{isGen&&<span style={{position:"absolute",top:-2,right:-6,width:6,height:6,borderRadius:"50%",background:T.ok,animation:"pu 1.5s infinite"}}/>}</span>
        <span style={{fontSize:10,fontWeight:700}}>{t.label}</span>{a&&<div style={{width:16,height:2,background:T.p,borderRadius:99,marginTop:1}}/>}
      </button>})}</div>
    </nav>
  </div>;
}
