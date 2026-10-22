importScripts('core.js','pulse.js','wellbeing.js');
self.onmessage=({data})=>{try{const packet=NL2.validate(data.packet);NL2Wellbeing.validatePacket(packet);const result=NL2.analyze(packet,NL2Pulse);result.mind=NL2Wellbeing.analyze(packet,result);self.postMessage({id:data.id,result});}catch(error){self.postMessage({id:data.id,error:error.message});}};
