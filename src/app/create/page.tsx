import CreateWizard from "@/components/CreateWizard";
export const metadata={title:"Create an Orb"};
export default function Page(){return <div className="page"><div className="container"><span className="eyebrow">Host an Orb</span><h1 className="page-title">Turn a prize into a <span className="gradient-text">community event.</span></h1><p className="page-intro">Choose a game, fund the prize, customize the world, and schedule one shared launch for your community.</p><CreateWizard arenaLiveEnabled={false}/></div></div>}
