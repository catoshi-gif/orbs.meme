"use client";
import React,{useEffect,useMemo,useState} from "react";
import {ConnectionProvider,WalletProvider as AdapterWalletProvider} from "@solana/wallet-adapter-react";
import {WalletModalProvider} from "@solana/wallet-adapter-react-ui";
import {LedgerWalletAdapter,PhantomWalletAdapter,SolflareWalletAdapter} from "@solana/wallet-adapter-wallets";
import {SolanaMobileWalletAdapter,createDefaultAddressSelector,createDefaultAuthorizationResultCache,createDefaultWalletNotFoundHandler} from "@solana-mobile/wallet-adapter-mobile";
import {WalletAdapterNetwork,type Adapter} from "@solana/wallet-adapter-base";
import {clusterApiUrl} from "@solana/web3.js";
const RPC=process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()||clusterApiUrl("mainnet-beta");
function androidChromium(){try{const u=navigator.userAgent.toLowerCase();return u.includes("android")&&!u.includes("; wv)")&&(u.includes("chrome/")||u.includes("chromium/"));}catch{return false;}}
export default function SolanaWalletProvider({children}:{children:React.ReactNode}){
 const [origin,setOrigin]=useState<string|null>(null); useEffect(()=>setOrigin(window.location.origin||"https://orbs.meme"),[]);
 const wallets=useMemo<Adapter[]>(()=>{const a:Adapter[]=[new PhantomWalletAdapter(),new SolflareWalletAdapter({network:WalletAdapterNetwork.Mainnet}),new LedgerWalletAdapter()]; if(origin&&androidChromium())a.push(new SolanaMobileWalletAdapter({addressSelector:createDefaultAddressSelector(),appIdentity:{name:"Orbs",uri:origin,icon:"/orbs-logo-128.png"},authorizationResultCache:createDefaultAuthorizationResultCache(),cluster:"mainnet-beta",onWalletNotFound:createDefaultWalletNotFoundHandler()})); return a;},[origin]);
 return <ConnectionProvider endpoint={RPC}><AdapterWalletProvider wallets={wallets} autoConnect><WalletModalProvider>{children}</WalletModalProvider></AdapterWalletProvider></ConnectionProvider>;
}
