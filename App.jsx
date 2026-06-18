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
const BLANK = { id: 0, title: "", author: "", genre: "異世界ラブコメ", targetLength: 70000, characters: [], volumes: [], generatedTexts: {}, kdpMeta: {}, mangaPrompts: {}, coverImages: {}, charaImages: {}, charaPrompts: {}, xPosts: {}, volumeStatus: {} };
const GENRES = ["異世界ラブコメ","異世界ファンタジー","現代ラブコメ","アクション/バトル","コメディ","歴史","ミステリー","ホラー","SF","恋愛（一般）","BL","ダークファンタジー"];

/* ═══ Design ═══ */
const T = { bg:"#111118",s:"#191922",s2:"#1e1e2a",bd:"#2a2a3a",tx:"#eaeaf0",t2:"#a0a0b4",t3:"#6a6a80",p:"#6c8cff",sc:"#ff6c9d",ok:"#4cd9a0",w:"#ffb347",mono:"'IBM Plex Mono',monospace",body:"'Noto Sans JP',sans-serif" };

/* ═══ Components ═══ */
const Card = ({children,style,glow,onClick}) => <div onClick={onClick} style={{background:T.s,border:`1px solid ${T.bd}`,borderRadius:16,padding:"22px 20px",marginBottom:14,overflow:"hidden",...(glow?{boxShadow:`0 0 40px -10px ${glow}`}:{}),...style}}>{children}</div>;
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
  {key:"guide",icon:"📖",label:"Guide"},
  {key:"settings",icon:"⚙",label:"Settings"},
];
const STUDIO_SUBS = [
  {key:"novel",label:"Novel"},{key:"chara",label:"Chara"},{key:"kdp",label:"KDP"},{key:"manga",label:"Manga"},{key:"cover",label:"Cover"},{key:"xpost",label:"X Post"},
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
  // Safe string conversion for AI responses that might be objects
  const toStr=(v)=>typeof v==="object"&&v!==null?Object.entries(v).map(([k,val])=>`${k}: ${val}`).join("\n"):String(v||"");
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
          const hasContent=s.key==="novel"?Object.keys(proj.generatedTexts||{}).length>0:s.key==="chara"?Object.keys(proj.charaImages||{}).length>0:s.key==="kdp"?Object.keys(proj.kdpMeta||{}).length>0:s.key==="manga"?Object.keys(proj.mangaPrompts||{}).length>0:s.key==="cover"?Object.keys(proj.coverImages||{}).length>0:s.key==="xpost"?proj.xPosts&&Object.keys(proj.xPosts).length>0:false;
          return <button key={s.key} onClick={()=>setStudioSub(s.key)} style={{padding:"9px 18px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",background:active?T.p+"20":"transparent",color:active?T.p:T.t3,border:`1px solid ${active?T.p+"40":T.bd}`,position:"relative"}}>
            {s.label}
            {hasContent&&<span style={{position:"absolute",top:4,right:4,width:6,height:6,borderRadius:"50%",background:T.ok}}/>}
          </button>;
        })}
      </div>
      {studioSub==="novel"&&<NovelSub/>}
      {studioSub==="chara"&&<CharaSub/>}
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

  /* ─── Chara Sub (Character Illustration) ─── */
  function CharaSub(){
    const [ld,setLd]=useState("");
    const [prompts,setPrompts]=useState(proj.charaPrompts||{});
    const [images,setImages]=useState(proj.charaImages||{});
    const chars=proj.characters||[];

    // Generate Novel AI prompts for all characters
    const genAllPrompts=async()=>{
      if(chars.length===0){alert("先にNovelタブでキャラクターを作成してください");return;}
      setLd("キャラクタープロンプト生成中...");
      try{
        const charList=chars.map(c=>`${c.name}(${c.role}): ${c.desc}`).join("\n");
        const r=await claude("キャラクターデザイン＋AI画像生成専門家。JSONのみ。バッククォート不要。",
          `以下のキャラクターそれぞれについて、Novel AIで生成するための詳細プロンプトを作成してください。
全プロンプトに「no text, no title, no watermark, high quality, detailed」を含めてください。

【タイトル】${proj.title}
【ジャンル】${proj.genre}
【キャラクター】
${charList}

JSON形式で返してください：
{
  "characters": [
    {
      "name": "キャラ名",
      "fullBody": "全身イラスト用プロンプト（タグ形式）。1girl/1boyで始める。服装・髪型・目の色・体型を詳細に。simple background, white background含む",
      "faceCloseup": "顔アップ用プロンプト。portrait, face focus, upper body含む",
      "expressions": {
        "smile": "笑顔プロンプト",
        "angry": "怒りプロンプト",
        "sad": "悲しみプロンプト",
        "surprised": "驚きプロンプト"
      },
      "vibeTransferTip": "このキャラのVibe Transfer推奨設定（強度等）"
    }
  ]
}`,4096);
        const parsed=JSON.parse(r.replace(/```json|```/g,"").trim());
        const newPrompts={};
        (parsed.characters||[]).forEach(c=>{newPrompts[c.name]=c;});
        setPrompts(newPrompts);
        updateProj({charaPrompts:newPrompts});
      }catch(e){alert(e.message);}
      setLd("");
    };

    // Handle image upload for a character
    const uploadImage=(charName,type,e)=>{
      const file=e.target.files[0];if(!file)return;
      const reader=new FileReader();
      reader.onload=(ev)=>{
        const key=`${charName}_${type}`;
        const newImages={...images,[key]:ev.target.result};
        setImages(newImages);
        updateProj({charaImages:newImages});
      };
      reader.readAsDataURL(file);
    };

    return <>
      <Card glow={T.sc+"20"}>
        <Label color={T.sc}>character illustrations</Label>
        <H>キャラクターイラスト管理</H>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.7,margin:"8px 0 16px"}}>
          各キャラのNovel AIプロンプトを生成 → Novel AIでイラスト作成 → ここにアップロード。<br/>
          <span style={{color:T.w,fontWeight:700}}>この画像がVibe Transferの基準になります。表紙・漫画の前に必ず作成してください。</span>
        </div>
        {chars.length===0?(
          <div style={{padding:20,textAlign:"center",color:T.t3,fontSize:13}}>先にNovelタブでキャラクターを作成してください</div>
        ):(
          ld?<Loader msg={ld}/>:
          <Btn onClick={genAllPrompts} disabled={!keysOk} style={{width:"100%",padding:"14px",fontSize:14,background:`linear-gradient(135deg,${T.sc},#ff8c6c)`}}>
            ⚡ 全キャラのプロンプトを一括生成
          </Btn>
        )}
      </Card>

      {/* Per-character cards */}
      {chars.map((c,ci)=>{
        const p=prompts[c.name];
        const fullImg=images[`${c.name}_full`];
        const faceImg=images[`${c.name}_face`];
        return <Card key={ci}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <span style={{fontSize:16,fontWeight:800,color:T.tx}}>{c.name}</span>
            <Pill color={T.sc}>{c.role}</Pill>
            {(fullImg||faceImg)&&<Pill color={T.ok}>画像あり</Pill>}
          </div>
          <div style={{fontSize:12,color:T.t2,marginBottom:12}}>{c.desc}</div>

          {p?<>
            {/* Full body prompt */}
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontFamily:T.mono,fontSize:11,color:T.p,fontWeight:700}}>FULL BODY — 全身</span>
                <CopyBtn text={toStr(p.fullBody)}/>
              </div>
              <Code>{toStr(p.fullBody)}</Code>
              <div style={{marginTop:8}}>
                <div style={{fontSize:11,color:T.t3,marginBottom:4}}>Novel AIで生成した全身画像をアップロード（Vibe Transfer基準）</div>
                <input type="file" accept="image/*" onChange={(e)=>uploadImage(c.name,"full",e)} style={{fontSize:12,color:T.tx}}/>
                {fullImg&&<div style={{marginTop:8}}><img src={fullImg} alt="" style={{height:200,borderRadius:10,border:`1px solid ${T.bd}`}}/></div>}
              </div>
            </div>

            {/* Face closeup prompt */}
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontFamily:T.mono,fontSize:11,color:T.sc,fontWeight:700}}>FACE — 顔アップ</span>
                <CopyBtn text={toStr(p.faceCloseup)}/>
              </div>
              <Code>{toStr(p.faceCloseup)}</Code>
              <div style={{marginTop:8}}>
                <input type="file" accept="image/*" onChange={(e)=>uploadImage(c.name,"face",e)} style={{fontSize:12,color:T.tx}}/>
                {faceImg&&<div style={{marginTop:8}}><img src={faceImg} alt="" style={{height:150,borderRadius:10,border:`1px solid ${T.bd}`}}/></div>}
              </div>
            </div>

            {/* Expression prompts */}
            {p.expressions&&<div style={{marginBottom:10}}>
              <span style={{fontFamily:T.mono,fontSize:11,color:T.w,fontWeight:700}}>EXPRESSIONS — 表情差分</span>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:8}}>
                {Object.entries(p.expressions).map(([expr,prompt])=>
                  <div key={expr} style={{background:T.s2,borderRadius:8,padding:10,border:`1px solid ${T.bd}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <Pill color={T.w}>{expr}</Pill>
                      <CopyBtn text={toStr(prompt)}/>
                    </div>
                    <div style={{fontFamily:T.mono,fontSize:10,color:T.t2,lineHeight:1.5,wordBreak:"break-all"}}>{toStr(prompt)}</div>
                  </div>
                )}
              </div>
            </div>}

            {/* Vibe Transfer tip */}
            {p.vibeTransferTip&&<div style={{padding:10,background:T.p+"10",borderRadius:8,marginTop:8}}>
              <div style={{fontSize:12,color:T.p,lineHeight:1.6}}>💡 {toStr(p.vibeTransferTip)}</div>
            </div>}
          </>:(
            <div style={{padding:16,textAlign:"center",color:T.t3,fontSize:12,background:T.s2,borderRadius:10}}>
              上の「⚡ 全キャラのプロンプトを一括生成」でプロンプトが表示されます
            </div>
          )}
        </Card>;
      })}

      {Object.keys(prompts).length>0&&<Card style={{background:T.ok+"08",border:`1px solid ${T.ok}25`}}>
        <div style={{fontSize:13,color:T.ok,fontWeight:700,marginBottom:6}}>次のステップ</div>
        <div style={{fontSize:12,color:T.t2,lineHeight:1.7}}>
          1. 各プロンプトをNovel AIにコピペしてイラストを生成<br/>
          2. 全身画像をVibe Transferの参照画像に設定<br/>
          3. 生成した画像を上のフォームからアップロード<br/>
          4. 完了したらCoverタブで表紙作成、またはMangaタブで漫画生成へ
        </div>
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
  function MangaSub(){
    const [ld,setLd]=useState("");
    const [data,setData]=useState(null);
    const [selVol,setSelVol]=useState(1);
    const [panelImages,setPanelImages]=useState({});
    const [completedPages,setCompletedPages]=useState({});
    const [activeStep,setActiveStep]=useState("prompts");

    // Generate manga prompts from novel
    const gen=async()=>{
      const txt=proj.generatedTexts?.[String(selVol)];
      if(!txt){alert("先にNovelで小説を生成してください");return;}
      setLd("漫画プロンプト生成中...");
      try{
        const cs=(proj.characters||[]).map(c=>`${c.name}(${c.role}):${c.desc}`).join("\n");
        const r=await claude("漫画原作者兼レイアウト専門家。JSONのみ。バッククォート不要。",
          `小説を漫画に変換。各コマにセリフと効果音を必ず含める。

【キャラ】
${cs}

【小説テキスト（冒頭5000字）】
${txt.substring(0,5000)}

以下のJSON形式で返してください：
{
  "characterSheets":[{"name":"キャラ名","novelaiPrompt":"monochrome, greyscale, manga, screentone, ...タグ形式","expressions":["smile","angry","surprised","sad"]}],
  "pages":[{
    "pageNum":1,
    "panels":[{
      "panelNum":1,
      "size":"large",
      "description":"シーンの説明",
      "novelaiPrompt":"monochrome, greyscale, manga, screentone, ...タグ形式プロンプト",
      "dialogue":"セリフ（なければ空文字）",
      "sfx":"効果音（なければ空文字）",
      "speakerPosition":"left"
    }]
  }]
}

sizeは large/medium/small のいずれか。
speakerPositionは left/right/center のいずれか。
dialogueとsfxは必ず含めること（なければ空文字""）。
5ページ分、各ページ3〜5コマで生成。`,4096);
        const d=JSON.parse(r.replace(/```json|```/g,"").trim());
        setData(d);
        updateProj({mangaPrompts:{...(proj.mangaPrompts||{}),[String(selVol)]:d}});
      }catch(e){alert(e.message);}
      setLd("");
    };

    // ══ Page Composition Engine ══
    const PAGE_W=1200;
    const PAGE_H=1800;
    const GAP=8;
    const BORDER=3;
    const MARGIN=16;

    // Layout algorithm: arrange panels into rows
    const calcLayout=(panels)=>{
      const rows=[];
      let i=0;
      while(i<panels.length){
        const p=panels[i];
        if(p.size==="large"){
          rows.push([{...p,widthRatio:1}]);
          i++;
        }else if(p.size==="small"&&i+1<panels.length&&panels[i+1].size==="small"){
          rows.push([{...panels[i],widthRatio:0.5},{...panels[i+1],widthRatio:0.5}]);
          i+=2;
        }else{
          rows.push([{...p,widthRatio:1}]);
          i++;
        }
      }
      return rows;
    };

    // Draw speech bubble with vertical text
    const drawBubble=(ctx,x,y,w,h,text,position)=>{
      if(!text||!text.trim())return;
      const chars=text.split("");
      const fontSize=Math.max(Math.round(w/16),14);
      const lineH=fontSize*1.3;
      const maxPerCol=Math.floor((h*0.55)/lineH);
      const cols=Math.ceil(chars.length/maxPerCol);
      const bW=Math.max(cols*lineH+30,fontSize*2.5);
      const bH=Math.min(maxPerCol,chars.length)*lineH+24;

      let bx,by;
      if(position==="right"){bx=x+w-bW-12;by=y+10;}
      else if(position==="center"){bx=x+(w-bW)/2;by=y+10;}
      else{bx=x+12;by=y+10;}

      // Bubble shape
      ctx.fillStyle="rgba(255,255,255,0.95)";
      ctx.strokeStyle="rgba(0,0,0,0.85)";
      ctx.lineWidth=2;
      const cx=bx+bW/2;const cy=by+bH/2;
      ctx.beginPath();
      ctx.ellipse(cx,cy,bW/2,bH/2,0,0,Math.PI*2);
      ctx.fill();ctx.stroke();

      // Tail
      ctx.fillStyle="rgba(255,255,255,0.95)";
      ctx.beginPath();
      const dir=position==="right"?-1:position==="center"?0:1;
      ctx.moveTo(cx+dir*(bW*0.15),cy+bH*0.35);
      ctx.lineTo(cx+dir*(bW*0.25),cy+bH*0.5+10);
      ctx.lineTo(cx+dir*(bW*0.3),cy+bH*0.3);
      ctx.fill();

      // Vertical text (right to left columns)
      ctx.fillStyle="rgba(0,0,0,1)";
      ctx.font=`bold ${fontSize}px 'Noto Sans JP',sans-serif`;
      ctx.textAlign="center";ctx.textBaseline="middle";
      let col=0;let row=0;
      for(let c=0;c<chars.length;c++){
        const tx=bx+bW-16-col*lineH;
        const ty=by+16+row*lineH+lineH/2;
        ctx.fillText(chars[c],tx,ty);
        row++;
        if(row>=maxPerCol){row=0;col++;}
      }
    };

    // Draw SFX text
    const drawSfx=(ctx,x,y,w,h,sfx)=>{
      if(!sfx||!sfx.trim())return;
      const size=Math.max(Math.round(w/6),20);
      ctx.font=`900 ${size}px 'Noto Sans JP',sans-serif`;
      ctx.textAlign="center";
      ctx.strokeStyle="rgba(255,255,255,0.9)";
      ctx.lineWidth=Math.max(3,size/6);
      ctx.strokeText(sfx,x+w/2,y+h-size*0.8);
      ctx.fillStyle="rgba(0,0,0,0.9)";
      ctx.fillText(sfx,x+w/2,y+h-size*0.8);
    };

    // Compose a full manga page
    const composePage=async(pageNum)=>{
      const page=data?.pages?.find(p=>p.pageNum===pageNum);
      if(!page)return;

      const canvas=document.createElement("canvas");
      canvas.width=PAGE_W;canvas.height=PAGE_H;
      const ctx=canvas.getContext("2d");

      // White background
      ctx.fillStyle="#ffffff";
      ctx.fillRect(0,0,PAGE_W,PAGE_H);

      const rows=calcLayout(page.panels);
      const usableW=PAGE_W-MARGIN*2;
      const totalGapH=(rows.length-1)*GAP;
      const usableH=PAGE_H-MARGIN*2-totalGapH;
      const rowH=usableH/rows.length;

      let curY=MARGIN;

      for(const row of rows){
        const rowGapW=(row.length-1)*GAP;
        let curX=MARGIN;

        for(const panel of row){
          const pw=usableW*panel.widthRatio-(row.length>1?GAP/2:0);
          const ph=rowH;

          // Draw panel border
          ctx.strokeStyle="rgba(0,0,0,1)";
          ctx.lineWidth=BORDER;
          ctx.strokeRect(curX,curY,pw,ph);

          // Draw panel image if uploaded
          const key=`${pageNum}-${panel.panelNum}`;
          const imgUrl=panelImages[key];
          if(imgUrl){
            try{
              const img=new Image();
              await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=imgUrl;});
              // Fit image into panel (cover mode)
              const imgRatio=img.naturalWidth/img.naturalHeight;
              const panelRatio=pw/ph;
              let sx=0,sy=0,sw=img.naturalWidth,sh=img.naturalHeight;
              if(imgRatio>panelRatio){
                sw=img.naturalHeight*panelRatio;
                sx=(img.naturalWidth-sw)/2;
              }else{
                sh=img.naturalWidth/panelRatio;
                sy=(img.naturalHeight-sh)/2;
              }
              ctx.drawImage(img,sx,sy,sw,sh,curX+BORDER,curY+BORDER,pw-BORDER*2,ph-BORDER*2);
            }catch{}
          }else{
            // No image - draw placeholder
            ctx.fillStyle="rgba(240,240,240,1)";
            ctx.fillRect(curX+BORDER,curY+BORDER,pw-BORDER*2,ph-BORDER*2);
            ctx.fillStyle="rgba(180,180,180,1)";
            ctx.font="14px sans-serif";
            ctx.textAlign="center";
            ctx.fillText(`コマ${panel.panelNum}（画像未設定）`,curX+pw/2,curY+ph/2);
          }

          // Add speech bubble
          drawBubble(ctx,curX,curY,pw,ph,panel.dialogue,panel.speakerPosition||"left");

          // Add SFX
          drawSfx(ctx,curX,curY,pw,ph,panel.sfx);

          curX+=pw+GAP;
        }
        curY+=rowH+GAP;
      }

      const result=canvas.toDataURL("image/png");
      setCompletedPages(prev=>({...prev,[String(pageNum)]:result}));
      return result;
    };

    // Compose all pages
    const composeAll=async()=>{
      if(!data?.pages)return;
      setLd("全ページを生成中...");
      for(const page of data.pages){
        await composePage(page.pageNum);
      }
      setLd("");
    };

    const dlPage=(pageNum)=>{
      const url=completedPages[String(pageNum)];if(!url)return;
      const a=document.createElement("a");a.href=url;a.download=`manga_page_${pageNum}.png`;a.click();
    };

    const dlAll=()=>{
      Object.entries(completedPages).forEach(([num,url])=>{
        setTimeout(()=>{const a=document.createElement("a");a.href=url;a.download=`manga_page_${num}.png`;a.click();},parseInt(num)*300);
      });
    };

    const totalPanels=data?.pages?.reduce((a,p)=>a+(p.panels?.length||0),0)||0;
    const uploadedCount=Object.keys(panelImages).length;
    const completedCount=Object.keys(completedPages).length;
    const totalPages=data?.pages?.length||0;

    return <>
      {/* Step tabs */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[
          {k:"prompts",l:"① プロンプト生成"},
          {k:"upload",l:`② 画像アップロード (${uploadedCount}/${totalPanels})`},
          {k:"compose",l:`③ ページ生成 (${completedCount}/${totalPages})`},
        ].map(s=>
          <button key={s.k} onClick={()=>setActiveStep(s.k)} style={{flex:1,padding:"10px 4px",borderRadius:10,fontSize:12,fontWeight:700,cursor:"pointer",background:activeStep===s.k?T.sc+"20":"transparent",color:activeStep===s.k?T.sc:T.t3,border:`1px solid ${activeStep===s.k?T.sc+"40":T.bd}`}}>
            {s.l}
          </button>
        )}
      </div>

      {/* ═══ STEP 1: Prompt Generation ═══ */}
      {activeStep==="prompts"&&<>
        <Card><Label color={T.sc}>manga prompts</Label>
          <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:12}}>
            小説テキストから漫画の全コマ（プロンプト・セリフ・効果音・レイアウト）を一括生成します。
          </div>
          <div style={{display:"flex",gap:8,margin:"12px 0",flexWrap:"wrap"}}>
            {(proj.volumes||[]).map(v=><Btn key={v.num} v={selVol===v.num?"primary":"ghost"} style={{fontSize:12}} onClick={()=>setSelVol(v.num)}>
              Vol.{v.num} {proj.generatedTexts?.[String(v.num)]?"✓":"—"}
            </Btn>)}
          </div>
          {ld?<Loader msg={ld}/>:<Btn onClick={gen} disabled={!keysOk}>漫画プロンプトを生成</Btn>}
        </Card>

        {data?.characterSheets&&<Card><Label>character sheets — novel ai</Label>
          {data.characterSheets.map((cs,i)=>
            <div key={i} style={{padding:"14px 0",borderBottom:i<data.characterSheets.length-1?`1px solid ${T.bd}`:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontWeight:700,color:T.tx}}>{cs.name}</span><CopyBtn text={toStr(cs.novelaiPrompt)}/>
              </div>
              <Code>{toStr(cs.novelaiPrompt)}</Code>
            </div>
          )}
        </Card>}

        {data?.pages&&<Card><Label>pages & panels — プロンプト一覧</Label>
          {data.pages.map(pg=><div key={pg.pageNum} style={{marginBottom:20}}>
            <div style={{fontFamily:T.mono,color:T.w,fontWeight:700,marginBottom:8,fontSize:14}}>Page {pg.pageNum} — {pg.panels.length}コマ</div>
            {(pg.panels||[]).map(pn=>
              <div key={pn.panelNum} style={{background:T.s2,borderRadius:10,padding:12,marginBottom:6,border:`1px solid ${T.bd}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{display:"flex",gap:6}}><Pill>{pn.panelNum}</Pill><Pill color={T.t3}>{pn.size}</Pill></div>
                  <CopyBtn text={toStr(pn.novelaiPrompt)}/>
                </div>
                <div style={{fontSize:12,color:T.t2,marginBottom:4}}>{pn.description}</div>
                <Code>{toStr(pn.novelaiPrompt)}</Code>
                {pn.dialogue&&<div style={{color:T.sc,marginTop:8,fontSize:13}}>💬「{pn.dialogue}」</div>}
                {pn.sfx&&<div style={{color:T.w,marginTop:4,fontSize:12}}>SFX: {pn.sfx}</div>}
              </div>
            )}
          </div>)}
          <div style={{padding:14,background:T.ok+"10",borderRadius:10,border:`1px solid ${T.ok}30`,marginTop:8}}>
            <div style={{fontSize:13,color:T.ok,fontWeight:700}}>次のステップ</div>
            <div style={{fontSize:12,color:T.t2,marginTop:4,lineHeight:1.6}}>
              各コマのプロンプトをNovel AIにコピペして画像を生成 → 「② 画像アップロード」タブへ
            </div>
          </div>
        </Card>}
      </>}

      {/* ═══ STEP 2: Upload Panel Images ═══ */}
      {activeStep==="upload"&&<>
        {!data?<Card style={{textAlign:"center",padding:40}}><div style={{color:T.t3}}>先に「① プロンプト生成」を実行してください</div></Card>:<>
          <Card>
            <Label color={T.w}>panel images — アップロード</Label>
            <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:14}}>
              Novel AIで生成した各コマの画像をアップロードしてください。<br/>
              全コマアップロード後「③ ページ生成」で完成ページが出力されます。
            </div>
            <div style={{display:"flex",gap:3,marginBottom:8}}>
              {Array.from({length:totalPanels}).map((_,i)=>
                <div key={i} style={{flex:1,height:6,borderRadius:99,background:i<uploadedCount?T.w:T.s2}}/>
              )}
            </div>
            <div style={{fontSize:12,color:T.t3}}>{uploadedCount}/{totalPanels}コマ アップロード済み</div>
          </Card>

          {data.pages.map(pg=><Card key={pg.pageNum}>
            <Label color={T.w}>page {pg.pageNum}</Label>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(pg.panels||[]).map(pn=>{
                const key=`${pg.pageNum}-${pn.panelNum}`;
                const uploaded=panelImages[key];
                return <div key={pn.panelNum} style={{background:T.s2,borderRadius:10,padding:12,border:`1px solid ${uploaded?T.ok+"40":T.bd}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{display:"flex",gap:6}}>
                      <Pill>{pn.panelNum}</Pill><Pill color={T.t3}>{pn.size}</Pill>
                      {uploaded&&<Pill color={T.ok}>✓</Pill>}
                    </div>
                  </div>
                  {pn.dialogue&&<div style={{fontSize:12,color:T.sc,marginBottom:6}}>💬「{pn.dialogue}」</div>}
                  <input type="file" accept="image/*" onChange={e=>{
                    const file=e.target.files[0];if(!file)return;
                    const reader=new FileReader();
                    reader.onload=ev=>setPanelImages(prev=>({...prev,[key]:ev.target.result}));
                    reader.readAsDataURL(file);
                  }} style={{fontSize:12,color:T.tx}}/>
                  {uploaded&&<div style={{marginTop:8}}><img src={uploaded} alt="" style={{width:"100%",maxHeight:200,objectFit:"contain",borderRadius:8,border:`1px solid ${T.bd}`}}/></div>}
                </div>;
              })}
            </div>
          </Card>)}

          {uploadedCount>0&&<Card style={{background:T.ok+"10",border:`1px solid ${T.ok}30`}}>
            <div style={{fontSize:13,color:T.ok,fontWeight:700}}>次のステップ</div>
            <div style={{fontSize:12,color:T.t2,marginTop:4}}>「③ ページ生成」タブで完成ページを自動生成できます</div>
          </Card>}
        </>}
      </>}

      {/* ═══ STEP 3: Page Composition ═══ */}
      {activeStep==="compose"&&<>
        {!data?<Card style={{textAlign:"center",padding:40}}><div style={{color:T.t3}}>先に「① プロンプト生成」を実行してください</div></Card>:<>
          <Card>
            <Label color={T.ok}>page composition — ページ自動生成</Label>
            <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:14}}>
              アップロードしたコマ画像を自動レイアウトし、吹き出し・セリフ・効果音を配置した完成ページを出力します。
            </div>
            {uploadedCount===0&&<div style={{padding:14,background:T.w+"10",borderRadius:10,border:`1px solid ${T.w}30`,marginBottom:14}}>
              <div style={{fontSize:13,color:T.w}}>⚠ まだ画像がアップロードされていません。「② 画像アップロード」で画像を追加してください。</div>
            </div>}

            {ld?<Loader msg={ld}/>:
              <div style={{display:"flex",gap:8}}>
                <Btn onClick={composeAll} v="success" style={{flex:1,padding:"14px",fontSize:14}}>
                  ⚡ 全{totalPages}ページを一括生成
                </Btn>
                {completedCount>0&&<Btn onClick={dlAll} v="secondary" style={{fontSize:12,padding:"14px"}}>全DL</Btn>}
              </div>
            }
          </Card>

          {/* Completed pages preview */}
          {data.pages.map(pg=>{
            const pageImg=completedPages[String(pg.pageNum)];
            return <Card key={pg.pageNum}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <Label color={pageImg?T.ok:T.t3}>page {pg.pageNum} {pageImg?"— ✓ 完成":""}</Label>
                <div style={{display:"flex",gap:6}}>
                  {!ld&&<Btn v="ghost" style={{fontSize:11,padding:"6px 12px"}} onClick={()=>composePage(pg.pageNum)}>
                    {pageImg?"再生成":"生成"}
                  </Btn>}
                  {pageImg&&<Btn v="success" style={{fontSize:11,padding:"6px 12px"}} onClick={()=>dlPage(pg.pageNum)}>DL</Btn>}
                </div>
              </div>
              {pageImg?
                <img src={pageImg} alt={`Page ${pg.pageNum}`} style={{width:"100%",borderRadius:10,border:`1px solid ${T.bd}`}}/>
              :
                <div style={{padding:30,textAlign:"center",background:T.s2,borderRadius:10,border:`1px solid ${T.bd}`}}>
                  <div style={{color:T.t3,fontSize:13}}>
                    {uploadedCount>0?"「生成」ボタンで作成":"画像をアップロード後に生成できます"}
                  </div>
                  <div style={{fontSize:12,color:T.t3,marginTop:8}}>
                    {pg.panels.map(pn=>`コマ${pn.panelNum}(${pn.size})`).join(" / ")}
                  </div>
                </div>
              }
            </Card>;
          })}
        </>}
      </>}
    </>;
  }

  /* ─── Cover Sub ─── */
  function CoverSub(){
    const [ld,setLd]=useState("");
    const [sec,setSec]=useState("novel");
    const [uploadedImg,setUploadedImg]=useState(null);
    const [finalImg,setFinalImg]=useState(proj.coverImages?.novel||null);
    const [mangaFinalImg,setMangaFinalImg]=useState(proj.coverImages?.manga||null);
    const [naiPrompt,setNaiPrompt]=useState("");
    const [titleText,setTitleText]=useState(proj.title||"");
    const [subtitleText,setSubtitleText]=useState("");
    const [authorText,setAuthorText]=useState(proj.author||"");
    const [typographyPlan,setTypographyPlan]=useState(null);
    const fileRef=useRef(null);
    const cs=()=>(proj.characters||[]).map(c=>`${c.name}(${c.role}):${c.desc}`).join("\n");
    const dataUrlToBlob=async(u)=>{const r=await fetch(u);return await r.blob();};

    const handleUpload=(e)=>{
      const file=e.target.files[0];if(!file)return;
      const reader=new FileReader();
      reader.onload=(ev)=>setUploadedImg(ev.target.result);
      reader.readAsDataURL(file);
    };

    // Generate Novel AI prompt (no title text in illustration)
    const genNaiPrompt=async(type)=>{
      setLd("Novel AIプロンプト生成中...");
      try{
        const style=type==="novel"?"colorful anime, vibrant":"monochrome, greyscale, manga, screentone";
        const r=await claude("AI画像生成専門家。JSONのみ。バッククォート不要。",
          `Novel AI用の${type==="novel"?"小説":"漫画"}表紙イラストプロンプト。タイトル文字は入れない。キャラ中心の構図。上部または下部にテキストスペースを空ける。

【タイトル】${proj.title}
【ジャンル】${proj.genre}
【キャラ】${cs()}

JSON:{"naiPrompt":"Novel AIタグ形式。${style}。no text, no title, no watermark含む。positive: ... | negative: ...","vibeTransferTip":"Vibe Transfer設定のコツ"}`,2000);
        const p=JSON.parse(r.replace(/```json|```/g,"").trim());
        setNaiPrompt(typeof p.naiPrompt==="object"?Object.entries(p.naiPrompt).map(([k,v])=>`${k}: ${v}`).join("\n"):p.naiPrompt||"");
      }catch(e){alert(e.message);}
      setLd("");
    };

    // AI-driven title addition: Claude designs typography → GPT renders
    const addTitle=async()=>{
      if(!uploadedImg){alert("先にNovel AIで作った画像をアップロードしてください");return;}
      if(!openaiKey){alert("SettingsでOpenAI APIキーを設定してください");return;}
      if(!titleText.trim()){alert("タイトルを入力してください");return;}

      setLd("Claudeがタイポグラフィをデザイン中...");
      try{
        // Step 1: Claude analyzes and designs optimal typography
        const typoResult=await claude("書籍の表紙タイポグラフィデザインの世界的専門家。JSONのみ。バッククォート不要。",
          `以下の情報に基づいて、${sec==="novel"?"ライトノベル":"漫画"}の表紙に最適なタイポグラフィデザインを設計してください。

【タイトル】${titleText}
${subtitleText?`【サブタイトル】${subtitleText}`:""}
${authorText?`【著者名】${authorText}`:""}
【ジャンル】${proj.genre}
【表紙タイプ】${sec==="novel"?"カラーのアニメ風":"モノクロの漫画風"}

以下を自動判断してJSON:
{
  "titlePosition":"タイトルの配置を具体的に（例：upper center, top left, bottom right, diagonal across top, centered vertically on left side等）",
  "titleStyle":"フォントスタイルの詳細説明（例：bold gothic with metallic gold gradient and black outline, elegant serif with subtle shadow, dynamic brush stroke style with red accent等）",
  "titleColor":"メインカラー（例：white with gold gradient, crimson red, deep blue with white outline等）",
  "titleEffect":"エフェクト（例：outer glow, drop shadow, emboss, none, fire effect, ice crystal等）",
  "titleSize":"サイズ感（例：very large dominant, medium balanced, large but thin等）",
  "subtitleStyle":"サブタイトルのスタイル（位置・フォント・色・サイズ）",
  "authorStyle":"著者名のスタイル（位置・フォント・色・サイズ）",
  "overallLayout":"全体のレイアウト説明",
  "gptPrompt":"上記すべてを反映した、GPT Image 2への英語プロンプト。イラスト部分は変更せず、テキスト部分のみ追加する指示。非常に具体的かつ詳細に。300語程度。",
  "designRationale":"このデザインにした理由（日本語）"
}

ジャンルの雰囲気に合わせてください。異世界ラブコメなら明るく華やか、ダークファンタジーなら重厚、ホラーなら不気味、コメディならポップに。プロの装丁デザイナーが設計したような仕上がりを目指してください。`,3000);

        const typo=JSON.parse(typoResult.replace(/```json|```/g,"").trim());
        setTypographyPlan(typo);

        // Step 2: Apply to image via GPT Image 2
        setLd("GPT Image 2でタイトルを追加中...(30〜60秒)");
        const img=new Image();
        await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=uploadedImg;});
        const w=img.naturalWidth||1024;const h=img.naturalHeight||1536;

        // Create mask based on AI-decided position
        const canvas=document.createElement("canvas");
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext("2d");
        ctx.fillStyle="rgba(0,0,0,1)";
        ctx.fillRect(0,0,w,h);
        // Make 30% of the image transparent based on position
        const pos=typo.titlePosition.toLowerCase();
        if(pos.includes("bottom")){ctx.clearRect(0,h*0.7,w,h*0.3);}
        else if(pos.includes("center")&&pos.includes("vertical")){ctx.clearRect(0,h*0.35,w,h*0.3);}
        else if(pos.includes("diagonal")){ctx.clearRect(0,0,w,h*0.35);}
        else{ctx.clearRect(0,0,w,h*0.3);} // default: top

        const maskBlob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
        const imgBlob=await dataUrlToBlob(uploadedImg);

        const formData=new FormData();
        formData.append("image",imgBlob,"image.png");
        formData.append("mask",maskBlob,"mask.png");
        formData.append("prompt",typo.gptPrompt);
        formData.append("model","gpt-image-1");
        formData.append("size","1024x1536");

        const res=await fetch("https://api.openai.com/v1/images/edits",{
          method:"POST",headers:{"Authorization":`Bearer ${openaiKey}`},body:formData,
        });
        if(!res.ok){const err=await res.text().catch(()=>"");throw new Error(`OpenAI ${res.status}: ${err.substring(0,300)}`);}
        const data=await res.json();
        let resultUrl;
        if(data.data?.[0]?.b64_json)resultUrl=`data:image/png;base64,${data.data[0].b64_json}`;
        else if(data.data?.[0]?.url)resultUrl=data.data[0].url;
        else throw new Error("画像データなし");

        if(sec==="novel"){setFinalImg(resultUrl);updateProj({coverImages:{...(proj.coverImages||{}),novel:resultUrl}});}
        else{setMangaFinalImg(resultUrl);updateProj({coverImages:{...(proj.coverImages||{}),manga:resultUrl}});}
      }catch(e){alert("エラー: "+e.message);}
      setLd("");
    };

    // Full GPT fallback
    const genFullGpt=async(type)=>{
      if(!openaiKey){alert("SettingsでOpenAI APIキーを設定してください");return;}
      setLd("GPT Image 2で表紙を一括生成中...");
      try{
        const r=await claude("表紙デザイン専門家。JSONのみ。バッククォート不要。",
          `${type==="novel"?"小説":"漫画"}表紙をGPT Image 2で一括生成するための英語プロンプト。タイトル・著者名・デザインすべて含む。

【タイトル】${titleText||proj.title}
${authorText?`【著者名】${authorText}`:""}
【ジャンル】${proj.genre}
【キャラ】${cs()}
【スタイル】${type==="novel"?"colorful anime light novel":"monochrome manga"}

JSON:{"imagePrompt":"300語の詳細な英語プロンプト。プロの装丁デザイナーレベルのタイポグラフィ指示を含む。1024x1536。"}`,2000);
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

    return <>
      {!openaiKey&&<Card style={{background:`${T.w}10`,border:`1px solid ${T.w}30`}}><div style={{fontSize:13,color:T.w}}>⚠ タイトル追加にはOpenAI APIキーが必要 → <span style={{textDecoration:"underline",cursor:"pointer"}} onClick={()=>setTab("settings")}>Settings</span></div></Card>}

      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[{k:"novel",l:"🎨 小説表紙",s:"カラー"},{k:"manga",l:"◈ 漫画表紙",s:"モノクロ"}].map(s=>
          <button key={s.k} onClick={()=>setSec(s.k)} style={{flex:1,padding:"14px",borderRadius:12,cursor:"pointer",background:sec===s.k?(s.k==="novel"?T.p:T.sc)+"15":T.s,border:`1px solid ${sec===s.k?(s.k==="novel"?T.p:T.sc)+"50":T.bd}`,color:sec===s.k?(s.k==="novel"?T.p:T.sc):T.t3,fontSize:14,fontWeight:700,textAlign:"center"}}>
            {s.l}<div style={{fontSize:11,fontWeight:400,marginTop:4,opacity:0.7}}>{s.s}</div>
          </button>
        )}
      </div>

      {/* Step 1: Novel AI Prompt */}
      <Card glow={(sec==="novel"?T.p:T.sc)+"20"}>
        <Label color={T.w}>step 1 — novel ai でイラスト生成</Label>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:14}}>
          プロンプトを生成 → Novel AIでVibe Transfer付きイラストを作成<br/>
          <span style={{color:T.w}}>※タイトル文字は入れない</span>（Step 2でAIが自動デザイン）
        </div>
        {ld&&ld.includes("プロンプト")?<Loader msg={ld}/>:
          <Btn onClick={()=>genNaiPrompt(sec)} disabled={!keysOk} v="secondary" style={{width:"100%",fontSize:13}}>
            Novel AI用プロンプトを生成
          </Btn>}
      </Card>
      {naiPrompt&&<Card glow={T.w+"20"}><div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><Label color={T.w}>novel ai prompt</Label><CopyBtn text={naiPrompt}/></div><Code>{naiPrompt}</Code><div style={{fontSize:12,color:T.t3,marginTop:10}}>↑をNovel AIに貼り付け → 生成後Step 2へ</div></Card>}

      {/* Step 2: Upload + AI Typography */}
      <Card>
        <Label color={T.ok}>step 2 — ai自動タイポグラフィ</Label>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginBottom:14}}>
          画像をアップロードするだけ。フォント・色・位置・エフェクトは<span style={{color:T.ok,fontWeight:700}}>AIがジャンルに合わせて全自動でデザイン</span>します。
        </div>

        {/* Upload */}
        <div style={{padding:16,background:T.s2,borderRadius:12,border:`1px solid ${T.bd}`,marginBottom:12}}>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} style={{display:"none"}}/>
          <Btn v="secondary" onClick={()=>fileRef.current?.click()} style={{width:"100%",fontSize:13}}>
            {uploadedImg?"✓ 画像アップロード済み — 変更する":"Novel AIの画像をアップロード"}
          </Btn>
          {uploadedImg&&<div style={{marginTop:12,textAlign:"center"}}><img src={uploadedImg} alt="" style={{maxWidth:"100%",maxHeight:280,borderRadius:10,border:`1px solid ${T.bd}`}}/></div>}
        </div>

        {/* Text inputs */}
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div><div style={{fontSize:12,color:T.t3,marginBottom:4}}>タイトル</div><Input value={titleText} onChange={e=>setTitleText(e.target.value)} placeholder="メインタイトル"/></div>
          <div><div style={{fontSize:12,color:T.t3,marginBottom:4}}>サブタイトル（任意）</div><Input value={subtitleText} onChange={e=>setSubtitleText(e.target.value)} placeholder="巻タイトルなど"/></div>
          <div><div style={{fontSize:12,color:T.t3,marginBottom:4}}>著者名（任意）</div><Input value={authorText} onChange={e=>setAuthorText(e.target.value)} placeholder="ペンネーム"/></div>
        </div>

        {/* Generate */}
        {ld&&!ld.includes("プロンプト")?<Loader msg={ld}/>:
          <Btn onClick={addTitle} disabled={!uploadedImg||!openaiKey||!titleText.trim()} style={{width:"100%",padding:"16px",fontSize:15,background:`linear-gradient(135deg,${T.ok},#2dd4bf)`}}>
            ⚡ AIにお任せ — タイトルを自動デザイン
          </Btn>}
      </Card>

      {/* Typography Plan */}
      {typographyPlan&&<Card>
        <Label color={T.t3}>ai typography design</Label>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.8}}>
          <div style={{marginBottom:8}}><span style={{color:T.p,fontWeight:700}}>配置:</span> {typographyPlan.titlePosition}</div>
          <div style={{marginBottom:8}}><span style={{color:T.sc,fontWeight:700}}>スタイル:</span> {typographyPlan.titleStyle}</div>
          <div style={{marginBottom:8}}><span style={{color:T.w,fontWeight:700}}>カラー:</span> {typographyPlan.titleColor}</div>
          <div style={{marginBottom:8}}><span style={{color:T.ok,fontWeight:700}}>エフェクト:</span> {typographyPlan.titleEffect}</div>
          {typographyPlan.designRationale&&<div style={{marginTop:8,padding:12,background:T.s2,borderRadius:10,border:`1px solid ${T.bd}`}}><span style={{fontWeight:700,color:T.w}}>デザイン理由: </span>{typographyPlan.designRationale}</div>}
        </div>
      </Card>}

      {/* Fallback */}
      <Card><Label color={T.t3}>または — gpt image 2 で一括生成</Label>
        <div style={{fontSize:12,color:T.t3,marginBottom:10}}>Novel AIを使わず全部GPTに任せる（キャラ一貫性は低下）</div>
        {!ld&&<Btn v="ghost" onClick={()=>genFullGpt(sec)} disabled={!keysOk} style={{width:"100%",fontSize:12}}>GPTで一括生成</Btn>}
      </Card>

      {/* Result */}
      {currentImg&&<Card glow={T.ok+"20"}>
        <Label color={T.ok}>完成した表紙</Label>
        <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
          <div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${T.bd}`,maxWidth:320,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
            <img src={currentImg} alt="cover" style={{width:"100%",display:"block"}}/>
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
          <Btn v="success" style={{fontSize:12}} onClick={()=>dl(currentImg,sec)}>ダウンロード</Btn>
          <Btn v="ghost" style={{fontSize:12}} onClick={()=>{if(uploadedImg)addTitle();else genFullGpt(sec);}}>再生成</Btn>
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

  /* ═══ GUIDE ═══ */
  function GuideView(){
    const [openSection,setOpenSection]=useState(null);
    const toggle=(k)=>setOpenSection(openSection===k?null:k);
    const Section=({id,num,title,color,children})=>(
      <Card style={{cursor:"pointer",borderLeft:`3px solid ${color}`}} onClick={()=>toggle(id)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:T.mono,fontSize:13,fontWeight:900,color,background:color+"18",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8}}>{num}</span>
            <span style={{fontSize:15,fontWeight:700,color:T.tx}}>{title}</span>
          </div>
          <span style={{color:T.t3,fontSize:16,transform:openSection===id?"rotate(180deg)":"rotate(0)",transition:"transform 0.2s"}}>▾</span>
        </div>
        {openSection===id&&<div onClick={e=>e.stopPropagation()} style={{marginTop:16,fontSize:13,color:T.t2,lineHeight:2}}>{children}</div>}
      </Card>
    );
    const Step=({children,tool})=>(
      <div style={{display:"flex",gap:10,padding:"6px 0"}}>
        <span style={{color:T.ok,flexShrink:0}}>▸</span>
        <div style={{flex:1}}>{children}{tool&&<span style={{fontFamily:T.mono,fontSize:11,color:T.p,marginLeft:6,background:T.p+"15",padding:"1px 8px",borderRadius:4}}>{tool}</span>}</div>
      </div>
    );

    return <>
      <Card glow={T.p+"20"}>
        <Label color={T.p}>vessel studio — complete guide</Label>
        <H>制作ワークフロー 完全ガイド</H>
        <div style={{fontSize:13,color:T.t2,lineHeight:1.7,marginTop:8}}>
          小説の執筆からKDP出版まで、全工程の手順を解説します。<br/>各セクションをタップして詳細を表示。
        </div>
      </Card>

      <Section id="setup" num="0" title="初期設定" color={T.w}>
        <Step tool="Settings">Settingsタブを開く</Step>
        <Step tool="Settings">Anthropic APIキーを入力して保存（必須 — 小説生成等に使用）</Step>
        <Step>取得先: <a href="https://console.anthropic.com/settings/keys" target="_blank" style={{color:T.p}}>console.anthropic.com/settings/keys</a></Step>
        <Step tool="Settings">OpenAI APIキーを入力して保存（表紙の文字入れに使用）</Step>
        <Step>取得先: <a href="https://platform.openai.com/api-keys" target="_blank" style={{color:T.p}}>platform.openai.com/api-keys</a></Step>
        <Step>OpenAIは事前チャージ制（$5〜）。Billing → Add to balanceでチャージ</Step>
      </Section>

      <Section id="project" num="1" title="プロジェクト作成" color={T.p}>
        <Step tool="Home">Homeタブで「AIに提案させる」を選択</Step>
        <Step tool="Home">ジャンルを選び、コンセプトを入力（空欄でもOK）</Step>
        <Step tool="Home">「AIに企画を提案させる」ボタン → タイトル・キャラ5人・プロット・章構成が一括生成される</Step>
        <Step tool="Studio">自動でStudioタブに移動。キャラの✎ボタンで名前・設定を修正可能</Step>
        <Step tool="Studio">章構成の✎ボタンで各章のあらすじを修正可能</Step>
        <div style={{padding:10,background:T.ok+"10",borderRadius:8,marginTop:8,fontSize:12,color:T.ok}}>
          💡 「手動入力」でタイトルとジャンルだけ入力し、キャラと章構成は後からAI生成することも可能
        </div>
      </Section>

      <Section id="novel" num="2" title="小説の自動生成" color="#a78bfa">
        <Step tool="Studio → Novel">Studioタブ → Novelサブタブを開く</Step>
        <Step tool="Novel">生成したい巻を選択</Step>
        <Step tool="Novel">「第○巻を自動生成」ボタンを押す</Step>
        <Step>7章を順番に自動生成。1章ごとに自動保存されます</Step>
        <Step>所要時間：約15〜25分 / 巻（他のタブに移動しても処理は続きます）</Step>
        <Step>途中でPCを閉じても、次回「▶ 再開」ボタンで続きから生成できます</Step>
        <Step tool="Novel">完成後「Download .txt」でテキストファイルを取得</Step>
        <Step tool="Novel">「全文を読む」ボタンでアプリ内プレビューも可能</Step>
        <div style={{padding:10,background:T.w+"10",borderRadius:8,marginTop:8,fontSize:12,color:T.w}}>
          ⚠ 「最初から再生成」を押すと既存テキストが上書きされます（確認ダイアログあり）
        </div>
        <div style={{padding:10,background:T.p+"10",borderRadius:8,marginTop:6,fontSize:12,color:T.p}}>
          💰 APIコスト目安：約$1.25（約190円）/ 巻（約7万文字）
        </div>
      </Section>

      <Section id="char_illust" num="3" title="キャラクターイラスト作成（シリーズ初回のみ）" color={T.sc}>
        <Step tool="Studio → Cover">CoverサブタブでNovel AI用プロンプトを生成</Step>
        <Step tool="Novel AI">プロンプトをNovel AIにコピペしてキャラクターの基準画像を生成</Step>
        <Step tool="Novel AI">生成した画像をVibe Transferの参照画像に設定</Step>
        <Step>以降、この参照画像を使うことで全てのイラストでキャラの顔が統一されます</Step>
        <div style={{padding:10,background:T.sc+"10",borderRadius:8,marginTop:8,fontSize:12,color:T.sc}}>
          💡 Vibe Transferとは：参照画像の見た目を新しい画像に反映する機能。強度0.3〜0.7が最適
        </div>
      </Section>

      <Section id="novel_cover" num="4" title="小説表紙の作成" color="#a78bfa">
        <div style={{fontSize:12,color:T.t3,marginBottom:8,fontStyle:"italic"}}>Novel AIの高品質イラスト ＋ GPT Image 2の文字精度 を組み合わせます</div>
        <Step tool="Studio → Cover">Coverサブタブ → 「🎨 小説表紙」を選択</Step>
        <Step tool="Cover">Step 1「Novel AI用プロンプトを生成」→ コピー</Step>
        <Step tool="Novel AI">Novel AIでVibe Transferを使って表紙イラストを生成（文字なし）</Step>
        <Step tool="Cover">Step 2で画像をアップロード → タイトルを確認</Step>
        <Step tool="Cover">「GPT Image 2でタイトルを追加」ボタン → 文字入り表紙が完成</Step>
        <Step tool="Cover">ダウンロードしてKDP用に使用（推奨サイズ: 1600×2560にアップスケール）</Step>
        <div style={{padding:10,background:T.p+"10",borderRadius:8,marginTop:8,fontSize:12,color:T.p}}>
          💰 表紙1枚のコスト：約$0.17（約25円）
        </div>
      </Section>

      <Section id="manga_gen" num="5" title="漫画の生成" color={T.sc}>
        <div style={{fontWeight:700,color:T.tx,marginBottom:8}}>5-A. プロンプト生成</div>
        <Step tool="Studio → Manga">Mangaサブタブ → 「① プロンプト生成」</Step>
        <Step tool="Manga">巻を選んで「漫画プロンプトを生成」→ 全ページ分のコマ割り・プロンプト・セリフ・効果音が一括で出力</Step>
        <Step>出力内容：キャラシート / ページごとのコマ構成 / 各コマのNovel AIプロンプト / セリフ / SFX</Step>

        <div style={{fontWeight:700,color:T.tx,marginBottom:8,marginTop:16}}>5-B. 画像生成（Novel AI）</div>
        <Step tool="Novel AI">各コマのプロンプトをコピーしてNovel AIで画像生成</Step>
        <Step tool="Novel AI">Vibe Transferで同じキャラ参照画像を使うこと（キャラ統一のため）</Step>
        <Step>全コマ分の画像を保存しておく</Step>

        <div style={{fontWeight:700,color:T.tx,marginBottom:8,marginTop:16}}>5-C. 画像アップロード</div>
        <Step tool="Manga">「② 画像アップロード」タブで各コマの画像をアップロード</Step>
        <Step>進捗バーで何コマ完了したか確認</Step>

        <div style={{fontWeight:700,color:T.tx,marginBottom:8,marginTop:16}}>5-D. ページ生成（自動）</div>
        <Step tool="Manga">「③ ページ生成」タブ →「⚡ 全ページを一括生成」</Step>
        <Step>VESSEL Studioが自動で処理する内容：</Step>
        <div style={{paddingLeft:20,fontSize:12,color:T.t2}}>
          ・コマを指定サイズで自動レイアウト（large=横幅100%, small=2つ並び）<br/>
          ・吹き出しを話者の位置に自動配置<br/>
          ・セリフを縦書きで描画<br/>
          ・効果音（SFX）を太字で配置<br/>
          ・コマ枠線を描画<br/>
          ・完成ページ画像（1200×1800px）を出力
        </div>
        <Step>各ページのプレビューを確認 → ダウンロード</Step>
      </Section>

      <Section id="manga_cover" num="6" title="漫画表紙の作成" color={T.sc}>
        <Step tool="Studio → Cover">Coverサブタブ →「◈ 漫画表紙」を選択</Step>
        <Step tool="Cover">Step 1「Novel AI用プロンプトを生成」→ モノクロ漫画スタイルのプロンプトをコピー</Step>
        <Step tool="Novel AI">Novel AIでVibe Transferを使って漫画表紙イラストを生成（文字なし）</Step>
        <Step tool="Cover">Step 2で画像をアップロード → タイトル文字を追加</Step>
        <Step>または「GPT Image 2で漫画表紙を生成」で一括自動生成も可能</Step>
      </Section>

      <Section id="kdp" num="7" title="KDP入稿データの生成" color={T.w}>
        <Step tool="Studio → KDP">KDPサブタブを開く</Step>
        <Step tool="KDP">巻を選んでボタンを押す → 全入稿項目が一括生成</Step>
        <Step>生成される項目：タイトル / フリガナ / ローマ字 / サブタイトル / シリーズ名 / 内容紹介（A/Bテスト2パターン） / キーワード7つ / カテゴリー3つ / 価格 / ロイヤリティ</Step>
        <Step>各項目の「copy」ボタンでKDPの入力画面にそのまま貼り付け</Step>
        <Step>キーワードはタップでコピー</Step>
        <div style={{padding:10,background:T.w+"10",borderRadius:8,marginTop:8,fontSize:12,color:T.w}}>
          ⚠ KDPの「AI生成コンテンツ」の開示申告を忘れずに
        </div>
      </Section>

      <Section id="xpost" num="8" title="X投稿文の生成" color="#60a5fa">
        <Step tool="Studio → X Post">X Postサブタブを開く</Step>
        <Step tool="X Post">「15投稿を生成」ボタン → 5カテゴリ×3パターンが一括生成</Step>
        <Step>カテゴリ：新刊告知 / キャラなりきり / 設定ネタ / アンケート / 制作裏話</Step>
        <Step>各投稿の「copy」ボタンでXにそのまま貼り付け</Step>
        <div style={{padding:10,background:T.p+"10",borderRadius:8,marginTop:8,fontSize:12,color:T.p}}>
          💡 発売2〜3ヶ月前からアカウントを育て始めると、発売日の初動が良くなります
        </div>
      </Section>

      <Section id="publish" num="9" title="KDPへの出版" color={T.ok}>
        <Step>kdp.amazon.co.jp にログイン</Step>
        <Step>「電子書籍」→「新しい電子書籍を作成」</Step>
        <Step>VESSEL Studioで生成したKDPメタデータを各欄にコピペ</Step>
        <Step>原稿ファイル（.txt or .epub）をアップロード</Step>
        <Step>表紙画像をアップロード（推奨: 1600×2560px）</Step>
        <Step>KDPセレクト（Kindle Unlimited）に登録 → 読み放題からの収入を得る</Step>
        <Step>「AI生成コンテンツ」の開示に✓を入れる</Step>
        <Step>出版ボタンを押す → 24〜72時間で審査完了・公開</Step>
      </Section>

      <Section id="library" num="10" title="生成コンテンツの管理" color={T.p}>
        <Step tool="Library">Libraryタブで全プロジェクトの生成済みコンテンツを横断表示</Step>
        <Step>検索バーでプロジェクト名・巻タイトルを検索</Step>
        <Step>フィルター（小説/KDP/漫画/表紙/X投稿）で絞り込み</Step>
        <Step>カードをタップ → フルスクリーンプレビュー</Step>
        <Step>プレビュー画面からダウンロード・コピーが可能</Step>
      </Section>

      <Card style={{background:`${T.ok}08`,border:`1px solid ${T.ok}25`}}>
        <Label color={T.ok}>cost summary — 1冊あたりのコスト</Label>
        <div style={{fontSize:13,color:T.t2,lineHeight:2}}>
          <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${T.bd}`}}><span>小説生成（約7万文字）</span><span style={{fontFamily:T.mono,color:T.ok}}>約190円</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${T.bd}`}}><span>KDP + 漫画 + X投稿</span><span style={{fontFamily:T.mono,color:T.ok}}>約20円</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${T.bd}`}}><span>表紙画像（文字入れ）</span><span style={{fontFamily:T.mono,color:T.ok}}>約25円/枚</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${T.bd}`}}><span>Novel AI（漫画+表紙イラスト）</span><span style={{fontFamily:T.mono,color:T.ok}}>月額$25固定</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontWeight:700}}><span style={{color:T.tx}}>1冊トータル（APIのみ）</span><span style={{fontFamily:T.mono,color:T.w}}>約260円</span></div>
        </div>
      </Card>
    </>;
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
  const views={home:HomeView,studio:StudioView,library:LibraryView,guide:GuideView,settings:SettingsView};
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
