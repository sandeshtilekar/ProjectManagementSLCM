import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useStore }      from '../context/store';
import { useRealtime }   from '../hooks/useRealtime';
import api               from '../api/client';

const T = {
  bg:'#0b0d19', sidebar:'#0e1022', surface:'#13162b', surfaceHover:'#191d36',
  surfaceActive:'#1d2240', border:'#232747', borderHover:'#323968',
  accent:'#5b7ffc', accentDim:'rgba(91,127,252,0.12)',
  success:'#10d9a0', warning:'#f5a623', danger:'#f45b5b',
  text:'#e4e8ff', textMuted:'#7880a8', textFaint:'#3d4268',
};

const FMETA = {
  text:{icon:'⊤',label:'Text'}, number:{icon:'#',label:'Number'},
  singleSelect:{icon:'◎',label:'Select'}, multiSelect:{icon:'⊞',label:'Multi'},
  date:{icon:'◷',label:'Date'}, checkbox:{icon:'✓',label:'Check'},
  email:{icon:'@',label:'Email'}, url:{icon:'⌁',label:'URL'},
  rating:{icon:'★',label:'Rating'}, phone:{icon:'✆',label:'Phone'},
  attachment:{icon:'⊙',label:'Files'},
};
const uid = () => Math.random().toString(36).slice(2,9);
const TAG_PAL=[['#1e1b4b','#818cf8'],['#4c1d95','#c084fc'],['#701a75','#e879f9'],
  ['#881337','#fb7185'],['#7c2d12','#fb923c'],['#14532d','#4ade80'],
  ['#134e4a','#2dd4bf'],['#1e3a5f','#60a5fa']];
const tagPal=s=>TAG_PAL[(s.charCodeAt(0)+s.length)%TAG_PAL.length];
const SEL={
  'Todo':{bg:'#1e2d4a',tx:'#60a5fa'},'In Progress':{bg:'#0f2d27',tx:'#34d399'},
  'Done':{bg:'#0d2b1d',tx:'#22c55e'},'Blocked':{bg:'#2d1515',tx:'#f87171'},
  'Low':{bg:'#0d2b1d',tx:'#86efac'},'Medium':{bg:'#2b2312',tx:'#fbbf24'},
  'High':{bg:'#2d1a0d',tx:'#f97316'},'Critical':{bg:'#2d1515',tx:'#f87171'},
};
const ss=v=>SEL[v]||{bg:'#1e2340',tx:'#94a3b8'};

// ── CELL DISPLAY ──────────────────────────────────────────────
function Cell({field,value}){
  switch(field.type){
    case'number': return <span style={{color:T.text,fontSize:13,fontVariantNumeric:'tabular-nums'}}>{value!==null&&value!==''?Number(value).toLocaleString():''}</span>;
    case'singleSelect':return value?<span style={{background:ss(value).bg,color:ss(value).tx,padding:'2px 9px',borderRadius:4,fontSize:11,fontWeight:600}}>{value}</span>:null;
    case'multiSelect':return <div style={{display:'flex',flexWrap:'wrap',gap:3}}>{(value||[]).map(x=>{const[bg,tx]=tagPal(x);return<span key={x} style={{background:bg,color:tx,padding:'2px 6px',borderRadius:3,fontSize:11,fontWeight:500}}>{x}</span>;})}</div>;
    case'date':return value?<span style={{color:T.text,fontSize:13}}>{new Date(value).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>:null;
    case'checkbox':return<div style={{width:17,height:17,borderRadius:4,background:value?T.success:'transparent',border:`2px solid ${value?T.success:T.borderHover}`,display:'flex',alignItems:'center',justifyContent:'center'}}>{value&&<span style={{color:'#000',fontSize:10,fontWeight:800}}>✓</span>}</div>;
    case'rating':return<div style={{display:'flex',gap:2}}>{[1,2,3,4,5].map(i=><span key={i} style={{color:i<=(value||0)?T.warning:T.textFaint,fontSize:14}}>★</span>)}</div>;
    case'attachment':return value?.length?<span style={{color:T.textMuted,fontSize:12}}>📎 {value.length} file{value.length>1?'s':''}</span>:null;
    default:return<span style={{color:T.text,fontSize:13}}>{value||''}</span>;
  }
}

// ── PRESENCE AVATARS ─────────────────────────────────────────
function Presence({collaborators}){
  if(!collaborators.length) return null;
  return(
    <div style={{display:'flex',alignItems:'center',gap:-4}}>
      {collaborators.slice(0,5).map((c,i)=>(
        <div key={c.userId} title={c.userName}
          style={{width:28,height:28,borderRadius:'50%',
            background:`hsl(${(c.userId.charCodeAt(0)*40)%360},60%,40%)`,
            border:`2px solid ${T.sidebar}`,marginLeft:i?-8:0,
            display:'flex',alignItems:'center',justifyContent:'center',
            color:'#fff',fontSize:11,fontWeight:600,zIndex:i}}>
          {c.userName[0].toUpperCase()}
        </div>
      ))}
      {collaborators.length>5&&<span style={{color:T.textMuted,fontSize:11,marginLeft:4}}>+{collaborators.length-5}</span>}
    </div>
  );
}

// ── ATTACHMENT CELL ──────────────────────────────────────────
function AttachmentCell({recordId, fieldId}){
  const [files, setFiles]=useState([]);
  const [loading, setLoading]=useState(false);
  useEffect(()=>{
    api.get(`/upload/${recordId}/${fieldId}`).then(r=>setFiles(r.data)).catch(()=>{});
  },[recordId,fieldId]);
  const upload=async(e)=>{
    const file=e.target.files[0];if(!file)return;
    const fd=new FormData();fd.append('file',file);
    setLoading(true);
    try{const{data}=await api.post(`/upload/${recordId}/${fieldId}`,fd);
      setFiles(f=>[...f,data]);toast.success('Uploaded!');}
    catch{toast.error('Upload failed');}
    finally{setLoading(false);}
  };
  const del=async(id)=>{
    await api.delete(`/upload/${id}`);
    setFiles(f=>f.filter(x=>x.id!==id));
  };
  return(
    <div style={{padding:'8px 0'}}>
      {files.map(f=>(
        <div key={f.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
          {f.mimeType?.startsWith('image/')?
            <img src={f.thumbUrl||f.url} alt={f.name} style={{width:40,height:28,objectFit:'cover',borderRadius:3}}/>:
            <span style={{fontSize:20}}>📄</span>}
          <a href={f.url} target="_blank" rel="noopener noreferrer"
            style={{color:T.accent,fontSize:12,textDecoration:'none',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</a>
          <span style={{color:T.textFaint,fontSize:11}}>{(f.size/1024).toFixed(0)}KB</span>
          <button onClick={()=>del(f.id)} style={{background:'none',border:'none',cursor:'pointer',color:T.danger,fontSize:13}}>✕</button>
        </div>
      ))}
      <label style={{display:'inline-flex',alignItems:'center',gap:5,cursor:'pointer',
        color:T.accent,fontSize:12,marginTop:4}}>
        <input type="file" style={{display:'none'}} onChange={upload} disabled={loading}/>
        {loading?'Uploading…':'+ Attach file'}
      </label>
    </div>
  );
}

// ── RECORD MODAL ──────────────────────────────────────────────
function RecordModal({record,fields,onClose,onUpdate}){
  const [d,setD]=useState({...record});
  const update=(fid,v)=>{const n={...d,[fid]:v};setD(n);onUpdate(fid,v);};
  const primary=fields.find(f=>f.primary||f.is_primary);
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.75)',zIndex:3000,
      display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(5px)'}}
      onClick={onClose}>
      <div style={{width:580,maxHeight:'82vh',background:T.surface,borderRadius:12,
        border:`1px solid ${T.borderHover}`,boxShadow:'0 30px 80px rgba(0,0,0,.7)',
        display:'flex',flexDirection:'column',overflow:'hidden'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{padding:'14px 20px',borderBottom:`1px solid ${T.border}`,
          display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{color:T.text,fontWeight:600,fontSize:15}}>{d[primary?.id]||'Record'}</span>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,fontSize:18}}>✕</button>
        </div>
        <div style={{overflowY:'auto',padding:'16px 20px',flex:1}}>
          {fields.map(f=>(
            <div key={f.id} style={{marginBottom:18}}>
              <div style={{color:T.textMuted,fontSize:10,fontWeight:700,textTransform:'uppercase',
                letterSpacing:.9,marginBottom:6}}>
                {FMETA[f.type]?.icon} {f.name}
              </div>
              {f.type==='attachment'?
                <AttachmentCell recordId={record.id} fieldId={f.id}/>:
                <ModalEditor field={f} value={d[f.id]} onChange={v=>update(f.id,v)}/>
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModalEditor({field,value,onChange}){
  const ist={width:'100%',background:T.surfaceActive,border:`1px solid ${T.border}`,
    borderRadius:6,color:T.text,fontSize:13,padding:'8px 12px',
    boxSizing:'border-box',fontFamily:'inherit',outline:'none'};
  switch(field.type){
    case'text':case'email':case'phone':case'url':
      return<input type="text" value={value||''} onChange={e=>onChange(e.target.value)} style={ist}/>;
    case'number':
      return<input type="number" value={value??''} onChange={e=>onChange(e.target.value===''?null:Number(e.target.value))} style={ist}/>;
    case'date':
      return<input type="date" value={value||''} onChange={e=>onChange(e.target.value)} style={ist}/>;
    case'checkbox':
      return<div style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer'}} onClick={()=>onChange(!value)}>
        <div style={{width:22,height:22,borderRadius:5,background:value?T.success:'transparent',
          border:`2px solid ${value?T.success:T.borderHover}`,display:'flex',alignItems:'center',justifyContent:'center'}}>
          {value&&<span style={{color:'#000',fontSize:12,fontWeight:800}}>✓</span>}
        </div>
        <span style={{color:T.textMuted,fontSize:13}}>{value?'Checked':'Unchecked'}</span>
      </div>;
    case'singleSelect':
      return<div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        {(field.options||[]).map(opt=>{const s=ss(opt);const a=value===opt;
          return<span key={opt} onClick={()=>onChange(a?'':opt)} style={{
            background:a?s.bg:'transparent',color:a?s.tx:T.textMuted,
            border:`1px solid ${a?s.bg:T.border}`,padding:'5px 12px',
            borderRadius:4,cursor:'pointer',fontSize:12}}>
            {opt}
          </span>;})}
      </div>;
    case'multiSelect':
      const sel=value||[];
      return<div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        {(field.options||[]).map(opt=>{const[bg,tx]=tagPal(opt);const a=sel.includes(opt);
          return<span key={opt} onClick={()=>onChange(a?sel.filter(x=>x!==opt):[...sel,opt])} style={{
            background:a?bg:'transparent',color:a?tx:T.textMuted,
            border:`1px solid ${a?bg:T.border}`,padding:'5px 10px',
            borderRadius:3,cursor:'pointer',fontSize:12}}>
            {opt}
          </span>;})}
      </div>;
    case'rating':
      return<div style={{display:'flex',gap:6}}>{[1,2,3,4,5].map(i=>(
        <span key={i} onClick={()=>onChange(i===value?0:i)}
          style={{cursor:'pointer',fontSize:24,color:i<=(value||0)?T.warning:T.textFaint}}>★</span>
      ))}</div>;
    default:
      return<input type="text" value={value||''} onChange={e=>onChange(e.target.value)} style={ist}/>;
  }
}

// ── ADD FIELD MODAL ───────────────────────────────────────────
function AddFieldModal({onClose,onAdd}){
  const [name,setName]=useState('');
  const [type,setType]=useState('text');
  const [opts,setOpts]=useState('');
  const needsOpts=['singleSelect','multiSelect'].includes(type);
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.75)',zIndex:3000,
      display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{width:400,background:T.surface,borderRadius:12,
        border:`1px solid ${T.borderHover}`,padding:24}} onClick={e=>e.stopPropagation()}>
        <h3 style={{color:T.text,fontSize:15,fontWeight:700,margin:'0 0 20px'}}>Add Field</h3>
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Field name…"
          style={{width:'100%',background:T.surfaceActive,border:`1px solid ${T.border}`,
            borderRadius:6,color:T.text,fontSize:13,padding:'8px 12px',
            boxSizing:'border-box',fontFamily:'inherit',outline:'none',marginBottom:14}}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:14}}>
          {Object.entries(FMETA).map(([t,m])=>(
            <div key={t} onClick={()=>setType(t)} style={{
              padding:'7px 11px',borderRadius:6,cursor:'pointer',
              border:`1px solid ${type===t?T.accent:T.border}`,
              background:type===t?T.accentDim:'transparent',
              color:type===t?T.accent:T.textMuted,
              fontSize:12,display:'flex',alignItems:'center',gap:6}}>
              {m.icon} {m.label}
            </div>
          ))}
        </div>
        {needsOpts&&<input value={opts} onChange={e=>setOpts(e.target.value)}
          placeholder="Option A, Option B…" style={{width:'100%',background:T.surfaceActive,
            border:`1px solid ${T.border}`,borderRadius:6,color:T.text,fontSize:13,
            padding:'8px 12px',boxSizing:'border-box',fontFamily:'inherit',outline:'none',marginBottom:14}}/>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{padding:'8px 16px',borderRadius:6,border:`1px solid ${T.border}`,
            background:'transparent',color:T.textMuted,cursor:'pointer',fontSize:13,fontFamily:'inherit'}}>Cancel</button>
          <button onClick={()=>{
            if(!name.trim())return;
            onAdd(name.trim(), type, needsOpts?opts.split(',').map(s=>s.trim()).filter(Boolean):undefined);
            onClose();
          }} style={{padding:'8px 18px',borderRadius:6,border:'none',
            background:T.accent,color:'#fff',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit'}}>Add</button>
        </div>
      </div>
    </div>
  );
}

// ── GRID VIEW ─────────────────────────────────────────────────
function GridView({fields,records,onCellChange,onExpandRecord,onDeleteRecord,onAddRecord,onAddField,onDeleteField}){
  const [editing,setEditing]=useState(null);
  const [editVal,setEditVal]=useState(null);
  const [sort,setSort]=useState(null);
  const [hovRow,setHovRow]=useState(null);
  const [search,setSearch]=useState('');
  const [showAddField,setShowAddField]=useState(false);

  let rows=[...records];
  if(search)rows=rows.filter(r=>fields.some(f=>{
    const v=r[f.id];
    return Array.isArray(v)?v.some(x=>String(x).toLowerCase().includes(search.toLowerCase()))
      :String(v||'').toLowerCase().includes(search.toLowerCase());
  }));
  if(sort)rows.sort((a,b)=>{
    const c=String(a[sort.f]??'').localeCompare(String(b[sort.f]??''),undefined,{numeric:true});
    return sort.d==='asc'?c:-c;
  });

  const startEdit=(rid,fid,val)=>{setEditing({rid,fid});setEditVal(val);};
  const commit=()=>{
    if(!editing)return;
    onCellChange(editing.rid,editing.fid,editVal);
    setEditing(null);setEditVal(null);
  };
  const fw=f=>f.width||150;
  const RH=36,HH=36,GW=44;

  const iStyle={width:'100%',height:'100%',border:'none',outline:'none',
    background:'transparent',color:T.text,fontSize:13,fontFamily:'inherit',
    padding:'0 8px',boxSizing:'border-box'};

  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div style={{padding:'7px 14px',borderBottom:`1px solid ${T.border}`,
        display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
        <span style={{position:'relative'}}>
          <span style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',
            color:T.textFaint,fontSize:13}}>⌕</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
            style={{background:T.surfaceActive,border:`1px solid ${T.border}`,borderRadius:6,
              color:T.text,fontSize:12,padding:'5px 10px 5px 26px',outline:'none',
              width:160,fontFamily:'inherit'}}/>
        </span>
        <div style={{flex:1}}/>
        {/* Import CSV */}
        <label title="Import CSV or Excel file" style={{cursor:'pointer',display:'flex',alignItems:'center',
          gap:4,background:T.surfaceActive,border:`1px solid ${T.border}`,borderRadius:6,
          padding:'4px 10px',color:T.textMuted,fontSize:12,fontFamily:'inherit'}}>
          <span style={{fontSize:13}}>⬆</span> Import
          <input type="file" accept=".csv,.txt" style={{display:'none'}}
            onChange={async e=>{
              const file=e.target.files[0]; if(!file) return;
              const fd=new FormData(); fd.append('file',file);
              try{
                const r=await api.post(`/tables/${activeTableId}/import`,fd,{headers:{'Content-Type':'multipart/form-data'}});
                toast.success(`Imported ${r.data.imported} records${r.data.fieldsCreated>0?' + '+r.data.fieldsCreated+' new fields':''}`);
                loadRecords(activeTableId);
                if(r.data.fieldsCreated>0) loadFields(activeTableId);
              }catch(err){toast.error(err.response?.data?.error||'Import failed');}
              e.target.value='';
            }}/>
        </label>
        {/* Export CSV */}
        <button title="Export table to CSV" onClick={()=>{
          const token=localStorage.getItem('access_token');
          const base=window.location.origin;
          const url=`${base}/api/tables/${activeTableId}/export.csv`;
          // Create a temporary link with auth — fetch and download
          fetch(url,{headers:{Authorization:`Bearer ${token}`}})
            .then(r=>{
              const cd=r.headers.get('content-disposition')||'';
              const m=cd.match(/filename="([^"]+)"/);
              const fname=m?m[1]:'export.csv';
              return r.blob().then(b=>({b,fname}));
            })
            .then(({b,fname})=>{
              const a=document.createElement('a');
              a.href=URL.createObjectURL(b); a.download=fname; a.click();
              URL.revokeObjectURL(a.href);
              toast.success('Exported to CSV');
            })
            .catch(()=>toast.error('Export failed'));
        }} style={{cursor:'pointer',display:'flex',alignItems:'center',gap:4,
          background:T.surfaceActive,border:`1px solid ${T.border}`,borderRadius:6,
          padding:'4px 10px',color:T.textMuted,fontSize:12,fontFamily:'inherit'}}>
          <span style={{fontSize:13}}>⬇</span> Export
        </button>
        <span style={{color:T.textFaint,fontSize:12}}>{rows.length} records</span>
      </div>
      <div style={{flex:1,overflow:'auto'}}>
        <div style={{minWidth:'fit-content'}}>
          {/* Header */}
          <div style={{display:'flex',background:T.surfaceActive,borderBottom:`1px solid ${T.border}`,
            position:'sticky',top:0,zIndex:10}}>
            <div style={{width:GW,minWidth:GW,height:HH,borderRight:`1px solid ${T.border}`,flexShrink:0}}/>
            {fields.map(f=>(
              <div key={f.id} style={{width:fw(f),minWidth:fw(f),height:HH,
                borderRight:`1px solid ${T.border}`,display:'flex',alignItems:'center',
                padding:'0 10px',gap:6,flexShrink:0,cursor:'pointer',userSelect:'none'}}
                onClick={()=>setSort(sort?.f===f.id?(sort.d==='asc'?{f:f.id,d:'desc'}:null):{f:f.id,d:'asc'})}>
                <span style={{color:T.accent,fontSize:11,opacity:.7}}>{FMETA[f.type]?.icon}</span>
                <span style={{color:T.textMuted,fontSize:12,fontWeight:600,flex:1,overflow:'hidden',
                  textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                {sort?.f===f.id&&<span style={{color:T.accent,fontSize:10}}>{sort.d==='asc'?'↑':'↓'}</span>}
                {!(f.primary||f.is_primary)&&(
                  <span onClick={e=>{e.stopPropagation();onDeleteField(f.id);}}
                    style={{color:T.danger,fontSize:10,opacity:.5,cursor:'pointer'}}>✕</span>
                )}
              </div>
            ))}
            <div onClick={()=>setShowAddField(true)} style={{width:44,height:HH,flexShrink:0,
              display:'flex',alignItems:'center',justifyContent:'center',
              cursor:'pointer',color:T.textMuted,fontSize:18}}>+</div>
          </div>
          {/* Rows */}
          {rows.map((rec,idx)=>(
            <div key={rec.id} style={{display:'flex',borderBottom:`1px solid ${T.border}`,
              background:hovRow===rec.id?T.surfaceHover:'transparent'}}
              onMouseEnter={()=>setHovRow(rec.id)}
              onMouseLeave={()=>setHovRow(null)}>
              <div style={{width:GW,minWidth:GW,height:RH,borderRight:`1px solid ${T.border}`,
                display:'flex',alignItems:'center',justifyContent:'center',gap:3,flexShrink:0}}>
                {hovRow===rec.id?(
                  <>
                    <span onClick={()=>onExpandRecord(rec)} title="Expand"
                      style={{cursor:'pointer',color:T.accent,fontSize:13}}>⤢</span>
                    <span onClick={()=>onDeleteRecord(rec.id)} title="Delete"
                      style={{cursor:'pointer',color:T.danger,fontSize:11}}>✕</span>
                  </>
                ):<span style={{color:T.textFaint,fontSize:11}}>{idx+1}</span>}
              </div>
              {fields.map(f=>{
                const isEd=editing?.rid===rec.id&&editing?.fid===f.id;
                const val=rec[f.id];
                return(
                  <div key={f.id} style={{width:fw(f),minWidth:fw(f),height:RH,
                    borderRight:`1px solid ${T.border}`,display:'flex',alignItems:'center',
                    padding:f.type==='checkbox'?'0 14px':'0 8px',
                    position:'relative',flexShrink:0,overflow:'hidden',
                    outline:isEd?`2px solid ${T.accent}`:'none',outlineOffset:-2}}
                    onClick={()=>{
                      if(f.type==='checkbox')onCellChange(rec.id,f.id,!val);
                      else if(!isEd)startEdit(rec.id,f.id,val);
                    }}>
                    {isEd&&f.type!=='checkbox'?(
                      ['text','email','phone','url'].includes(f.type)?
                        <input autoFocus type="text" value={editVal||''} onChange={e=>setEditVal(e.target.value)}
                          onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')commit();}} style={iStyle}/>:
                      f.type==='number'?
                        <input autoFocus type="number" value={editVal??''} onChange={e=>setEditVal(e.target.value===''?null:Number(e.target.value))}
                          onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit();}} style={iStyle}/>:
                      f.type==='date'?
                        <input autoFocus type="date" value={editVal||''} onChange={e=>setEditVal(e.target.value)}
                          onBlur={commit} style={iStyle}/>:
                      f.type==='singleSelect'?(
                        <div style={{position:'absolute',zIndex:100,top:'100%',left:0,minWidth:160,
                          background:T.surfaceActive,border:`1px solid ${T.borderHover}`,
                          borderRadius:7,padding:4,boxShadow:'0 8px 28px rgba(0,0,0,.5)'}}>
                          {(f.options||[]).map(opt=>{
                            const s=ss(opt);
                            return<div key={opt} onClick={()=>{setEditVal(opt);setTimeout(()=>{onCellChange(rec.id,f.id,opt);setEditing(null);},0);}}
                              style={{padding:'6px 10px',borderRadius:4,cursor:'pointer'}}
                              onMouseEnter={e=>e.currentTarget.style.background=T.surfaceHover}
                              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                              <span style={{background:s.bg,color:s.tx,padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600}}>{opt}</span>
                            </div>;
                          })}
                        </div>
                      ):f.type==='rating'?(
                        <div style={{display:'flex',padding:'0 8px',height:'100%',alignItems:'center',gap:3}}>
                          {[1,2,3,4,5].map(i=>(
                            <span key={i} style={{cursor:'pointer',color:i<=(editVal||0)?T.warning:T.textFaint,fontSize:16}}
                              onClick={()=>{onCellChange(rec.id,f.id,i);setEditing(null);}}>★</span>
                          ))}
                        </div>
                      ):null
                    ):<Cell field={f} value={val}/>}
                  </div>
                );
              })}
            </div>
          ))}
          <div onClick={onAddRecord} style={{display:'flex',alignItems:'center',height:30,
            padding:'0 0 0 14px',cursor:'pointer',color:T.textMuted,fontSize:12,gap:5,
            borderBottom:`1px solid ${T.border}`}}
            onMouseEnter={e=>e.currentTarget.style.background=T.surfaceHover}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <span style={{fontSize:16}}>+</span> Add record
          </div>
        </div>
      </div>
      {showAddField&&<AddFieldModal onClose={()=>setShowAddField(false)} onAdd={(n,t,o)=>{onAddField(n,t,o);setShowAddField(false);}}/>}
    </div>
  );
}

// ── APP LAYOUT ────────────────────────────────────────────────

// ── DASHBOARD ─────────────────────────────────────────────────
function Dashboard({ tables, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Load all table data in parallel
        const results = await Promise.all(
          tables.map(async t => {
            try {
              const [fr, rr] = await Promise.all([
                api.get(`/tables/${t.id}/fields`),
                api.get(`/tables/${t.id}/records`),
              ]);
              return { table: t, fields: fr.data, records: rr.data };
            } catch { return { table: t, fields: [], records: [] }; }
          })
        );

        // Build stats by scanning known table types
        const s = {
          totalTables: tables.length,
          totalRecords: results.reduce((a, r) => a + r.records.length, 0),
          assets: { total: 0, active: 0, eolWarning: 0, endOfLife: 0 },
          licences: { total: 0, compliant: 0, overLicensed: 0, underLicensed: 0, expired: 0 },
          changes: { total: 0, open: 0, completed: 0, failed: 0 },
          incidents: { total: 0, p1: 0, p2: 0, open: 0 },
          eol: { overdue: 0, critical: 0, high: 0 },
          contracts: { total: 0, active: 0, expiringSoon: 0, expired: 0 },
          msu: { overages: 0, nearThreshold: 0 },
          releases: { total: 0, released: 0, inFlight: 0, failed: 0 },
          tableData: results,
        };

        results.forEach(({ table, fields, records }) => {
          const n = table.name.toLowerCase();
          const getVal = (rec, fieldName) => {
            const f = fields.find(f => f.name.toLowerCase().includes(fieldName.toLowerCase()));
            if (!f) return '';
            return String(rec[f.id] || '');
          };

          if (n.includes('asset')) {
            s.assets.total = records.length;
            records.forEach(r => {
              const st = getVal(r, 'lifecycle').toLowerCase();
              if (st.includes('active')) s.assets.active++;
              if (st.includes('eol warning') || st.includes('warning')) s.assets.eolWarning++;
              if (st.includes('end of life') || st === 'end of life') s.assets.endOfLife++;
            });
          }
          if (n.includes('licence') || n.includes('license')) {
            s.licences.total = records.length;
            records.forEach(r => {
              const st = getVal(r, 'compliance').toLowerCase();
              if (st.includes('compliant') && !st.includes('non')) s.licences.compliant++;
              if (st.includes('over')) s.licences.overLicensed++;
              if (st.includes('under')) s.licences.underLicensed++;
              if (st.includes('expired')) s.licences.expired++;
            });
          }
          if (n.includes('change')) {
            s.changes.total = records.length;
            records.forEach(r => {
              const st = getVal(r, 'status').toLowerCase();
              if (['draft','submitted','cab review','approved','scheduled','in progress'].some(v => st.includes(v))) s.changes.open++;
              if (st.includes('completed')) s.changes.completed++;
              if (st.includes('failed') || st.includes('rolled back')) s.changes.failed++;
            });
          }
          if (n.includes('incident')) {
            s.incidents.total = records.length;
            records.forEach(r => {
              const sev = getVal(r, 'severity').toLowerCase();
              const st = getVal(r, 'status').toLowerCase();
              if (sev.includes('p1')) s.incidents.p1++;
              if (sev.includes('p2')) s.incidents.p2++;
              if (['open','investigating','identified','monitoring'].some(v => st.includes(v))) s.incidents.open++;
            });
          }
          if (n.includes('eol') || n.includes('refresh')) {
            records.forEach(r => {
              const urg = getVal(r, 'urgency').toLowerCase();
              if (urg.includes('overdue')) s.eol.overdue++;
              if (urg.includes('critical')) s.eol.critical++;
              if (urg.includes('high')) s.eol.high++;
            });
          }
          if (n.includes('vendor') || n.includes('contract')) {
            s.contracts.total = records.length;
            records.forEach(r => {
              const st = getVal(r, 'status').toLowerCase();
              if (st.includes('active')) s.contracts.active++;
              if (st.includes('expiring')) s.contracts.expiringSoon++;
              if (st.includes('expired') && !st.includes('expiring')) s.contracts.expired++;
            });
          }
          if (n.includes('msu')) {
            records.forEach(r => {
              const st = getVal(r, 'status').toLowerCase();
              if (st.includes('overage')) s.msu.overages++;
              if (st.includes('near')) s.msu.nearThreshold++;
            });
          }
          if (n.includes('release')) {
            s.releases.total = records.length;
            records.forEach(r => {
              const st = getVal(r, 'status').toLowerCase();
              if (st.includes('released')) s.releases.released++;
              if (['planning','dev complete','sit','uat','scheduled'].some(v => st.includes(v))) s.releases.inFlight++;
              if (st.includes('failed')) s.releases.failed++;
            });
          }
        });

        setStats(s);
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
    }
    if (tables.length) load();
    else { setLoading(false); }
  }, [tables.map(t=>t.id).join(',')]);

  const Card = ({ color, label, value, sub, onClick, alert }) => (
    <div onClick={onClick} style={{
      background: T.surface, border: `1px solid ${alert ? color+'66' : T.border}`,
      borderRadius: 10, padding: '14px 16px', cursor: onClick ? 'pointer' : 'default',
      transition: 'border-color .15s', minWidth: 0,
      boxShadow: alert ? `0 0 0 1px ${color}33` : 'none',
    }}
    onMouseEnter={e => { if(onClick) e.currentTarget.style.borderColor = color; }}
    onMouseLeave={e => { if(onClick) e.currentTarget.style.borderColor = alert ? color+'66' : T.border; }}>
      <div style={{ color: T.textFaint, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      {sub && <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const MiniBar = ({ label, value, max, color }) => {
    const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: T.textMuted, fontSize: 11 }}>{label}</span>
          <span style={{ color: T.text, fontSize: 11, fontWeight: 600 }}>{value}</span>
        </div>
        <div style={{ height: 4, background: T.border, borderRadius: 2 }}>
          <div style={{ height: 4, width: pct + '%', background: color, borderRadius: 2, transition: 'width .4s' }}/>
        </div>
      </div>
    );
  };

  const navTo = name => {
    const t = tables.find(t => t.name.toLowerCase().includes(name.toLowerCase()));
    if (t) onNavigate(t);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${T.border}`, borderTopColor: T.accent, borderRadius: '50%', animation: 'spin 1s linear infinite' }}/>
      <span style={{ color: T.textMuted, fontSize: 13 }}>Loading dashboard...</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!stats || tables.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.textMuted, fontSize: 14 }}>
      No tables yet — add some tables to see your dashboard.
    </div>
  );

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: T.text, fontSize: 20, fontWeight: 700, marginBottom: 4 }}>SLM Dashboard</div>
        <div style={{ color: T.textFaint, fontSize: 12 }}>{stats.totalTables} tables · {stats.totalRecords} total records · {new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
      </div>

      {/* Alert banner — show if any critical issues */}
      {(stats.eol.overdue > 0 || stats.licences.expired > 0 || stats.msu.overages > 0 || stats.contracts.expiringSoon > 0) && (
        <div style={{ background: '#2d1a05', border: '1px solid #f59e0b44', borderRadius: 8, padding: '10px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span style={{ color: '#f59e0b', fontSize: 12, fontWeight: 500 }}>
            Action required:
            {stats.eol.overdue > 0 && ` ${stats.eol.overdue} overdue EOL items`}
            {stats.licences.expired > 0 && ` · ${stats.licences.expired} expired licences`}
            {stats.msu.overages > 0 && ` · ${stats.msu.overages} MSU overages`}
            {stats.contracts.expiringSoon > 0 && ` · ${stats.contracts.expiringSoon} contracts expiring soon`}
          </span>
        </div>
      )}

      {/* Row 1 — key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Card color={T.accent}       label="Total Assets"       value={stats.assets.total}       sub={`${stats.assets.active} active`}                onClick={() => navTo('asset')} />
        <Card color="#10d9a0"        label="Compliant Licences" value={stats.licences.compliant}  sub={`of ${stats.licences.total} total`}              onClick={() => navTo('licence')} />
        <Card color="#60a5fa"        label="Open Changes"       value={stats.changes.open}        sub={`${stats.changes.completed} completed`}          onClick={() => navTo('change')} />
        <Card color="#f59e0b"        label="EOL / Overdue"      value={stats.eol.overdue}         sub={`${stats.eol.critical} critical`}  alert={stats.eol.overdue > 0} onClick={() => navTo('eol')} />
        <Card color="#e879f9"        label="Releases In Flight" value={stats.releases.inFlight}   sub={`${stats.releases.released} released`}           onClick={() => navTo('release')} />
        <Card color="#f87171"        label="Open Incidents"     value={stats.incidents.open}      sub={`${stats.incidents.p1} P1 · ${stats.incidents.p2} P2`} alert={stats.incidents.p1 > 0} onClick={() => navTo('incident')} />
        <Card color="#f59e0b"        label="Contracts Expiring" value={stats.contracts.expiringSoon} sub={`${stats.contracts.active} active`} alert={stats.contracts.expiringSoon > 0} onClick={() => navTo('vendor')} />
        <Card color="#fb923c"        label="MSU Overages"       value={stats.msu.overages}        sub={`${stats.msu.nearThreshold} near threshold`} alert={stats.msu.overages > 0} onClick={() => navTo('msu')} />
      </div>

      {/* Row 2 — breakdown panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 20 }}>

        {/* Asset health */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 12 }}>Asset Lifecycle Health</div>
          <MiniBar label="Active"       value={stats.assets.active}    max={stats.assets.total} color="#10d9a0" />
          <MiniBar label="EOL Warning"  value={stats.assets.eolWarning} max={stats.assets.total} color="#f59e0b" />
          <MiniBar label="End of Life"  value={stats.assets.endOfLife} max={stats.assets.total} color="#f87171" />
          <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => navTo('asset')}>
            <span style={{ color: T.textFaint, fontSize: 11 }}>View Software Asset Register →</span>
          </div>
        </div>

        {/* Licence compliance */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 12 }}>Licence Compliance</div>
          <MiniBar label="Compliant"      value={stats.licences.compliant}     max={stats.licences.total} color="#10d9a0" />
          <MiniBar label="Over-licensed"  value={stats.licences.overLicensed}  max={stats.licences.total} color="#60a5fa" />
          <MiniBar label="Under-licensed" value={stats.licences.underLicensed} max={stats.licences.total} color="#f59e0b" />
          <MiniBar label="Expired"        value={stats.licences.expired}       max={stats.licences.total} color="#f87171" />
          <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 10, cursor: 'pointer' }}
            onClick={() => navTo('licence')}>
            <span style={{ color: T.textFaint, fontSize: 11 }}>View Licence Manager →</span>
          </div>
        </div>

        {/* Change pipeline */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 12 }}>Change Pipeline</div>
          <MiniBar label="Open / In Progress" value={stats.changes.open}      max={stats.changes.total} color="#60a5fa" />
          <MiniBar label="Completed"          value={stats.changes.completed} max={stats.changes.total} color="#10d9a0" />
          <MiniBar label="Failed / Rolled Back" value={stats.changes.failed}  max={stats.changes.total} color="#f87171" />
          <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 10, cursor: 'pointer' }}
            onClick={() => navTo('change')}>
            <span style={{ color: T.textFaint, fontSize: 11 }}>View Change Register →</span>
          </div>
        </div>

        {/* EOL urgency */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 12 }}>EOL Urgency</div>
          <MiniBar label="Overdue"           value={stats.eol.overdue}   max={stats.eol.overdue + stats.eol.critical + stats.eol.high || 1} color="#f87171" />
          <MiniBar label="Critical 0-3 months" value={stats.eol.critical} max={stats.eol.overdue + stats.eol.critical + stats.eol.high || 1} color="#f59e0b" />
          <MiniBar label="High 3-6 months"   value={stats.eol.high}      max={stats.eol.overdue + stats.eol.critical + stats.eol.high || 1} color="#fbbf24" />
          <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 10, cursor: 'pointer' }}
            onClick={() => navTo('eol')}>
            <span style={{ color: T.textFaint, fontSize: 11 }}>View EOL & Refresh Planner →</span>
          </div>
        </div>

      </div>

      {/* Row 3 — tables quick access */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 12 }}>All Tables</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {stats.tableData.map(({ table, records }) => (
            <div key={table.id} onClick={() => onNavigate(table)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: T.surfaceActive, borderRadius: 7,
                cursor: 'pointer', border: `1px solid transparent`, transition: 'border-color .15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
              <span style={{ color: T.text, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{table.name}</span>
              <span style={{ color: T.textFaint, fontSize: 11, marginLeft: 8, flexShrink: 0 }}>{records.length}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

export default function AppLayout(){
  const {
    user, logout, workspaces, activeWs, setActiveWs,
    bases, loadBases, loadTables,
    tables, activeTable, setActiveTable,
    fields, records,
    addRecord, updateCell, deleteRecord,
    addField, deleteField,
  } = useStore();

  const { collaborators, broadcastCellUpdate } = useRealtime(activeTable?.id);
  const [expandedRec, setExpandedRec]=useState(null);
  const [showDashboard, setShowDashboard]=useState(false);

  useEffect(()=>{
    if(activeWs) loadBases(activeWs.id);
  },[activeWs]);

  const handleCellChange = async (recordId, fieldId, value) => {
    await updateCell(recordId, fieldId, value);
    broadcastCellUpdate(recordId, fieldId, value);
  };

  const handleUpdateFromModal = async (fieldId, value) => {
    if(!expandedRec) return;
    handleCellChange(expandedRec.id, fieldId, value);
    setExpandedRec(r => ({...r, [fieldId]: value}));
  };

  return(
    <div style={{display:'flex',height:'100vh',background:T.bg,
      fontFamily:"'DM Sans','SF Pro Display',-apple-system,sans-serif",
      overflow:'hidden',color:T.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px;}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(.6);}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        select option{background:${T.surface};}
      `}</style>

      {/* SIDEBAR */}
      <div style={{width:220,flexShrink:0,background:T.sidebar,
        borderRight:`1px solid ${T.border}`,display:'flex',flexDirection:'column'}}>
        <div style={{padding:'16px 14px',borderBottom:`1px solid ${T.border}`,
          display:'flex',alignItems:'center',gap:9}}>
          <div style={{width:30,height:30,borderRadius:8,
            background:'linear-gradient(135deg,#5b7ffc,#8b5cf6)',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:15,color:'#fff',flexShrink:0}}>⊞</div>
          <div style={{flex:1,overflow:'hidden'}}>
            <div style={{color:T.text,fontSize:14,fontWeight:700,letterSpacing:'-.3px'}}>GridBase</div>
            <div style={{color:T.textFaint,fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user?.email}</div>
          </div>
        </div>

        {/* Workspace switcher */}
        {workspaces.length>1&&(
          <div style={{padding:'8px 12px',borderBottom:`1px solid ${T.border}`}}>
            <select value={activeWs?.id||''} onChange={e=>setActiveWs(workspaces.find(w=>w.id===e.target.value))}
              style={{width:'100%',background:T.surfaceActive,border:`1px solid ${T.border}`,
                borderRadius:5,color:T.text,fontSize:12,padding:'5px 8px',outline:'none',fontFamily:'inherit'}}>
              {workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}

        {/* Dashboard button */}
        <div style={{padding:'6px 10px 2px'}}>
          <div onClick={()=>{setShowDashboard(true);}} 
            style={{padding:'7px 10px',borderRadius:7,cursor:'pointer',
              background:showDashboard?T.surfaceActive:'transparent',
              border:showDashboard?`1px solid ${T.accent}44`:'1px solid transparent',
              color:showDashboard?T.text:T.textMuted,fontSize:13,fontWeight:500,
              display:'flex',alignItems:'center',gap:8,transition:'all .15s'}}>
            <span style={{fontSize:15}}>◈</span> Dashboard
          </div>
        </div>

        {/* Tables list */}
        <div style={{padding:'8px 12px 4px'}}>
          <div style={{color:T.textFaint,fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Tables</div>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {tables.map(t=>(
            <div key={t.id} onClick={()=>{setActiveTable(t);setShowDashboard(false);}}
              style={{padding:'7px 14px',cursor:'pointer',
                borderLeft:t.id===activeTable?.id?`2px solid ${T.accent}`:'2px solid transparent',
                background:t.id===activeTable?.id?T.surfaceActive:'transparent',
                color:t.id===activeTable?.id?T.text:T.textMuted,fontSize:13,fontWeight:t.id===activeTable?.id?500:400}}>
              {t.name}
            </div>
          ))}
        </div>

        <button onClick={logout} style={{margin:10,padding:'8px',borderRadius:6,
          border:`1px solid ${T.border}`,background:'transparent',
          color:T.textMuted,cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>
          Sign out
        </button>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Top bar */}
        <div style={{display:'flex',alignItems:'center',padding:'0 16px',
          height:46,borderBottom:`1px solid ${T.border}`,background:T.sidebar,
          flexShrink:0,gap:12}}>
          <span style={{color:T.text,fontSize:15,fontWeight:700,letterSpacing:'-.2px'}}>{showDashboard?'SLM Dashboard':activeTable?.name}</span>
          {!showDashboard&&<span style={{color:T.textFaint,fontSize:11}}>{records.length} records · {fields.length} fields</span>}
          <div style={{flex:1}}/>
          <Presence collaborators={collaborators}/>
        </div>
        <div style={{flex:1,overflow:'hidden'}}>
          {showDashboard?(
            <Dashboard tables={tables} onNavigate={t=>{setActiveTable(t);setShowDashboard(false);}}/>
          ):activeTable?(
            <GridView
              fields={fields}
              records={records}
              onCellChange={handleCellChange}
              onExpandRecord={setExpandedRec}
              onDeleteRecord={deleteRecord}
              onAddRecord={addRecord}
              onAddField={addField}
              onDeleteField={deleteField}
            />
          ):(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',
              height:'100%',color:T.textMuted,fontSize:14}}>
              Select a table or open the Dashboard
            </div>
          )}
        </div>
      </div>

      {/* Record modal */}
      {expandedRec&&(
        <RecordModal
          record={expandedRec}
          fields={fields}
          onClose={()=>setExpandedRec(null)}
          onUpdate={handleUpdateFromModal}
        />
      )}
    </div>
  );
}
