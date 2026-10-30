import { getChatGPTUser } from "./chatgpt-auth";
import { TFlow } from "./tflow";
export const dynamic="force-dynamic";
export default async function Home(){return <TFlow user={await getChatGPTUser()}/>;}
