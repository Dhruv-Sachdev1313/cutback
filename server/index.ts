import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { agentMode, config, MEDIA_DIR, ROOT } from './config.js';
import { GraphStore } from './store.js';
import { Pipeline, events } from './pipeline.js';
import { correctionSchema, evidenceSchema, changedFields, SCENE_IDS } from './story.js';
import { ZodError } from 'zod';
import type { RunEvent, SceneId } from '../shared/types.js';

const app=express(); app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
let store:GraphStore|undefined;let pipeline:Pipeline|undefined;let startupError='Connecting to FalkorDB…';
app.use('/media',express.static(MEDIA_DIR,{immutable:true,maxAge:'1y',dotfiles:'deny'}));
app.get('/api/health',async(_req,res)=>{
  try {if(!store) throw new Error(startupError);await store.health();res.json({ok:true,database:'FalkorDB',mode:agentMode(),model:config.model});}
  catch(error) {res.status(503).json({ok:false,error:error instanceof Error?error.message:String(error)});}
});
app.use('/api',(_req,res,next)=>{if(!store||!pipeline){res.status(503).json({error:startupError+' Start the database with npm run db:up.'});return;}next();});
app.get('/api/state',async(_req,res)=>{
  const [versions,graph,activeRun]=await Promise.all([store!.versions(),store!.graph(),store!.activeRun()]);
  res.json({ready:versions.length>0,graphConnected:true,mode:agentMode(),model:config.model,versions,latest:versions[0]||null,graph,activeRun});
});
app.post('/api/revisions',async(req,res)=>{
  const body=correctionSchema.parse(req.body); const run=await pipeline!.begin(body.evidence,body.expectedRevision,body.sourceNote);res.status(202).json(run);
});
app.post('/api/impact',async(req,res)=>{
  const evidence=evidenceSchema.parse(req.body);const previous=await store!.latest();
  res.json(await store!.impact(previous?changedFields(previous.evidence,evidence):Object.keys(evidence)));
});
app.get('/api/runs/:id',async(req,res)=>{const run=await store!.getRun(req.params.id);if(!run){res.status(404).json({error:'Run not found.'});return;}res.json(run);});
app.get('/api/runs/:id/events',async(req,res)=>{
  const runId=req.params.id; const run=await store!.getRun(runId);if(!run){res.status(404).json({error:'Run not found.'});return;}
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();
  let last=Number(req.headers['last-event-id']||0);
  const send=(event:RunEvent)=>{if(event.seq<=last)return;last=event.seq;res.write('id: '+event.seq+'\ndata: '+JSON.stringify(event)+'\n\n');};
  const end=()=>{res.write('event: finished\ndata: {}\n\n');res.end();};
  // Subscribe before replay, then fetch again, avoiding the replay/subscribe race.
  events.on(runId,send);events.on(runId+':end',end);
  const latest=await store!.getRun(runId);latest?.events.forEach(send);
  const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),15000);
  res.on('close',()=>{clearInterval(heartbeat);events.off(runId,send);events.off(runId+':end',end);});
  if(latest?.status!=='running')end();
});
app.get('/api/versions/:id/provenance/:sceneId',async(req,res)=>{
  if(!SCENE_IDS.includes(req.params.sceneId as SceneId)){res.status(404).json({error:'Scene not found.'});return;}
  const version=(await store!.versions()).find(v=>v.id===req.params.id);if(!version){res.status(404).json({error:'Version not found.'});return;}
  res.json({version:version.revision,evidence:version.evidence,sourceNote:version.sourceNote,paths:await store!.provenance(req.params.sceneId as SceneId)});
});
app.use('/api',(_req,res)=>{res.status(404).json({error:'Endpoint not found.'});});
app.use(express.static(path.join(ROOT,'dist')));
app.get('/{*path}',(_req,res)=>res.sendFile(path.join(ROOT,'dist','index.html')));
app.use((error:Error&{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(res.headersSent)return;
  res.status(error instanceof ZodError?400:error.status||500).json({error:error instanceof ZodError?error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '):error.message});
});
await fs.mkdir(MEDIA_DIR,{recursive:true});
const server=app.listen(config.port,config.host,()=>console.log('CUTBACK API + built studio: http://'+config.host+':'+config.port));
try {store=await GraphStore.connect();await store.initialize();await store.recoverInterruptedRuns();pipeline=new Pipeline(store);await pipeline.seed();console.log('FalkorDB connected. Editorial mode: '+agentMode());}
catch(error) {startupError=error instanceof Error?error.message:String(error);console.error('Startup:',startupError);}
async function shutdown(){server.close();if(store)await store.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
