import QRCode from 'npm:qrcode@1.5.4';
import * as oidc from 'npm:openid-client@6.9.0';
import {createHandler} from './handler.js';
const endpoint=Deno.env.get('SUPABASE_URL')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const rpc=async(op:string,data:unknown)=>{
 const response=await fetch(`${endpoint}/rest/v1/rpc/only_gateway`,{method:'POST',headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},body:JSON.stringify({p_op:op,p_data:data})});
 const result=await response.json();if(!response.ok)throw Error(result.message||'serverError');return result;
};
// "Entrar com LINKY": cliente público (PKCE) registrado pelo próprio LINKY como app da casa.
// O callback é fixo e igual ao LINKY_ONLY_CALLBACK_URL configurado no LINKY.
const linkyClientId=Deno.env.get('LINKY_ONLY_CLIENT_ID')||'uwy_only_ene42GPIkOUzeAdl';
const linkyIssuer=Deno.env.get('LINKY_ISSUER')||'https://linky-delta1s-projects.vercel.app/api/identity';
const callback=`${endpoint}/functions/v1/only/api/linky/callback`;
let config:Promise<oidc.Configuration>|undefined;
const linkyConfig=()=>config??=oidc.discovery(new URL(linkyIssuer),linkyClientId,{id_token_signed_response_alg:'ES256'},oidc.None()).then(c=>{oidc.enableNonRepudiationChecks(c);return c;}).catch(e=>{config=undefined;throw e;});
const linky={
 async start(){const c=await linkyConfig(),verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();
  const url=oidc.buildAuthorizationUrl(c,{redirect_uri:callback,scope:'openid email profile',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce});
  return {url:url.href,pending:{verifier,state,nonce}};},
 async finish(search:string,pending:{verifier:string,state:string,nonce:string}){const c=await linkyConfig();
  const tokens=await oidc.authorizationCodeGrant(c,new URL(callback+search),{pkceCodeVerifier:pending.verifier,expectedState:pending.state,expectedNonce:pending.nonce});
  const sub=tokens.claims()!.sub,info=await oidc.fetchUserInfo(c,tokens.access_token,sub);
  return {sub,email:typeof info.email==='string'?info.email:'',emailVerified:info.email_verified===true};},
};
Deno.serve(createHandler({rpc,linky,sealSecret:serviceKey,qr:(value:string)=>QRCode.toString(value,{type:'svg',width:260,margin:3,color:{dark:'#111111',light:'#ffffff'}})}));
