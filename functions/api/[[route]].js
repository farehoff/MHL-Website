// Cloudflare Pages Functions API — D1 persistence + signed session cookie.
const te=new TextEncoder();
const SESSION_COOKIE='mhl_session';
const COOKIE_TTL=12*60*60;
function response(data,status=200,extra={}) {return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});}
function b64(bytes) {return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function ub64(value){const input=value.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(input);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function hmac(secret,value){const key=await crypto.subtle.importKey('raw',te.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await crypto.subtle.sign('HMAC',key,te.encode(value)));}
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(value)));}
function equalBytes(a,b){let r=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)r |= (a[i]||0)^(b[i]||0);return r===0;}
async function authed(request,env){
 if(!env.SESSION_SECRET)return false;
 const cookie=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(SESSION_COOKIE+'='));
 if(!cookie)return false;
 const value=cookie.slice(SESSION_COOKIE.length+1);
 const parts=value.split('.');if(parts.length!==2)return false;
 const [payload,signature]=parts;
 try {const expected=await hmac(env.SESSION_SECRET,payload);
  if(!equalBytes(ub64(signature),ub64(expected)))return false;
  const data=JSON.parse(new TextDecoder().decode(ub64(payload)));
  return data.role==='admin' && Number.isFinite(data.exp) && data.exp>Date.now();
 }catch{return false;}
}
function requireOrigin(request){const url=new URL(request.url);const origin=request.headers.get('Origin');return origin===url.origin;}
async function jsonBody(request){if(!(request.headers.get('Content-Type')||'').includes('application/json'))throw new Error('JSON kreves');
 const len=Number(request.headers.get('Content-Length')||0);if(len>1024*1024)throw new Error('For stor forespørsel');
 const raw=await request.text();if(raw.length>1024*1024)throw new Error('For stor forespørsel');return JSON.parse(raw);}
const fail=(message,status=400)=>response({error:message},status);
export async function onRequest(context) {
 const {request,env}=context;
 if(!env.DB)return fail('D1-binding DB mangler',503);
 const url=new URL(request.url);
 const path=url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');
 const method=request.method.toUpperCase();
 try {
  // Public image metadata; actual files are streamed through this API from private R2.
  if(method==='GET' && path==='photos'){
   const admin=await authed(request,env);
   const result=await env.DB.prepare(admin?'SELECT id, alt, active FROM photos ORDER BY created_at DESC LIMIT 250':'SELECT id, alt, active FROM photos WHERE active=1 ORDER BY created_at DESC LIMIT 250').all();
   return response({photos:result.results.map(p=>({id:p.id,alt:p.alt,active:Boolean(p.active),src:'/api/photos/'+encodeURIComponent(p.id)+'/image'}))});
  }
  const imageMatch=path.match(/^photos\/([a-f0-9-]{36})\/image$/);
  if(method==='GET' && imageMatch){
   if(!env.IMAGES)return fail('R2-binding IMAGES mangler',503);
   const p=await env.DB.prepare('SELECT object_key, content_type, active FROM photos WHERE id=?').bind(imageMatch[1]).first();
   if(!p||(!p.active&&!await authed(request,env)))return fail('Bildet finnes ikke',404);
   const obj=await env.IMAGES.get(p.object_key);if(!obj)return fail('Bildet finnes ikke',404);
   return new Response(obj.body,{headers:{'Content-Type':p.content_type,'Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff'}});
  }
  if(path==='photos' && method==='POST'){
   if(!requireOrigin(request)||!await authed(request,env))return fail('Krever admininnlogging',403);
   if(!env.IMAGES)return fail('R2-binding IMAGES mangler',503);
   const form=await request.formData(),file=form.get('photo'),alt=String(form.get('alt')||'').trim().slice(0,180);
   const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'};
   if(!(file instanceof File)||!types[file.type]||file.size>6*1024*1024||file.size===0||!alt)return fail('JPG, PNG, WEBP eller AVIF kreves (maks 6 MB) samt bildetekst.');
   // Verify MIME signatures, rather than relying solely on user-provided Content-Type.
   const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
   const ascii=String.fromCharCode(...bytes);
   const good=file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
    file.type==='image/png'?ascii.startsWith('\x89PNG\r\n\x1a\n'):
    file.type==='image/webp'?ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP':ascii.slice(4,12)==='ftypavif';
   if(!good)return fail('Filinnholdet samsvarer ikke med bildeformatet');
   const id=crypto.randomUUID(),key='gallery/'+id+'.'+types[file.type];
   await env.IMAGES.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
   try {await env.DB.prepare('INSERT INTO photos(id,object_key,content_type,alt,active) VALUES(?,?,?,?,1)').bind(id,key,file.type,alt).run();}
   catch(error){await env.IMAGES.delete(key);throw error;}
   return response({ok:true,id},201);
  }
  const photoMatch=path.match(/^photos\/([a-f0-9-]{36})$/);
  if(photoMatch && ['PATCH','DELETE'].includes(method)){
   if(!requireOrigin(request)||!await authed(request,env))return fail('Krever admininnlogging',403);
   const id=photoMatch[1],p=await env.DB.prepare('SELECT object_key FROM photos WHERE id=?').bind(id).first();
   if(!p)return fail('Bildet finnes ikke',404);
   if(method==='PATCH'){
    const input=await jsonBody(request);
    if(typeof input.active!=='boolean')return fail('active må være true eller false');
    await env.DB.prepare('UPDATE photos SET active=? WHERE id=?').bind(input.active?1:0,id).run();
   }else{
    if(!env.IMAGES)return fail('R2-binding IMAGES mangler',503);
    await env.IMAGES.delete(p.object_key);
    await env.DB.prepare('DELETE FROM photos WHERE id=?').bind(id).run();
   }
   return response({ok:true});
  }
  if(method==='GET' && path==='state'){
   const row=await env.DB.prepare('SELECT payload,revision FROM site_state WHERE id=1').first();
   if(!row)return fail('D1 er ikke initialisert. Kjør schema.sql og seed.sql.',503);
   return response({data:JSON.parse(row.payload),revision:row.revision});
  }
  if(method==='GET' && path==='session')return response({authenticated:await authed(request,env)});
  if(method==='POST' && path==='login'){
   if(!requireOrigin(request))return fail('Ugyldig forespørselsopprinnelse',403);
   if(!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_SECRET)return fail('Innloggingshemmeligheter mangler',503);
   const body=await jsonBody(request);
   const validUser=equalBytes(await digest(String(body.username||'')),await digest(env.ADMIN_USERNAME));
   const validPass=equalBytes(await digest(String(body.password||'')),await digest(env.ADMIN_PASSWORD));
   if(!(validUser&&validPass))return fail('Feil brukernavn eller passord',401);
   const payload=b64(te.encode(JSON.stringify({role:'admin',exp:Date.now()+COOKIE_TTL*1000})));
   const signature=await hmac(env.SESSION_SECRET,payload);
   return response({authenticated:true},200,{'Set-Cookie':`${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_TTL}`});
  }
  if(method==='POST' && path==='logout'){
   if(!requireOrigin(request))return fail('Ugyldig forespørselsopprinnelse',403);
   return response({authenticated:false},200,{'Set-Cookie':`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});
  }
  if(method==='PUT' && path==='state'){
   if(!requireOrigin(request))return fail('Ugyldig forespørselsopprinnelse',403);
   if(!await authed(request,env))return fail('Krever admininnlogging',401);
   const input=await jsonBody(request);
   if(!Number.isInteger(input.revision)||input.revision<1)return fail('Revisjonsnummer mangler');
   const data=input.data;
   if(!data||!Array.isArray(data.teams)||!Array.isArray(data.players)||!Array.isArray(data.matches)||!Array.isArray(data.fixtures)||!Array.isArray(data.posts))return fail('Ugyldig MHL-datasett');
   // Remove demo admin credentials from incoming imports; never make password available publicly.
   delete data.admin;
   const payload=JSON.stringify(data);
   if(payload.length>900000)return fail('Datasettet er for stort');
   const result=await env.DB.prepare('UPDATE site_state SET payload=?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(payload,input.revision).run();
   if(result.meta.changes!==1)return fail('Andre har endret dataene. Last siden på nytt før du lagrer.',409);
   return response({ok:true,revision:input.revision+1});
  }
  return fail('Ukjent API-rute',404);
 }catch(e){console.error('MHL API error',e);return fail(e instanceof SyntaxError?'Ugyldig JSON':'Serveren kunne ikke utføre forespørselen',e instanceof SyntaxError?400:500);}
}
