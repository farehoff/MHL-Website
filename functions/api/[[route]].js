// MHL v11 API — Cloudflare Pages Functions, D1/R2 and role-based administration.
const te=new TextEncoder(), td=new TextDecoder();
const COOKIE='mhl_session', TTL=12*3600;
const ROLES=['superadmin','league_admin','team_manager','editor'];
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(msg,status=400)=>reply({error:msg},status);
const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
const ub64=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function hmac(secret,value){let key=await crypto.subtle.importKey('raw',te.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await crypto.subtle.sign('HMAC',key,te.encode(value)));}
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(value)));}
function eql(a,b){let r=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)r|=(a[i]||0)^(b[i]||0);return r===0;}
async function pwHash(pass,salt,iterations=210000){const key=await crypto.subtle.importKey('raw',te.encode(pass),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:ub64(salt),iterations,hash:'SHA-256'},key,256));}
async function signSession(env,user){const payload=b64(te.encode(JSON.stringify({id:user.id,version:user.session_version||1,exp:Date.now()+TTL*1000})));return `${COOKIE}=${payload}.${await hmac(env.SESSION_SECRET,payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}`;}
async function who(request,env){
 if(!env.SESSION_SECRET)return null;
 const part=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));if(!part)return null;
 try{
  const [payload,sig]=part.slice(COOKIE.length+1).split('.');if(!payload||!sig||!eql(ub64(sig),ub64(await hmac(env.SESSION_SECRET,payload))))return null;
  const obj=JSON.parse(td.decode(ub64(payload)));if(!(obj.exp>Date.now()))return null;
  if(obj.id==='bootstrap')return obj.version===1&&env.ADMIN_USERNAME?{id:'bootstrap',username:env.ADMIN_USERNAME,display_name:'Hovedadministrator',role:'superadmin',team_id:null,enabled:1,session_version:1}:null;
  const user=await env.DB.prepare('SELECT id,username,display_name,role,team_id,enabled,session_version FROM admin_users WHERE id=?').bind(obj.id).first();
  return user&&user.enabled===1&&user.session_version===obj.version?user:null;
 }catch{return null;}
}
const identity=user=>({id:user.id,username:user.username,displayName:user.display_name,role:user.role,teamId:user.team_id||null});
const requireOrigin=req=>req.headers.get('Origin')===new URL(req.url).origin;
async function bodyJson(req){if(!(req.headers.get('Content-Type')||'').includes('application/json'))throw new Error('JSON kreves');const raw=await req.text();if(raw.length>1000000)throw new Error('For stor forespørsel');return JSON.parse(raw);}
async function audit(env,user,action,details=''){await env.DB.prepare('INSERT INTO admin_audit(actor_id,actor_name,action,details) VALUES(?,?,?,?)').bind(user.id,user.username,action,String(details).slice(0,450)).run();}
const changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b);
function permittedChange(previous,next,user){
 if(user.role==='superadmin'||user.role==='league_admin')return true;
 const keys=new Set([...Object.keys(previous),...Object.keys(next)]);
 if(user.role==='editor')return [...keys].every(k=>k==='posts'||!changed(previous[k],next[k]));
 if(user.role!=='team_manager'||!user.team_id)return false;
 for(const key of keys){
  if(key==='teams'){
   const a=previous.teams||[],b=next.teams||[];
   if(a.length!==b.length)return false;
   for(let i=0;i<a.length;i++){
    if(a[i].id!==b[i].id)return false;
    if(a[i].id!==user.team_id&&changed(a[i],b[i]))return false;
   }
  }else if(key==='players'){
   const a=new Map((previous.players||[]).map(p=>[p.id,p])),b=new Map((next.players||[]).map(p=>[p.id,p]));
   for(const [id,p] of a){const n=b.get(id);if(!n){if(p.teamId!==user.team_id)return false;continue;}if((p.teamId!==user.team_id||n.teamId!==user.team_id)&&changed(p,n))return false;}
   for(const [id,p] of b){if(!a.has(id)&&p.teamId!==user.team_id)return false;}
  }else if(changed(previous[key],next[key]))return false;
 }
 return true;
}

// MHL v12 newsletter: explicit consent, verification, unsubscribe and one-time mailouts.
const mailEscape = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emailValid = v => /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,}$/.test(v);
const webPage=(title,message)=>new Response(`<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${mailEscape(title)} | MHL</title><body style="font:17px system-ui;background:#101a22;color:#f9f6ee;padding:12vh 8vw"><h1>${mailEscape(title)}</h1><p>${mailEscape(message)}</p><p><a style="color:#e7c16b" href="/">Tilbake til MHL</a></p></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
const mailToken=async (env,id,kind)=>hmac(env.SESSION_SECRET,`mhl-newsletter:${kind}:${id}`);
const newsletterReady=env=>!!(env.RESEND_API_KEY&&env.MAIL_FROM&&env.SESSION_SECRET);
async function mailAPI(env,payload,idempotency){
 const r=await fetch('https://api.resend.com/emails'+(Array.isArray(payload)?'/batch':''),{
  method:'POST',headers:{'Authorization':'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json',...(idempotency?{'Idempotency-Key':idempotency}:{})},body:JSON.stringify(payload)
 });
 if(!r.ok){const body=await r.text();console.error('Resend rejected',r.status,body.slice(0,250));throw new Error('E-postleverandøren avviste forespørselen ('+r.status+')');}
 return r.json();
}
function emailStandings(rows){
 if(!Array.isArray(rows)||!rows.length)return '';
 return `<h2 style="color:#d3a846">Tabellen etter runden</h2><table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th align="left">#</th><th align="left">Lag</th><th>K</th><th>+/-</th><th>P</th><th>Endr.</th></tr>${rows.slice(0,10).map((r,i)=>`<tr><td style="padding:6px;border-bottom:1px solid #eee">${i+1}</td><td style="border-bottom:1px solid #eee">${mailEscape(r.team)}</td><td align="center">${Number(r.gp)||0}</td><td align="center">${Number(r.diff)||0}</td><td align="center"><b>${Number(r.pts)||0}</b></td><td align="center">${r.movement==null?'–':r.movement>0?'↑'+r.movement:r.movement<0?'↓'+Math.abs(r.movement):'→'}</td></tr>`).join('')}</table>`;
}
function emailLeaders(items){
 if(!Array.isArray(items)||!items.length)return '';
 return '<h2 style="color:#d3a846">Poengplukkerne</h2><p>'+items.slice(0,3).map((x,i)=>`${i+1}. ${mailEscape(x.name)} (${mailEscape(x.team)}) – ${Number(x.points)||0} poeng`).join('<br>')+'</p>';
}
function newsletterContent(post,origin,recipient,env){
 const href=origin+'/#/';
 const unsubscribe=origin+'/api/newsletter/unsubscribe?id='+encodeURIComponent(recipient.id)+'&token='+encodeURIComponent(recipient.token);
 const images=(post.photoIds||[]).filter(x=>/^[a-f0-9-]{36}$/.test(x)).slice(0,3);
 const photos=images.map(id=>`<img alt="Bilde fra MHL" src="${origin}/api/photos/${id}/image" style="max-width:100%;display:block;margin:14px 0;border-radius:8px">`).join('');
 const roundup=post.roundup||null;
 const content=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#20262d;line-height:1.6"><div style="background:#13232d;color:#f7f2e8;padding:24px"><strong style="font-size:26px;color:#d3a846">MHL.</strong><div>HOCKEY FOR ALLE</div></div><div style="padding:22px"><h1>${mailEscape(post.title)}</h1><p style="white-space:pre-wrap">${mailEscape(post.content)}</p>${photos}${roundup?emailStandings(roundup.standings)+emailLeaders(roundup.leaders):''}<p><a href="${href}">Se MHL-nettsiden og full statistikk</a></p><hr><p style="font-size:12px;color:#6b7280">Du får denne e-posten fordi du har meldt deg på MHLs nyheter. <a href="${unsubscribe}">Meld meg av</a>.</p></div></div>`;
 return {from:env.MAIL_FROM,to:[recipient.email],subject:'MHL | '+String(post.title).slice(0,140),html:content,headers:{'List-Unsubscribe':`<${unsubscribe}>`}};
}

export async function onRequest({request,env}){
 if(!env.DB)return fail('D1-binding DB mangler',503);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');const method=request.method.toUpperCase();
 try{
  const user=await who(request,env);
  const canEdit=user&&['superadmin','league_admin','editor'].includes(user.role);
  const canPhotos=user&&['superadmin','league_admin','editor'].includes(user.role);

  // v13: anonymous approximate visits to the homepage. The browser generates
  // a random session token; the API stores only its HMAC, never IP/cookie data.
  // Count once per browser session per day, not on every hash-route change.
  if(path==='views'&&(method==='GET'||method==='POST')){
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   if(method==='POST'){
    if(!requireOrigin(request))return fail('Ugyldig opprinnelse',403);
    const input=await bodyJson(request),token=String(input.token||'');
    if(input.page!=='home'||!/^[a-f0-9-]{36}$/.test(token))return fail('Ugyldig besøkstoken');
    const visitKey=await hmac(env.SESSION_SECRET||'mhl-counter',day+':'+token);
    await env.DB.prepare('INSERT OR IGNORE INTO page_views(page,day,visit_key) VALUES(?,?,?)').bind('home',day,visitKey).run();
   }
   const result=await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN day=? THEN 1 ELSE 0 END),0) AS today FROM page_views WHERE page='home'").bind(day).first();
   return reply({total:Number(result?.total)||0,today:Number(result?.today)||0,description:'Omtrentlige besøk; én registrering per nettleserfane per dag.'});
  }
  if(method==='GET'&&path==='newsletter/status')return reply({enabled:newsletterReady(env)});
  if(method==='POST'&&path==='newsletter/subscribe'){
   if(!requireOrigin(request))return fail('Ugyldig opprinnelse',403);
   if(!newsletterReady(env))return fail('E-postpåmelding er ikke konfigurert ennå',503);
   const input=await bodyJson(request),email=String(input.email||'').trim().toLowerCase();
   if(!emailValid(email)||!input.consent||String(input.website||''))return fail('Oppgi gyldig e-post og samtykke');
   const current=await env.DB.prepare('SELECT id,confirmed_at,last_confirmation_at FROM newsletter_subscribers WHERE email=?').bind(email).first();
   if(current?.confirmed_at)return reply({ok:true,message:'Hvis adressen er registrert, vil du motta neste nyhetsbrev.'});
   if(current?.last_confirmation_at&&Date.now()-Date.parse(current.last_confirmation_at+'Z')<600000)return reply({ok:true,message:'Sjekk innboksen din for bekreftelseslenken.'});
   const id=current?.id||crypto.randomUUID();
   if(current)await env.DB.prepare('UPDATE newsletter_subscribers SET last_confirmation_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
   else await env.DB.prepare('INSERT INTO newsletter_subscribers(id,email,last_confirmation_at) VALUES(?,?,CURRENT_TIMESTAMP)').bind(id,email).run();
   const origin=new URL(request.url).origin,token=await mailToken(env,id,'confirm');
   const link=origin+'/api/newsletter/confirm?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(token);
   try{await mailAPI(env,{from:env.MAIL_FROM,to:[email],subject:'Bekreft MHL-nyheter',html:`<p>Du har bedt om å motta nyheter fra MHL.</p><p><a href="${link}">Bekreft e-postadressen</a></p><p>Ignorer denne meldingen dersom du ikke meldte deg på.</p>`});}
   catch{return fail('Bekreftelsesmail kunne ikke sendes. Prøv igjen senere.',503);}
   return reply({ok:true,message:'Vi har sendt deg en bekreftelseslenke på e-post.'});
  }
  if(method==='GET'&&(path==='newsletter/confirm'||path==='newsletter/unsubscribe')){
   if(!env.SESSION_SECRET)return fail('Ikke konfigurert',503);
   const id=url.searchParams.get('id')||'',token=url.searchParams.get('token')||'',kind=path.split('/')[1];
   if(!/^[a-f0-9-]{36}$/.test(id)||!token||!eql(ub64(token),ub64(await mailToken(env,id,kind))))return webPage('Ugyldig lenke','Lenken er ugyldig eller har utløpt.');
   if(kind==='confirm'){
    await env.DB.prepare('UPDATE newsletter_subscribers SET confirmed_at=COALESCE(confirmed_at,CURRENT_TIMESTAMP) WHERE id=?').bind(id).run();
    return webPage('E-post bekreftet','Du er nå påmeldt MHLs nyhetsoppdateringer.');
   }
   await env.DB.prepare('DELETE FROM newsletter_subscribers WHERE id=?').bind(id).run();
   return webPage('Du er meldt av','Du vil ikke lenger motta MHLs nyhetsbrev.');
  }
  if(method==='GET'&&path==='newsletter/overview'){
   if(!user||!canEdit)return fail('Ingen tilgang',403);
   const r=await env.DB.prepare('SELECT COUNT(*) AS count FROM newsletter_subscribers WHERE confirmed_at IS NOT NULL').first();
   const mails=await env.DB.prepare('SELECT post_id,status,recipients,created_at,updated_at FROM newsletter_mailings ORDER BY created_at DESC LIMIT 30').all();
   return reply({subscribers:r?.count||0,mailings:mails.results});
  }
  if(method==='POST'&&path==='newsletter/send'){
   if(!user||!canEdit||!requireOrigin(request))return fail('Ingen tilgang',403);
   if(!newsletterReady(env))return fail('Sett opp RESEND_API_KEY og MAIL_FROM først',503);
   const input=await bodyJson(request),postId=String(input.postId||'');
   if(!/^post-[a-z0-9-]{4,60}$/.test(postId))return fail('Ugyldig innlegg');
   const row=await env.DB.prepare('SELECT payload FROM site_state WHERE id=1').first();
   const post=JSON.parse(row.payload).posts.find(p=>p.id===postId);
   if(!post)return fail('Innlegget er ikke publisert',404);
   const current=await env.DB.prepare('SELECT status FROM newsletter_mailings WHERE post_id=?').bind(postId).first();
   if(current)return fail('Utsending er allerede registrert ('+current.status+'). Kontroller status hos e-postleverandøren før eventuell ny utsending.',409);
   const subs=await env.DB.prepare('SELECT id,email FROM newsletter_subscribers WHERE confirmed_at IS NOT NULL ORDER BY created_at LIMIT 101').all();
   if(subs.results.length>100)return fail('Over 100 abonnenter. Krever kø/batch-utvidelse før utsending.',409);
   if(!subs.results.length)return reply({ok:true,accepted:0,message:'Innlegget er publisert, men ingen har bekreftet abonnement ennå.'});
   await env.DB.prepare(`INSERT INTO newsletter_mailings(post_id,status,recipients) VALUES(?,'sending',?)`).bind(postId,subs.results.length).run();
   const origin=new URL(request.url).origin;
   const payload=[];
   for(const sub of subs.results){payload.push(newsletterContent(post,origin,{...sub,token:await mailToken(env,sub.id,'unsubscribe')},env));}
   try{
    await mailAPI(env,payload,'mhl-'+postId);
    await env.DB.prepare(`UPDATE newsletter_mailings SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE post_id=?`).bind(postId).run();
    await audit(env,user,'newsletter.send',postId+'; '+subs.results.length+' mottakere');
    return reply({ok:true,accepted:subs.results.length,message:'E-postleverandøren har akseptert utsendingen. Levering er ikke garantert.'});
   }catch(err){await env.DB.prepare(`UPDATE newsletter_mailings SET status='needs_review',updated_at=CURRENT_TIMESTAMP WHERE post_id=?`).bind(postId).run();return fail('Utsendingen må kontrolleres hos e-postleverandøren. Automatisk ny utsending er sperret for å unngå duplikater.',502);}
  }
  if(method==='GET'&&path==='session')return reply({authenticated:!!user,user:user?identity(user):null});
  if(method==='POST'&&path==='login'){
   if(!requireOrigin(request))return fail('Ugyldig opprinnelse',403);
   if(!env.SESSION_SECRET)return fail('SESSION_SECRET mangler',503);
   const input=await bodyJson(request),username=String(input.username||'').trim(),password=String(input.password||'');
   let found=null;
   if(env.ADMIN_USERNAME&&env.ADMIN_PASSWORD&&eql(await digest(username),await digest(env.ADMIN_USERNAME))&&eql(await digest(password),await digest(env.ADMIN_PASSWORD))){found={id:'bootstrap',username:env.ADMIN_USERNAME,display_name:'Hovedadministrator',role:'superadmin',team_id:null,session_version:1};}
   else{const candidate=await env.DB.prepare('SELECT * FROM admin_users WHERE username=? AND enabled=1').bind(username).first();if(candidate&&eql(ub64(candidate.password_hash),ub64(await pwHash(password,candidate.salt,candidate.iterations))))found=candidate;}
   if(!found)return fail('Feil brukernavn eller passord',401);
   await audit(env,found,'login');return reply({authenticated:true,user:identity(found)},200,{'Set-Cookie':await signSession(env,found)});
  }
  if(method==='POST'&&path==='logout'){if(!requireOrigin(request))return fail('Ugyldig opprinnelse',403);return reply({authenticated:false},200,{'Set-Cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});}
  if(method==='GET'&&path==='state'){const row=await env.DB.prepare('SELECT payload,revision FROM site_state WHERE id=1').first();if(!row)return fail('D1 må initialiseres',503);return reply({data:JSON.parse(row.payload),revision:row.revision});}
  if(method==='PUT'&&path==='state'){
   if(!requireOrigin(request)||!user)return fail('Krever innlogging',401);
   const input=await bodyJson(request);if(!Number.isInteger(input.revision)||input.revision<1)return fail('Revisjonsnummer mangler');
   const data=input.data;if(!data||!Array.isArray(data.teams)||!Array.isArray(data.players)||!Array.isArray(data.matches)||!Array.isArray(data.fixtures)||!Array.isArray(data.posts))return fail('Ugyldig datasett');delete data.admin;
   const row=await env.DB.prepare('SELECT payload,revision FROM site_state WHERE id=1').first();if(!row||row.revision!==input.revision)return fail('Andre har endret dataene. Last inn siden på nytt.',409);
   if(!permittedChange(JSON.parse(row.payload),data,user))return fail('Du har ikke tilgang til denne endringen',403);
   const payload=JSON.stringify(data);if(payload.length>900000)return fail('Datasettet er for stort');
   const result=await env.DB.prepare('UPDATE site_state SET payload=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(payload,input.revision).run();
   if(result.meta.changes!==1)return fail('Datakonflikt. Last inn på nytt.',409);
   await audit(env,user,'state.update',`revisjon ${input.revision+1}`);return reply({ok:true,revision:input.revision+1});
  }
  if(method==='GET'&&path==='photos'){
   const r=await env.DB.prepare(user?'SELECT id,alt,active FROM photos ORDER BY created_at DESC LIMIT 250':'SELECT id,alt,active FROM photos WHERE active=1 ORDER BY created_at DESC LIMIT 250').all();
   return reply({photos:r.results.map(p=>({id:p.id,alt:p.alt,active:!!p.active,src:'/api/photos/'+p.id+'/image'}))});
  }
  const img=path.match(/^photos\/([a-f0-9-]{36})\/image$/);
  if(method==='GET'&&img){if(!env.IMAGES)return fail('R2 mangler',503);const p=await env.DB.prepare('SELECT object_key,content_type,active FROM photos WHERE id=?').bind(img[1]).first();if(!p||(!p.active&&!user))return fail('Ikke funnet',404);const obj=await env.IMAGES.get(p.object_key);if(!obj)return fail('Ikke funnet',404);return new Response(obj.body,{headers:{'Content-Type':p.content_type,'X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=600'}});}
  if(method==='POST'&&path==='photos'){
   if(!requireOrigin(request)||!canPhotos)return fail('Ingen tilgang',403);if(!env.IMAGES)return fail('R2 mangler',503);
   const form=await request.formData(),file=form.get('photo'),alt=String(form.get('alt')||'').trim().slice(0,180);const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'};
   if(!(file instanceof File)||!types[file.type]||file.size>6*1024*1024||file.size===0||!alt)return fail('Bildeformat eller tekst ugyldig');
   const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer()),ascii=String.fromCharCode(...bytes);
   const valid=file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:file.type==='image/png'?ascii.startsWith('\x89PNG\r\n\x1a\n'):file.type==='image/webp'?ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP':ascii.slice(4,12)==='ftypavif';
   if(!valid)return fail('Bildeinnholdet er ugyldig');const id=crypto.randomUUID(),key='gallery/'+id+'.'+types[file.type];await env.IMAGES.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
   try{await env.DB.prepare('INSERT INTO photos(id,object_key,content_type,alt,active) VALUES(?,?,?,?,1)').bind(id,key,file.type,alt).run();}catch(err){await env.IMAGES.delete(key);throw err;}
   await audit(env,user,'photo.upload',id);return reply({ok:true,id},201);
  }
  const photo=path.match(/^photos\/([a-f0-9-]{36})$/);
  if(photo&&['PATCH','DELETE'].includes(method)){
   if(!requireOrigin(request)||!canPhotos)return fail('Ingen tilgang',403);const p=await env.DB.prepare('SELECT object_key FROM photos WHERE id=?').bind(photo[1]).first();if(!p)return fail('Ikke funnet',404);
   if(method==='PATCH'){const input=await bodyJson(request);if(typeof input.active!=='boolean')return fail('active må være boolsk');await env.DB.prepare('UPDATE photos SET active=? WHERE id=?').bind(input.active?1:0,photo[1]).run();}
   else{if(!env.IMAGES)return fail('R2 mangler',503);const site=await env.DB.prepare('SELECT payload FROM site_state WHERE id=1').first();if(site&&JSON.parse(site.payload).posts.some(post=>(post.photoIds||[]).includes(photo[1])))return fail('Bildet brukes i en publisering. Fjern koblingen før sletting.',409);await env.IMAGES.delete(p.object_key);await env.DB.prepare('DELETE FROM photos WHERE id=?').bind(photo[1]).run();}
   await audit(env,user,'photo.'+method.toLowerCase(),photo[1]);return reply({ok:true});
  }
  if(path==='users'&&method==='GET'){
   if(!user||user.role!=='superadmin')return fail('Kun superadmin',403);
   const rows=await env.DB.prepare('SELECT id,username,display_name,role,team_id,enabled,created_at FROM admin_users ORDER BY username').all();return reply({users:rows.results});
  }
  if(path==='users'&&method==='POST'){
   if(!requireOrigin(request)||!user||user.role!=='superadmin')return fail('Kun superadmin',403);
   const input=await bodyJson(request);const username=String(input.username||'').trim(),display=String(input.displayName||'').trim(),password=String(input.password||'');const role=String(input.role||''),team=role==='team_manager'?String(input.teamId||''):null;
   if(!/^[a-zA-Z0-9._-]{3,48}$/.test(username)||display.length<2||display.length>100||password.length<14||password.length>256||!ROLES.includes(role))return fail('Kontroller navn, brukernavn, rolle og passord (min. 14 tegn)');
   if(role==='superadmin')return fail('Flere superadmin-kontoer opprettes ikke i denne versjonen');
   if(role==='team_manager'){const row=await env.DB.prepare('SELECT payload FROM site_state WHERE id=1').first();if(!JSON.parse(row.payload).teams.some(t=>t.id===team))return fail('Ukjent lag');}
   if(username.toLowerCase()===String(env.ADMIN_USERNAME||'').toLowerCase())return fail('Brukernavn er reservert');
   const id=crypto.randomUUID(),salt=b64(crypto.getRandomValues(new Uint8Array(16))),hash=await pwHash(password,salt);
   try{await env.DB.prepare('INSERT INTO admin_users(id,username,display_name,role,team_id,salt,password_hash,iterations) VALUES(?,?,?,?,?,?,?,210000)').bind(id,username,display,role,team,salt,hash).run();}catch{return fail('Brukernavnet er allerede i bruk',409);}
   await audit(env,user,'user.create',`${username} (${role})`);return reply({ok:true,id},201);
  }
  const u=path.match(/^users\/([a-f0-9-]{36})$/);
  if(u&&method==='PATCH'){
   if(!requireOrigin(request)||!user||user.role!=='superadmin')return fail('Kun superadmin',403);
   const input=await bodyJson(request),target=await env.DB.prepare('SELECT * FROM admin_users WHERE id=?').bind(u[1]).first();if(!target)return fail('Bruker finnes ikke',404);
   if(typeof input.enabled==='boolean')await env.DB.prepare('UPDATE admin_users SET enabled=?,session_version=session_version+1 WHERE id=?').bind(input.enabled?1:0,u[1]).run();
   else if(typeof input.password==='string'&&input.password.length>=14&&input.password.length<=256){const salt=b64(crypto.getRandomValues(new Uint8Array(16)));await env.DB.prepare('UPDATE admin_users SET salt=?,password_hash=?,iterations=210000,session_version=session_version+1 WHERE id=?').bind(salt,await pwHash(input.password,salt),u[1]).run();}
   else return fail('Oppgi enabled eller nytt passord på minst 14 tegn');
   await audit(env,user,'user.update',target.username);return reply({ok:true});
  }
  if(path==='audit'&&method==='GET'){
   if(!user||user.role!=='superadmin')return fail('Kun superadmin',403);const r=await env.DB.prepare('SELECT actor_name,action,details,created_at FROM admin_audit ORDER BY id DESC LIMIT 60').all();return reply({entries:r.results});
  }
  return fail('Ukjent API-rute',404);
 }catch(err){console.error('MHL API error',err);return fail(err instanceof SyntaxError?'Ugyldig JSON':'Serverfeil',err instanceof SyntaxError?400:500);}
}
