import { strict as assert } from "node:assert";
import fs from "node:fs";
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("464cqCX4vMoQFjeuVinz3R6ccrFz68WqEkSvFSGg7Fns");
const CONFIG_SEED = Buffer.from("config");
const ORB_SEED = Buffer.from("orb");

type IdlInstruction = { name: string; accounts: Array<{ name: string; signer?: boolean; writable?: boolean; address?: string }>; args: Array<{ name: string }> };
type Idl = { address: string; instructions: IdlInstruction[] };

function loadIdl(): Idl {
  return JSON.parse(fs.readFileSync("../target/idl/orbs_protocol.json", "utf8")) as Idl;
}
function instruction(idl: Idl, name: string) {
  const ix = idl.instructions.find((entry) => entry.name === name);
  assert.ok(ix, `missing ${name}`);
  return ix;
}

describe("orbs_protocol production interface", () => {
  const idl = loadIdl();

  it("uses the deployed mainnet program id", () => {
    assert.equal(idl.address, PROGRAM_ID.toBase58());
  });

  it("exposes only the minimal custody/admin instruction surface", () => {
    assert.deepEqual(idl.instructions.map((ix) => ix.name).sort(), [
      "claim_prize",
      "fund_orb",
      "initialize_protocol",
      "refund_expired",
      "rotate_claim_authority",
    ]);
  });

  it("fund_orb has the exact minimal custody account set", () => {
    const ix = instruction(idl, "fund_orb");
    assert.deepEqual(ix.accounts.map((a) => a.name), [
      "host", "payer", "orb", "mint", "host_token_account", "prize_vault",
      "token_program", "associated_token_program", "system_program",
    ]);
    assert.deepEqual(ix.args.map((a) => a.name), ["args"]);
  });

  it("claim_prize requires distinct Turnkey and winner signer slots", () => {
    const ix = instruction(idl, "claim_prize");
    const claim = ix.accounts.find((a) => a.name === "claim_authority");
    const winner = ix.accounts.find((a) => a.name === "winner");
    assert.equal(claim?.signer, true);
    assert.equal(winner?.signer, true);
    assert.deepEqual(ix.args, []);
  });

  it("config and Orb PDAs remain deterministic", () => {
    const host = new PublicKey("11111111111111111111111111111111");
    const orbId = Buffer.alloc(16, 7);
    const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID);
    const [orb] = PublicKey.findProgramAddressSync([ORB_SEED, host.toBuffer(), orbId], PROGRAM_ID);
    assert.ok(config.toBase58().length > 30);
    assert.ok(orb.toBase58().length > 30);
    assert.notEqual(config.toBase58(), orb.toBase58());
  });
});
