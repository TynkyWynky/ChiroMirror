import { appScope } from "./environment.ts";
export function friendlyDeviceName() {
  if (typeof navigator === "undefined") return "Dit apparaat";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(ua)) return "iPhone/iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Firefox/i.test(ua)) return "Firefox op Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Safari op Mac";
  if (/Windows/i.test(ua)) return "Windows-pc";
  return "Dit apparaat";
}
export async function endpointKey(endpoint: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function setPushDevice(locked: boolean, endpoint?: string) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration(appScope());
  const workers = [...new Set([reg?.active,reg?.waiting,navigator.serviceWorker.controller].filter(Boolean))] as ServiceWorker[];
  const deviceKey = endpoint ? await endpointKey(endpoint) : undefined;
  await Promise.all(workers.map(worker=>new Promise<void>((resolve,reject)=>{
    const channel = new MessageChannel();
    const timer = setTimeout(()=>{channel.port1.close();reject(new Error("DEVICE_LOCK_FAILED"));},2000);
    channel.port1.onmessage = event=>{clearTimeout(timer);channel.port1.close();event.data?.ok ? resolve() : reject(new Error("DEVICE_LOCK_FAILED"));};
    worker.postMessage({type:locked?"PUSH_LOCK":"PUSH_BIND",deviceKey},[channel.port2]);
  })));
}
export async function bounded<T>(work: Promise<T>, ms = 3500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("DEVICE_TIMEOUT")),ms);})]); }
  finally {clearTimeout(timer);}
}
