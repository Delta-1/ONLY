import QRCode from 'npm:qrcode@1.5.4';
import {createHandler} from './handler.js';
const endpoint=Deno.env.get('SUPABASE_URL')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const rpc=async(op:string,data:unknown)=>{
 const response=await fetch(`${endpoint}/rest/v1/rpc/only_gateway`,{method:'POST',headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},body:JSON.stringify({p_op:op,p_data:data})});
 const result=await response.json();if(!response.ok)throw Error(result.message||'serverError');return result;
};
Deno.serve(createHandler({rpc,qr:(value:string)=>QRCode.toString(value,{type:'svg',width:260,margin:3,color:{dark:'#111111',light:'#ffffff'}})}));
