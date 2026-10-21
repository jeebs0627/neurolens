importScripts('core.js','pulse.js');
self.onmessage=({data})=>{try{const packet=NL2.validate(data.packet);self.postMessage({id:data.id,result:NL2.analyze(packet,NL2Pulse)});}catch(error){self.postMessage({id:data.id,error:error.message});}};
