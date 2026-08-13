import GameRouteClient from "@/components/game/GameRouteClient";

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function PlayPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return (
    <div className="game-page">
      <GameRouteClient
        slug={slug}
        wallet={one(query.wallet)}
        difficulty={one(query.difficulty)}
        marble={one(query.marble)}
        marble2={one(query.marble2)}
        walls={one(query.walls)}
        floor={one(query.floor)}
        accent={one(query.accent)}
      />
    </div>
  );
}
