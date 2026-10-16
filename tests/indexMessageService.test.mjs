import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexMessageService, decodeIndexMessages } from '../js/indexMessageService.js';
const data = {eno:'1',ownMessage:'hello',ownIconSlot:1,ownDefaultIconUrl:'/default.png',
  ownIconSlots:['/slot1.png',''],others:[{eno:'2',battlerName:'B',defaultIconUrl:'',iconUrl:'/other.png',message:'hi'}]};
test('strict INDEX v2 response whitelist, icon numbers, and Unicode boundaries',()=>{
 assert.deepEqual(decodeIndexMessages(data,'1'),data);
 for(const bad of [null,{}, {...data,private:'secret'}, {...data,eno:'2'},
   {...data,ownMessage:'😀'.repeat(61)}, {...data,ownIconSlot:0}, {...data,ownIconSlot:11},
   {...data,ownIconSlot:'1'}, {...data,ownIconSlots:['/a',null]}, {...data,ownIconSlots:Array(11).fill('')},
   {...data,others:[{...data.others[0],build:{}}]}, {...data,others:[{...data.others[0],iconUrl:1}]},
   {...data,others:[{...data.others[0],eno:'1'}]}, {...data,others:[{...data.others[0],message:' '}]},
   {...data,others:Array(4).fill(data.others[0])}, {...data,others:[data.others[0],data.others[0]]}
 ]) assert.throws(()=>decodeIndexMessages(bad,'1'));
 assert.equal(decodeIndexMessages({...data,ownMessage:'😀'.repeat(60)},'1').ownMessage.length,120);
});
test('service loads and saves icon choice; blank deletes; failure and identity switch are safe',async()=>{
 let id='user', error=null, calls=[], finish;
 const client={auth:{getSession:async()=>({data:{session:id?{user:{id}}:null}})},rpc:async(name,args)=>{
   calls.push({name,args});
   return {error,data:name==='get_index_messages_v2'?data:{eno:args.p_eno,message:args.p_message,iconSlot:args.p_icon_slot}};
 }};
 const s=createIndexMessageService(client,'1');
 assert.equal((await s.load()).ownIconSlot,1);
 assert.deepEqual(await s.save('  😀  ',1),{ok:true,message:'😀',iconSlot:1});
 assert.deepEqual(await s.save('   ',1),{ok:true,message:'',iconSlot:null});
 assert.equal(calls.at(-1).args.p_icon_slot,null);
 assert.equal(calls.at(-1).name,'set_index_message_v2');
 assert.equal((await s.save('😀'.repeat(60),null)).ok,true);
 const before=calls.length;
 for(const slot of [0,11,-1,'1',1.3])assert.equal((await s.save('message',slot)).ok,false);
 assert.equal((await s.save('😀'.repeat(61))).ok,false);
 assert.equal(calls.length,before);
 error={code:'network'};assert.equal((await s.save('keep')).ok,false);error=null;
 client.rpc=()=>new Promise(r=>finish=r);
 const pending=s.load();await new Promise(r=>setImmediate(r));s.invalidate();finish({data});assert.equal((await pending).ok,false);
 const changed=s.load();await new Promise(r=>setImmediate(r));id='other';finish({data});assert.equal((await changed).ok,false);
 id=null;assert.equal((await s.load()).ok,false);
});
