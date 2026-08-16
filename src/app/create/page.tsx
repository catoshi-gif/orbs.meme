import CreateWizard from "@/components/CreateWizard";
import { arenaRuntimeConfigured } from "@/lib/arenaRuntime";
export const metadata={title:"Create an Orb"};
export default function Page(){const arenaLiveEnabled=arenaRuntimeConfigured();return <div className="page"><div className="container"><span className="eyebrow">Host an Orb</span><h1 className="page-title">Give your community a <span className="gradient-text">game to play.</span></h1><p className="page-intro">Choose MAZE or ARENA, put up the prize, customize the world, and set the time.</p><CreateWizard arenaLiveEnabled={arenaLiveEnabled}/></div></div>}
