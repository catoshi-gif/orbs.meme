import * as anchor from "@coral-xyz/anchor";
import { strict as assert } from "node:assert";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.orbsProtocol as anchor.Program<any>;
const connection = provider.connection;

const key = (byte: number) => Keypair.fromSeed(new Uint8Array(32).fill(byte));
const treasury = key(1); // must match cfg(feature="local-testing") ORBS_TREASURY
const relayer = key(2); // must match cfg(feature="local-testing") ORBS_RENT_RECEIVER
const claimAuthority = key(3);
const quoteAuthority = key(4);
const ordinaryHost = key(5);
const adminHost = key(6); // must match cfg(feature="local-testing") ORBS_ADMIN_CREATOR
const winner = key(7);
const refundCaller = key(8);
const badPayer = key(9);
const alternateHost = key(10);

const CONFIG_SEED = Buffer.from("config");
const ORB_SEED = Buffer.from("orb");
const HOST_POLICY_SEED = Buffer.from("host-policy");
const DECIMALS = 6;
const PRIZE = 5_000_000;
const FEE = 1_150_000;
const LOCAL_WINDOW_SECONDS = 12;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function airdrop(pubkey: PublicKey, sol = 3) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function expectFail(promise: Promise<unknown>, label: string) {
  let failed = false;
  try { await promise; }
  catch { failed = true; }
  assert.equal(failed, true, `${label} unexpectedly succeeded`);
}

function pdas(host: PublicKey, orbId: number[], mint: PublicKey) {
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId);
  const orbBytes = Buffer.from(orbId);
  const [orb] = PublicKey.findProgramAddressSync([ORB_SEED, host.toBuffer(), orbBytes], program.programId);
  const [hostPolicy] = PublicKey.findProgramAddressSync([HOST_POLICY_SEED, host.toBuffer()], program.programId);
  const hostTokenAccount = getAssociatedTokenAddressSync(mint, host);
  const prizeVault = getAssociatedTokenAddressSync(mint, orb, true);
  const treasuryTokenAccount = getAssociatedTokenAddressSync(mint, treasury.publicKey);
  return { config, orb, hostPolicy, hostTokenAccount, prizeVault, treasuryTokenAccount };
}

function createArgs(orbId: number[], startOffset = 2, windowSeconds = LOCAL_WINDOW_SECONDS, prizeUsdMicros = 5_000_000, feeAmount = FEE) {
  const startsAt = nowSeconds() + startOffset;
  return {
    orbId,
    prizeAmount: new anchor.BN(PRIZE),
    prizeUsdMicros: new anchor.BN(prizeUsdMicros),
    feeAmount: new anchor.BN(feeAmount),
    startsAt: new anchor.BN(startsAt),
    refundAfter: new anchor.BN(startsAt + windowSeconds),
    quoteExpiresAt: new anchor.BN(nowSeconds() + 300),
    gameCommitment: Array.from(new Uint8Array(32).fill(orbId[0] || 1)),
  };
}

async function createFundedOrb(host: Keypair, mint: PublicKey, orbByte: number, overrides?: { startOffset?: number; window?: number; prizeUsdMicros?: number; feeAmount?: number; payer?: Keypair; treasuryAccount?: PublicKey; treasuryOwner?: PublicKey }) {
  const orbId = Array.from(new Uint8Array(16).fill(orbByte));
  const a = pdas(host.publicKey, orbId, mint);
  const args = createArgs(orbId, overrides?.startOffset ?? 2, overrides?.window ?? LOCAL_WINDOW_SECONDS, overrides?.prizeUsdMicros ?? 5_000_000, overrides?.feeAmount ?? FEE);
  const payer = overrides?.payer ?? relayer;
  const treasuryOwner = overrides?.treasuryOwner ?? treasury.publicKey;
  const treasuryTokenAccount = overrides?.treasuryAccount ?? a.treasuryTokenAccount;
  const tx = program.methods.createAndFundOrb(args).accountsStrict({
    host: host.publicKey,
    payer: payer.publicKey,
    config: a.config,
    feeQuoteAuthority: quoteAuthority.publicKey,
    orb: a.orb,
    hostPolicy: a.hostPolicy,
    mint,
    hostTokenAccount: a.hostTokenAccount,
    prizeVault: a.prizeVault,
    treasury: treasuryOwner,
    treasuryTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).signers([host, payer, quoteAuthority]);
  const signature = await tx.rpc();
  return { ...a, args, signature, orbId };
}

async function createMintAndFundHost(host: Keypair, raw = 50_000_000, freezeAuthority: PublicKey | null = null) {
  const mint = await createMint(connection, relayer, relayer.publicKey, freezeAuthority, DECIMALS);
  const hostAta = await getOrCreateAssociatedTokenAccount(connection, relayer, mint, host.publicKey);
  await mintTo(connection, relayer, mint, hostAta.address, relayer, raw);
  return { mint, hostAta: hostAta.address };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("orbs_protocol adversarial security", () => {
  before(async () => {
    await Promise.all([airdrop(relayer.publicKey, 15), airdrop(refundCaller.publicKey, 2), airdrop(badPayer.publicKey, 2)]);
    const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId);
    const existing = await connection.getAccountInfo(config, "confirmed");
    if (!existing) {
      await program.methods.initializeProtocol(claimAuthority.publicKey, quoteAuthority.publicKey).accountsStrict({
        initializer: treasury.publicKey,
        payer: relayer.publicKey,
        config,
        systemProgram: SystemProgram.programId,
      }).signers([treasury, relayer]).rpc();
    }
  });

  it("funds an isolated vault from a host with no SOL and pays the exact separate fee", async () => {
    const { mint } = await createMintAndFundHost(ordinaryHost);
    const hostSolBefore = await connection.getBalance(ordinaryHost.publicKey, "confirmed");
    assert.equal(hostSolBefore, 0, "host should begin with zero SOL");
    const created = await createFundedOrb(ordinaryHost, mint, 11);
    const vault = await getAccount(connection, created.prizeVault);
    const treasuryAta = await getAccount(connection, created.treasuryTokenAccount);
    assert.equal(vault.amount, BigInt(PRIZE));
    assert.equal(treasuryAta.amount, BigInt(FEE));
    assert.equal(await connection.getBalance(ordinaryHost.publicKey, "confirmed"), 0, "host must not need SOL");
  });

  it("rejects a non-relayer creator-side rent payer", async () => {
    const host = alternateHost;
    const { mint } = await createMintAndFundHost(host);
    await expectFail(createFundedOrb(host, mint, 12, { payer: badPayer }), "wrong rent payer");
  });

  it("rejects treasury substitution", async () => {
    const host = key(12);
    const { mint } = await createMintAndFundHost(host);
    const fakeTreasury = key(13).publicKey;
    const fakeAta = getAssociatedTokenAddressSync(mint, fakeTreasury);
    await expectFail(createFundedOrb(host, mint, 13, { treasuryOwner: fakeTreasury, treasuryAccount: fakeAta }), "fake treasury");
  });

  it("enforces the $5 minimum and exact custody window even when the quote signer signs", async () => {
    const lowHost = key(14);
    const low = await createMintAndFundHost(lowHost);
    await expectFail(createFundedOrb(lowHost, low.mint, 14, { prizeUsdMicros: 4_999_999 }), "sub-minimum prize");

    const badWindowHost = key(15);
    const badWindow = await createMintAndFundHost(badWindowHost);
    await expectFail(createFundedOrb(badWindowHost, badWindow.mint, 15, { window: LOCAL_WINDOW_SECONDS + 1 }), "wrong settlement window");
  });


  it("rejects a grossly excessive fee even when the quote authority signs it", async () => {
    const host = key(26);
    const { mint } = await createMintAndFundHost(host);
    await expectFail(createFundedOrb(host, mint, 26, { feeAmount: 1_300_001 }), "excessive protocol fee");
  });

  it("rejects classic SPL mints that retain a freeze authority", async () => {
    const host = key(27);
    const freezeAuthority = key(28);
    const { mint } = await createMintAndFundHost(host, 50_000_000, freezeAuthority.publicKey);
    await expectFail(createFundedOrb(host, mint, 27), "freezable mint");
  });

  it("enforces one active Orb per normal host but permits reuse after expiry without refunding the old Orb", async () => {
    const host = key(16);
    const { mint } = await createMintAndFundHost(host, 80_000_000);
    const first = await createFundedOrb(host, mint, 16);
    await expectFail(createFundedOrb(host, mint, 17), "second active Orb");
    const activeUntil = first.args.refundAfter.toNumber();
    const waitMs = Math.max(0, (activeUntil - nowSeconds() + 1) * 1000);
    await sleep(waitMs);
    const second = await createFundedOrb(host, mint, 17);
    assert.ok(second.signature.length > 0, "creator should be reusable after expiry");
    assert.ok(await connection.getAccountInfo(first.orb), "expired first Orb remains safely refundable");
  });

  it("keeps the designated admin creator exempt only from concurrency", async () => {
    const { mint } = await createMintAndFundHost(adminHost, 80_000_000);
    const first = await createFundedOrb(adminHost, mint, 18);
    const second = await createFundedOrb(adminHost, mint, 19);
    assert.ok(first.signature.length > 0 && second.signature.length > 0);
  });

  it("rejects premature, host-as-winner, and wrong-authority claims, then pays once to the canonical winner ATA", async () => {
    const host = key(20);
    const { mint } = await createMintAndFundHost(host);
    const created = await createFundedOrb(host, mint, 20);
    const winnerAta = getAssociatedTokenAddressSync(mint, winner.publicKey);
    const claimAccounts = {
      payer: relayer.publicKey,
      rentReceiver: relayer.publicKey,
      config: created.config,
      claimAuthority: claimAuthority.publicKey,
      orb: created.orb,
      mint,
      prizeVault: created.prizeVault,
      winner: winner.publicKey,
      winnerTokenAccount: winnerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    const claimArgs = {
      resultHash: Array.from(new Uint8Array(32).fill(7)),
      completedAt: created.args.startsAt,
    };
    await expectFail(program.methods.claimPrize(claimArgs).accountsStrict(claimAccounts).signers([relayer, claimAuthority, winner]).rpc(), "premature claim");
    const waitMs = Math.max(0, (created.args.startsAt.toNumber() - nowSeconds() + 1) * 1000);
    await sleep(waitMs);

    const wrongClaim = key(21);
    await expectFail(program.methods.claimPrize(claimArgs).accountsStrict({ ...claimAccounts, claimAuthority: wrongClaim.publicKey }).signers([relayer, wrongClaim, winner]).rpc(), "wrong claim authority");

    const hostAta = getAssociatedTokenAddressSync(mint, host.publicKey);
    await expectFail(program.methods.claimPrize(claimArgs).accountsStrict({ ...claimAccounts, winner: host.publicKey, winnerTokenAccount: hostAta }).signers([relayer, claimAuthority, host]).rpc(), "host winner");

    const substitutedWinnerAta = getAssociatedTokenAddressSync(mint, refundCaller.publicKey);
    await expectFail(program.methods.claimPrize(claimArgs).accountsStrict({ ...claimAccounts, winnerTokenAccount: substitutedWinnerAta }).signers([relayer, claimAuthority, winner]).rpc(), "winner ATA substitution");

    await program.methods.claimPrize(claimArgs).accountsStrict(claimAccounts).signers([relayer, claimAuthority, winner]).rpc();
    const winnerAccount = await getAccount(connection, winnerAta);
    assert.equal(winnerAccount.amount, BigInt(PRIZE));
    assert.equal(await connection.getAccountInfo(created.orb, "confirmed"), null, "Orb must close after claim");
    assert.equal(await connection.getAccountInfo(created.prizeVault, "confirmed"), null, "vault must close after claim");
    await expectFail(program.methods.claimPrize(claimArgs).accountsStrict(claimAccounts).signers([relayer, claimAuthority, winner]).rpc(), "double claim");
  });

  it("allows a permissionless expiry refund but fixes the SPL destination to the original host ATA", async () => {
    const host = key(22);
    const { mint, hostAta } = await createMintAndFundHost(host);
    const before = (await getAccount(connection, hostAta)).amount;
    const created = await createFundedOrb(host, mint, 22);
    const waitMs = Math.max(0, (created.args.refundAfter.toNumber() - nowSeconds() + 1) * 1000);
    await sleep(waitMs);
    const refundAccounts = {
      payer: refundCaller.publicKey,
      rentReceiver: relayer.publicKey,
      orb: created.orb,
      mint,
      prizeVault: created.prizeVault,
      host: host.publicKey,
      hostTokenAccount: hostAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    const divertedAta = getAssociatedTokenAddressSync(mint, winner.publicKey);
    await expectFail(program.methods.refundExpired().accountsStrict({ ...refundAccounts, hostTokenAccount: divertedAta }).signers([refundCaller]).rpc(), "refund destination substitution");
    await program.methods.refundExpired().accountsStrict(refundAccounts).signers([refundCaller]).rpc();
    const after = (await getAccount(connection, hostAta)).amount;
    assert.equal(after, before - BigInt(FEE), "host should recover the entire prize while the already-paid protocol fee remains paid");
    assert.equal(await connection.getAccountInfo(created.orb, "confirmed"), null);
    assert.equal(await connection.getAccountInfo(created.prizeVault, "confirmed"), null);
  });

  it("cannot be griefed by pre-creating the deterministic Orb vault ATA", async () => {
    const host = key(25);
    const { mint } = await createMintAndFundHost(host);
    const orbId = Array.from(new Uint8Array(16).fill(25));
    const expected = pdas(host.publicKey, orbId, mint);
    const precreated = await getOrCreateAssociatedTokenAccount(connection, relayer, mint, expected.orb, true);
    assert.equal(precreated.address.toBase58(), expected.prizeVault.toBase58());
    await mintTo(connection, relayer, mint, precreated.address, relayer, 1);

    const created = await createFundedOrb(host, mint, 25);
    const vault = await getAccount(connection, created.prizeVault);
    assert.equal(vault.amount, BigInt(PRIZE + 1), "unsolicited dust must not change the exact host-funded prize delta");
  });

  it("rotates claim and quote authorities only with treasury + current + new signer consent", async () => {
    const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId);
    const nextClaim = key(23);
    const nextQuote = key(24);

    await expectFail(program.methods.rotateClaimAuthority().accountsStrict({
      treasury: treasury.publicKey,
      config,
      currentClaimAuthority: claimAuthority.publicKey,
      newClaimAuthority: nextClaim.publicKey,
    }).signers([claimAuthority, nextClaim]).rpc(), "claim rotation without treasury");

    await program.methods.rotateClaimAuthority().accountsStrict({
      treasury: treasury.publicKey,
      config,
      currentClaimAuthority: claimAuthority.publicKey,
      newClaimAuthority: nextClaim.publicKey,
    }).signers([treasury, claimAuthority, nextClaim]).rpc();
    let state = await program.account.protocolConfig.fetch(config);
    assert.equal(state.claimAuthority.toBase58(), nextClaim.publicKey.toBase58());

    await program.methods.rotateClaimAuthority().accountsStrict({
      treasury: treasury.publicKey,
      config,
      currentClaimAuthority: nextClaim.publicKey,
      newClaimAuthority: claimAuthority.publicKey,
    }).signers([treasury, nextClaim, claimAuthority]).rpc();

    await expectFail(program.methods.rotateFeeQuoteAuthority().accountsStrict({
      treasury: treasury.publicKey,
      config,
      currentFeeQuoteAuthority: quoteAuthority.publicKey,
      newFeeQuoteAuthority: nextQuote.publicKey,
    }).signers([treasury, nextQuote]).rpc(), "quote rotation without current signer");

    await program.methods.rotateFeeQuoteAuthority().accountsStrict({
      treasury: treasury.publicKey,
      config,
      currentFeeQuoteAuthority: quoteAuthority.publicKey,
      newFeeQuoteAuthority: nextQuote.publicKey,
    }).signers([treasury, quoteAuthority, nextQuote]).rpc();
    state = await program.account.protocolConfig.fetch(config);
    assert.equal(state.feeQuoteAuthority.toBase58(), nextQuote.publicKey.toBase58());

    await program.methods.rotateFeeQuoteAuthority().accountsStrict({
      treasury: treasury.publicKey,
      config,
      currentFeeQuoteAuthority: nextQuote.publicKey,
      newFeeQuoteAuthority: quoteAuthority.publicKey,
    }).signers([treasury, nextQuote, quoteAuthority]).rpc();
  });

});
