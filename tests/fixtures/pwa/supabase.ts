// Test-only Auth transport. Production AdminApp, storage selection, routing and UI are unchanged.
export function createClient(_url:string,_key:string,options:any) {
  const storage=options.auth.storage,key=options.auth.storageKey,listeners=new Set<(event:string,session:any)=>void>();
  const session=()=>{try{return JSON.parse(storage.getItem(key)??'null');}catch{return null;}};
  const api=async(body:any)=>{
    const s=session();const actor=Number(s?.user.id.slice(-12)??0);
    const res=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({...body,actor})});return res.json();
  };
  function query(initial:any){
    const value={...initial,filters:[],orders:[]};
    const q={select(columns='*',opts={}){Object.assign(value,{columns,...opts});return q;},eq(column:string,v:unknown){value.filters.push([column,v]);return q;},is(column:string,v:unknown){return q.eq(column,v);},order(column:string,opts:any={}){value.orders.push([column,opts.ascending!==false]);return q;},range(from:number,to:number){Object.assign(value,{from,limit:to-from+1});return q;},limit(limit:number){value.limit=limit;return q;},maybeSingle(){value.single=true;return q;},single(){value.single=true;return q;},then(resolve:any,reject:any){return api(value).then(resolve,reject);}};
    return q;
  }
  return {
    from(table:string){return query({table});},rpc(name:string,args:object={}){return query({name,args});},
    auth:{
      getSession:async()=>({data:{session:session()},error:null}),getUser:async()=>({data:{user:session()?.user},error:null}),
      onAuthStateChange(listener:any){listeners.add(listener);return{data:{subscription:{unsubscribe(){listeners.delete(listener);}}}};},
      signInWithPassword:async({email}:any)=>{const n=email.startsWith('thomas')?2:1,s={user:{id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,email},access_token:'fixture-only',expires_at:Math.floor(Date.now()/1000)+3600};storage.setItem(key,JSON.stringify(s));listeners.forEach(fn=>fn('SIGNED_IN',s));return{data:{session:s},error:null};},
      signOut:async()=>{storage.removeItem(key);listeners.forEach(fn=>fn('SIGNED_OUT',null));return{error:null};}
    }
  };
}
