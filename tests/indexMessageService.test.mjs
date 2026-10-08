import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexMessageService, decodeIndexMessages } from '../js/indexMessageService.js';
const data = {eno:'1',ownMessage:'hello',others:[{eno:'2',battlerName:'B',defaultIconUrl:'',message:'hi'}]};
test('strict INDEX response whitelist and Unicode boundaries',()=>{
 assert.deepEqual(decodeIndexMessages(data,'1'),data);
 for(const bad of [null,{}, {...data,private:'secret'}, {...data,eno:'2'}, {...data,ownMessage:'😀'.repeat(61)}, {...data,others:[{...data.others[0],build:{}}]}, {...data,others:[{...data.others[0],eno:'1'}]}, {...data,others:[{...data.others[0],message:' '}]}, {...data,others:Array(4).fill(data.others[0])}, {...data,others:[data.others[0],data.others[0]]}]) assert.throws(()=>decodeIndexMessages(bad,'1'));
 assert.equal(decodeIndexMessages({...data,ownMessage:'😀'.repeat(60)},'1').ownMessage.length,120);
});
test('service load/save, failed save and invalidation/session switch',async()=>{
 let id='user', error=null, calls=0, finish;
 const client={auth:{getSession:async()=>({data:{session:id?{user:{id}}:null}})},rpc:async(name,args)=>{calls++;return {error,data:name==='get_index_messages'?data:{eno:args.p_eno,message:args.p_message}};}};
 const s=createIndexMessageService(client,'1');assert.equal((await s.load()).ok,true);
 assert.deepEqual(await s.save('  😀  '),{ok:true,message:'😀'});
 assert.equal((await s.save('😀'.repeat(60))).ok,true);const before=calls;
 assert.equal((await s.save('😀'.repeat(61))).ok,false);assert.equal(calls,before);
 error={code:'network'};assert.equal((await s.save('keep')).ok,false);error=null;
 client.rpc=()=>new Promise(r=>finish=r);
 const pending=s.load();await new Promise(r=>setImmediate(r));s.invalidate();finish({data});assert.equal((await pending).ok,false);
 const changed=s.load();await new Promise(r=>setImmediate(r));id='other';finish({data});assert.equal((await changed).ok,false);
 id=null;assert.equal((await s.load()).ok,false);
});
