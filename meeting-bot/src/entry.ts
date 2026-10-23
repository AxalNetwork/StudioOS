/** D886 B2: private container HTTP entry; B8 supplies routing and secrets. */
import { createServer } from 'node:http';
import { RuntimeHost } from './runtime.ts';
import { runtimeAdapter } from './runtimeAdapters.ts';
import { consoleSink, logLine } from './log.ts';

try{
  const host=new RuntimeHost({secret:process.env.MEETING_BOT_SECRET??'',callbackOrigin:process.env.MEETING_BOT_CALLBACK_ORIGIN??'',adapter:runtimeAdapter,log:consoleSink});
  const port=Number(process.env.PORT??8080);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('port_invalid');
  const server=createServer(async(req,res)=>{
    try{
      const request=new Request(`http://runtime.internal${req.url??'/'}`,{method:req.method,headers:req.headers as Record<string,string>,
        ...(req.method==='POST'?{body:req,duplex:'half'}:{} )} as RequestInit);
      const response=await host.fetch(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(503,{'content-type':'application/json'});res.end('{"code":"runtime_unavailable"}');}
  });
  let stopping=false;
  const stop=()=>{
    if(stopping)return;stopping=true;server.close();
    const force=setTimeout(()=>process.exit(1),28_000);force.unref();
    void host.shutdown().then(()=>{clearTimeout(force);process.exit(0);}).catch(()=>{logLine(consoleSink,'runtime_failed');process.exit(1);});
  };
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  server.listen(port,'0.0.0.0',()=>logLine(consoleSink,'runtime_listening',{port}));
  server.on('error',()=>{logLine(consoleSink,'runtime_failed');process.exitCode=1;});
}catch{logLine(consoleSink,'runtime_failed');process.exitCode=1;}
